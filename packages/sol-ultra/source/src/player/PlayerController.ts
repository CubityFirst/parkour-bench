import {
  Box3, BoxGeometry, Group, MathUtils, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Vector3,
} from 'three';
import { Input } from './Input';
import { CollisionWorld, type Collider } from '../world/CollisionWorld';

export const PLAYER_TUNING = {
  radius: 0.31,
  standingHeight: 1.75,
  slidingHeight: 0.8,
  walkSpeed: 7,
  sprintSpeed: 12,
  jumpSpeed: 9.6,
  gravity: 24,
};

interface Traversal {
  start: Vector3;
  end: Vector3;
  high: number;
  elapsed: number;
  duration: number;
  momentum: Vector3;
}

const EPSILON = 0.001;

export class PlayerController {
  readonly position = new Vector3(0, 0, 0);
  readonly velocity = new Vector3();
  readonly input = new Input();
  readonly events: string[] = [];
  yaw = 0;
  pitch = 0;
  grounded = false;
  state = 'READY';
  sensitivity = 1;
  reducedMotion = false;
  enabled = false;

  private height = PLAYER_TUNING.standingHeight;
  private slideTime = 0;
  private sliding = false;
  private coyoteTime = 0;
  private jumpBuffer = 0;
  private traversal: Traversal | null = null;
  private wall: Collider | null = null;
  private readonly wallNormal = new Vector3();
  private wallTime = 0;
  private readonly usedWalls = new Set<Collider>();
  private wallRoll = 0;
  private eyeHeight = 1.6;
  private shownYaw = 0;
  private shownPitch = 0;
  private landingImpact = 0;
  private roll = 0;
  private bobPhase = 0;
  private footstepDistance = 0;
  private readonly body = new Group();
  private readonly arms: Group[] = [];
  private readonly legs: Group[] = [];
  private readonly bodyGeometry: BoxGeometry[] = [];
  private readonly bodyMaterials: MeshStandardMaterial[] = [];
  private readonly bounds = new Box3();
  private readonly scratch = new Vector3();
  private readonly move = new Vector3();
  private readonly forward = new Vector3(0, 0, -1);
  private readonly right = new Vector3(1, 0, 0);

  constructor(private readonly camera: PerspectiveCamera, private readonly world: CollisionWorld) {
    this.camera.rotation.order = 'YXZ';
    this.createBody();
    this.camera.add(this.body);
  }

