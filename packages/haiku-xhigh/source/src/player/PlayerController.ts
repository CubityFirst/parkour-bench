import { BoxCollider, CollisionWorld, Vec3 } from '../world/CollisionWorld';
import { PlayerPhysics, SLIDE_HEIGHT, STAND_HEIGHT } from './PlayerPhysics';
import { ParkourSystem, WallRunContact } from './ParkourSystem';

// ---- Tuning (metres and seconds). Values were chosen so that a sprint jump covers ~6.5 m. ----

export const WALK_SPEED = 7;
export const SPRINT_SPEED = 11.5;
const CROUCH_SPEED = 3.6;

const GROUND_ACCEL = 60;
/** Bleeds speed slowly toward a lower target, so sprint momentum survives releasing Shift. */
const GROUND_DECEL = 9;
const GROUND_FRICTION = 16;
const LANDING_TIME = 0.15;
const LANDING_SCALE = 0.9;
const LANDING_IMPACT_FOR_FRICTION = 6;

/** Air steering only adds speed up to this cap along the wish direction, so momentum is kept. */
const AIR_CONTROL_ACCEL = 9;
const AIR_CONTROL_CAP = 7.5;

const GRAVITY = 30;
const TERMINAL_SPEED = 42;
const JUMP_SPEED = 9.2;
/** Releasing jump early multiplies the remaining rise by this, giving variable jump height. */
const JUMP_CUT = 0.45;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;

const SLIDE_MIN_SPEED = 5.5;
const SLIDE_MAX_TIME = 1.3;
const SLIDE_FRICTION = 3.2;
const SLIDE_STEER = 1.5;
const SLIDE_END_SPEED = 3.5;

const WALLRUN_MIN_SPEED = 7.5;
const WALLRUN_MAX_TIME = 1.6;
const WALLRUN_DESCENT = 0.9;
const WALLRUN_JUMP_OUT = 7.5;
const WALLRUN_JUMP_UP = 8.8;

const VAULT_TIME = 0.42;
const MANTLE_TIME = 0.5;

const FOOTSTEP_WALK = 1.8;
const FOOTSTEP_SPRINT = 2.4;

/** Per-frame input snapshot. Edge flags (`*Pressed`) are true only on the tick they occur. */
export interface MoveInput {
  /** -1..1, positive = forward (W). */
  forward: number;
  /** -1..1, positive = right (D). */
  strafe: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
  /** Camera yaw in radians. Yaw 0 looks down -Z. */
  yaw: number;
}

export type MoveMode = 'normal' | 'slide' | 'wallrun' | 'vault' | 'mantle';

/** Sound and camera cues emitted by the controller. Drained once per tick by Game. */
export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'land'; impact: number }
  | { type: 'step' }
  | { type: 'slideStart' }
  | { type: 'slideEnd' }
  | { type: 'wallrunStart' }
  | { type: 'wallrunEnd' }
  | { type: 'vault' }
  | { type: 'mantle' };

interface ScriptedMove {
  t: number;
  duration: number;
  start: Vec3;
  end: Vec3;
  arc: number;
  exitVelocity: Vec3;
}

/**
 * Movement state machine. Each tick it chooses velocities for the current mode,
 * then hands the body to PlayerPhysics. Vault and mantle are scripted moves
 * that bypass collision for a short arc, then return control with momentum.
 */
export class PlayerController {
  mode: MoveMode = 'normal';

  private readonly parkour: ParkourSystem;
  private readonly events: PlayerEvent[] = [];

  private yaw = 0;
  private coyoteTimer = 0;
  private jumpBuffer = 0;
  private jumpRising = false;
  private wasGrounded = false;
  private landingTimer = 0;
  private slideTimer = 0;
  private stepDistance = 0;

  private wallContact: WallRunContact | null = null;
  private wallTimer = 0;
  private wallSpeed = 0;
  /** The wall used in the current airtime. Cleared on landing so each wall is used once per jump. */
  private wallUsed: BoxCollider | null = null;

