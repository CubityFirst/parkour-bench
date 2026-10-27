import * as THREE from 'three';
import { CollisionWorld, type Solid } from '../world/CollisionWorld';
import { Input } from './Input';

export type MovementEvent = 'jump' | 'land' | 'slide' | 'wallrun' | 'vault' | 'mantle';

interface Traversal {
  start: THREE.Vector3;
  end: THREE.Vector3;
  peak: number;
  elapsed: number;
  duration: number;
  direction: THREE.Vector3;
}

const RADIUS = 0.36;
const STANDING_HEIGHT = 1.8;
const SLIDING_HEIGHT = 0.9;
const GRAVITY = 24;

export class PlayerController {
  readonly position = new THREE.Vector3(0, 0, 7);
  readonly velocity = new THREE.Vector3();
  grounded = true;
  sliding = false;
  wallRunning = false;
  wallSide = 0;
  yaw = 0;
  pitch = -0.04;
  targetYaw = 0;
  targetPitch = -0.04;
  impact = 0;
  private height = STANDING_HEIGHT;
  private eyeHeight = 1.6;
  private coyote = 0;
  private jumpBuffer = 0;
  private wallRemaining = 0;
  private wallUsed = false;
  private traversal: Traversal | null = null;
  private cameraRoll = 0;
  private bobTime = 0;
  private readonly arms: THREE.Group;

  constructor(
    private readonly world: CollisionWorld,
    readonly camera: THREE.PerspectiveCamera,
    private readonly emit: (event: MovementEvent) => void,
  ) {
    this.camera.rotation.order = 'YXZ';
    this.arms = this.createArms();
    this.camera.add(this.arms);
  }

  get speed(): number { return Math.hypot(this.velocity.x, this.velocity.z); }
  get isTraversing(): boolean { return this.traversal !== null; }

