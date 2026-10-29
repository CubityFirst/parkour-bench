import * as THREE from 'three';
import { CollisionWorld, type Collider } from '../world/CollisionWorld';

export interface WallRunState {
  collider: Collider;
  /** Unit normal pointing from the wall surface towards the player. */
  normal: THREE.Vector3;
  /** Unit vector running along the wall surface. */
  tangent: THREE.Vector3;
  time: number;
  speed: number;
}

export interface ActionState {
  type: 'vault' | 'mantle';
  t: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Extra vertical lift used by the vault arc. */
  arc: number;
  exitSpeed: number;
}

export interface MoveIntent {
  /** Normalised world space direction the player wants to move in. */
  wish: THREE.Vector3;
  sprint: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  /** True while a movement key is held at all. */
  moving: boolean;
  /** True while the slide key is held. */
  slideHeld: boolean;
}

export const CFG = {
  radius: 0.35,
  standHeight: 1.8,
  slideHeight: 0.85,
  eyeHeight: 1.62,
  slideEyeHeight: 0.55,
  walkSpeed: 6.4,
  sprintSpeed: 12.0,
  groundAccel: 74,
  groundFriction: 9.5,
  slideFriction: 0.35,
  airAccel: 26,
  airControl: 0.5,
  gravityUp: 22,
  gravityDown: 30,
  jumpVelocity: 8.2,
  coyoteTime: 0.12,
  jumpBufferTime: 0.14,
  maxSpeed: 13.6,
  stepHeight: 0.42,
  wallRunDuration: 2.2,
  wallRunMinSpeed: 4.2,
  /** Small upward drift so the player keeps height on the wall. */
  wallRunClimb: 0.9,
  wallRunReach: 1.6,
  vaultDuration: 0.34,
  vaultMaxHeight: 1.35,
  vaultMinHeight: 0.35,
  vaultMaxDepth: 2.2,
  mantleDuration: 0.46,
  mantleMaxHeight: 1.7,
  landImpactThreshold: 7,
  stepSize: 0.22,
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Lightweight AABB character controller.
 *
 * The player is a vertical box (radius x height). Movement is integrated with
 * a fixed timestep and resolved per axis so the controller can never tunnel
 * through a wall even at sprint speed.
 */
export class PlayerPhysics {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  /** Current collision height (blends between standing and sliding). */
  height = CFG.standHeight;
  heightTarget = CFG.standHeight;

  grounded = false;
  coyote = 0;
  jumpBuffer = 0;
  jumping = false;
  sliding = false;
  slideTimer = 0;

  wallRun: WallRunState | null = null;
  action: ActionState | null = null;

  /** Set for one step when the player hits the ground hard. */
  landImpact = 0;
  airTime = 0;

  /** Horizontal facing / right vectors, refreshed from the camera each frame. */
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);

  private readonly scratch: Collider[] = [];

  constructor(private readonly world: CollisionWorld) {}

  reset(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.height = CFG.standHeight;
    this.heightTarget = CFG.standHeight;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumping = false;
    this.sliding = false;
    this.slideTimer = 0;
    this.wallRun = null;
    this.action = null;
    this.airTime = 0;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Height of the eyes above the feet for the current stance. */
  get eyeHeight(): number {
    const t = (this.height - CFG.slideHeight) / (CFG.standHeight - CFG.slideHeight);
    const k = Math.min(1, Math.max(0, t));
    return CFG.slideEyeHeight + (CFG.eyeHeight - CFG.slideEyeHeight) * k;
  }

  /** ------------------------------------------------------------------ */
  /** Main simulation step.                                             */
  /** ------------------------------------------------------------------ */
  step(dt: number, intent: MoveIntent): void {
    this.landImpact = 0;

    if (this.action) {
      this.updateAction(dt);
      return;
    }

    // timers ------------------------------------------------------------
    if (this.grounded) {
      this.coyote = CFG.coyoteTime;
      this.airTime = 0;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
      this.airTime += dt;
    }
    if (intent.jumpPressed) this.jumpBuffer = CFG.jumpBufferTime;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // wall run takes over the whole movement ---------------------------
    if (this.wallRun) {
      this.stepWallRun(dt, intent);
      this.moveAndCollide(dt);
      return;
    }

    // horizontal acceleration ------------------------------------------
    const wish = intent.wish;
    const moving = intent.moving && wish.lengthSq() > 0.0001;
    const maxSpeed = intent.sprint ? CFG.sprintSpeed : CFG.walkSpeed;

    if (this.grounded) {
      if (this.sliding) {
        if (moving) {
          // limited steering while sliding
          this.velocity.addScaledVector(wish, Math.min(9 * dt, maxSpeed - this.velocity.dot(wish)));
        }
        const speed = this.horizontalSpeed;
        if (speed > 0.001) {
          const drop = speed * CFG.slideFriction * dt;
          this.velocity.x *= (speed - drop) / speed;
          this.velocity.z *= (speed - drop) / speed;
        }
      } else if (moving) {
        // Quake style acceleration: the component along the wish direction is
        // topped up, so strafing keeps the speed and turns instantly.
        const current = this.velocity.dot(wish);
        const add = maxSpeed - current;
        if (add > 0) {
          const accel = current < 0 ? CFG.groundAccel * 1.7 : CFG.groundAccel;
          this.velocity.addScaledVector(wish, Math.min(accel * dt, add));
        }
      } else {
        const speed = this.horizontalSpeed;
        if (speed > 0.001) {
          const drop = speed * CFG.groundFriction * dt;
          this.velocity.x *= (speed - drop) / speed;
          this.velocity.z *= (speed - drop) / speed;
        }
      }
    } else {
      // air control - keeps momentum but allows subtle steering
      if (moving) {
        const current = this.velocity.dot(wish);
        const add = maxSpeed - current;
        if (add > 0) {
          this.velocity.addScaledVector(wish, Math.min(CFG.airAccel * CFG.airControl * dt, add));
        }
      }
    }

    // hard cap so the player can never outrun the controller
    if (!this.sliding) {
      const sp = this.horizontalSpeed;
      if (sp > CFG.maxSpeed) {
        const k = CFG.maxSpeed / sp;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
    }

    // jump --------------------------------------------------------------
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.doJump();
    }
    if (this.jumping && !intent.jumpHeld && this.velocity.y > 0) {
      // variable jump height - releasing early cuts the rise
      this.velocity.y *= 0.45;
      this.jumping = false;
    }

    // gravity -------------------------------------------------------------
    let g = this.velocity.y > 0 ? CFG.gravityUp : CFG.gravityDown;
    if (this.jumping && intent.jumpHeld && this.velocity.y > 0) g *= 0.88;
    this.velocity.y = Math.max(this.velocity.y - g * dt, -70);

    this.moveAndCollide(dt);
  }

  private doJump(): void {
    this.velocity.y = CFG.jumpVelocity;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumping = true;
    this.sliding = false;
    this.heightTarget = CFG.standHeight;
  }

  /** ------------------------------------------------------------------ */
  /** Wall running                                                       */
  /** ------------------------------------------------------------------ */
  private stepWallRun(dt: number, intent: MoveIntent): void {
    const wr = this.wallRun!;
    const speed = Math.max(this.horizontalSpeed, wr.speed);

    // While on the wall the player hugs the surface instead of falling, so the
    // run reads as "running along the building" rather than floating.
    const targetVy = CFG.wallRunClimb;
    this.velocity.y += (targetVy - this.velocity.y) * Math.min(1, 7 * dt);
    this.velocity.y = Math.max(this.velocity.y, -2.5);

    // kill the component into the wall, keep the tangential speed
    const into = this.velocity.dot(wr.normal);
    if (into < 0) this.velocity.addScaledVector(wr.normal, -into);

    // gently steer the tangent towards where the player is looking
    const look = this.forward.clone().setY(0);
    if (look.lengthSq() > 0.001) {
      look.normalize();
      const projected = look.clone().addScaledVector(wr.normal, -look.dot(wr.normal));
      if (projected.lengthSq() > 0.01) {
        projected.normalize();
        wr.tangent.lerp(projected, Math.min(1, 4 * dt)).normalize();
      }
    }

    const decay = Math.max(0, 1 - 0.3 * dt);
    wr.speed = Math.max(3.5, speed * decay);
    this.velocity.x = wr.tangent.x * wr.speed;
    this.velocity.z = wr.tangent.z * wr.speed;

    // jump away from the wall
    if (intent.jumpPressed) {
      this.velocity.addScaledVector(wr.normal, 4.6);
      this.velocity.y = CFG.jumpVelocity;
      this.jumping = true;
      this.wallRun = null;
    }
  }

  /** ------------------------------------------------------------------ */
  /** Scripted actions (vault / mantle)                                  */
  /** ------------------------------------------------------------------ */
  startAction(action: ActionState): void {
    this.action = action;
    this.velocity.set(0, 0, 0);
    this.wallRun = null;
  }

  updateAction(dt: number): void {
    const a = this.action!;
    a.t += dt;
    const k = Math.min(1, a.t / a.duration);
    const e = 1 - Math.pow(1 - k, 3);
    this.position.lerpVectors(a.from, a.to, e);
    if (a.arc !== 0) this.position.y += Math.sin(k * Math.PI) * a.arc;

    if (k >= 1) {
      this.action = null;
      this.velocity.x = this.forward.x * a.exitSpeed;
      this.velocity.z = this.forward.z * a.exitSpeed;
      this.velocity.y = 0;
      this.grounded = false;
    }
  }

  /** ------------------------------------------------------------------ */
  /** Collision resolution                                               */
  /** ------------------------------------------------------------------ */
  private moveAndCollide(dt: number): void {
    const dx = this.velocity.x * dt;
    const dy = this.velocity.y * dt;
    const dz = this.velocity.z * dt;
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / CFG.stepSize)
    );
    const sdt = dt / steps;
    const impactSpeed = this.velocity.y;

    for (let i = 0; i < steps; i++) {
      this.position.x += this.velocity.x * sdt;
      this.resolveAxis('x', this.velocity.x);
      this.position.z += this.velocity.z * sdt;
      this.resolveAxis('z', this.velocity.z);
      this.position.y += this.velocity.y * sdt;
      this.resolveAxis('y', this.velocity.y);
    }

    // ground check
    const wasGrounded = this.grounded;
    this.grounded = false;
    const r = CFG.radius;
    const p = this.position;
    if (
      this.world.overlaps(
        p.x - r,
        p.y - 0.07,
        p.z - r,
        p.x + r,
        p.y + 0.02,
        p.z + r
      )
    ) {
      this.grounded = true;
    }

    if (this.grounded && !wasGrounded && impactSpeed < -CFG.landImpactThreshold) {
      this.landImpact = -impactSpeed;
    }
    if (this.grounded) this.airTime = 0;
  }

  /**
   * Resolves penetration on a single axis.
   *
   * Several colliders can overlap the player at once (a wall next to a floor,
   * two roofs meeting at a corner), so the correction is computed against the
   * most obstructive one rather than whichever happens to be first.
   */
  private resolveAxis(axis: 'x' | 'y' | 'z', delta: number): void {
    const p = this.position;
    const r = CFG.radius;
    const h = this.height;

    this.world.query(
      p.x - r,
      p.y,
      p.z - r,
      p.x + r,
      p.y + h,
      p.z + r,
      this.scratch
    );

    // --- vertical -------------------------------------------------------
    if (axis === 'y') {
      let floor = -Infinity;
      let ceiling = Infinity;
      for (const c of this.scratch) {
        if (c.maxX <= p.x - r || c.minX >= p.x + r) continue;
        if (c.maxZ <= p.z - r || c.minZ >= p.z + r) continue;
        if (c.maxY <= p.y || c.minY >= p.y + h) continue;
        if (delta <= 0) {
          if (c.maxY > floor) floor = c.maxY;
        } else {
          if (c.minY < ceiling) ceiling = c.minY;
        }
      }
      if (delta <= 0 && floor > -Infinity) {
        p.y = floor;
        this.grounded = true;
        if (this.velocity.y < 0) this.velocity.y = 0;
      } else if (delta > 0 && ceiling < Infinity) {
        p.y = ceiling - h;
        if (this.velocity.y > 0) this.velocity.y = 0;
      }
      return;
    }

    // --- horizontal -----------------------------------------------------
    // Try to step over low obstacles instead of blocking on them.
    if (this.grounded) {
      let stepTo = -Infinity;
      for (const c of this.scratch) {
        if (c.maxX <= p.x - r || c.minX >= p.x + r) continue;
        if (c.maxZ <= p.z - r || c.minZ >= p.z + r) continue;
        if (c.maxY <= p.y || c.minY >= p.y + h) continue;
        const stepTop = c.maxY - p.y;
        if (stepTop > 0 && stepTop <= CFG.stepHeight && c.maxY > stepTo) stepTo = c.maxY;
      }
      if (stepTo > -Infinity) {
        p.y = stepTo;
        return;
      }
    }

    let push = 0;
    for (const c of this.scratch) {
      if (c.maxX <= p.x - r || c.minX >= p.x + r) continue;
      if (c.maxZ <= p.z - r || c.minZ >= p.z + r) continue;
      if (c.maxY <= p.y || c.minY >= p.y + h) continue;

      if (axis === 'x') {
        const toMin = c.minX - r - p.x; // negative: push west
        const toMax = c.maxX + r - p.x; // positive: push east
        const amount = delta > 0 ? toMin : delta < 0 ? toMax : Math.abs(toMin) < Math.abs(toMax) ? toMin : toMax;
        if (Math.abs(amount) > Math.abs(push)) push = amount;
      } else {
        const toMin = c.minZ - r - p.z;
        const toMax = c.maxZ + r - p.z;
        const amount = delta > 0 ? toMin : delta < 0 ? toMax : Math.abs(toMin) < Math.abs(toMax) ? toMin : toMax;
        if (Math.abs(amount) > Math.abs(push)) push = amount;
      }
    }

    if (push !== 0) {
      if (axis === 'x') {
        p.x += push;
        this.velocity.x = 0;
      } else {
        p.z += push;
        this.velocity.z = 0;
      }
    }
  }

  /** True when the player fits standing up at the given position. */
  canStand(pos: THREE.Vector3 = this.position): boolean {
    const r = CFG.radius;
    return !this.world.overlaps(
      pos.x - r,
      pos.y + CFG.slideHeight + 0.05,
      pos.z - r,
      pos.x + r,
      pos.y + CFG.standHeight,
      pos.z + r
    );
  }

  /** True when nothing blocks the given box. */
  isFree(
    x: number,
    y: number,
    z: number,
    width = CFG.radius,
    height = CFG.standHeight
  ): boolean {
    return !this.world.overlaps(
      x - width,
      y,
      z - width,
      x + width,
      y + height,
      z + width
    );
  }

  /** Orthonormal frame of the player on the XZ plane. */
  updateBasis(forward: THREE.Vector3): void {
    this.forward.set(forward.x, 0, forward.z);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.crossVectors(this.forward, UP).normalize();
  }
}