  respawn(position: Vector3, yaw = 0): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.shownYaw = yaw;
    this.shownPitch = 0;
    this.height = PLAYER_TUNING.standingHeight;
    this.eyeHeight = 1.6;
    this.sliding = false;
    this.traversal = null;
    this.wall = null;
    this.wallTime = 0;
    this.wallRoll = 0;
    this.roll = 0;
    this.landingImpact = 0;
    this.usedWalls.clear();
    this.grounded = this.hasGround();
    this.coyoteTime = this.grounded ? 0.12 : 0;
    this.jumpBuffer = 0;
    this.footstepDistance = 0;
    this.input.clear();
    this.state = 'READY';
    this.camera.position.copy(position).add(new Vector3(0, this.eyeHeight, 0));
    this.camera.rotation.set(0, yaw, 0, 'YXZ');
  }

  update(dt: number): void {
    if (!this.enabled) {
      this.input.mouseX = 0;
      this.input.mouseY = 0;
      return;
    }

    this.yaw -= MathUtils.clamp(this.input.mouseX, -500, 500) * 0.0021 * this.sensitivity;
    this.pitch = MathUtils.clamp(this.pitch - MathUtils.clamp(this.input.mouseY, -350, 350) * 0.0021 * this.sensitivity, -1.45, 1.45);
    this.input.mouseX = 0;
    this.input.mouseY = 0;
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.input.pressed('Space')) this.jumpBuffer = 0.15;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const interact = this.input.pressed('KeyE');
    const slidePressed = this.input.pressed('ControlLeft') || this.input.pressed('ControlRight') || this.input.pressed('KeyC');
    const crouching = this.input.down('ControlLeft') || this.input.down('ControlRight') || this.input.down('KeyC');
    const sprinting = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    const inputX = Number(this.input.down('KeyD') || this.input.down('ArrowRight')) - Number(this.input.down('KeyA') || this.input.down('ArrowLeft'));
    const inputZ = Number(this.input.down('KeyW') || this.input.down('ArrowUp')) - Number(this.input.down('KeyS') || this.input.down('ArrowDown'));
    this.move.copy(this.forward).multiplyScalar(inputZ).addScaledVector(this.right, inputX);
    if (this.move.lengthSq() > 1) this.move.normalize();

    if (this.traversal) {
      this.updateTraversal(dt);
      return;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (slidePressed && this.grounded && speed > 4.2 && !this.sliding) {
      this.sliding = true;
      this.slideTime = 0;
      this.height = PLAYER_TUNING.slidingHeight;
      this.velocity.x *= 1.1;
      this.velocity.z *= 1.1;
      this.events.push('slide');
    }
    if (this.sliding) {
      this.slideTime += dt;
      if (this.slideTime > 0.22 && (!crouching || speed < 2.8) && this.canStand()) {
        this.sliding = false;
        this.height = PLAYER_TUNING.standingHeight;
      }
    } else if (crouching && this.grounded && speed < 4.2) {
      this.sliding = true;
      this.height = PLAYER_TUNING.slidingHeight;
      this.slideTime = 0.3;
    }

    if (interact && this.tryTraversal(false)) return;
    // Holding jump and moving toward a reachable edge makes late jumps forgiving.
    if (!this.grounded && !this.wall && inputZ > 0 && this.velocity.y < 4 && (this.input.down('Space') || interact) && this.tryTraversal(true)) return;

    this.coyoteTime = this.grounded ? 0.12 : Math.max(0, this.coyoteTime - dt);
    if (!this.grounded && !this.sliding && inputZ > 0 && speed > 5) this.updateWallRun(dt);
    else this.endWallRun();

    if (this.jumpBuffer > 0 && (this.coyoteTime > 0 || this.wall)) {
      if (this.wall) {
        this.velocity.addScaledVector(this.wallNormal, 5.4);
        this.velocity.y = 8.8;
        this.endWallRun();
      } else {
        this.velocity.y = PLAYER_TUNING.jumpSpeed;
      }
      this.grounded = false;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      if (this.sliding && this.canStand()) {
        this.sliding = false;
        this.height = PLAYER_TUNING.standingHeight;
      }
      this.events.push('jump');
    }

    if (this.wall) {
      this.velocity.y = Math.max(this.velocity.y - 3.5 * dt, -1.25);
    } else {
      this.accelerate(dt, sprinting);
      const gravityMultiplier = this.velocity.y > 0 && !this.input.down('Space') ? 1.85 : 1;
      this.velocity.y -= PLAYER_TUNING.gravity * gravityMultiplier * dt;
    }

    const wasGrounded = this.grounded;
    const downwardSpeed = this.velocity.y;
    this.grounded = false;
    const steps = Math.max(1, Math.ceil(this.velocity.length() * dt / 0.18));
    for (let step = 0; step < steps; step++) {
      const stepDt = dt / steps;
      this.moveAxis('x', this.velocity.x * stepDt);
      this.moveAxis('z', this.velocity.z * stepDt);
      this.moveAxis('y', this.velocity.y * stepDt);
    }
    if (!this.grounded && this.velocity.y <= 0 && this.hasGround()) this.grounded = true;
    if (this.grounded) {
      this.endWallRun();
      this.usedWalls.clear();
      if (!wasGrounded && downwardSpeed < -2.5) {
        this.landingImpact = Math.min(0.14, -downwardSpeed * 0.009);
        this.events.push('land');
      }
      const actualSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (!this.sliding && actualSpeed > 1.4) {
        this.footstepDistance += actualSpeed * dt;
        if (this.footstepDistance > (sprinting ? 2.5 : 2.1)) {
          this.footstepDistance = 0;
          this.events.push('step');
        }
      }
    }

    this.state = this.wall ? 'WALL RUN' : this.sliding ? 'SLIDING' : !this.grounded ? 'AIRBORNE' : speed > 8 ? 'SPRINTING' : speed > 0.5 ? 'RUNNING' : 'READY';
  }

  render(dt: number, _time: number): void {
    const ease = 1 - Math.exp(-18 * dt);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.eyeHeight = MathUtils.lerp(this.eyeHeight, this.sliding ? 0.66 : 1.6, 1 - Math.exp(-12 * dt));
    this.shownYaw = MathUtils.lerp(this.shownYaw, this.yaw, 1 - Math.exp(-45 * dt));
    this.shownPitch = MathUtils.lerp(this.shownPitch, this.pitch, 1 - Math.exp(-45 * dt));
    this.landingImpact *= Math.exp(-11 * dt);
    if (this.enabled && this.grounded && !this.sliding) this.bobPhase += speed * dt * 2.3;
    const bob = this.reducedMotion || !this.grounded || this.sliding ? 0 : Math.sin(this.bobPhase * 2) * Math.min(speed / 12, 1) * 0.019;
    const targetRoll = this.reducedMotion ? 0 : this.wall ? this.wallRoll : -this.velocity.dot(this.right) * 0.0018;
    this.roll = MathUtils.lerp(this.roll, targetRoll, ease);
    this.camera.position.copy(this.position);
    this.camera.position.y += this.eyeHeight + bob - (this.reducedMotion ? 0 : this.landingImpact);
    this.camera.rotation.set(this.shownPitch, this.shownYaw, this.roll, 'YXZ');
    const targetFov = 78 + (this.reducedMotion ? 0 : MathUtils.clamp((speed - 6) * 1.25, 0, 9));
    this.camera.fov = MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();
    this.animateBody(speed);
  }

  dispose(): void {
    this.input.dispose();
    this.camera.remove(this.body);
    this.bodyGeometry.forEach((geometry) => geometry.dispose());
    this.bodyMaterials.forEach((material) => material.dispose());
  }

  private accelerate(dt: number, sprinting: boolean): void {
    if (this.sliding) {
      const friction = this.grounded ? 0.88 : 0.05;
      this.velocity.x *= Math.exp(-friction * dt);
      this.velocity.z *= Math.exp(-friction * dt);
      if (this.move.lengthSq() > 0) {
        this.velocity.x += this.move.x * dt * 3;
        this.velocity.z += this.move.z * dt * 3;
        const speed = Math.hypot(this.velocity.x, this.velocity.z);
        if (speed > 13.3) {
          this.velocity.x *= 13.3 / speed;
          this.velocity.z *= 13.3 / speed;
        }
      }
      return;
    }
    const maximum = sprinting ? PLAYER_TUNING.sprintSpeed : PLAYER_TUNING.walkSpeed;
    if (this.grounded) {
      if (this.move.lengthSq() === 0) {
        this.velocity.x *= Math.exp(-9 * dt);
        this.velocity.z *= Math.exp(-9 * dt);
      } else {
        this.scratch.copy(this.move).multiplyScalar(maximum);
        this.scratch.x -= this.velocity.x;
        this.scratch.z -= this.velocity.z;
        this.scratch.y = 0;
        const distance = this.scratch.length();
        const acceleration = Math.hypot(this.velocity.x, this.velocity.z) > maximum + 0.5 ? 24 : 60;
        if (distance > 0) this.scratch.multiplyScalar(Math.min(1, acceleration * dt / distance));
        this.velocity.x += this.scratch.x;
        this.velocity.z += this.scratch.z;
      }
    } else if (this.move.lengthSq() > 0) {
      // Only add speed along the wish direction, preserving existing air momentum.
      const projectedSpeed = this.velocity.x * this.move.x + this.velocity.z * this.move.z;
      const acceleration = Math.min(15 * dt, Math.max(0, maximum - projectedSpeed));
      this.velocity.x += this.move.x * acceleration;
      this.velocity.z += this.move.z * acceleration;
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > 14) {
        this.velocity.x *= 14 / speed;
        this.velocity.z *= 14 / speed;
      }
    }
  }

  private playerBox(position = this.position, height = this.height): Box3 {
    const radius = PLAYER_TUNING.radius;
    this.bounds.min.set(position.x - radius, position.y + EPSILON, position.z - radius);
    this.bounds.max.set(position.x + radius, position.y + height, position.z + radius);
    return this.bounds;
  }

  private canStand(): boolean {
    return !this.world.intersects(this.playerBox(this.position, PLAYER_TUNING.standingHeight));
  }

  private hasGround(): boolean {
    const box = this.playerBox();
    box.max.y = this.position.y + 0.015;
    box.min.y = this.position.y - 0.055;
    return this.world.intersects(box);
  }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number): void {
    if (Math.abs(amount) < 0.0000001) return;
    this.position[axis] += amount;
    const box = this.playerBox();
    for (const collider of this.world.colliders) {
      const other = collider.box;
      if (box.min.x >= other.max.x - EPSILON || box.max.x <= other.min.x + EPSILON ||
          box.min.y >= other.max.y - EPSILON || box.max.y <= other.min.y + EPSILON ||
          box.min.z >= other.max.z - EPSILON || box.max.z <= other.min.z + EPSILON) continue;
      if (axis === 'y') {
        if (amount < 0) {
          this.position.y = other.max.y;
          this.grounded = true;
        } else {
          this.position.y = other.min.y - this.height - EPSILON;
        }
      } else {
        this.position[axis] = amount > 0 ? other.min[axis] - PLAYER_TUNING.radius - EPSILON : other.max[axis] + PLAYER_TUNING.radius + EPSILON;
      }
      this.velocity[axis] = 0;
      this.playerBox();
    }
  }

  private updateWallRun(dt: number): void {
    if (this.wall && this.wallTime >= 2) {
      this.endWallRun();
      return;
    }
    let candidate: Collider | null = null;
    let candidateDistance = Infinity;
    const candidateNormal = new Vector3();
    for (const collider of this.world.colliders) {
      if (collider.kind !== 'wallrun' || (this.usedWalls.has(collider) && collider !== this.wall)) continue;
      const box = collider.box;
      if (this.position.y + 1.3 < box.min.y || this.position.y + 0.3 > box.max.y) continue;
      const closestX = MathUtils.clamp(this.position.x, box.min.x, box.max.x);
      const closestZ = MathUtils.clamp(this.position.z, box.min.z, box.max.z);
      this.scratch.set(this.position.x - closestX, 0, this.position.z - closestZ);
      const distance = this.scratch.length();
      if (distance < 0.05 || distance > 0.92 || distance > candidateDistance) continue;
      this.scratch.divideScalar(distance);
      if (Math.abs(this.scratch.dot(this.forward)) > 0.65) continue;
      candidate = collider;
      candidateDistance = distance;
      candidateNormal.copy(this.scratch);
    }
    if (!candidate) {
      this.endWallRun();
      return;
    }
    if (candidate !== this.wall) {
      this.wall = candidate;
      this.usedWalls.add(candidate);
      this.wallTime = 0;
      this.velocity.y = MathUtils.clamp(this.velocity.y, 0.8, 2.5);
      this.events.push('wallrun');
    }
    this.wallTime += dt;
    this.wallNormal.copy(candidateNormal);
    this.wallRoll = this.wallNormal.dot(this.right) > 0 ? 0.105 : -0.105;
    const tangent = this.forward.clone().addScaledVector(this.wallNormal, -this.forward.dot(this.wallNormal)).normalize();
    // Gentle attraction keeps a run stable even without holding a strafe key.
    this.velocity.x = tangent.x * 12.7 - this.wallNormal.x * 1.9;
    this.velocity.z = tangent.z * 12.7 - this.wallNormal.z * 1.9;
  }

  private endWallRun(): void {
    this.wall = null;
    this.wallTime = 0;
    this.wallRoll = 0;
  }

  private rayInterval(box: Box3): { entry: number; exit: number } | null {
    let entry = -Infinity;
    let exit = Infinity;
    for (const axis of ['x', 'z'] as const) {
      const direction = this.forward[axis];
      if (Math.abs(direction) < 0.0001) {
        if (this.position[axis] < box.min[axis] || this.position[axis] > box.max[axis]) return null;
        continue;
      }
      const first = (box.min[axis] - this.position[axis]) / direction;
      const second = (box.max[axis] - this.position[axis]) / direction;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
    }
    if (entry > exit || exit < 0) return null;
    return { entry, exit };
  }

  private tryTraversal(mantle: boolean): boolean {
    let chosen: Collider | null = null;
    let chosenEntry = Infinity;
    let chosenExit = 0;
    for (const collider of this.world.colliders) {
      if (collider.kind === 'wallrun') continue;
      const topHeight = collider.box.max.y - this.position.y;
      if (topHeight < (mantle ? 0.18 : 0.3) || topHeight > (mantle ? 1.5 : 1.4)) continue;
      const interval = this.rayInterval(collider.box);
      if (!interval || interval.entry < -0.1 || interval.entry > (mantle ? 1.05 : 1.65) || interval.entry > chosenEntry) continue;
      if (!mantle && interval.exit - interval.entry > 2.6) continue;
      chosen = collider;
      chosenEntry = interval.entry;
      chosenExit = interval.exit;
    }
    if (!chosen) return false;
    const distance = mantle ? chosenEntry + PLAYER_TUNING.radius + 0.22 : chosenExit + PLAYER_TUNING.radius + 0.3;
    const end = this.position.clone().addScaledVector(this.forward, distance);
    end.y = mantle ? chosen.box.max.y : this.position.y + 0.01;
    if (!mantle) {
      let support = -Infinity;
      for (const { box } of this.world.colliders) {
        if (end.x - 0.2 < box.min.x || end.x + 0.2 > box.max.x || end.z - 0.2 < box.min.z || end.z + 0.2 > box.max.z) continue;
        if (box.max.y <= chosen.box.max.y + 0.01 && box.max.y >= this.position.y - 0.4) support = Math.max(support, box.max.y);
      }
      if (support !== -Infinity) end.y = support;
    }
    const traversal: Traversal = {
      start: this.position.clone(), end,
      high: Math.max(this.position.y, end.y, chosen.box.max.y) + 0.12,
      elapsed: 0,
      duration: mantle ? 0.42 : 0.46,
      momentum: this.velocity.clone(),
    };
    // Validate the entire arc, including the room needed above a ledge.
    for (let sample = 1; sample <= 18; sample++) {
      this.traversalPoint(traversal, sample / 18, this.scratch);
      if (this.world.intersects(this.playerBox(this.scratch, PLAYER_TUNING.standingHeight))) return false;
    }
    this.traversal = traversal;
    this.sliding = false;
    this.height = PLAYER_TUNING.standingHeight;
    this.endWallRun();
    this.state = 'VAULTING';
    this.events.push('vault');
    return true;
  }

  private traversalPoint(traversal: Traversal, t: number, output: Vector3): void {
    if (t < 0.24) {
      const progress = MathUtils.smoothstep(t / 0.24, 0, 1);
      output.copy(traversal.start);
      output.y = MathUtils.lerp(traversal.start.y, traversal.high, progress);
    } else if (t < 0.8) {
      const progress = MathUtils.smoothstep((t - 0.24) / 0.56, 0, 1);
      output.lerpVectors(traversal.start, traversal.end, progress);
      output.y = traversal.high + Math.sin(progress * Math.PI) * 0.09;
    } else {
      const progress = MathUtils.smoothstep((t - 0.8) / 0.2, 0, 1);
      output.copy(traversal.end);
      output.y = MathUtils.lerp(traversal.high, traversal.end.y, progress);
    }
  }

  private updateTraversal(dt: number): void {
    const traversal = this.traversal!;
    traversal.elapsed += dt;
    const t = Math.min(1, traversal.elapsed / traversal.duration);
    this.traversalPoint(traversal, t, this.position);
    this.velocity.set(0, 0, 0);
    this.state = 'VAULTING';
    if (t >= 1) {
      const speed = Math.max(6, Math.hypot(traversal.momentum.x, traversal.momentum.z));
      this.velocity.copy(this.forward).multiplyScalar(Math.min(speed, 13));
      this.traversal = null;
      this.grounded = this.hasGround();
      this.jumpBuffer = 0;
    }
  }

  private createBody(): void {
    const sleeve = new MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.9 });
    const glove = new MeshStandardMaterial({ color: 0x202931, roughness: 0.85 });
    const accent = new MeshStandardMaterial({ color: 0xf13529, roughness: 0.8 });
    const trousers = new MeshStandardMaterial({ color: 0xb5c8cc, roughness: 1 });
    this.bodyMaterials.push(sleeve, glove, accent, trousers);
    const box = (width: number, height: number, depth: number, material: MeshStandardMaterial): Mesh => {
      const geometry = new BoxGeometry(width, height, depth);
      this.bodyGeometry.push(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      return mesh;
    };
    for (const side of [-1, 1]) {
      const arm = new Group();
      const forearm = box(0.105, 0.26, 0.11, sleeve);
      forearm.position.y = -0.09;
      const hand = box(0.11, 0.105, 0.12, glove);
      hand.position.y = 0.085;
      const cuff = box(0.11, 0.035, 0.12, accent);
      cuff.position.y = 0.018;
      arm.add(forearm, hand, cuff);
      arm.position.set(side * 0.33, -0.54, -0.42);
      arm.rotation.set(-0.65, side * -0.2, side * -0.16);
      this.arms.push(arm);
      this.body.add(arm);
      const leg = new Group();
      const shin = box(0.16, 0.42, 0.17, trousers);
      const shoe = box(0.17, 0.11, 0.28, accent);
      shoe.position.set(0, -0.24, -0.05);
      leg.add(shin, shoe);
      leg.position.set(side * 0.13, -0.9, -0.26);
      this.legs.push(leg);
      this.body.add(leg);
    }
  }

  private animateBody(speed: number): void {
    const vaulting = !!this.traversal;
    const moving = this.enabled && speed > 2 && this.grounded && !this.sliding;
    this.arms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      const swing = moving && !this.reducedMotion ? Math.sin(this.bobPhase + index * Math.PI) * 0.055 * Math.min(speed / 10, 1) : 0;
      arm.position.set(side * (vaulting ? 0.28 : 0.33), (vaulting ? -0.27 : -0.54) + swing, vaulting ? -0.51 : -0.42);
      arm.rotation.x = vaulting ? -1.15 : this.sliding ? -0.9 : -0.65 + swing * 2;
      arm.visible = vaulting || this.sliding || moving;
    });
    this.legs.forEach((leg, index) => {
      leg.visible = this.pitch < -0.75 || this.sliding;
      leg.position.y = this.sliding ? -0.43 : -0.9;
      leg.position.z = this.sliding ? -0.58 : -0.26;
      leg.rotation.x = this.sliding ? -1.1 : moving ? Math.sin(this.bobPhase + index * Math.PI) * 0.18 : 0;
    });
  }
}