  reset(position: THREE.Vector3, resetLook = false): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.sliding = false;
    this.wallRunning = false;
    this.wallSide = 0;
    this.wallUsed = false;
    this.wallRemaining = 0;
    this.height = STANDING_HEIGHT;
    this.eyeHeight = 1.6;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.traversal = null;
    this.impact = 0;
    if (resetLook) {
      this.yaw = this.targetYaw = 0;
      this.pitch = this.targetPitch = -0.04;
    }
  }

  look(mouseX: number, mouseY: number, sensitivity: number, dt: number): void {
    this.targetYaw -= mouseX * sensitivity * 0.0017;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - mouseY * sensitivity * 0.0017, -1.42, 1.42);
    const smooth = 1 - Math.exp(-22 * dt);
    this.yaw = THREE.MathUtils.lerp(this.yaw, this.targetYaw, smooth);
    this.pitch = THREE.MathUtils.lerp(this.pitch, this.targetPitch, smooth);
  }

  step(dt: number, input: Input): void {
    if (input.takeJump()) this.jumpBuffer = 0.15;
    if (this.traversal) {
      this.updateTraversal(dt);
      return;
    }
    if (input.takeAction() && (this.tryVault() || this.tryMantle())) return;

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.grounded) this.coyote = 0.12;
    else this.coyote = Math.max(0, this.coyote - dt);

    const slideHeld = input.down('ControlLeft', 'ControlRight', 'KeyC');
    if (!this.sliding && slideHeld && this.grounded && this.speed > 2.5) {
      this.sliding = true;
      this.height = SLIDING_HEIGHT;
      this.emit('slide');
    }
    if (this.sliding && !slideHeld && this.world.hasRoom(this.position, RADIUS, STANDING_HEIGHT)) {
      this.sliding = false;
      this.height = STANDING_HEIGHT;
    }

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forwardInput = Number(input.down('KeyW', 'ArrowUp')) - Number(input.down('KeyS', 'ArrowDown'));
    const sideInput = Number(input.down('KeyD', 'ArrowRight')) - Number(input.down('KeyA', 'ArrowLeft'));
    const wish = forward.multiplyScalar(forwardInput).addScaledVector(right, sideInput);
    if (wish.lengthSq() > 1) wish.normalize();

    if (!this.grounded) this.checkWallRun(dt, forwardInput);
    else {
      this.wallRunning = false;
      this.wallSide = 0;
      this.wallUsed = false;
    }

    if (this.jumpBuffer > 0) {
      if (this.wallRunning) {
        this.velocity.y = 8.2;
        this.velocity.x += -this.wallSide * 5.4;
        this.wallRunning = false;
        this.wallRemaining = 0;
        this.jumpBuffer = 0;
        this.emit('jump');
      } else if (this.coyote > 0) {
        this.velocity.y = 8.5;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        if (this.sliding && this.world.hasRoom(this.position, RADIUS, STANDING_HEIGHT)) {
          this.sliding = false;
          this.height = STANDING_HEIGHT;
        }
        this.emit('jump');
      } else if (this.tryMantle()) {
        this.jumpBuffer = 0;
        return;
      }
    }

    const sprint = input.down('ShiftLeft', 'ShiftRight');
    const maxSpeed = sprint ? 10.8 : 6.8;
    if (this.sliding && this.grounded) {
      const drag = Math.exp(-0.75 * dt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;
      this.velocity.x += wish.x * 3 * dt;
      this.velocity.z += wish.z * 3 * dt;
    } else {
      const acceleration = this.grounded ? 34 : 9;
      const targetX = wish.x * maxSpeed;
      const targetZ = wish.z * maxSpeed;
      const difference = new THREE.Vector2(targetX - this.velocity.x, targetZ - this.velocity.z);
      const maxChange = acceleration * dt;
      if (difference.length() > maxChange) difference.setLength(maxChange);
      this.velocity.x += difference.x;
      this.velocity.z += difference.y;
      if (this.grounded && wish.lengthSq() === 0) {
        const drag = Math.exp(-7 * dt);
        this.velocity.x *= drag;
        this.velocity.z *= drag;
      }
    }

    if (this.wallRunning) {
      this.velocity.y = Math.max(this.velocity.y - 6 * dt, -0.15);
      this.velocity.z = Math.sign(this.velocity.z || -1) * Math.max(Math.abs(this.velocity.z), 10.8);
    } else {
      this.velocity.y -= GRAVITY * dt;
      if (!input.down('Space') && this.velocity.y > 0) this.velocity.y -= 14 * dt;
    }

    if (this.world.moveHorizontal(this.position, this.velocity.x * dt, 'x', RADIUS, this.height)) this.velocity.x = 0;
    if (this.world.moveHorizontal(this.position, this.velocity.z * dt, 'z', RADIUS, this.height)) this.velocity.z = 0;
    const previousVerticalSpeed = this.velocity.y;
    const wasGrounded = this.grounded;
    const verticalHit = this.world.moveVertical(this.position, this.velocity.y * dt, RADIUS, this.height);
    this.grounded = verticalHit === 'ground';
    if (verticalHit) this.velocity.y = 0;
    if (this.grounded && !wasGrounded) {
      this.impact = Math.min(1, Math.abs(previousVerticalSpeed) / 12);
      this.emit('land');
    }
  }

  private checkWallRun(dt: number, forwardInput: number): void {
    if (this.wallRunning) {
      this.wallRemaining -= dt;
      if (this.wallRemaining <= 0 || !this.nearRunnableWall() || forwardInput <= 0) {
        this.wallRunning = false;
        this.wallSide = 0;
      }
      return;
    }
    if (this.wallUsed || this.speed < 5.5 || forwardInput <= 0) return;
    const side = this.nearRunnableWall();
    if (side) {
      this.wallRunning = true;
      this.wallSide = side;
      this.wallUsed = true;
      this.wallRemaining = 1.55;
      this.velocity.y = Math.min(this.velocity.y, 2.4);
      this.emit('wallrun');
    }
  }

  private nearRunnableWall(): number {
    for (const solid of this.world.solids) {
      if (!solid.runnable) continue;
      const box = solid.box;
      if (this.position.z < box.min.z - 0.1 || this.position.z > box.max.z + 0.1 ||
          this.position.y + this.height < box.min.y || this.position.y > box.max.y || Math.abs(this.velocity.z) < 4) continue;
      const leftDistance = box.min.x - this.position.x;
      const rightDistance = this.position.x - box.max.x;
      if (leftDistance >= 0 && leftDistance < 1.1) return 1;
      if (rightDistance >= 0 && rightDistance < 1.1) return -1;
    }
    return 0;
  }

  private tryVault(): boolean {
    if (!this.grounded) return false;
    const direction = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    let candidate: { solid: Solid; entry: number; exit: number } | null = null;
    for (const solid of this.world.solids) {
      if (!solid.vaultable) continue;
      const obstacleHeight = solid.box.max.y - this.position.y;
      if (obstacleHeight < 0.35 || obstacleHeight > 1.4) continue;
      let entry = -Infinity;
      let exit = Infinity;
      for (const axis of ['x', 'z'] as const) {
        const min = solid.box.min[axis] - RADIUS;
        const max = solid.box.max[axis] + RADIUS;
        if (Math.abs(direction[axis]) < 0.0001) {
          if (this.position[axis] < min || this.position[axis] > max) { entry = Infinity; break; }
        } else {
          const first = (min - this.position[axis]) / direction[axis];
          const second = (max - this.position[axis]) / direction[axis];
          entry = Math.max(entry, Math.min(first, second));
          exit = Math.min(exit, Math.max(first, second));
        }
      }
      if (entry <= exit && exit > 0 && entry >= -0.1 && entry < 1.6 && (!candidate || entry < candidate.entry)) candidate = { solid, entry, exit };
    }
    if (!candidate) return false;
    const end = this.position.clone().addScaledVector(direction, candidate.exit + 0.3);
    const ground = this.world.groundBelow(end.clone().add(new THREE.Vector3(0, 0.1, 0)), RADIUS, 2);
    if (ground === null) return false;
    end.y = ground;
    const peak = candidate.solid.box.max.y + 0.16;
    if (!this.safeTraversal(this.position, end, peak)) return false;
    this.beginTraversal(end, peak, direction, 'vault');
    return true;
  }

  private tryMantle(): boolean {
    if (this.grounded || this.velocity.y > 1.5) return false;
    const direction = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const solid of this.world.solids) {
      if (solid.kind !== 'roof') continue;
      const box = solid.box;
      const rise = box.max.y - this.position.y;
      if (rise < 0.1 || rise > 1.45) continue;
      const end = new THREE.Vector3(
        THREE.MathUtils.clamp(this.position.x, box.min.x + RADIUS + 0.15, box.max.x - RADIUS - 0.15),
        box.max.y,
        THREE.MathUtils.clamp(this.position.z, box.min.z + RADIUS + 0.15, box.max.z - RADIUS - 0.15),
      );
      const toward = end.clone().sub(this.position).setY(0);
      if (toward.length() > 1.25 || toward.length() < 0.05 || toward.clone().normalize().dot(direction) < 0.2) continue;
      if (!this.safeTraversal(this.position, end, box.max.y + 0.18)) continue;
      this.beginTraversal(end, box.max.y + 0.18, direction, 'mantle');
      return true;
    }
    return false;
  }

  private traversalPoint(start: THREE.Vector3, end: THREE.Vector3, peak: number, progress: number): THREE.Vector3 {
    const horizontal = THREE.MathUtils.smoothstep(progress, 0.25, 0.75);
    const point = start.clone().lerp(end, horizontal);
    if (progress < 0.25) point.y = THREE.MathUtils.lerp(start.y, peak, THREE.MathUtils.smoothstep(progress, 0, 0.25));
    else if (progress > 0.75) point.y = THREE.MathUtils.lerp(peak, end.y, THREE.MathUtils.smoothstep(progress, 0.75, 1));
    else point.y = peak;
    return point;
  }

  private safeTraversal(start: THREE.Vector3, end: THREE.Vector3, peak: number): boolean {
    for (let index = 1; index <= 16; index++) {
      const point = this.traversalPoint(start, end, peak, index / 16);
      if (!this.world.hasRoom(point, RADIUS, STANDING_HEIGHT)) return false;
    }
    return true;
  }

  private beginTraversal(end: THREE.Vector3, peak: number, direction: THREE.Vector3, event: 'vault' | 'mantle'): void {
    this.traversal = { start: this.position.clone(), end, peak, elapsed: 0, duration: event === 'vault' ? 0.62 : 0.55, direction };
    this.sliding = false;
    this.height = STANDING_HEIGHT;
    this.grounded = false;
    this.wallRunning = false;
    this.emit(event);
  }

  private updateTraversal(dt: number): void {
    const traversal = this.traversal!;
    traversal.elapsed += dt;
    const progress = Math.min(1, traversal.elapsed / traversal.duration);
    this.position.copy(this.traversalPoint(traversal.start, traversal.end, traversal.peak, progress));
    if (progress >= 1) {
      const carry = Math.max(5.5, Math.min(10.8, this.speed));
      this.velocity.set(traversal.direction.x * carry, 0, traversal.direction.z * carry);
      this.grounded = true;
      this.traversal = null;
    }
  }

  render(dt: number, reducedMotion: boolean, active: boolean): void {
    const speed = this.speed;
    this.bobTime += dt * Math.min(speed, 10) * 1.3;
    const motion = reducedMotion ? 0 : 1;
    const desiredEye = this.sliding ? 0.7 : 1.6;
    this.eyeHeight = THREE.MathUtils.lerp(this.eyeHeight, desiredEye, 1 - Math.exp(-12 * dt));
    this.impact = Math.max(0, this.impact - dt * 3);
    const bob = this.grounded && speed > 1 ? Math.sin(this.bobTime * 2) * Math.min(speed / 10, 1) * 0.035 * motion : 0;
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight + bob - this.impact * 0.09 * motion, this.position.z);
    const targetRoll = this.wallRunning ? -this.wallSide * 0.1 : THREE.MathUtils.clamp(-this.velocity.x * 0.003, -0.025, 0.025);
    this.cameraRoll = THREE.MathUtils.lerp(this.cameraRoll, targetRoll * motion, 1 - Math.exp(-8 * dt));
    this.camera.rotation.set(this.pitch, this.yaw, this.cameraRoll);
    const targetFov = 74 + Math.min(speed / 10.8, 1) * 8 * motion;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-4 * dt));
    this.camera.updateProjectionMatrix();
    this.arms.visible = active && (speed > 1.5 || this.isTraversing || this.sliding || !this.grounded);
    this.arms.position.y = this.isTraversing ? 0.12 : 0;
    this.arms.rotation.z = Math.sin(this.bobTime) * 0.025 * motion;
  }

  private createArms(): THREE.Group {
    const group = new THREE.Group();
    const sleeve = new THREE.MeshBasicMaterial({ color: 0xdce4e3, depthTest: false });
    const glove = new THREE.MeshBasicMaterial({ color: 0xe3242f, depthTest: false });
    const dark = new THREE.MeshBasicMaterial({ color: 0x303c42, depthTest: false });
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.88, -0.82, -1.15);
      arm.rotation.z = side * 0.25;
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.3, 0.13), sleeve);
      forearm.position.y = -0.04;
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.14), dark);
      cuff.position.y = 0.12;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.13), glove);
      hand.position.y = 0.21;
      forearm.renderOrder = cuff.renderOrder = hand.renderOrder = 10;
      arm.add(forearm, cuff, hand);
      group.add(arm);
    }
    return group;
  }
}
