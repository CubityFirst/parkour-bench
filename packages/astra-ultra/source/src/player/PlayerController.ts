import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';
import { FirstPersonCamera } from './FirstPersonCamera';
import { PlayerInput } from './PlayerInput';
import { PLAYER_RADIUS, PlayerPhysics, SLIDING_HEIGHT, STANDING_HEIGHT } from './PlayerPhysics';

interface Traversal {
  kind: 'vault' | 'mantle';
  collider: Collider;
  from: Vector3;
  to: Vector3;
  peak: number;
  elapsed: number;
  duration: number;
  momentum: Vector3;
}

/** update() accepts a fixed timestep in seconds; render() applies visual effects separately. */
export class PlayerController {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  action = 'idle';
  enabled = false;
  sensitivity = 1;
  reducedMotion = false;
  onEvent: (event: string) => void = () => {};
  readonly input: PlayerInput;
  private physics: PlayerPhysics;
  private view: FirstPersonCamera;
  private height = STANDING_HEIGHT;
  private wish = new Vector3();
  private forward = new Vector3();
  private right = new Vector3();
  private scratch = new Vector3();
  private strafe = 0;
  private jumpBuffer = 0;
  private coyote = 0;
  private jumpCut = false;
  private slideTimer = 0;
  private slideCooldown = 0;
  private stepDistance = 0;
  private traversal?: Traversal;
  private wall?: Collider;
  private wallNormal = new Vector3();
  private wallTimer = 0;
  private wallCooldown = 0;
  private usedWalls = new Set<Collider>();
  private side = 0;

  constructor(camera: PerspectiveCamera, world: CollisionWorld, element: HTMLElement) {
    this.physics = new PlayerPhysics(world);
    this.view = new FirstPersonCamera(camera);
    this.input = new PlayerInput(element, () => this.enabled, (x, y) => {
      this.yaw -= x * 0.002 * this.sensitivity;
      this.pitch = MathUtils.clamp(this.pitch - y * 0.002 * this.sensitivity, -1.46, 1.46);
    });
  }

  get speed(): number { return Math.hypot(this.velocity.x, this.velocity.z); }
  get isSliding(): boolean { return this.slideTimer > 0; }
  get isCrouched(): boolean { return this.height < STANDING_HEIGHT; }
  get wallRunning(): boolean { return this.wall !== undefined; }

