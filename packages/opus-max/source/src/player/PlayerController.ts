import { Vector3 } from 'three';
import type { Collider, CollisionWorld } from '../world/CollisionWorld.ts';
import { ColliderFlags } from '../world/CollisionWorld.ts';
import { PlayerConfig as C } from './PlayerConfig.ts';
import { KinematicBody, PlayerPhysics } from './PlayerPhysics.ts';
import { ParkourSystem, type LedgePlan, type VaultPlan, type ZiplineLine } from './ParkourSystem.ts';

export const MoveMode = {
  Ground: 0,
  Air: 1,
  Slide: 2,
  WallRun: 3,
  Vault: 4,
  Mantle: 5,
  Zipline: 6,
} as const;
export type MoveMode = (typeof MoveMode)[keyof typeof MoveMode];
export const MODE_NAMES = ['ground', 'air', 'slide', 'wallrun', 'vault', 'mantle', 'zipline'] as const;

/** Input sampled once per fixed physics step. `*Pressed` flags are edges (true for one step). */
export interface StepInput {
  /** Strafe axis, +1 = right. */
  moveX: number;
  /** Forward axis, +1 = forward. */
  moveZ: number;
  /** View yaw in radians (0 = looking down -Z). */
  yaw: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  crouchHeld: boolean;
  crouchPressed: boolean;
  interactPressed: boolean;
}

export function emptyInput(): StepInput {
  return { moveX: 0, moveZ: 0, yaw: 0, sprint: false, jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false, interactPressed: false };
}

export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'land'; impact: number; hard: boolean }
  | { type: 'footstep'; intensity: number; metal: boolean; wall: boolean }
  | { type: 'slideStart' }
  | { type: 'slideEnd' }
  | { type: 'wallRunStart'; side: number }
  | { type: 'wallRunEnd' }
  | { type: 'wallJump' }
  | { type: 'vault'; duration: number }
  | { type: 'mantle'; duration: number; height: number }
  | { type: 'zipAttach' }
  | { type: 'zipDetach' }
  | { type: 'bonk' };

interface ScriptedAction {
  kind: 'vault' | 'mantle';
  t: number;
  duration: number;
  sx: number;
  sy: number;
  sz: number;
  vault: VaultPlan | null;
  ledge: LedgePlan | null;
  riseFrac: number;
  exitSpeed: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * First-person parkour controller.
 *
 * Owns the player's movement state machine. Everything here runs on the fixed physics
 * timestep and is completely independent of rendering, so the same code drives both the
 * game and the headless route test (tools/route-sim.ts).
 */
export class PlayerController {
  readonly body = new KinematicBody();
  /** Position before the most recent step, for render interpolation. */
  readonly prevPos = new Vector3();
  readonly physics: PlayerPhysics;
  readonly parkour: ParkourSystem;
  ziplines: ZiplineLine[] = [];

  mode: MoveMode = MoveMode.Ground;
  crouched = false;
  /** Events produced during the last step(s); the game drains this list. */
  readonly events: PlayerEvent[] = [];

  // Jump state
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpAscending = false;
  airTime = 0;

  // Slide state
  slideTime = 0;
  private slideBoostCooldown = 0;

  // Wall-run state. (wrNx, wrNz) points out of the wall; (wrTx, wrTz) is the run direction.
  wallSide = 0;
  private wrNx = 0;
  private wrNz = 0;
  private wrTx = 0;
  private wrTz = 0;
  wallRunTime = 0;
  private wrSpeed = 0;
  private wrCollider: Collider | null = null;
  private wallLockCollider: Collider | null = null;
  private wallLockNx = 0;
  private wallLockNz = 0;
  private wallChain = 0;
  private wallCoyote = 0;

  // Vault / mantle
  private action: ScriptedAction | null = null;

  // Zipline
  zipLine: ZiplineLine | null = null;
  zipS = 0;
  zipSpeed = 0;
  private readonly zipOffset = new Vector3();
  private zipCooldown = 0;

  // Feedback
  /** 0..1 phase within the current footstep; drives head bob and footstep sounds. */
  stridePhase = 0;
  private recentSpeed = 0;
  /** Seconds since the last landing (for camera/body animation). */
  sinceLanding = 10;

  constructor(world: CollisionWorld) {
    this.physics = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(world, this.physics);
  }

  // ---------------------------------------------------------------- queries

  get position(): Vector3 {
    return this.body.pos;
  }

