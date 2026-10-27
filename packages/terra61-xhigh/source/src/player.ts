import * as THREE from 'three';
import type { Solid } from './world';

const RADIUS = 0.32;
const STANDING = 1.75;
const CROUCHING = 0.9;

export class Player {
  readonly position = new THREE.Vector3(0, 0, 7);
  readonly velocity = new THREE.Vector3();
  readonly keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  grounded = false;
  sliding = false;
  wallSide = 0;
  sensitivity = 1;
  reducedMotion = false;
  onEvent: (name: string) => void = () => {};
  private height = STANDING;
  private eyeHeight = 1.6;
  private coyote = 0;
  private jumpBuffer = 0;
  private wallTime = 0;
  private wallUsed = false;
  private slideTime = 0;
  private impact = 0;
  private bob = 0;
  private stepTimer = 0;
  private readonly arms: THREE.Group[] = [];
  private vault: { start: THREE.Vector3; end: THREE.Vector3; time: number; duration: number } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private solids: Solid[]) {
    camera.rotation.order = 'YXZ';
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xe9f0ee, roughness: 0.9 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a3538, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.15, 0.46), sleeve);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.2), glove);
      hand.position.z = -0.3; arm.add(forearm, hand); arm.position.set(side * 0.47, -0.48, -0.65);
      arm.rotation.z = side * 0.2; camera.add(arm); this.arms.push(arm);
    }
  }

  keyDown(code: string) {
    if (!this.keys.has(code) && code === 'Space') this.jumpBuffer = 0.15;
    if (!this.keys.has(code) && code === 'KeyE') this.tryVault();
    this.keys.add(code);
  }

  keyUp(code: string) {
    this.keys.delete(code);
    if (code === 'Space' && this.velocity.y > 3) this.velocity.y *= 0.55;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.002 * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.002 * this.sensitivity, -1.48, 1.48);
  }

  reset(x: number, y: number, z: number) {
    this.position.set(x, y + 0.03, z); this.velocity.set(0, 0, 0); this.grounded = false;
    this.wallSide = 0; this.wallUsed = false; this.wallTime = 0; this.slideTime = 0;
    this.sliding = false; this.height = STANDING; this.vault = null; this.jumpBuffer = 0; this.keys.clear();
  }

  update(dt: number) {
    if (this.vault) {
      this.vault.time += dt;
      const progress = Math.min(1, this.vault.time / this.vault.duration);
      const eased = progress * progress * (3 - 2 * progress);
      this.position.lerpVectors(this.vault.start, this.vault.end, eased);
      this.position.y += Math.sin(progress * Math.PI) * 0.4;
      if (progress === 1) { this.vault = null; this.velocity.y = 0; }
      this.updateCamera(dt); return;
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const input = new THREE.Vector3();
    if (this.keys.has('KeyW')) input.add(forward);
    if (this.keys.has('KeyS')) input.sub(forward);
    if (this.keys.has('KeyD')) input.add(right);
    if (this.keys.has('KeyA')) input.sub(right);
    input.normalize();
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const crouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC');
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (crouch && this.grounded && speed > 5 && !this.sliding) { this.sliding = true; this.slideTime = 0; this.onEvent('slide'); }
    if (this.sliding) {
      this.slideTime += dt;
      if ((!crouch || speed < 2.3 || this.slideTime > 1.8) && this.canStand()) this.sliding = false;
    }
    this.height = this.sliding ? CROUCHING : STANDING;
    const targetSpeed = sprint ? 12.5 : 7.5;
    if (this.sliding) {
      const friction = Math.max(0, 1 - 0.42 * dt);
      this.velocity.x *= friction; this.velocity.z *= friction;
    } else {
      const acceleration = this.grounded ? (input.lengthSq() ? 13 : 10) : 2.4;
      const blend = 1 - Math.exp(-acceleration * dt);
      this.velocity.x += (input.x * targetSpeed - this.velocity.x) * blend;
      this.velocity.z += (input.z * targetSpeed - this.velocity.z) * blend;
    }

    this.wallSide = 0;
    if (!this.grounded && !this.wallUsed && speed > 6) {
      for (const solid of this.solids) {
        if (!solid.runnable || this.position.z < solid.min.z - 0.3 || this.position.z > solid.max.z + 0.3 || this.position.y + 1 < solid.min.y || this.position.y > solid.max.y) continue;
        const leftDistance = this.position.x - solid.max.x;
        const rightDistance = solid.min.x - this.position.x;
        if (leftDistance >= 0 && leftDistance < 1.1) this.wallSide = -1;
        if (rightDistance >= 0 && rightDistance < 1.1) this.wallSide = 1;
        if (this.wallSide) break;
      }
      if (this.wallSide) {
        if (this.wallTime === 0) this.onEvent('wall');
        this.wallTime += dt;
        this.velocity.y = Math.max(this.velocity.y, -1.0);
        if (Math.abs(this.velocity.z) < 16) this.velocity.z = (this.velocity.z < 0 ? -1 : 1) * 16;
        if (this.wallTime > 1.55) { this.wallUsed = true; this.wallSide = 0; }
      } else if (this.wallTime > 0) { this.wallUsed = true; }
    }
    if (this.jumpBuffer > 0 && (this.coyote > 0 || this.wallSide !== 0)) {
      if (this.wallSide) { this.velocity.x = -this.wallSide * 5.2; this.wallUsed = true; }
      this.velocity.y = 9; this.grounded = false; this.coyote = 0; this.jumpBuffer = 0;
      if (this.sliding && this.canStand()) { this.sliding = false; this.height = STANDING; }
      this.onEvent('jump');
    }
    this.velocity.y -= (this.wallSide ? 3.5 : 24) * dt;

    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);
    const wasGrounded = this.grounded;
    const fallingSpeed = this.velocity.y;
    this.grounded = false;
    this.moveAxis('y', this.velocity.y * dt);
    if (this.grounded) {
      this.wallUsed = false; this.wallTime = 0;
      if (!wasGrounded && fallingSpeed < -3) { this.impact = Math.min(0.13, -fallingSpeed * 0.009); this.onEvent('land'); }
      if (speed > 3 && !this.sliding) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) { this.onEvent('step'); this.stepTimer = speed > 9 ? 0.32 : 0.46; }
      } else this.stepTimer = 0;
    }
    this.updateCamera(dt);
  }

  private overlaps(position: THREE.Vector3, height: number, solid: Solid) {
    return position.x + RADIUS > solid.min.x && position.x - RADIUS < solid.max.x && position.z + RADIUS > solid.min.z && position.z - RADIUS < solid.max.z && position.y < solid.max.y && position.y + height > solid.min.y;
  }

  private canStand() { return !this.solids.some(solid => this.overlaps(this.position, STANDING, solid)); }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number) {
    if (!amount) return;
    this.position[axis] += amount;
    for (const solid of this.solids) {
      if (!this.overlaps(this.position, this.height, solid)) continue;
      if (axis === 'y') {
        if (amount < 0) { this.position.y = solid.max.y; this.grounded = true; }
        else this.position.y = solid.min.y - this.height;
      } else this.position[axis] = amount > 0 ? solid.min[axis] - RADIUS : solid.max[axis] + RADIUS;
      this.velocity[axis] = 0;
    }
  }

  private tryVault() {
    if (this.vault) return;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const solid of this.solids) {
      const top = solid.max.y - this.position.y;
      if (top < 0.25 || top > 1.65 || solid.runnable) continue;
      for (let distance = 0.4; distance <= 1.8; distance += 0.2) {
        const probe = this.position.clone().addScaledVector(forward, distance);
        if (probe.x < solid.min.x - RADIUS || probe.x > solid.max.x + RADIUS || probe.z < solid.min.z - RADIUS || probe.z > solid.max.z + RADIUS) continue;
        const end = probe.clone().addScaledVector(forward, 1.1); end.y = solid.max.y + 0.03;
        if (this.solids.some(other => other !== solid && this.overlaps(end, STANDING, other))) break;
        this.vault = { start: this.position.clone(), end, time: 0, duration: 0.38 };
        this.velocity.y = 0; this.onEvent('vault'); return;
      }
    }
  }

  private updateCamera(dt: number) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.eyeHeight += ((this.sliding ? 0.72 : 1.6) - this.eyeHeight) * Math.min(1, dt * 10);
    this.impact *= Math.exp(-8 * dt);
    if (this.grounded && speed > 1) this.bob += dt * (speed * 0.85);
    const motion = this.reducedMotion ? 0 : Math.sin(this.bob * 1.8) * Math.min(speed / 12, 1) * 0.035;
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight + motion - this.impact, this.position.z);
    const strafe = this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw);
    this.camera.rotation.set(this.pitch, this.yaw, this.reducedMotion ? 0 : -this.wallSide * 0.1 - strafe * 0.002, 'YXZ');
    for (let index = 0; index < this.arms.length; index++) {
      const swing = this.reducedMotion ? 0 : Math.sin(this.bob * 1.8 + index * Math.PI) * Math.min(speed / 12, 1);
      this.arms[index].position.y = -0.48 + swing * 0.04 + (this.vault ? 0.14 : 0);
      this.arms[index].rotation.x = swing * 0.14 + (this.vault ? -0.35 : 0);
    }
    const targetFov = 75 + Math.min(speed / 12, 1) * 7;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix();
  }
}
