import { MathUtils, Ray, Vector3 } from "three";
import { CollisionWorld } from "../world/CollisionWorld";
import type { Collider } from "../world/CollisionWorld";
import type { Controls } from "./Input";

const RADIUS = 0.34;
const STANDING_HEIGHT = 1.78;
const CROUCH_HEIGHT = 0.78;
const GRAVITY = 26;
const JUMP_SPEED = 10.4;

interface Traversal {
  from: Vector3;
  to: Vector3;
  elapsed: number;
  duration: number;
  arc: number;
  name: string;
}
export type MovementEvent = "jump" | "land" | "slide" | "vault" | "wallrun";

function sampleTraversal(
  traversal: Traversal,
  progress: number,
  target: Vector3,
): Vector3 {
  // Lift, cross, then settle: the body clears the lip before moving through it.
  target.lerpVectors(
    traversal.from,
    traversal.to,
    MathUtils.smoothstep(progress, 0.2, 0.8),
  );
  const top = Math.max(traversal.from.y, traversal.to.y) + traversal.arc;
  target.y =
    progress < 0.22
      ? MathUtils.lerp(
          traversal.from.y,
          top,
          MathUtils.smoothstep(progress, 0, 0.22),
        )
      : progress > 0.78
        ? MathUtils.lerp(
            top,
            traversal.to.y,
            MathUtils.smoothstep(progress, 0.78, 1),
          )
        : top;
  return target;
}

export class PlayerPhysics {
  readonly position = new Vector3(0, 42, 16);
  readonly previous = this.position.clone();
  readonly velocity = new Vector3();
  grounded = true;
  crouching = false;
  sliding = false;
  wallSide = 0;
  activeWall: Collider | null = null;
  wallTime = 0;
  landingImpact = 0;
  moveName = "READY";
  traversal: Traversal | null = null;
  private jumpBuffer = 0;
  private coyoteTime = 0.12;
  private slideTime = 0;
  private slideWasHeld = false;
  private usedWall: Collider | null = null;
  private wallCooldown = 0;
  onEvent: (event: MovementEvent, intensity?: number) => void = () => {};

  constructor(readonly world: CollisionWorld) {}

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
  get height(): number {
    return this.crouching ? CROUCH_HEIGHT : STANDING_HEIGHT;
  }

  reset(position: Vector3): void {
    this.position.copy(position);
    this.previous.copy(position);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.crouching = false;
    this.sliding = false;
    this.activeWall = null;
    this.usedWall = null;
    this.wallSide = 0;
    this.wallTime = 0;
    this.wallCooldown = 0;
    this.traversal = null;
    this.jumpBuffer = 0;
    this.coyoteTime = 0.12;
    this.landingImpact = 0;
    this.slideTime = 0;
    this.slideWasHeld = false;
    this.moveName = "READY";
  }