  get velocity(): Vector3 {
    return this.body.vel;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.body.vel.x, this.body.vel.z);
  }

  get grounded(): boolean {
    return this.mode === MoveMode.Ground || this.mode === MoveMode.Slide;
  }

  /** Kind of scripted move in progress and its 0..1 progress. */
  get actionKind(): 'vault' | 'mantle' | null {
    return this.action ? this.action.kind : null;
  }

  get actionProgress(): number {
    return this.action ? Math.min(1, this.action.t / this.action.duration) : 0;
  }

  get actionHeight(): number {
    const a = this.action;
    if (!a) return 0;
    return (a.ledge ? a.ledge.topY : a.vault ? a.vault.topY : a.sy) - a.sy;
  }

  /** Context prompt for the HUD: what pressing E would do right now. */
  probePrompt(yaw: number): 'vault' | 'zipline' | null {
    const b = this.body;
    if (this.mode !== MoveMode.Ground && this.mode !== MoveMode.Air) return null;
    if (this.zipCooldown <= 0 && this.parkour.ziplineNearby(this.ziplines, b.pos.x, b.pos.y, b.pos.z)) return 'zipline';
    if (this.mode !== MoveMode.Ground) return null;
    const plan = this.parkour.findVault(b.pos.x, b.pos.y, b.pos.z, -Math.sin(yaw), -Math.cos(yaw), this.horizontalSpeed, false);
    return plan ? 'vault' : null;
  }

  // ---------------------------------------------------------------- control

  /** Teleports the player and clears all movement state (respawn / restart). */
  respawn(x: number, y: number, z: number): void {
    const b = this.body;
    b.pos.set(x, y, z);
    b.vel.set(0, 0, 0);
    b.grounded = true;
    b.contactCount = 0;
    this.prevPos.copy(b.pos);
    this.mode = MoveMode.Ground;
    this.setCrouched(false);
    this.action = null;
    this.zipLine = null;
    this.zipCooldown = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpAscending = false;
    this.airTime = 0;
    this.slideTime = 0;
    this.slideBoostCooldown = 0;
    this.wallLockCollider = null;
    this.wallChain = 0;
    this.wallCoyote = 0;
    this.wallRunTime = 0;
    this.wallSide = 0;
    this.recentSpeed = 0;
    this.stridePhase = 0;
    this.sinceLanding = 10;
    this.events.length = 0;
  }

  /** Advances the simulation by one fixed step. */
  step(input: StepInput, dt: number): void {
    const b = this.body;
    this.prevPos.copy(b.pos);

    // Timers
    this.jumpBuffer = input.jumpPressed ? C.JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.wallCoyote = Math.max(0, this.wallCoyote - dt);
    this.slideBoostCooldown = Math.max(0, this.slideBoostCooldown - dt);
    this.zipCooldown = Math.max(0, this.zipCooldown - dt);
    this.sinceLanding += dt;

    // Movement input in world space (forward = -Z at yaw 0, right = +X).
    const sinY = Math.sin(input.yaw);
    const cosY = Math.cos(input.yaw);
    let wx = -sinY * input.moveZ + cosY * input.moveX;
    let wz = -cosY * input.moveZ - sinY * input.moveX;
    let wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
      wl = 1;
    }

    switch (this.mode) {
      case MoveMode.Vault:
      case MoveMode.Mantle:
        this.updateScripted(dt);
        break;
      case MoveMode.Zipline:
        this.updateZipline(dt, input);
        break;
      case MoveMode.WallRun:
        this.updateWallRun(dt, input, wx, wz, wl);
        break;
      case MoveMode.Slide:
        this.updateSlide(dt, input, wx, wz, wl);
        break;
      default:
        this.updateLocomotion(dt, input, wx, wz, wl);
    }