  private script: ScriptedMove = {
    t: 0,
    duration: 1,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 0 },
    arc: 0,
    exitVelocity: { x: 0, y: 0, z: 0 },
  };
  private scriptKind: 'vault' | 'mantle' = 'vault';

  constructor(
    readonly physics: PlayerPhysics,
    world: CollisionWorld,
  ) {
    this.parkour = new ParkourSystem(world);
  }

  /** Horizontal speed in metres per second. */
  get speed(): number {
    return Math.hypot(this.physics.velocity.x, this.physics.velocity.z);
  }

  get crouching(): boolean {
    return this.physics.height < STAND_HEIGHT - 0.05;
  }

  /** Fraction of the vault/mantle animation that has played, 0 when no scripted move is active. */
  get scriptProgress(): number {
    if (this.mode !== 'vault' && this.mode !== 'mantle') return 0;
    return Math.min(1, this.script.t / this.script.duration);
  }

  get currentScriptKind(): 'vault' | 'mantle' {
    return this.scriptKind;
  }

  /**
   * Lean toward the wall while wall-running: +1 = wall on the right, -1 = wall on the left.
   * Derived from the current yaw so the camera tilts correctly at any heading.
   */
  get wallLean(): number {
    if (this.mode !== 'wallrun' || !this.wallContact) return 0;
    const c = this.wallContact;
    // Direction from the body toward the wall.
    const toWallX = c.normalAxis === 'x' ? -c.normalSign : 0;
    const toWallZ = c.normalAxis === 'z' ? -c.normalSign : 0;
    // Camera right vector for this yaw.
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    return Math.max(-1, Math.min(1, toWallX * rightX + toWallZ * rightZ));
  }

  /** Returns the queued events and clears the queue. */
  drainEvents(): PlayerEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  reset(): void {
    this.mode = 'normal';
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.jumpRising = false;
    this.wasGrounded = false;
    this.landingTimer = 0;
    this.slideTimer = 0;
    this.stepDistance = 0;
    this.wallContact = null;
    this.wallTimer = 0;
    this.wallUsed = null;
    this.events.length = 0;
    this.physics.kinematic = false;
  }

  update(dt: number, input: MoveInput): void {
    const p = this.physics;
    this.yaw = input.yaw;

    this.jumpBuffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    this.coyoteTimer = p.grounded ? COYOTE_TIME : Math.max(0, this.coyoteTimer - dt);
    this.landingTimer = Math.max(0, this.landingTimer - dt);

    if (this.mode === 'vault' || this.mode === 'mantle') {
      this.updateScripted(dt);
      return;
    }

    if (p.grounded && !this.wasGrounded) this.onLanded();
    this.wasGrounded = p.grounded;
    if (p.grounded) this.wallUsed = null;

    // Releasing jump early cuts the rise short: variable jump height.
    if (!input.jumpHeld && this.jumpRising && p.velocity.y > 0) {
      p.velocity.y *= JUMP_CUT;
      this.jumpRising = false;
    }
    if (p.velocity.y <= 0) this.jumpRising = false;

    const wish = wishDirection(input);

    if (input.vaultPressed && this.startVault()) return;

    if (this.mode === 'wallrun') this.updateWallRunState();

    if (input.slidePressed && this.mode === 'normal' && p.grounded) this.tryStartSlide();

    if (this.jumpBuffer > 0 && this.mode !== 'wallrun' && (p.grounded || this.coyoteTimer > 0)) {
      this.jump();
    }

    // Mode-specific velocities.
    if (this.mode === 'wallrun') {
      this.applyWallRunVelocity(dt);
    } else if (this.mode === 'slide') {
      this.applySlide(dt, wish);
    } else if (p.grounded) {
      this.applyGroundMove(dt, wish, input.sprint);
    } else {
      this.applyAirMove(dt, wish);
    }

    if (this.mode !== 'wallrun') {
      p.velocity.y = Math.max(-TERMINAL_SPEED, p.velocity.y - GRAVITY * dt);
    }

    this.updateHeight(dt);
    p.integrate(dt);
    this.afterIntegrate(dt, input);
  }

  // ---- Ground and air ----

  private applyGroundMove(dt: number, wish: { x: number; z: number }, sprint: boolean): void {
    const v = this.physics.velocity;
    const target = this.crouching ? CROUCH_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED;
    const hasWish = wish.x !== 0 || wish.z !== 0;
    const speed = this.speed;

    let accel: number;
    if (!hasWish) {
      // Stopping is firmer for a short window after landing, so a landing feels planted.
      accel = GROUND_FRICTION * (this.landingTimer > 0 ? 2 : 1);
    } else {
      // Turning sharply should be crisp, so only bleed speed when already moving along the wish direction.
      const aligned = speed > 0.01 && (v.x * wish.x + v.z * wish.z) / speed > 0.7;
      accel = speed < target || !aligned ? GROUND_ACCEL : GROUND_DECEL;
    }
    moveHorizontalTowards(v, hasWish ? wish.x * target : 0, hasWish ? wish.z * target : 0, accel * dt);
  }

  private applyAirMove(dt: number, wish: { x: number; z: number }): void {
    if (wish.x === 0 && wish.z === 0) return;
    const v = this.physics.velocity;
    // Steering only adds speed up to a cap along the wish direction, so momentum from a sprint is kept.
    const along = v.x * wish.x + v.z * wish.z;
    if (along < AIR_CONTROL_CAP) {
      const add = Math.min(AIR_CONTROL_ACCEL * dt, AIR_CONTROL_CAP - along);
      v.x += wish.x * add;
      v.z += wish.z * add;
    }
  }

  private onLanded(): void {
    const impact = this.physics.impactSpeed;
    this.events.push({ type: 'land', impact });
    this.landingTimer = LANDING_TIME;
    if (impact > LANDING_IMPACT_FOR_FRICTION) {
      // Controlled friction on hard landings: keep most of the momentum but scrub a little.
      this.physics.velocity.x *= LANDING_SCALE;
      this.physics.velocity.z *= LANDING_SCALE;
    }
  }

  private jump(): void {
    const p = this.physics;
    p.velocity.y = JUMP_SPEED;
    p.grounded = false;
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.jumpRising = true;
    if (this.mode === 'slide') {
      this.mode = 'normal';
      this.events.push({ type: 'slideEnd' });
    }
    this.events.push({ type: 'jump' });
  }

  // ---- Slide ----

  private tryStartSlide(): void {
    if (this.speed < SLIDE_MIN_SPEED) return;
    this.mode = 'slide';
    this.slideTimer = 0;
    this.events.push({ type: 'slideStart' });
  }

  private applySlide(dt: number, wish: { x: number; z: number }): void {
    const p = this.physics;
    const v = p.velocity;
    this.slideTimer += dt;

    // Small steering while keeping the incoming momentum.
    v.x += wish.x * SLIDE_STEER * dt;
    v.z += wish.z * SLIDE_STEER * dt;

    // Friction bleeds speed; direction is kept.
    const speed = this.speed;
    if (speed > 0) {
      const next = Math.max(0, speed - SLIDE_FRICTION * dt) / speed;
      v.x *= next;
      v.z *= next;
    }

    const finished = this.speed < SLIDE_END_SPEED || this.slideTimer > SLIDE_MAX_TIME;
    if (!p.grounded || finished) {
      // If there is no headroom the body stays low and the player crawls (see crouching).
      this.mode = 'normal';
      this.events.push({ type: 'slideEnd' });
    }
  }

  /** Lowers or raises the body toward slide or standing height, but never into a ceiling. */
  private updateHeight(dt: number): void {
    const p = this.physics;
    const target = this.mode === 'slide' ? SLIDE_HEIGHT : STAND_HEIGHT;
    const next = p.height + (target - p.height) * Math.min(1, dt * 12);
    p.trySetHeight(Math.abs(target - next) < 0.01 ? target : next);
  }

  // ---- Wall run ----

  private startWallRun(c: WallRunContact): void {
    const p = this.physics;
    this.mode = 'wallrun';
    this.wallContact = c;
    this.wallTimer = 0;
    this.wallUsed = c.box;
    this.wallSpeed = Math.max(this.speed, 9);
    this.parkour.snapToWall(p, c);
    p.velocity.y = Math.min(p.velocity.y, 2);
    this.events.push({ type: 'wallrunStart' });
  }

  private endWallRun(): void {
    this.mode = 'normal';
    this.wallContact = null;
    this.events.push({ type: 'wallrunEnd' });
  }

  /** Runs before the velocity step, so exits and wall jumps are decided on the current frame. */
  private updateWallRunState(): void {
    const c = this.wallContact;
    if (!c) return;
    const p = this.physics;

    if (this.jumpBuffer > 0) {
      // Jump away from the wall.
      p.velocity.x = c.normalAxis === 'x' ? c.normalSign * WALLRUN_JUMP_OUT : 0;
      p.velocity.z = c.normalAxis === 'z' ? c.normalSign * WALLRUN_JUMP_OUT : 0;
      p.velocity.y = WALLRUN_JUMP_UP;
      this.jumpBuffer = 0;
      this.jumpRising = true;
      this.endWallRun();
      this.events.push({ type: 'jump' });
      return;
    }

    const hitOther = p.horizontalHit !== null && p.horizontalHit.box !== c.box;
    if (p.grounded || hitOther || this.wallTimer > WALLRUN_MAX_TIME || !this.parkour.isAlongside(p, c)) {
      this.endWallRun();
      return;
    }
    this.parkour.snapToWall(p, c);
  }

  private applyWallRunVelocity(dt: number): void {
    const c = this.wallContact;
    if (!c) return;
    const p = this.physics;
    const v = p.velocity;
    this.wallTimer += dt;

    // Run along the wall, zero motion into it, and descend slowly to reduce gravity's pull.
    v.x = c.tangentAxis === 'x' ? c.tangentSign * this.wallSpeed : 0;
    v.z = c.tangentAxis === 'z' ? c.tangentSign * this.wallSpeed : 0;
    v.y += (-WALLRUN_DESCENT - v.y) * Math.min(1, dt * 8);
  }

  // ---- Vault and mantle (scripted) ----

  private startVault(): boolean {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const target = this.parkour.findVault(this.physics, fx, fz);
    if (!target) return false;

    const exit = this.exitDirection(fx, fz);
    const p = this.physics;
    const rise = Math.max(0, target.target.y - p.position.y);
    this.beginScript('vault', target.target, VAULT_TIME, 0.5 + rise * 0.5, exit);
    this.events.push({ type: 'vault' });
    return true;
  }

  private startMantle(target: Vec3): void {
    const exit = this.exitDirection(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const rise = Math.max(0, target.y - this.physics.position.y);
    this.beginScript('mantle', target, MANTLE_TIME, 0.4 + rise * 0.6, {
      x: exit.x * 3,
      y: 0,
      z: exit.z * 3,
    });
    this.events.push({ type: 'mantle' });
  }

  private beginScript(kind: 'vault' | 'mantle', end: Vec3, duration: number, arc: number, exit: Vec3): void {
    const p = this.physics;
    this.mode = kind;
    this.scriptKind = kind;
    this.script = {
      t: 0,
      duration,
      start: { x: p.position.x, y: p.position.y, z: p.position.z },
      end: { x: end.x, y: end.y, z: end.z },
      arc,
      exitVelocity: exit,
    };
    p.kinematic = true;
    p.velocity.x = p.velocity.y = p.velocity.z = 0;
    this.wallContact = null;
    this.slideTimer = 0;
  }

  private updateScripted(dt: number): void {
    const s = this.script;
    const p = this.physics;
    s.t += dt;
    const u = Math.min(1, s.t / s.duration);
    // Smoothstep eases in and out so the move looks deliberate, not mechanical.
    const e = u * u * (3 - 2 * u);
    p.position.x = lerp(s.start.x, s.end.x, e);
    p.position.z = lerp(s.start.z, s.end.z, e);
    p.position.y = lerp(s.start.y, s.end.y, e) + s.arc * Math.sin(Math.PI * u);

    if (u >= 1) {
      p.position.y = s.end.y;
      p.kinematic = false;
      p.velocity.x = s.exitVelocity.x;
      p.velocity.y = 0;
      p.velocity.z = s.exitVelocity.z;
      p.grounded = false;
      this.mode = 'normal';
    }
  }

  /** Keeps forward momentum through a scripted move: the current heading, or the facing direction when stopped. */
  private exitDirection(fx: number, fz: number): Vec3 {
    const v = this.physics.velocity;
    const speed = this.speed;
    const keep = Math.max(speed, 6.5);
    if (speed > 0.5) {
      return { x: (v.x / speed) * keep, y: 0, z: (v.z / speed) * keep };
    }
    return { x: fx * keep, y: 0, z: fz * keep };
  }

  /** Runs after collision resolution: detects mantles, wall-run contacts, and footsteps. */
  private afterIntegrate(dt: number, input: MoveInput): void {
    const p = this.physics;

    if (this.mode === 'normal' && !p.grounded) {
      const mantle = this.parkour.findMantle(p);
      if (mantle) {
        this.startMantle(mantle.target);
        return;
      }
      const contact = this.parkour.findWallRun(p, this.wallUsed, WALLRUN_MIN_SPEED);
      if (contact) this.startWallRun(contact);
    }

    if (this.mode === 'normal' && p.grounded && this.speed > 2) {
      this.stepDistance += this.speed * dt;
      const stride = input.sprint ? FOOTSTEP_SPRINT : FOOTSTEP_WALK;
      if (this.stepDistance >= stride) {
        this.stepDistance = 0;
        this.events.push({ type: 'step' });
      }
    }
  }
}

/** Converts WASD into a unit horizontal direction in world space. */
function wishDirection(input: MoveInput): { x: number; z: number } {
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  // Forward is (-sin, -cos) and right is (cos, -sin) for a yaw measured from -Z.
  let x = -sin * input.forward + cos * input.strafe;
  let z = -cos * input.forward - sin * input.strafe;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, z };
}

/** Moves (vx, vz) toward (tx, tz) by at most maxDelta. */
function moveHorizontalTowards(v: Vec3, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDelta) {
    v.x = tx;
    v.z = tz;
  } else {
    v.x += (dx / dist) * maxDelta;
    v.z += (dz / dist) * maxDelta;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
