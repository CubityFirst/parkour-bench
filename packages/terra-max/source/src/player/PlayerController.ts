import * as THREE from 'three';
import { Input } from '../game/Input';
import { CollisionWorld, WallContact } from '../world/CollisionWorld';

export type PlayerEvents = {
  jumped: boolean;
  landed: boolean;
  hardLanding: boolean;
  startedSlide: boolean;
  vaulted: boolean;
  startedWallRun: boolean;
};

type VaultMove = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  forward: THREE.Vector3;
  duration: number;
  elapsed: number;
  speed: number;
};

/** Momentum-focused first-person controller for the fixed-step simulation. */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly radius = 0.34;
  readonly standHeight = 1.72;
  readonly slideHeight = 1.02;

  yaw = Math.PI;
  pitch = -0.025;
  grounded = false;
  reducedMotion = false;
  cameraHeight = 1.58;
  cameraBob = 0;
  cameraRoll = 0;
  cameraFov = 75;
  wallRunning = false;

  private height = this.standHeight;
  private coyoteTime = 0;
  private jumpBuffer = 0;
  private slideTime = 0;
  private slideDirection = new THREE.Vector3(0, 0, 1);
  private wallRunTime = 0;
  private wallRunCooldown = 0;
  private wallNormal = new THREE.Vector3();
  private vault: VaultMove | null = null;
  private bobPhase = 0;
  private landingKick = 0;
  private horizontalScratch = new THREE.Vector3();
  private desiredScratch = new THREE.Vector3();
  private forwardScratch = new THREE.Vector3();
  private rightScratch = new THREE.Vector3();

  constructor(private readonly world: CollisionWorld, private readonly input: Input) {}

  reset(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.height = this.standHeight;
    this.slideTime = 0;
    this.wallRunning = false;
    this.wallRunTime = 0;
    this.wallRunCooldown = 0;
    this.vault = null;
    this.cameraRoll = 0;
    this.cameraBob = 0;
    this.landingKick = 0;
  }

  setLook(deltaX: number, deltaY: number, sensitivity: number): void {
    const scale = 0.00162 * sensitivity;
    this.yaw -= deltaX * scale;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * scale, -1.32, 1.32);
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  getSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(delta: number): PlayerEvents {
    const events: PlayerEvents = { jumped: false, landed: false, hardLanding: false, startedSlide: false, vaulted: false, startedWallRun: false };
    const jumpPressed = this.input.consumePressed('Space');
    const slidePressed = this.input.consumePressed('ControlLeft', 'ControlRight', 'KeyC');
    const vaultPressed = this.input.consumePressed('KeyE');

    this.jumpBuffer = jumpPressed ? 0.14 : Math.max(0, this.jumpBuffer - delta);
    this.wallRunCooldown = Math.max(0, this.wallRunCooldown - delta);

    if (this.vault) {
      this.updateVault(delta);
      this.updateCamera(delta);
      return events;
    }

    if (vaultPressed && this.grounded && !this.isSliding()) {
      const obstacle = this.world.findVault(this.position, this.height, this.getForward(this.forwardScratch));
      if (obstacle) {
        this.startVault(obstacle);
        events.vaulted = true;
        this.updateCamera(delta);
        return events;
      }
    }

    if (slidePressed && this.grounded && this.getSpeed() > 5.1) {
      this.startSlide();
      events.startedSlide = true;
    }
    this.updateSlide(delta);

    if (this.grounded) this.coyoteTime = 0.13;
    else this.coyoteTime = Math.max(0, this.coyoteTime - delta);

    if (this.jumpBuffer > 0 && this.wallRunning) {
      this.velocity.y = 7.2;
      this.velocity.addScaledVector(this.wallNormal, 6.1);
      this.jumpBuffer = 0;
      this.wallRunning = false;
      this.wallRunCooldown = 0.24;
      events.jumped = true;
    } else if (this.jumpBuffer > 0 && this.coyoteTime > 0) {
      this.velocity.y = this.isSliding() ? 7.35 : 6.75;
      this.grounded = false;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      events.jumped = true;
    }

    this.applyMovement(delta);
    if (!this.grounded && !this.wallRunning) {
      const contact = this.tryStartWallRun();
      if (contact) events.startedWallRun = true;
    }

    if (this.wallRunning) {
      this.wallRunTime += delta;
      const contact = this.world.findRunnableWall(this.position, this.height, this.radius);
      if (!contact || this.wallRunTime > 1.9 || !this.input.isDown('KeyW', 'KeyA', 'KeyS', 'KeyD')) {
        this.wallRunning = false;
        this.wallRunCooldown = 0.22;
      } else {
        this.wallNormal.copy(contact.normal);
        const intoWall = this.velocity.dot(this.wallNormal);
        if (intoWall < 0) this.velocity.addScaledVector(this.wallNormal, -intoWall);
        const wallForward = this.getForward(this.forwardScratch).projectOnPlane(this.wallNormal);
        if (wallForward.lengthSq() > 0.1) {
          wallForward.normalize();
          const alongSpeed = this.velocity.dot(wallForward);
          if (alongSpeed < 12.7) this.velocity.addScaledVector(wallForward, Math.min(23 * delta, 12.7 - alongSpeed));
        }
        this.velocity.y = Math.max(this.velocity.y - 17.8 * delta * 0.15, -0.85);
      }
    }

    if (!this.wallRunning) {
      this.velocity.y -= 17.8 * delta;
      if (!this.input.isDown('Space') && this.velocity.y > 0) this.velocity.y -= 15 * delta;
    }
    this.velocity.y = Math.max(this.velocity.y, -34);

    const previousY = this.position.y;
    this.world.resolveHorizontal(this.position, this.height, this.radius, this.velocity.x * delta, this.velocity.z * delta);
    const nextY = previousY + this.velocity.y * delta;
    if (this.velocity.y > 0) {
      const ceiling = this.world.resolveCeiling(this.position, this.height, this.radius, previousY, nextY);
      if (ceiling !== null) {
        this.position.y = ceiling - this.height;
        this.velocity.y = 0;
      } else {
        this.position.y = nextY;
      }
      this.grounded = false;
    } else {
      const ground = this.world.findGround(this.position, this.radius, previousY, nextY);
      if (ground !== null) {
        const impactSpeed = -this.velocity.y;
        this.position.y = ground;
        this.velocity.y = 0;
        if (!this.grounded) {
          events.landed = true;
          events.hardLanding = impactSpeed > 7.8;
          this.landingKick = Math.min(0.11, impactSpeed * 0.008);
        }
        this.grounded = true;
        this.wallRunning = false;
      } else {
        this.position.y = nextY;
        this.grounded = false;
      }
    }

    this.updateCamera(delta);
    return events;
  }

  private applyMovement(delta: number): void {
    const forward = this.getForward(this.forwardScratch);
    const right = this.rightScratch.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const forwardInput = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    const strafeInput = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    const desired = this.desiredScratch.set(0, 0, 0).addScaledVector(forward, forwardInput).addScaledVector(right, strafeInput);
    if (desired.lengthSq() > 0) desired.normalize();

    this.horizontalScratch.set(this.velocity.x, 0, this.velocity.z);
    if (this.isSliding()) {
      const speed = Math.max(0, this.horizontalScratch.length() - 6.7 * delta);
      const steer = desired.lengthSq() > 0 ? desired : this.slideDirection;
      this.slideDirection.lerp(steer, Math.min(1, delta * 1.65)).normalize();
      this.horizontalScratch.copy(this.slideDirection).multiplyScalar(speed);
    } else {
      const sprinting = this.input.isDown('ShiftLeft', 'ShiftRight') && forwardInput > 0.2;
      const topSpeed = sprinting ? 12.35 : 7.25;
      desired.multiplyScalar(topSpeed);
      const acceleration = this.grounded ? 38 : 8.5;
      const change = desired.sub(this.horizontalScratch);
      const maxChange = acceleration * delta;
      if (change.length() > maxChange) change.setLength(maxChange);
      this.horizontalScratch.add(change);
      if (forwardInput === 0 && strafeInput === 0 && this.grounded) {
        const friction = Math.max(0, 1 - 11.5 * delta);
        this.horizontalScratch.multiplyScalar(friction);
      }
    }
    this.velocity.x = this.horizontalScratch.x;
    this.velocity.z = this.horizontalScratch.z;
  }

  private tryStartWallRun(): WallContact | null {
    if (this.wallRunCooldown > 0 || this.getSpeed() < 7.3 || this.velocity.y > 4.9) return null;
    const contact = this.world.findRunnableWall(this.position, this.height, this.radius);
    if (!contact) return null;
    this.wallRunning = true;
    this.wallRunTime = 0;
    this.wallNormal.copy(contact.normal);
    this.velocity.y = Math.max(this.velocity.y, 1.15);
    const intoWall = this.velocity.dot(contact.normal);
    if (intoWall < 0) this.velocity.addScaledVector(contact.normal, -intoWall);
    return contact;
  }

  private startSlide(): void {
    this.slideTime = 1.08;
    this.height = this.slideHeight;
    this.horizontalScratch.set(this.velocity.x, 0, this.velocity.z);
    if (this.horizontalScratch.lengthSq() < 1) this.horizontalScratch.copy(this.getForward(this.forwardScratch));
    this.slideDirection.copy(this.horizontalScratch).normalize();
    this.velocity.x = this.slideDirection.x * Math.max(9.5, this.horizontalScratch.length());
    this.velocity.z = this.slideDirection.z * Math.max(9.5, this.horizontalScratch.length());
  }

  private updateSlide(delta: number): void {
    if (!this.isSliding()) return;
    this.slideTime -= delta;
    const shouldStayLow = this.slideTime > 0 && this.getSpeed() > 2.9;
    if (!shouldStayLow && this.world.canStand(this.position, this.standHeight, this.radius)) {
      this.slideTime = 0;
      this.height = this.standHeight;
    }
  }

  private isSliding(): boolean {
    return this.slideTime > 0;
  }

  private startVault(obstacle: { box: THREE.Box3 }): void {
    const forward = this.getForward(this.forwardScratch).clone();
    const speed = Math.max(8.7, this.getSpeed());
    const widthAlongDirection = Math.abs(forward.x) > Math.abs(forward.z) ? obstacle.box.getSize(new THREE.Vector3()).x : obstacle.box.getSize(new THREE.Vector3()).z;
    const distance = Math.max(1.65, widthAlongDirection + 1.15);
    const end = this.position.clone().addScaledVector(forward, distance);
    this.vault = { start: this.position.clone(), end, forward, duration: 0.42, elapsed: 0, speed };
    this.velocity.set(0, 0, 0);
    this.grounded = false;
  }

  private updateVault(delta: number): void {
    if (!this.vault) return;
    this.vault.elapsed += delta;
    const raw = THREE.MathUtils.clamp(this.vault.elapsed / this.vault.duration, 0, 1);
    const eased = raw * raw * (3 - 2 * raw);
    this.position.lerpVectors(this.vault.start, this.vault.end, eased);
    this.position.y = THREE.MathUtils.lerp(this.vault.start.y, this.vault.end.y, eased) + Math.sin(raw * Math.PI) * 0.68;
    if (raw >= 1) {
      this.position.y = this.vault.end.y;
      this.velocity.copy(this.vault.forward).multiplyScalar(this.vault.speed);
      this.grounded = true;
      this.vault = null;
    }
  }

  private updateCamera(delta: number): void {
    const speed = this.getSpeed();
    const moving = this.grounded && speed > 1.2 && !this.vault;
    if (moving) this.bobPhase += delta * (this.isSliding() ? 13 : 8.5 + speed * 0.72);
    const targetHeight = this.isSliding() ? 0.89 : 1.58;
    this.cameraHeight = THREE.MathUtils.damp(this.cameraHeight, targetHeight, 13, delta);
    const bobAmount = this.reducedMotion ? 0.007 : this.isSliding() ? 0.016 : 0.018 + Math.min(speed, 12) * 0.0015;
    this.cameraBob = moving ? Math.sin(this.bobPhase) * bobAmount : 0;
    this.landingKick = THREE.MathUtils.damp(this.landingKick, 0, 17, delta);

    const strafe = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    const wallRoll = this.wallRunning ? this.wallNormal.x * 0.15 + this.wallNormal.z * 0.15 : 0;
    const amount = this.reducedMotion ? 0.35 : 1;
    this.cameraRoll = THREE.MathUtils.damp(this.cameraRoll, (strafe * -0.028 + wallRoll) * amount, 10, delta);
    this.cameraFov = THREE.MathUtils.damp(this.cameraFov, 75 + Math.max(0, speed - 4) * 0.9 * amount, 6, delta);
  }

  getCameraY(): number {
    return this.cameraHeight + this.cameraBob - this.landingKick;
  }

  getPitch(): number {
    return this.pitch;
  }

  getYaw(): number {
    return this.yaw;
  }

  getVaultProgress(): number {
    return this.vault ? this.vault.elapsed / this.vault.duration : 0;
  }
}