  update(dt: number, input: Controls, yaw: number): void {
    this.previous.copy(this.position);
    this.landingImpact = Math.max(0, this.landingImpact - dt * 2.2);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.jumpBuffer = input.jump ? 0.15 : Math.max(0, this.jumpBuffer - dt);
    this.coyoteTime = this.grounded ? 0.12 : Math.max(0, this.coyoteTime - dt);

    if (this.traversal) {
      const t = this.traversal;
      t.elapsed += dt;
      const progress = Math.min(1, t.elapsed / t.duration);
      sampleTraversal(t, progress, this.position);
      this.moveName = t.name;
      if (progress === 1) {
        this.traversal = null;
        this.velocity.y = 0;
        this.grounded = true;
      }
      return;
    }

    const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const wish = forward
      .clone()
      .multiplyScalar(input.forward)
      .addScaledVector(right, input.right);
    if (wish.lengthSq() > 1) wish.normalize();

    if (input.vault && this.tryTraversal(forward, false)) return;

    if (input.slide && !this.slideWasHeld && this.grounded && this.speed > 5) {
      this.sliding = true;
      this.slideTime = 1.15;
      this.crouching = true;
      this.velocity.x *= 1.12;
      this.velocity.z *= 1.12;
      this.onEvent("slide");
    }
    this.slideWasHeld = input.slide;
    if (this.sliding) {
      this.slideTime -= dt;
      this.velocity.x *= Math.exp(-0.32 * dt);
      this.velocity.z *= Math.exp(-0.32 * dt);
      this.velocity.addScaledVector(wish, dt * 3);
      if (this.slideTime <= 0 || this.speed < 3) this.sliding = false;
    }
    this.crouching = this.sliding || input.slide || !this.canStand();

    if (!this.sliding) {
      const maximum = this.crouching ? 4.8 : input.sprint ? 14.2 : 9;
      if (this.grounded) {
        const response = 1 - Math.exp(-dt * (wish.lengthSq() > 0 ? 9 : 7.5));
        this.velocity.x = MathUtils.lerp(
          this.velocity.x,
          wish.x * maximum,
          response,
        );
        this.velocity.z = MathUtils.lerp(
          this.velocity.z,
          wish.z * maximum,
          response,
        );
      } else {
        // Air steering changes direction without deleting the momentum of a running jump.
        this.velocity.addScaledVector(wish, dt * 11);
        const airLimit = Math.max(maximum, 14.2);
        if (this.speed > airLimit) {
          const ratio = airLimit / this.speed;
          this.velocity.x *= ratio;
          this.velocity.z *= ratio;
        }
      }
    }

    this.updateWallRun(dt, wish);
    if (this.jumpBuffer > 0) {
      if (this.activeWall) {
        const b = this.activeWall.bounds;
        const kick = this.position.x > (b.min.x + b.max.x) / 2 ? 1 : -1;
        this.velocity.x = kick * 5.8;
        this.velocity.y = 9.1;
        this.usedWall = this.activeWall;
        this.activeWall = null;
        this.wallSide = 0;
        this.wallCooldown = 0.3;
        this.jumpBuffer = 0;
        this.onEvent("jump");
      } else if (this.coyoteTime > 0 && (this.canStand() || this.crouching)) {
        this.velocity.y = JUMP_SPEED;
        this.grounded = false;
        this.coyoteTime = 0;
        this.jumpBuffer = 0;
        this.sliding = false;
        this.onEvent("jump");
      }
    }

    if (
      !this.grounded &&
      !input.jumpHeld &&
      this.velocity.y > 4.7 &&
      !this.activeWall
    )
      this.velocity.y -= GRAVITY * 0.65 * dt;
    this.velocity.y -= (this.activeWall ? 2.4 : GRAVITY) * dt;
    const wasGrounded = this.grounded;
    const fallSpeed = this.velocity.y;
    this.moveAxis("x", this.velocity.x * dt);
    this.moveAxis("z", this.velocity.z * dt);
    this.grounded = false;
    this.moveAxis("y", this.velocity.y * dt);

    if (this.grounded) {
      if (!wasGrounded && fallSpeed < -2) {
        this.landingImpact = Math.min(0.22, Math.abs(fallSpeed) * 0.014);
        this.onEvent("land", Math.min(1, Math.abs(fallSpeed) / 15));
      }
      this.usedWall = null;
      this.activeWall = null;
      this.wallSide = 0;
      this.wallTime = 0;
    } else if (!this.activeWall && this.velocity.y < 3 && input.forward > 0) {
      this.tryTraversal(forward, true);
    }
    const traversal = this.traversal as Traversal | null;
    this.moveName = traversal
      ? traversal.name
      : this.activeWall
        ? "WALL RUN"
        : this.sliding
          ? "SLIDING"
          : this.crouching
            ? "CROUCHED"
            : !this.grounded
              ? "AIRBORNE"
              : this.speed > 10
                ? "SPRINTING"
                : this.speed > 0.5
                  ? "RUNNING"
                  : "READY";
  }

  private canStand(): boolean {
    return !this.world.overlaps(this.position, STANDING_HEIGHT, RADIUS);
  }

  private moveAxis(axis: "x" | "y" | "z", amount: number): void {
    if (amount === 0) return;
    this.position[axis] += amount;
    for (const c of this.world.nearby(this.position)) {
      if (!this.world.intersects(this.position, this.height, RADIUS, c))
        continue;
      const b = c.bounds;
      if (axis !== "y") {
        // Small steps let the player run over thresholds and launch ramps.
        const step = b.max.y - this.position.y;
        if (this.grounded && step > 0 && step <= 0.27) {
          const raised = this.position.clone();
          raised.y = b.max.y;
          if (!this.world.overlaps(raised, this.height, RADIUS, c)) {
            this.position.y = raised.y;
            continue;
          }
        }
        this.position[axis] =
          amount > 0 ? b.min[axis] - RADIUS : b.max[axis] + RADIUS;
        this.velocity[axis] = 0;
      } else if (amount < 0) {
        this.position.y = b.max.y;
        this.velocity.y = 0;
        this.grounded = true;
      } else {
        this.position.y = b.min.y - this.height;
        this.velocity.y = 0;
      }
    }
  }