  reset(position: Vector3, yaw = 0): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = !!this.physics.support(position, 0.12);
    this.action = 'idle';
    this.height = STANDING_HEIGHT;
    this.jumpBuffer = this.slideTimer = this.slideCooldown = this.wallTimer = this.wallCooldown = this.stepDistance = 0;
    this.coyote = this.grounded ? 0.13 : 0;
    this.traversal = undefined;
    this.wall = undefined;
    this.side = 0;
    this.usedWalls.clear();
    this.jumpCut = false;
    this.input.clear();
    this.view.reset(this.position, this.yaw, this.pitch);
  }

  update(dt: number): void {
    if (!this.enabled) { this.input.clear(); return; }
    dt = Math.min(dt, 0.05);
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forwardInput = Number(this.input.down('KeyW', 'ArrowUp')) - Number(this.input.down('KeyS', 'ArrowDown'));
    this.strafe = Number(this.input.down('KeyD', 'ArrowRight')) - Number(this.input.down('KeyA', 'ArrowLeft'));
    this.wish.copy(this.forward).multiplyScalar(forwardInput).addScaledVector(this.right, this.strafe);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    const sprint = this.input.down('ShiftLeft', 'ShiftRight');
    const crouchHeld = this.input.down('ControlLeft', 'ControlRight', 'KeyC');
    const slidePressed = this.input.take('ControlLeft', 'ControlRight', 'KeyC');
    const vaultPressed = this.input.take('KeyE');
    this.jumpBuffer = this.input.take('Space') ? 0.15 : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.13 : Math.max(0, this.coyote - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);

    if (this.traversal) { this.updateTraversal(dt); return; }
    if (vaultPressed && this.tryVault()) { this.updateTraversal(dt); return; }

    if (slidePressed && this.grounded && this.speed > 3 && this.slideCooldown === 0) {
      this.slideTimer = 1.0;
      this.slideCooldown = 0.35;
      this.height = SLIDING_HEIGHT;
      if (this.speed < 9) {
        this.scratch.copy(this.velocity).setY(0).normalize();
        this.velocity.x = this.scratch.x * 9;
        this.velocity.z = this.scratch.z * 9;
      }
      this.onEvent('slide');
    }
    this.slideTimer = Math.max(0, this.slideTimer - dt);
    if (crouchHeld && this.grounded) this.height = SLIDING_HEIGHT;
    if (this.slideTimer === 0 && !crouchHeld && this.physics.canOccupy(this.position, STANDING_HEIGHT)) this.height = STANDING_HEIGHT;

    if (this.jumpBuffer > 0) {
      if (this.wall) this.wallJump();
      else if (this.coyote > 0) {
        this.velocity.y = 9;
        this.grounded = false;
        this.coyote = this.jumpBuffer = this.slideTimer = 0;
        this.jumpCut = false;
        if (!crouchHeld && this.physics.canOccupy(this.position, STANDING_HEIGHT)) this.height = STANDING_HEIGHT;
        this.onEvent('jump');
      }
    }

    if (!this.grounded && !this.wall && this.velocity.y > 0 && !this.input.down('Space') && !this.jumpCut) {
      this.velocity.y *= 0.52;
      this.jumpCut = true;
    }

    const wasGrounded = this.grounded;
    if (this.slideTimer > 0 && this.grounded) {
      const speed = this.speed;
      const nextSpeed = Math.max(0, speed - 2.8 * dt);
      if (speed > 0) { this.velocity.x *= nextSpeed / speed; this.velocity.z *= nextSpeed / speed; }
      this.velocity.addScaledVector(this.wish, dt * 1.1);
    } else if (this.grounded) {
      const maxSpeed = this.isCrouched ? 3.5 : sprint ? 12 : 6.5;
      const rate = this.wish.lengthSq() ? 12 : 10;
      const blend = 1 - Math.exp(-rate * dt);
      this.velocity.x = MathUtils.lerp(this.velocity.x, this.wish.x * maxSpeed, blend);
      this.velocity.z = MathUtils.lerp(this.velocity.z, this.wish.z * maxSpeed, blend);
    } else if (!this.wall && this.wish.lengthSq() > 0) {
      // Limited steering changes the direction without deleting existing forward momentum.
      const maxSpeed = Math.max(sprint ? 12 : 6.5, this.speed);
      const desiredX = this.wish.x * maxSpeed;
      const desiredZ = this.wish.z * maxSpeed;
      const changeX = desiredX - this.velocity.x;
      const changeZ = desiredZ - this.velocity.z;
      const amount = Math.min(1, 15 * dt / (Math.hypot(changeX, changeZ) || 1));
      this.velocity.x += changeX * amount;
      this.velocity.z += changeZ * amount;
    }

    if (!this.grounded && forwardInput > 0 && this.height === STANDING_HEIGHT) this.updateWallrun(dt);
    else if (this.wall) this.endWallrun();
    this.velocity.y -= (this.wall ? 1.8 : 24) * dt;
    this.velocity.y = Math.max(this.velocity.y, -48);

    if (!this.grounded && !this.wall && forwardInput > 0 && this.velocity.y <= 3 && this.tryMantle()) {
      this.updateTraversal(dt); return;
    }
    const result = this.physics.move(this.position, this.velocity, this.height, dt, this.grounded);
    this.grounded = result.grounded;
    if (this.grounded) {
      if (this.wall) this.endWallrun();
      this.usedWalls.clear();
      if (!wasGrounded && result.impact > 2) { this.view.land(result.impact); this.onEvent('land'); }
      this.jumpCut = false;
      this.stepDistance += this.speed * dt;
      if (this.stepDistance > (sprint ? 2.7 : 2.15) && !this.isCrouched) { this.stepDistance = 0; this.onEvent('step'); }
    }
    this.action = this.wall ? 'wallrun' : this.slideTimer > 0 ? 'slide' : this.isCrouched ? 'crouch' : !this.grounded ? 'air' : this.speed > 8.5 ? 'sprint' : this.speed > 0.35 ? 'run' : 'idle';
  }

  private nearestWall(): { collider: Collider; normal: Vector3; distance: number } | undefined {
    let closest: { collider: Collider; normal: Vector3; distance: number } | undefined;
    for (const collider of this.physics.world.colliders) {
      if (collider.kind !== 'wallrun' || collider.max.y < this.position.y + 0.55 || collider.min.y > this.position.y + 1.3) continue;
      const faces = [
        { axis: 'x' as const, other: 'z' as const, edge: collider.min.x, sign: -1 },
        { axis: 'x' as const, other: 'z' as const, edge: collider.max.x, sign: 1 },
        { axis: 'z' as const, other: 'x' as const, edge: collider.min.z, sign: -1 },
        { axis: 'z' as const, other: 'x' as const, edge: collider.max.z, sign: 1 },
      ];
      for (const face of faces) {
        if (this.position[face.other] < collider.min[face.other] - 0.12 || this.position[face.other] > collider.max[face.other] + 0.12) continue;
        const distance = (this.position[face.axis] - face.edge) * face.sign;
        if (distance < PLAYER_RADIUS - 0.08 || distance > 0.95 || (closest && distance >= closest.distance)) continue;
        const normal = new Vector3(); normal[face.axis] = face.sign;
        const tangent = this.wish.clone().addScaledVector(normal, -this.wish.dot(normal));
        if (tangent.lengthSq() < 0.36) continue;
        closest = { collider, normal, distance };
      }
    }
    return closest;
  }

  private updateWallrun(dt: number): void {
    const contact = this.nearestWall();
    if (this.wall && (!contact || contact.collider !== this.wall || this.wallTimer > 1.65 || this.wish.dot(this.wallNormal) > 0.65)) this.endWallrun();
    if (!this.wall) {
      if (!contact || this.speed < 6 || this.wallCooldown > 0 || this.usedWalls.has(contact.collider) || this.velocity.y < -9) return;
      this.wall = contact.collider;
      this.wallNormal.copy(contact.normal);
      this.wallTimer = 0;
      this.usedWalls.add(contact.collider);
      this.velocity.y = Math.max(1.8, this.velocity.y * 0.3);
      this.side = this.right.dot(this.wallNormal) > 0 ? -1 : 1;
      this.onEvent('wallrun');
    }
    this.wallTimer += dt;
    this.scratch.copy(this.wish).addScaledVector(this.wallNormal, -this.wish.dot(this.wallNormal)).normalize().multiplyScalar(12.8);
    this.velocity.x = this.scratch.x - this.wallNormal.x * 1.4;
    this.velocity.z = this.scratch.z - this.wallNormal.z * 1.4;
  }

  private endWallrun(): void { this.wall = undefined; this.side = 0; this.wallCooldown = 0.18; }

  private wallJump(): void {
    this.velocity.addScaledVector(this.wallNormal, 5.5);
    this.velocity.y = 8.4;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.endWallrun();
    this.wallCooldown = 0.3;
    this.onEvent('jump');
  }

  private tryVault(): boolean {
    if (this.isCrouched || this.velocity.y > 4) return false;
    let selected: { collider: Collider; near: number; far: number } | undefined;
    for (const collider of this.physics.world.colliders) {
      const rise = collider.max.y - this.position.y;
      if (rise < 0.2 || rise > 1.4 || collider.min.y > this.position.y + 1.1 || collider.kind === 'wallrun') continue;
      const hit = this.physics.rayBox(this.position, this.forward, collider);
      if (!hit || hit.near < 0 || hit.near > 1.6 || hit.far - hit.near > 2.05) continue;
      if (!selected || hit.near < selected.near) selected = { collider, ...hit };
    }
    if (!selected) return false;
    const target = this.position.clone().addScaledVector(this.forward, selected.far + PLAYER_RADIUS + 0.28);
    const peak = selected.collider.max.y + 0.12;
    const highTarget = target.clone().setY(peak);
    if (!this.physics.canOccupy(highTarget, STANDING_HEIGHT, selected.collider)) return false;
    if (!this.physics.canOccupy(target, STANDING_HEIGHT, selected.collider)) target.y = selected.collider.max.y + 0.01;
    if (!this.physics.canOccupy(target, STANDING_HEIGHT, selected.collider)) return false;
    if (!this.clearTraversal(selected.collider, target, peak)) return false;
    this.beginTraversal('vault', selected.collider, target, peak, 0.46);
    return true;
  }

  private tryMantle(): boolean {
    if (this.isCrouched || this.speed < 1) return false;
    let selected: { collider: Collider; near: number } | undefined;
    for (const collider of this.physics.world.colliders) {
      const rise = collider.max.y - this.position.y;
      if (rise < 0.16 || rise > 1.8 || collider.kind === 'wallrun') continue;
      const hit = this.physics.rayBox(this.position, this.forward, collider);
      if (!hit || hit.near < 0 || hit.near > PLAYER_RADIUS + 0.38 || hit.far - hit.near < 0.75) continue;
      if (!selected || hit.near < selected.near) selected = { collider, near: hit.near };
    }
    if (!selected) return false;
    const target = this.position.clone().addScaledVector(this.forward, selected.near + PLAYER_RADIUS + 0.24);
    target.y = selected.collider.max.y + 0.005;
    if (!this.physics.canOccupy(target, STANDING_HEIGHT)) return false;
    const peak = target.y + 0.08;
    if (!this.clearTraversal(selected.collider, target, peak)) return false;
    this.beginTraversal('mantle', selected.collider, target, peak, 0.32);
    return true;
  }

  private clearTraversal(ignore: Collider, target: Vector3, peak: number): boolean {
    // Check the lift and overhead path before committing so traversal cannot bypass ceilings.
    for (let i = 0; i <= 8; i++) {
      this.scratch.copy(this.position).lerp(target, i / 8); this.scratch.y = peak;
      if (!this.physics.canOccupy(this.scratch, STANDING_HEIGHT, ignore)) return false;
    }
    return true;
  }

  private beginTraversal(kind: Traversal['kind'], collider: Collider, target: Vector3, peak: number, duration: number): void {
    const speed = Math.max(5, this.speed);
    this.traversal = { kind, collider, from: this.position.clone(), to: target, peak, elapsed: 0, duration, momentum: this.forward.clone().multiplyScalar(speed) };
    this.wall = undefined;
    this.side = 0;
    this.jumpBuffer = this.coyote = this.slideTimer = 0;
    this.grounded = false;
    this.velocity.set(0, 0, 0);
    this.height = STANDING_HEIGHT;
    this.action = kind;
    this.onEvent(kind === 'mantle' ? 'vault' : kind);
  }

  private updateTraversal(dt: number): void {
    const traversal = this.traversal!;
    traversal.elapsed += dt;
    const t = Math.min(1, traversal.elapsed / traversal.duration);
    const smooth = (value: number) => { const v = MathUtils.clamp(value, 0, 1); return v * v * (3 - 2 * v); };
    const travel = smooth((t - 0.2) / 0.7);
    this.scratch.copy(traversal.from).lerp(traversal.to, travel);
    if (t < 0.4) this.scratch.y = MathUtils.lerp(traversal.from.y, traversal.peak, smooth(t / 0.4));
    else this.scratch.y = MathUtils.lerp(traversal.peak, traversal.to.y, smooth((t - 0.65) / 0.35));
    if (!this.physics.canOccupy(this.scratch, this.height, traversal.collider)) {
      this.traversal = undefined;
      this.velocity.set(0, 0, 0);
      return;
    }
    this.position.copy(this.scratch);
    if (t >= 1) {
      this.velocity.copy(traversal.momentum);
      this.grounded = !!this.physics.support(this.position, 0.08);
      this.traversal = undefined;
      this.action = this.grounded ? 'run' : 'air';
    }
  }

  render(dt: number, time: number): void {
    this.view.render(dt, time, { position: this.position, yaw: this.yaw, pitch: this.pitch, speed: this.speed,
      grounded: this.grounded, crouched: this.isCrouched, action: this.action, strafe: this.strafe,
      wallSide: this.side, reducedMotion: this.reducedMotion });
  }

  dispose(): void { this.input.dispose(); this.view.dispose(); }
}
