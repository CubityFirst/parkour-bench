import * as THREE from 'three';
import { CollisionWorld } from '../world/CollisionWorld';
import { AudioManager } from '../game/AudioManager';

export interface PlayerEvents {
  onJump?: () => void;
  onLand?: () => void;
  onSlide?: () => void;
  onVault?: () => void;
}

export class PlayerController {
  readonly position = new THREE.Vector3(); // feet position
  readonly velocity = new THREE.Vector3();
  readonly keys = new Set<string>();
  yaw = 0;
  pitch = -0.04;
  sensitivity = 1;
  reducedMotion = false;
  grounded = false;
  sliding = false;
  wallRunning = false;
  private readonly radius = 0.42;
  private standHeight = 1.72;
  private slideHeight = 0.88;
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpHeld = false;
  private slideHeld = false;
  private interactQueued = false;
  private wallTime = 0;
  private wallCooldown = 0;
  private wallNormal = new THREE.Vector3();
  private vaultTime = 0;
  private vaultDuration = 0;
  private vaultStart = new THREE.Vector3();
  private vaultTarget = new THREE.Vector3();
  private cameraRoll = 0;
  private landingKick = 0;
  private bobTime = 0;
  private justLanded = false;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly world: CollisionWorld, private readonly audio: AudioManager, private readonly events: PlayerEvents = {}) {
    this.camera.rotation.order = 'YXZ';
  }

  connectInput(target = window): () => void {
    const down = (event: KeyboardEvent) => {
      const key = event.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) event.preventDefault();
      if (!this.keys.has(key)) {
        if (key === 'Space') { this.jumpBuffer = 0.14; this.jumpHeld = true; }
        if (key === 'ControlLeft' || key === 'ControlRight' || key === 'KeyC') this.slideHeld = true;
        if (key === 'KeyE') this.interactQueued = true;
      }
      this.keys.add(key);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') this.jumpHeld = false;
      if (event.code === 'ControlLeft' || event.code === 'ControlRight' || event.code === 'KeyC') this.slideHeld = false;
      this.keys.delete(event.code);
    };
    const mouse = (event: MouseEvent) => {
      this.yaw -= event.movementX * 0.0018 * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018 * this.sensitivity, -1.42, 1.42);
    };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    document.addEventListener('mousemove', mouse);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      document.removeEventListener('mousemove', mouse);
    };
  }

  reset(spawn: THREE.Vector3): void {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.sliding = false;
    this.wallRunning = false;
    this.wallCooldown = 0;
    this.vaultTime = 0;
    this.jumpBuffer = 0;
    this.cameraRoll = 0;
    this.landingKick = 0;
  }

  get speed(): number { return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z); }
  get height(): number { return this.sliding ? this.slideHeight : this.standHeight; }
  get isVaulting(): boolean { return this.vaultDuration > 0; }
  get forward(): THREE.Vector3 { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  private down(code: string): boolean { return this.keys.has(code); }
  private horizontalMove(): THREE.Vector3 {
    const forward = this.forward;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const result = new THREE.Vector3();
    if (this.down('KeyW')) result.add(forward);
    if (this.down('KeyS')) result.sub(forward);
    if (this.down('KeyD')) result.add(right);
    if (this.down('KeyA')) result.sub(right);
    return result.lengthSq() > 0 ? result.normalize() : result;
  }

  private beginVault(target: THREE.Vector3, duration: number): void {
    this.vaultStart.copy(this.position);
    this.vaultTarget.copy(target);
    this.vaultTime = 0;
    this.vaultDuration = duration;
    this.velocity.set(0, 0, 0);
    this.wallRunning = false;
    this.sliding = false;
    this.events.onVault?.();
  }

  update(dt: number): void {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.justLanded = false;
    const forward = this.forward;

    if (this.vaultDuration > 0) {
      this.vaultTime += dt;
      const t = Math.min(1, this.vaultTime / this.vaultDuration);
      const ease = t * t * (3 - 2 * t);
      this.position.lerpVectors(this.vaultStart, this.vaultTarget, ease);
      this.position.y += Math.sin(Math.PI * t) * (this.vaultDuration < 0.35 ? 0.75 : 0.35);
      if (t >= 1) {
        this.position.copy(this.vaultTarget);
        this.vaultDuration = 0;
        this.grounded = true;
      }
      this.updateCamera(dt);
      return;
    }

    const desired = this.horizontalMove();
    const sprinting = this.down('ShiftLeft') || this.down('ShiftRight');
    const currentSpeed = this.speed;
    const wantSlide = this.slideHeld && (this.grounded || currentSpeed > 4.7);
    if (wantSlide && !this.sliding && currentSpeed > 4.2) {
      this.sliding = true;
      this.velocity.multiplyScalar(1.06);
      this.audio.slide();
      this.events.onSlide?.();
    }
    if (this.sliding && !this.slideHeld && this.canStand()) this.sliding = false;
    const targetSpeed = this.sliding ? Math.max(4.7, currentSpeed) : (sprinting ? 10.4 : 6.7);
    const acceleration = this.grounded ? (this.sliding ? 7 : 38) : 9;
    if (desired.lengthSq()) {
      const target = desired.multiplyScalar(targetSpeed);
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, target.x, acceleration, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, target.z, acceleration, dt);
    } else if (this.grounded && !this.sliding) {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, 16, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, 16, dt);
    } else if (this.sliding) {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, 1.3, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, 1.3, dt);
    }

    const nearWall = !this.grounded ? this.world.findRunnableWall(this.position, 0.82) : null;
    if (!this.wallRunning && nearWall && this.speed > 6 && this.velocity.y < 2 && this.wallCooldown <= 0) {
      this.wallRunning = true;
      this.wallNormal.copy(nearWall);
      this.wallTime = 1.55;
    }
    if (this.wallRunning) {
      this.wallTime -= dt;
      const stillNear = this.world.findRunnableWall(this.position, 0.92);
      if (!stillNear || this.wallTime <= 0) {
        this.wallRunning = false;
        this.wallCooldown = 0.55;
      }
      else {
        this.wallNormal.copy(stillNear);
        this.velocity.y = Math.max(this.velocity.y - 5.2 * dt, -2.4);
        const along = new THREE.Vector3(-this.wallNormal.z, 0, this.wallNormal.x);
        if (along.dot(this.velocity) < 0) along.negate();
        const alongSpeed = Math.max(7.8, this.speed);
        this.velocity.x = THREE.MathUtils.damp(this.velocity.x, along.x * alongSpeed, 6, dt);
        this.velocity.z = THREE.MathUtils.damp(this.velocity.z, along.z * alongSpeed, 6, dt);
      }
    } else {
      this.velocity.y -= 22 * dt;
    }

    if (!this.jumpHeld && this.velocity.y > 3.2) this.velocity.y = Math.min(this.velocity.y, 3.2);
    if (this.jumpBuffer > 0) {
      if (this.wallRunning) {
        this.velocity.y = 7.7;
        this.velocity.addScaledVector(this.wallNormal, 5.7);
        this.wallRunning = false;
        this.wallCooldown = 0.25;
        this.jumpBuffer = 0;
        this.audio.jump();
        this.events.onJump?.();
      } else if (this.grounded || this.coyote > 0) {
        this.velocity.y = this.sliding ? 7.25 : 8.15;
        this.grounded = false;
        this.sliding = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.audio.jump();
        this.events.onJump?.();
      }
    }

    if (this.interactQueued) {
      const vault = this.world.vaultAhead(this.position, forward, this.radius);
      const ledge = !vault && !this.grounded ? this.world.ledgeAhead(this.position, forward) : null;
      if (vault) this.beginVault(vault.target, 0.36);
      else if (ledge) this.beginVault(ledge, 0.42);
      this.interactQueued = false;
    }

    const wasGrounded = this.grounded;
    const hit = this.world.move(this.position, this.velocity.clone().multiplyScalar(dt), this.radius, this.height);
    if (hit.hitX) this.velocity.x = 0;
    if (hit.hitZ) this.velocity.z = 0;
    if (hit.ceiling) this.velocity.y = Math.min(0, this.velocity.y);
    if (hit.grounded) {
      if (!wasGrounded && this.velocity.y < -4.5) {
        this.landingKick = Math.min(0.14, -this.velocity.y * 0.013);
        this.audio.land();
        this.events.onLand?.();
      }
      this.velocity.y = 0;
      this.grounded = true;
      this.coyote = 0.12;
      this.wallRunning = false;
      this.wallCooldown = 0;
    } else {
      this.grounded = false;
      this.coyote = Math.max(0, this.coyote - dt);
    }
    if (this.position.y < -32) this.position.y = -32;
    this.updateCamera(dt);
  }

  private canStand(): boolean {
    const probe = this.position.clone();
    const clearance = this.world.move(probe, new THREE.Vector3(), this.radius, this.standHeight);
    return !clearance.hitX && !clearance.hitZ;
  }

  private updateCamera(dt: number): void {
    const speed = this.speed;
    this.bobTime += dt * (this.grounded ? Math.min(speed, 10) : 2);
    const motion = this.reducedMotion ? 0.25 : 1;
    const bob = this.grounded && speed > 1 ? Math.sin(this.bobTime * 10) * 0.045 * motion : 0;
    const cameraHeight = (this.sliding ? 0.64 : 1.54) + bob - this.landingKick;
    this.landingKick = THREE.MathUtils.damp(this.landingKick, 0, 10, dt);
    const rightVelocity = this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw);
    const rollTarget = (this.wallRunning ? this.wallNormal.x * -0.18 : THREE.MathUtils.clamp(-rightVelocity * 0.014, -0.055, 0.055)) * motion;
    this.cameraRoll = THREE.MathUtils.damp(this.cameraRoll, rollTarget, 10, dt);
    this.camera.position.set(this.position.x, this.position.y + cameraHeight, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.cameraRoll, 'YXZ');
    const targetFov = 74 + Math.min(10, Math.max(0, speed - 4) * 1.15) * motion;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 8, dt);
    this.camera.updateProjectionMatrix();
  }
}