  private updateWallRun(dt: number, wish: Vector3): void {
    if (
      this.grounded ||
      this.crouching ||
      this.wallCooldown > 0 ||
      this.speed < 6 ||
      wish.lengthSq() === 0
    ) {
      this.activeWall = null;
      this.wallSide = 0;
      return;
    }
    const candidate = this.world.nearby(this.position, 2).find((c) => {
      if (c.kind !== "wallrun" || c === this.usedWall) return false;
      const b = c.bounds;
      const dx = Math.min(
        Math.abs(this.position.x - b.min.x),
        Math.abs(this.position.x - b.max.x),
      );
      return (
        dx < 1.4 &&
        this.position.y + 0.8 > b.min.y &&
        this.position.y < b.max.y - 0.5 &&
        this.position.z < b.max.z &&
        this.position.z > b.min.z
      );
    });
    if (!candidate) {
      this.activeWall = null;
      this.wallSide = 0;
      return;
    }
    if (candidate !== this.activeWall) {
      this.activeWall = candidate;
      this.wallTime = 0;
      this.velocity.y = Math.max(2.6, Math.min(4, this.velocity.y));
      this.onEvent("wallrun");
    }
    this.wallTime += dt;
    if (this.wallTime > 2.35) {
      this.usedWall = candidate;
      this.activeWall = null;
      this.wallSide = 0;
      return;
    }
    const center = (candidate.bounds.min.x + candidate.bounds.max.x) / 2;
    this.wallSide = this.position.x > center ? -1 : 1;
    const face =
      this.wallSide < 0
        ? candidate.bounds.max.x + RADIUS + 0.07
        : candidate.bounds.min.x - RADIUS - 0.07;
    this.position.x = MathUtils.lerp(
      this.position.x,
      face,
      Math.min(1, dt * 12),
    );
    this.velocity.x = 0;
    this.velocity.z =
      Math.sign(this.velocity.z || -1) *
      Math.max(12.8, Math.abs(this.velocity.z));
  }

  private tryTraversal(forward: Vector3, mantle: boolean): boolean {
    if (this.crouching) return false;
    const reach = mantle ? 0.95 : 2;
    const candidates = this.world
      .nearby(this.position, reach + 1)
      .flatMap((c) => {
        if (c.kind === "wallrun") return [];
        const b = c.bounds,
          rise = b.max.y - this.position.y;
        if (rise < 0.12 || rise > (mantle ? 1.6 : 1.55)) return [];
        const origin = new Vector3(
          this.position.x,
          b.max.y - 0.05,
          this.position.z,
        );
        const hit = new Ray(origin, forward).intersectBox(b, new Vector3());
        const distance = hit ? hit.distanceTo(origin) : Infinity;
        return distance <= reach ? [{ collider: c, distance }] : [];
      })
      .sort((a, b) => a.distance - b.distance);
    for (const { collider: c, distance } of candidates) {
      const b = c.bounds;
      let target = this.position.clone();
      if (mantle || c.kind === "roof") {
        target.addScaledVector(forward, distance + 0.75);
        target.y = b.max.y;
        if (
          target.x < b.min.x + RADIUS ||
          target.x > b.max.x - RADIUS ||
          target.z < b.min.z + RADIUS ||
          target.z > b.max.z - RADIUS
        )
          continue;
      } else {
        const thickness =
          Math.abs(forward.x) > Math.abs(forward.z)
            ? (b.max.x - b.min.x) / Math.abs(forward.x)
            : (b.max.z - b.min.z) / Math.abs(forward.z);
        if (thickness > 3.1) continue;
        target.addScaledVector(forward, distance + thickness + 0.8);
        const floor = this.world.floorAt(
          target.x,
          target.z,
          this.position.y + 0.2,
        );
        if (floor === undefined) continue;
        target.y = floor;
      }
      if (this.world.overlaps(target, STANDING_HEIGHT, RADIUS)) continue;
      // Check the top of the whole arc, so a vault cannot pass through a low ceiling.
      const apex = this.position.clone().lerp(target, 0.5);
      apex.y = Math.max(this.position.y, b.max.y) + 0.12;
      if (this.world.overlaps(apex, STANDING_HEIGHT, RADIUS)) continue;
      const traversal: Traversal = {
        from: this.position.clone(),
        to: target,
        elapsed: 0,
        duration: mantle ? 0.32 : 0.4,
        arc: mantle
          ? 0.14
          : Math.max(
              0.35,
              b.max.y - Math.max(this.position.y, target.y) + 0.15,
            ),
        name: mantle ? "MANTLE" : "VAULT",
      };
      let clear = true;
      for (let sample = 1; sample <= 32; sample++) {
        const point = sampleTraversal(traversal, sample / 32, new Vector3());
        if (this.world.overlaps(point, STANDING_HEIGHT, RADIUS)) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      this.traversal = traversal;
      this.velocity.addScaledVector(forward, Math.max(0, 9 - this.speed));
      this.grounded = false;
      this.jumpBuffer = 0;
      this.onEvent("vault");
      return true;
    }
    return false;
  }
}