    this.postStep(dt);
  }

  // ---------------------------------------------------------------- locomotion

  private updateLocomotion(dt: number, input: StepInput, wx: number, wz: number, wl: number): void {
    const b = this.body;
    let grounded = this.mode === MoveMode.Ground;
    const lookX = -Math.sin(input.yaw);
    const lookZ = -Math.cos(input.yaw);

    // E: grab a zipline, otherwise vault whatever is in front.
    if (input.interactPressed) {
      if (this.tryAttachZipline(true)) return;
      if ((grounded || this.coyote > 0) && this.tryVault(lookX, lookZ, false)) return;
    }
    // Jumping at a low obstacle while running into it vaults it, as long as there is
    // ground behind it (so the jump key never throws you off a roof).
    if (this.jumpBuffer > 0 && (grounded || this.coyote > 0) && input.moveZ > 0.3 && this.tryVault(lookX, lookZ, true)) {
      this.jumpBuffer = 0;
      return;
    }
    // Jumping into a zipline cable grabs it automatically.
    if (!grounded && this.tryAttachZipline(false)) return;

    // Crouch and slide
    if (grounded) {
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (input.crouchPressed && !this.crouched && hs >= C.SLIDE_MIN_SPEED) {
        this.startSlide();
        this.updateSlide(dt, input, wx, wz, wl);
        return;
      }
      if (input.crouchHeld && !this.crouched && hs < C.SLIDE_MIN_SPEED) this.setCrouched(true);
    }
    if (this.crouched && !input.crouchHeld) this.tryStand();

    // Jump (buffered, with coyote time), or a late jump off a wall we just left.
    if (this.jumpBuffer > 0 && (grounded || this.coyote > 0)) {
      if (!this.crouched || this.tryStand()) {
        this.doJump();
        grounded = false;
      }
    } else if (!grounded && this.wallCoyote > 0 && this.jumpBuffer > 0 && this.wrCollider) {
      this.wallJump(input.yaw, this.wrNx, this.wrNz, this.wrTx, this.wrTz, this.wrSpeed, this.wrCollider);
    }

    // Horizontal control
    if (grounded) {
      const target = this.crouched ? C.CROUCH_SPEED : input.sprint ? C.SPRINT_SPEED : C.RUN_SPEED;
      this.groundControl(dt, wx, wz, wl, target, this.crouched ? C.GROUND_FRICTION : C.OVERSPEED_DECAY);
    } else {
      this.airControl(dt, wx, wz, wl);
    }

    // Gravity. Releasing jump early cuts the ascent (variable jump height).
    if (grounded) {
      b.vel.y = Math.min(b.vel.y, 0) - C.GRAVITY * dt;
    } else {
      let g = C.GRAVITY;
      if (b.vel.y > 0) {
        if (this.jumpAscending && !input.jumpHeld) g *= C.JUMP_CUT_GRAVITY_MULT;
      } else {
        g *= C.FALL_GRAVITY_MULT;
        this.jumpAscending = false;
      }
      b.vel.y = Math.max(-C.MAX_FALL_SPEED, b.vel.y - g * dt);
    }

    // Airborne next to a runnable wall?
    if (!grounded && this.tryStartWallRun(input)) {
      this.updateWallRun(dt, input, wx, wz, wl);
      return;
    }

    const preVy = b.vel.y;
    // In the air a small step-up rescues jumps that clip the top corner of a ledge.
    const stepHeight = grounded ? C.STEP_HEIGHT : C.AIR_STEP_HEIGHT;
    this.physics.move(b, dt, { stepHeight, snapDown: grounded });
    if (b.hitCeiling && preVy > 2) this.events.push({ type: 'bonk' });

    // Ledge recovery: holding forward against a ledge within reach climbs it.
    if (!b.grounded && !grounded && this.tryMantle(input, wx, wz, wl, lookX, lookZ)) return;

    if (b.grounded) {
      if (!grounded) this.onLanded(-preVy, input);
      else this.coyote = C.COYOTE_TIME;
    } else {
      if (grounded) {
        // Walked off an edge: coyote time is already full from the last grounded step.
        this.mode = MoveMode.Air;
        this.airTime = 0;
      }
      this.airTime += dt;
    }
  }

  private groundControl(dt: number, wx: number, wz: number, wl: number, maxSpeed: number, overspeedDecay: number): void {
    const b = this.body;
    if (wl < 0.01) {
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0) {
        const ns = Math.max(0, sp - C.GROUND_FRICTION * dt);
        b.vel.x *= ns / sp;
        b.vel.z *= ns / sp;
      }
      return;
    }
    const dx = wx / wl;
    const dz = wz / wl;
    const target = maxSpeed * wl;
    // Split velocity into the part along the wish direction and the sideways remainder.
    let along = b.vel.x * dx + b.vel.z * dz;
    let px = b.vel.x - dx * along;
    let pz = b.vel.z - dz * along;
    const lat = Math.hypot(px, pz);
    if (lat > 0) {
      const nl = Math.max(0, lat - C.GROUND_GRIP * dt);
      px *= nl / lat;
      pz *= nl / lat;
    }
    if (along < target) {
      along = Math.min(target, along + (along < C.RUN_SPEED ? C.GROUND_ACCEL : C.SPRINT_ACCEL) * dt);
    } else {
      along = Math.max(target, along - overspeedDecay * dt);
    }
    b.vel.x = dx * along + px;
    b.vel.z = dz * along + pz;
  }

  private airControl(dt: number, wx: number, wz: number, wl: number): void {
    if (wl < 0.01) return; // no air drag: momentum is preserved
    const b = this.body;
    const dx = wx / wl;
    const dz = wz / wl;
    let along = b.vel.x * dx + b.vel.z * dz;
    let px = b.vel.x - dx * along;
    let pz = b.vel.z - dz * along;
    const lat = Math.hypot(px, pz);
    if (lat > 0) {
      const nl = Math.max(0, lat - C.AIR_GRIP * wl * dt);
      px *= nl / lat;
      pz *= nl / lat;
    }
    const target = C.AIR_TARGET_SPEED * wl;
    if (along < target) along = Math.min(target, along + C.AIR_ACCEL * wl * dt);
    b.vel.x = dx * along + px;
    b.vel.z = dz * along + pz;
  }

  private doJump(): void {
    const b = this.body;
    b.vel.y = C.JUMP_VELOCITY;
    this.mode = MoveMode.Air;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpAscending = true;
    this.airTime = 0;
    this.events.push({ type: 'jump' });
  }

  private onLanded(impact: number, input: StepInput): void {
    const b = this.body;
    this.mode = MoveMode.Ground;
    this.coyote = C.COYOTE_TIME;
    this.jumpAscending = false;
    this.wallChain = 0;
    this.wallLockCollider = null;
    this.wallCoyote = 0;
    this.airTime = 0;
    this.sinceLanding = 0;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    let hard = false;
    if (input.crouchHeld && hs >= C.SLIDE_MIN_SPEED) {
      // Landing straight into a slide keeps all momentum (and soaks up a hard landing).
      this.startSlide();
    } else if (impact >= C.HARD_LANDING_SPEED) {
      hard = true;
      b.vel.x *= C.HARD_LANDING_SPEED_KEEP;
      b.vel.z *= C.HARD_LANDING_SPEED_KEEP;
    }
    if (impact > 1.5) this.events.push({ type: 'land', impact, hard });
  }

  // ---------------------------------------------------------------- crouch & slide

  private setCrouched(value: boolean): void {
    this.crouched = value;
    this.body.height = value ? C.CROUCH_HEIGHT : C.STAND_HEIGHT;
  }

  /** Stands up if there is headroom. Returns true when standing afterwards. */
  private tryStand(): boolean {
    if (!this.crouched) return true;
    const b = this.body;
    if (!this.physics.fits(b.pos.x, b.pos.y + 0.002, b.pos.z, b.radius - 0.01, C.STAND_HEIGHT)) return false;
    this.setCrouched(false);
    return true;
  }

  private startSlide(): void {
    const b = this.body;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    const boost = this.slideBoostCooldown <= 0 ? C.SLIDE_BOOST : 0;
    const ns = Math.max(hs, Math.min(C.SLIDE_MAX_SPEED, hs + boost));
    if (hs > 0.01) {
      b.vel.x *= ns / hs;
      b.vel.z *= ns / hs;
    }
    this.mode = MoveMode.Slide;
    this.slideTime = 0;
    this.slideBoostCooldown = C.SLIDE_BOOST_COOLDOWN;
    this.setCrouched(true);
    this.events.push({ type: 'slideStart' });
  }

  private updateSlide(dt: number, input: StepInput, wx: number, wz: number, wl: number): void {
    const b = this.body;
    this.slideTime += dt;

    // Jump out of the slide, keeping the speed.
    if (this.jumpBuffer > 0 && this.tryStand()) {
      this.events.push({ type: 'slideEnd' });
      this.mode = MoveMode.Ground;
      this.doJump();
      this.updateLocomotion(dt, input, wx, wz, wl);
      return;
    }

    let hs = Math.hypot(b.vel.x, b.vel.z);
    let dirX = hs > 0.01 ? b.vel.x / hs : -Math.sin(input.yaw);
    let dirZ = hs > 0.01 ? b.vel.z / hs : -Math.cos(input.yaw);
    // Limited steering towards the input direction.
    if (wl > 0.1) {
      const ix = wx / wl;
      const iz = wz / wl;
      const cross = dirZ * ix - dirX * iz;
      const dot = dirX * ix + dirZ * iz;
      if (dot > -0.2) {
        const ang = clamp(Math.atan2(cross, dot), -C.SLIDE_STEER * dt, C.SLIDE_STEER * dt);
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const nx = dirX * c + dirZ * s;
        const nz = -dirX * s + dirZ * c;
        dirX = nx;
        dirZ = nz;
      }
    }
    let decel = C.SLIDE_FRICTION;
    if (input.moveZ < -0.3) decel += C.SLIDE_BRAKE;
    hs = Math.max(0, hs - decel * dt);
    b.vel.x = dirX * hs;
    b.vel.z = dirZ * hs;
    b.vel.y = Math.min(b.vel.y, 0) - C.GRAVITY * dt;

    this.physics.move(b, dt, { stepHeight: 0.3, snapDown: true });

    if (!b.grounded) {
      // Slid off an edge: stay low until there is room to stand.
      this.mode = MoveMode.Air;
      this.airTime = 0;
      this.coyote = C.COYOTE_TIME;
      this.events.push({ type: 'slideEnd' });
      return;
    }
    const after = Math.hypot(b.vel.x, b.vel.z);
    if ((!input.crouchHeld && this.slideTime >= C.SLIDE_MIN_TIME) || after < C.SLIDE_END_SPEED) {
      this.mode = MoveMode.Ground;
      this.coyote = C.COYOTE_TIME;
      this.events.push({ type: 'slideEnd' });
      if (!input.crouchHeld) this.tryStand(); // stays crouched under low ceilings
    }
  }

  // ---------------------------------------------------------------- wall run

  private tryStartWallRun(input: StepInput): boolean {
    const b = this.body;
    if (this.mode !== MoveMode.Air || this.airTime < 0.04 || this.crouched) return false;
    if (input.moveZ < 0.3 || this.wallChain >= C.WALLRUN_MAX_CHAIN) return false;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    if (hs < C.WALLRUN_MIN_SPEED || b.vel.y < C.WALLRUN_ENTRY_MAX_FALL) return false;
    const dx = b.vel.x / hs;
    const dz = b.vel.z / hs;
    for (const side of [-1, 1]) {
      const probe = this.parkour.findWall(b.pos.x, b.pos.y, b.pos.z, dx, dz, side);
      if (!probe) continue;
      // Moving along the wall (or glancing into it), not straight into it or away from it.
      const into = dx * probe.nx + dz * probe.nz;
      if (into < -0.8 || into > 0.35) continue;
      if (this.wallLockCollider === probe.collider && this.wallLockNx === probe.nx && this.wallLockNz === probe.nz) continue;
      let tx = dx - probe.nx * into;
      let tz = dz - probe.nz * into;
      const tl = Math.hypot(tx, tz);
      if (tl < 0.3) continue;
      tx /= tl;
      tz /= tl;

      this.mode = MoveMode.WallRun;
      this.wallSide = side;
      this.wrNx = probe.nx;
      this.wrNz = probe.nz;
      this.wrTx = tx;
      this.wrTz = tz;
      this.wrCollider = probe.collider;
      this.wallRunTime = 0;
      this.wrSpeed = clamp(Math.max(hs, C.WALLRUN_ENTRY_MIN_SPEED), 0, C.WALLRUN_MAX_SPEED);
      // A small upward kick when catching the wall; a falling entry is softened.
      b.vel.y = clamp(b.vel.y + 2.5, C.WALLRUN_VY_MIN, C.WALLRUN_VY_MAX);
      this.jumpAscending = false;
      this.jumpBuffer = 0;
      this.wallChain++;
      this.events.push({ type: 'wallRunStart', side });
      return true;
    }
    return false;
  }

  private updateWallRun(dt: number, input: StepInput, wx: number, wz: number, wl: number): void {
    const b = this.body;
    this.wallRunTime += dt;

    if (this.jumpBuffer > 0 && this.wrCollider) {
      this.wallJump(input.yaw, this.wrNx, this.wrNz, this.wrTx, this.wrTz, this.wrSpeed, this.wrCollider);
      this.updateLocomotion(dt, input, wx, wz, wl);
      return;
    }

    const probe = this.parkour.findWall(b.pos.x, b.pos.y, b.pos.z, this.wrTx, this.wrTz, this.wallSide, 0.15);
    const lost = !probe || probe.nx !== this.wrNx || probe.nz !== this.wrNz;
    if (lost || input.moveZ < 0.1 || this.wallRunTime >= C.WALLRUN_MAX_TIME) {
      this.endWallRun();
      this.updateLocomotion(dt, input, wx, wz, wl);
      return;
    }

    // Ease towards the standard wall-run speed and hug the wall.
    this.wrSpeed += clamp(C.WALLRUN_SPEED - this.wrSpeed, -2.5 * dt, 4 * dt);
    b.vel.x = this.wrTx * this.wrSpeed - this.wrNx * 1.5;
    b.vel.z = this.wrTz * this.wrSpeed - this.wrNz * 1.5;
    // Gravity starts very light and ramps up, so every wall run arcs and ends.
    const k = this.wallRunTime / C.WALLRUN_MAX_TIME;
    const gScale = C.WALLRUN_GRAVITY_START + (C.WALLRUN_GRAVITY_END - C.WALLRUN_GRAVITY_START) * k * k;
    b.vel.y = Math.max(-C.WALLRUN_MAX_DOWN_SPEED, b.vel.y - C.GRAVITY * gScale * dt);

    const preVy = b.vel.y;
    this.physics.move(b, dt, { stepHeight: 0, snapDown: false });

    if (b.grounded) {
      this.endWallRun();
      this.onLanded(-preVy, input);
      return;
    }
    // Ran into something ahead: drop off the wall.
    for (let i = 0; i < b.contactCount; i++) {
      const ct = b.contacts[i];
      if (ct.nx * this.wrTx + ct.nz * this.wrTz < -0.6) {
        this.endWallRun();
        return;
      }
    }
    this.airTime += dt;
  }

  private endWallRun(): void {
    this.mode = MoveMode.Air;
    this.wallLockCollider = this.wrCollider;
    this.wallLockNx = this.wrNx;
    this.wallLockNz = this.wrNz;
    this.wallCoyote = C.WALLJUMP_COYOTE;
    this.events.push({ type: 'wallRunEnd' });
  }

  private wallJump(yaw: number, nx: number, nz: number, tx: number, tz: number, speed: number, collider: Collider): void {
    const b = this.body;
    const lookX = -Math.sin(yaw);
    const lookZ = -Math.cos(yaw);
    let jx = tx * 0.8 + nx * 0.6;
    let jz = tz * 0.8 + nz * 0.6;
    // Looking away from the wall steers the jump towards where you look.
    if (lookX * nx + lookZ * nz > 0.15) {
      jx += lookX * 0.9;
      jz += lookZ * 0.9;
    }
    let jl = Math.hypot(jx, jz);
    jx /= jl;
    jz /= jl;
    const out = jx * nx + jz * nz;
    if (out < 0.35) {
      jx += nx * (0.35 - out);
      jz += nz * (0.35 - out);
      jl = Math.hypot(jx, jz);
      jx /= jl;
      jz /= jl;
    }
    const sp = Math.max(speed, C.WALLJUMP_MIN_SPEED);
    b.vel.set(jx * sp, C.WALLJUMP_UP, jz * sp);
    this.wallLockCollider = collider;
    this.wallLockNx = nx;
    this.wallLockNz = nz;
    this.wallCoyote = 0;
    this.mode = MoveMode.Air;
    this.jumpAscending = true;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.airTime = 0;
    this.events.push({ type: 'wallJump' });
  }

  // ---------------------------------------------------------------- vault & mantle

  private tryVault(dirX: number, dirZ: number, requireLanding: boolean): boolean {
    const b = this.body;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    const plan = this.parkour.findVault(b.pos.x, b.pos.y, b.pos.z, dirX, dirZ, hs, requireLanding);
    if (!plan) return false;
    // Vaulting preserves (and if needed restores) running momentum.
    const speed = Math.max(hs, C.VAULT_MIN_EXIT_SPEED);
    const duration = clamp(plan.endS / speed + 0.1, 0.3, 0.6);
    this.action = {
      kind: 'vault',
      t: 0,
      duration,
      sx: b.pos.x,
      sy: b.pos.y,
      sz: b.pos.z,
      vault: plan,
      ledge: null,
      riseFrac: clamp(plan.frontS / plan.endS, 0.2, 0.65),
      exitSpeed: Math.min(speed, C.SLIDE_MAX_SPEED),
    };
    this.mode = MoveMode.Vault;
    this.jumpBuffer = 0;
    this.events.push({ type: 'vault', duration });
    return true;
  }

  private tryMantle(input: StepInput, wx: number, wz: number, wl: number, lookX: number, lookZ: number): boolean {
    const b = this.body;
    if (input.moveZ < 0.3) return false;
    if (b.vel.y > 2.5) return false; // still rising fast: the jump itself will carry us
    const dx = wl > 0.1 ? wx / wl : lookX;
    const dz = wl > 0.1 ? wz / wl : lookZ;
    const plan = this.parkour.findLedge(b.pos.x, b.pos.y, b.pos.z, dx, dz);
    if (!plan) return false;
    const rise = plan.topY - b.pos.y;
    const duration = 0.2 + 0.11 * rise;
    const keep = rise < 1.2 ? 0.8 : 0.45;
    this.action = {
      kind: 'mantle',
      t: 0,
      duration,
      sx: b.pos.x,
      sy: b.pos.y,
      sz: b.pos.z,
      vault: null,
      ledge: plan,
      riseFrac: 0.62,
      exitSpeed: clamp(this.recentSpeed * keep, rise < 1.2 ? 3.5 : 2.5, C.SPRINT_SPEED),
    };
    this.mode = MoveMode.Mantle;
    this.jumpBuffer = 0;
    this.events.push({ type: 'mantle', duration, height: rise });
    return true;
  }

  private updateScripted(dt: number): void {
    const a = this.action;
    const b = this.body;
    if (!a) {
      this.mode = MoveMode.Air;
      return;
    }
    a.t += dt;
    const u = Math.min(1, a.t / a.duration);
    let s: number;
    let y: number;
    let dirX: number;
    let dirZ: number;

    if (a.vault) {
      const p = a.vault;
      dirX = p.dirX;
      dirZ = p.dirZ;
      const A = a.riseFrac;
      if (u < A) {
        // Plant hands and lift: rise to clearance while closing in on the obstacle.
        const k = u / A;
        s = p.frontS * k;
        y = a.sy + (p.clearY - a.sy) * (1 - (1 - k) * (1 - k));
      } else {
        // Swing over, then drop down the far side.
        const k = (u - A) / (1 - A);
        s = p.frontS + (p.endS - p.frontS) * k;
        if (s <= p.backS || !p.landing || p.onto) {
          y = p.clearY + Math.sin(Math.min(1, k * 1.5) * Math.PI) * 0.05;
        } else {
          const kk = (s - p.backS) / Math.max(0.01, p.endS - p.backS);
          y = p.clearY + (p.endY - p.clearY) * kk * kk;
        }
      }
      if (u >= 1 && p.landing) y = p.endY;
    } else {
      const p = a.ledge!;
      dirX = p.dirX;
      dirZ = p.dirZ;
      const A = a.riseFrac;
      if (u < A) {
        const k = u / A;
        const e = k * k * (3 - 2 * k);
        s = 0;
        y = a.sy + (p.topY + 0.02 - a.sy) * e;
      } else {
        const k = (u - A) / (1 - A);
        s = p.destS * (1 - (1 - k) * (1 - k));
        y = p.topY + 0.02;
      }
      if (u >= 1) y = p.topY;
    }

    b.pos.set(a.sx + dirX * s, y, a.sz + dirZ * s);
    // Velocity mirrors the scripted motion so camera effects see real movement.
    b.vel.set((b.pos.x - this.prevPos.x) / dt, (b.pos.y - this.prevPos.y) / dt, (b.pos.z - this.prevPos.z) / dt);

    if (u >= 1) this.finishAction(a, dirX, dirZ);
  }

  private finishAction(a: ScriptedAction, dirX: number, dirZ: number): void {
    const b = this.body;
    this.action = null;
    if (a.vault) {
      const p = a.vault;
      b.vel.set(dirX * a.exitSpeed, p.landing ? 0 : -0.5, dirZ * a.exitSpeed);
      this.mode = p.landing ? MoveMode.Ground : MoveMode.Air;
    } else {
      b.vel.set(dirX * a.exitSpeed, 0, dirZ * a.exitSpeed);
      this.mode = MoveMode.Ground;
    }
    // Stand up if there's room, otherwise finish crouched.
    if (this.physics.fits(b.pos.x, b.pos.y + 0.002, b.pos.z, b.radius - 0.01, C.STAND_HEIGHT)) this.setCrouched(false);
    else this.setCrouched(true);
    this.physics.depenetrate(b);
    this.airTime = 0;
    this.coyote = this.mode === MoveMode.Ground ? C.COYOTE_TIME : 0;
    this.wallChain = 0;
    this.wallLockCollider = null;
    this.sinceLanding = 0;
  }

  // ---------------------------------------------------------------- zipline

  private tryAttachZipline(explicit: boolean): boolean {
    if (this.zipCooldown > 0 || this.ziplines.length === 0) return false;
    const b = this.body;
    const found = this.parkour.findZipline(this.ziplines, b.pos.x, b.pos.y, b.pos.z, explicit, this.mode === MoveMode.Air);
    if (!found) return false;
    if (this.crouched && !this.tryStand()) return false;
    const l = found.line;
    this.zipLine = l;
    // Never start hanging inside the tower the cable leaves from.
    this.zipS = Math.max(found.s, 0.6);
    const along = b.vel.x * l.dx + b.vel.y * l.dy + b.vel.z * l.dz;
    this.zipSpeed = Math.max(C.ZIP_MIN_SPEED, along);
    // Blend smoothly from where we grabbed onto the cable's hanging position.
    this.zipOffset.set(
      b.pos.x - (l.ax + l.dx * this.zipS),
      b.pos.y - (l.ay + l.dy * this.zipS - C.ZIP_HANG),
      b.pos.z - (l.az + l.dz * this.zipS),
    );
    this.mode = MoveMode.Zipline;
    this.jumpAscending = false;
    this.wallChain = 0;
    this.events.push({ type: 'zipAttach' });
    return true;
  }

  private updateZipline(dt: number, input: StepInput): void {
    const b = this.body;
    const l = this.zipLine;
    if (!l) {
      this.mode = MoveMode.Air;
      return;
    }
    // Gravity along the cable, minus a little drag.
    this.zipSpeed = Math.min(C.ZIP_MAX_SPEED, this.zipSpeed + (C.GRAVITY * -l.dy * 0.9 - C.ZIP_DRAG * this.zipSpeed * this.zipSpeed) * dt);
    this.zipS += this.zipSpeed * dt;
    this.zipOffset.multiplyScalar(Math.exp(-dt * 9));
    b.pos.set(
      l.ax + l.dx * this.zipS + this.zipOffset.x,
      l.ay + l.dy * this.zipS - C.ZIP_HANG + this.zipOffset.y,
      l.az + l.dz * this.zipS + this.zipOffset.z,
    );
    b.vel.set(l.dx * this.zipSpeed, l.dy * this.zipSpeed, l.dz * this.zipSpeed);

    if (!this.physics.fits(b.pos.x, b.pos.y, b.pos.z, b.radius - 0.02, b.height)) {
      b.pos.copy(this.prevPos);
      this.detachZipline(0);
    } else if (input.jumpPressed) {
      this.detachZipline(4.5);
      this.jumpBuffer = 0;
    } else if (input.crouchPressed) {
      this.detachZipline(0);
    } else if (this.zipS >= l.length - C.ZIP_END_MARGIN) {
      this.detachZipline(1.5);
    }
  }

  private detachZipline(upBoost: number): void {
    this.body.vel.y += upBoost;
    this.mode = MoveMode.Air;
    this.zipLine = null;
    this.zipCooldown = 0.6;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpAscending = false;
    this.events.push({ type: 'zipDetach' });
  }

  // ---------------------------------------------------------------- bookkeeping

  private postStep(dt: number): void {
    const b = this.body;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    this.recentSpeed = Math.max(hs, this.recentSpeed - 14 * dt);

    // Footsteps: one event per stride, used for sound and head-bob sync.
    if ((this.mode === MoveMode.Ground && hs > 0.6) || this.mode === MoveMode.WallRun) {
      const wall = this.mode === MoveMode.WallRun;
      const stepLen = wall ? 1.6 : clamp(0.7 + hs * 0.16, 0.7, 2.3);
      this.stridePhase += (hs * dt) / stepLen;
      if (this.stridePhase >= 1) {
        this.stridePhase -= 1;
        const ground = b.groundCollider;
        this.events.push({
          type: 'footstep',
          intensity: clamp(hs / C.SPRINT_SPEED, 0.25, 1.2),
          metal: !!ground && (ground.flags & ColliderFlags.METAL) !== 0,
          wall,
        });
      }
    }
  }
}
