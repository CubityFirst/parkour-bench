import { Vector3, MathUtils } from 'three';
import { CollisionWorld, type Collider } from '../world/CollisionWorld';
import type { MoveInput } from './Input';

export type MovementEvent = 'jump' | 'land' | 'slide' | 'vault' | 'wallrun';
export class PlayerController {
  readonly position = new Vector3(0, 32, -5);
  readonly velocity = new Vector3();
  grounded = false;
  height = 1.8;
  slideTime = 0;
  wall: Collider | undefined;
  wallSide = 0;
  wallTime = 0;
  usedWall = -1;
  jumpBuffer = 0;
  coyoteTime = 0;
  airborneTime = 0;
  vault: { from: Vector3; to: Vector3; time: number; duration: number; arc: number } | undefined;
  onEvent: (event: MovementEvent, strength?: number) => void = () => {};
  private wish = new Vector3();
  private jumped = false;
  private wallCooldown = 0;
  constructor(readonly world: CollisionWorld) {}
  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }
  get mode() { return this.vault ? 'VAULT' : this.wall ? 'WALL RUN' : this.slideTime > 0 ? 'SLIDING' : !this.grounded ? 'AIRBORNE' : this.speed > 9 ? 'SPRINTING' : this.speed > 0.4 ? 'RUNNING' : 'READY'; }

  reset(position: Vector3) {
    this.position.copy(position); this.velocity.set(0, 0, 0);
    this.grounded = false; this.height = 1.8; this.slideTime = 0; this.wall = undefined;
    this.wallSide = 0; this.wallTime = 0; this.usedWall = -1; this.jumpBuffer = 0;
    this.coyoteTime = 0; this.vault = undefined; this.airborneTime = 0; this.jumped = false; this.wallCooldown = 0;
  }

  update(dt: number, input: MoveInput, yaw: number) {
    if (this.vault) {
      const v = this.vault;
      v.time += dt;
      const t = Math.min(1, v.time / v.duration);
      this.traversalPoint(v.from, v.to, t, v.arc, this.position);
      if (t >= 1) { this.vault = undefined; this.velocity.y = 0; }
      return;
    }
    const p = this.position, vel = this.velocity;
    this.jumpBuffer = input.jumpPressed ? 0.15 : Math.max(0, this.jumpBuffer - dt);
    this.coyoteTime = this.grounded ? 0.12 : Math.max(0, this.coyoteTime - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.airborneTime = this.grounded ? 0 : this.airborneTime + dt;
    this.wish.set(input.strafe * Math.cos(yaw) - input.forward * Math.sin(yaw), 0,
      -input.forward * Math.cos(yaw) - input.strafe * Math.sin(yaw));
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    if (input.slidePressed && this.grounded && this.speed > 4) {
      this.slideTime = 1.1; this.height = 0.82;
      vel.x *= 1.13; vel.z *= 1.13;
      this.onEvent('slide');
    }
    if (this.slideTime > 0) this.slideTime = Math.max(0, this.slideTime - dt);
    if (this.slideTime <= 0 && this.height < 1.8) {
      if (!this.world.overlaps(p, 1.8)) this.height = 1.8;
      else { this.height = 0.82; this.slideTime = 0.03; }
    }

    if (input.vaultPressed && this.tryVault(yaw, false)) return;
    if (!this.grounded && this.airborneTime > 0.15 && input.forward > 0 && vel.y < 2 &&
      (input.jump || input.vaultPressed) && this.tryVault(yaw, true)) return;

    if (!this.grounded && this.speed > 6 && this.slideTime === 0 && input.forward > 0 && this.wallCooldown === 0) {
      const surface = this.world.wallNear(p, this.height);
      if (surface && (surface.id !== this.usedWall || this.wall === surface) && this.wallTime < 1.95) {
        if (!this.wall) { this.onEvent('wallrun'); this.wallTime = 0; }
        this.wall = surface; this.usedWall = surface.id;
        this.wallSide = p.x < (surface.min.x + surface.max.x) / 2 ? 1 : -1;
        this.wallTime += dt;
        p.x = this.wallSide > 0 ? surface.min.x - 0.39 : surface.max.x + 0.39;
        vel.x = 0;
        vel.z = Math.min(vel.z, -11.5);
        vel.y = Math.max(vel.y, -1.1);
      } else this.wall = undefined;
    } else this.wall = undefined;

    if (this.jumpBuffer > 0 && (this.coyoteTime > 0 || this.wall)) {
      if (this.wall) {
        vel.x = -this.wallSide * 7; this.wall = undefined; this.wallCooldown = 0.3;
      }
      vel.y = 9.4;
      this.grounded = false; this.coyoteTime = 0; this.jumpBuffer = 0; this.jumped = true;
      this.slideTime = 0;
      if (!this.world.overlaps(p, 1.8)) this.height = 1.8;
      this.onEvent('jump');
    }
    if (!input.jump && this.jumped && vel.y > 3.6) { vel.y *= 0.54; this.jumped = false; }

    if (!this.wall) {
      if (this.slideTime > 0) {
        const friction = Math.exp(-0.55 * dt);
        vel.x = vel.x * friction + this.wish.x * dt * 1.2;
        vel.z = vel.z * friction + this.wish.z * dt * 1.2;
      } else {
        const target = input.sprint ? 13.2 : 7.2;
        if (this.grounded) {
          const gain = 1 - Math.exp(-(this.wish.lengthSq() ? 10 : 8) * dt);
          vel.x = MathUtils.lerp(vel.x, this.wish.x * target, gain);
          vel.z = MathUtils.lerp(vel.z, this.wish.z * target, gain);
        } else {
          // Accelerate along the desired direction without erasing existing jump momentum.
          const projection = vel.x * this.wish.x + vel.z * this.wish.z;
          const acceleration = Math.min(7 * dt, Math.max(0, target - projection));
          vel.x += this.wish.x * acceleration; vel.z += this.wish.z * acceleration;
          const speed = this.speed;
          if (speed > 15) { vel.x *= 15 / speed; vel.z *= 15 / speed; }
        }
      }
    }
    vel.y -= (this.wall ? 3 : 25) * dt;
    const fallSpeed = vel.y;
    const wasGrounded = this.grounded;
    this.grounded = this.world.move(p, vel, this.height, dt);
    if (this.grounded) {
      if (!wasGrounded && fallSpeed < -3) this.onEvent('land', Math.min(1, -fallSpeed / 15));
      this.wall = undefined; this.wallSide = 0; this.wallTime = 0; this.usedWall = -1; this.jumped = false;
    }
  }

  private traversalPoint(from: Vector3, to: Vector3, t: number, arc: number, target = new Vector3()) {
    // Lift before moving across the face, then lower after clearing the far edge.
    const crossing = MathUtils.clamp((t - 0.25) / 0.5, 0, 1);
    target.lerpVectors(from, to, crossing * crossing * (3 - 2 * crossing));
    target.y = MathUtils.lerp(from.y, to.y, t * t * (3 - 2 * t)) + Math.pow(Math.max(0, Math.sin(t * Math.PI)), 0.45) * arc;
    return target;
  }

  private tryVault(yaw: number, ledge: boolean) {
    const direction = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    if (Math.abs(direction.z) < 0.5) return false;
    const p = this.position;
    for (const b of this.world.colliders) {
      const difference = b.max.y - p.y;
      if (b.kind === 'wallrun' || difference < (ledge ? 0.15 : 0.3) || difference > (ledge ? 1.55 : 1.45)) continue;
      const ahead = p.clone().addScaledVector(direction, 1.5);
      if (ahead.x < b.min.x - 0.25 || ahead.x > b.max.x + 0.25 || ahead.z < b.min.z || ahead.z > b.max.z) continue;
      if (!ledge && b.kind !== 'vault') continue;
      const to = p.clone();
      if (ledge) {
        to.addScaledVector(direction, 1.6); to.y = b.max.y + 0.01;
      } else {
        const edge = direction.z < 0 ? b.min.z - 0.65 : b.max.z + 0.65;
        const distance = Math.abs(edge - p.z) / Math.abs(direction.z);
        if (distance > 5) continue;
        to.addScaledVector(direction, distance);
        const support = this.world.supportAt(to, 2.5);
        if (!support) continue;
        to.y = support.max.y + 0.01;
      }
      if (this.world.overlaps(to, 1.8)) continue;
      // Only accept an arc that clears all geometry, including low ceilings.
      const arc = difference + 0.3;
      let blocked = false;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const point = this.traversalPoint(p, to, t, arc);
        if (this.world.overlaps(point, 1.8)) { blocked = true; break; }
      }
      if (blocked) continue;
      this.vault = { from: p.clone(), to, time: 0, duration: ledge ? 0.34 : 0.43, arc };
      this.height = 1.8; this.slideTime = 0; this.wall = undefined;
      this.onEvent('vault');
      return true;
    }
    return false;
  }
}
