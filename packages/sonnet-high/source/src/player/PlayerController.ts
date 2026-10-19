import { MOVE } from './MovementConfig.ts';
import { PlayerPhysics, PLAYER_RADIUS, SLIDE_HEIGHT, STAND_HEIGHT } from './PlayerPhysics.ts';
import { ParkourSystem, bezierPoint } from './ParkourSystem.ts';
import type { ActionPlan, Vec3 } from './ParkourSystem.ts';
import type { CollisionWorld } from '../world/CollisionWorld.ts';

export const MoveState = {
  Ground: 'ground',
  Air: 'air',
  Slide: 'slide',
  WallRun: 'wallrun',
  Vault: 'vault',
  Mantle: 'mantle',
} as const;
export type MoveStateName = (typeof MoveState)[keyof typeof MoveState];

/** Input snapshot consumed by one fixed physics tick. */
export interface PlayerInput {
  /** Strafe: +1 right, -1 left. */
  moveX: number;
  /** Forward: +1 forward, -1 back. */
  moveY: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  slideHeld: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
  yaw: number;
}

export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'land'; impact: number }
  | { type: 'step'; speed: number; wall: boolean }
  | { type: 'slideStart' }
  | { type: 'slideEnd' }
  | { type: 'vault' }
  | { type: 'mantle' }
  | { type: 'wallStart'; side: number }
  | { type: 'wallEnd' }
  | { type: 'wallJump' }
  | { type: 'respawn' };

const smoothstep = (u: number): number => u * u * (3 - 2 * u);

/**
 * Movement state machine.
 *
 * Ground / Air / Slide / WallRun use the physics body and real collision. Vault / Mantle are
 * short scripted moves along a pre-validated curve (see ParkourSystem) so they can never clip.
 *
 * Conventions: yaw 0 faces -Z. forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw).
 */
export class PlayerController {
  readonly phys: PlayerPhysics;
  readonly parkour: ParkourSystem;

  state: MoveStateName = MoveState.Air;
  crouched = false;
  yaw = 0;
  readonly events: PlayerEvent[] = [];

  // Render interpolation (position at the start of the latest tick).
  prevX = 0;
  prevY = 0;
  prevZ = 0;
  /** Height gained/lost by automatic step-ups this tick (camera smooths this out). */
  stepDelta = 0;

  // Info for camera / body animation.
  wallSide = 0;
  actionKind: 'vault' | 'mantle' | null = null;
  actionProgress = 0;
  lastInput: PlayerInput = {
    moveX: 0,
    moveY: 0,
    sprint: false,
    jumpHeld: false,
    jumpPressed: false,
    slideHeld: false,
    slidePressed: false,
    vaultPressed: false,
    yaw: 0,
  };
  airTime = 0;

  // Timers.
  private coyote = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private vaultBuffer = 0;
  private slideCooldown = 0;
  private wallCooldown = 0;
  private mantleCooldown = 0;
  private jumping = false;

  // Slide.
  private slideDirX = 0;
  private slideDirZ = -1;
  private slideTime = 0;
  private slideAirTime = 0;

  // Wall run.
  private wallSolidId = 0;
  private wallLockId = 0;
  private wallNx = 0;
  private wallNz = 0;
  private wallDirX = 0;
  private wallDirZ = 0;
  private wallTime = 0;
  private wallBudget: number = MOVE.wallRunBudget;

  // Scripted action.
  private plan: ActionPlan | null = null;
  private actionTime = 0;
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };

  private stepDist = 0;

  constructor(world: CollisionWorld) {
    this.phys = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(this.phys);
  }

  // -----------------------------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------------------------

  get speedH(): number {
    return Math.hypot(this.phys.vx, this.phys.vz);
  }

  /** Eye height above the feet the camera should be heading towards. */
  get eyeTarget(): number {
    if (this.crouched) return 0.62;
    if (this.state === MoveState.Vault) return 1.5;
    if (this.state === MoveState.Mantle) return 1.45;
    return 1.65;
  }

  respawn(x: number, y: number, z: number, yaw: number): void {
    const p = this.phys;
    p.teleport(x, y, z);
    this.prevX = x;
    this.prevY = y;
    this.prevZ = z;
    this.yaw = yaw;
    this.state = MoveState.Air;
    this.crouched = false;
    this.plan = null;
    this.actionKind = null;
    this.actionProgress = 0;
    this.coyote = this.jumpBuffer = this.slideBuffer = this.vaultBuffer = 0;
    this.slideCooldown = this.wallCooldown = this.mantleCooldown = 0;
    this.jumping = false;
    this.wallSolidId = 0;
    this.wallLockId = 0;
    this.wallBudget = MOVE.wallRunBudget;
    this.wallSide = 0;
    this.stepDist = 0;
    this.stepDelta = 0;
    this.airTime = 0;
    p.settle();
    if (p.grounded) this.state = MoveState.Ground;
    this.events.length = 0;
    this.events.push({ type: 'respawn' });
  }

  /** Cheap check used by the HUD to show the "[E] vault" prompt. */
  canVaultNow(): boolean {
    if (this.state !== MoveState.Ground || this.crouched) return false;
    const [hx, hz] = this.heading();
    return this.parkour.probeVault(hx, hz, this.speedH) !== null;
  }

  update(dt: number, inp: PlayerInput): void {
    const p = this.phys;
    this.lastInput = inp;
    this.prevX = p.x;
    this.prevY = p.y;
    this.prevZ = p.z;
    this.stepDelta = 0;
    this.yaw = inp.yaw;

    // Timers.
    this.coyote = Math.max(0, this.coyote - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);
    this.jumpBuffer = inp.jumpPressed ? MOVE.jumpBufferTime : Math.max(0, this.jumpBuffer - dt);
    this.slideBuffer = inp.slidePressed ? 0.18 : Math.max(0, this.slideBuffer - dt);
    this.vaultBuffer = inp.vaultPressed ? MOVE.vaultBufferTime : Math.max(0, this.vaultBuffer - dt);

    switch (this.state) {
      case MoveState.Ground:
        this.updateGround(dt, inp);
        break;
      case MoveState.Air:
        this.updateAir(dt, inp);
        break;
      case MoveState.Slide:
        this.updateSlide(dt, inp);
        break;
      case MoveState.WallRun:
        this.updateWallRun(dt, inp);
        break;
      case MoveState.Vault:
      case MoveState.Mantle:
        this.updateAction(dt);
        break;
    }

    // Hard safety clamp on speed.
    const hs = Math.hypot(p.vx, p.vz);
    if (hs > MOVE.maxSpeed) {
      p.vx *= MOVE.maxSpeed / hs;
      p.vz *= MOVE.maxSpeed / hs;
    }

    this.emitFootsteps(dt);
  }

  // -----------------------------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------------------------

  private forward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  /** Direction used for parkour probes: velocity if moving, otherwise where we look. */
  private heading(): [number, number] {
    const p = this.phys;
    const hs = Math.hypot(p.vx, p.vz);
    if (hs > 2.5) return [p.vx / hs, p.vz / hs];
    return this.forward();
  }

  /** World-space wish direction from WASD (length 0..1). */
  private wish(inp: PlayerInput): [number, number, number] {
    const fx = -Math.sin(inp.yaw);
    const fz = -Math.cos(inp.yaw);
    const rx = Math.cos(inp.yaw);
    const rz = -Math.sin(inp.yaw);
    let mx = inp.moveX;
    let my = inp.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    return [fx * my + rx * mx, fz * my + rz * mx, Math.min(len, 1)];
  }

  private targetSpeed(inp: PlayerInput): number {
    if (this.crouched) return MOVE.crouchSpeed;
    if (inp.moveY < -0.1) return MOVE.walkSpeed * MOVE.backwardMultiplier;
    return inp.sprint && inp.moveY > 0.1 ? MOVE.sprintSpeed : MOVE.walkSpeed;
  }

  private accelerateGround(dt: number, wx: number, wz: number, mag: number, maxSpeed: number): void {
    const p = this.phys;
    const speed = Math.hypot(p.vx, p.vz);
    const hasInput = mag > 0.01;
    let accel: number;
    if (!hasInput) {
      accel = MOVE.groundDecel;
    } else {
      const align = speed > 0.1 ? (p.vx * wx + p.vz * wz) / (speed * Math.hypot(wx, wz)) : 1;
      if (speed > maxSpeed + 0.1 && align > 0.7) {
        accel = MOVE.overspeedFriction; // keep momentum: bleed excess speed gently
      } else {
        accel = MOVE.groundAccel * (align < 0.3 ? MOVE.turnAccelBoost : 1);
      }
    }
    const tx = hasInput ? wx * maxSpeed : 0;
    const tz = hasInput ? wz * maxSpeed : 0;
    const dx = tx - p.vx;
    const dz = tz - p.vz;
    const d = Math.hypot(dx, dz);
    const maxStep = accel * dt;
    if (d <= maxStep) {
      p.vx = tx;
      p.vz = tz;
    } else {
      p.vx += (dx / d) * maxStep;
      p.vz += (dz / d) * maxStep;
    }
  }

  private tryStandUp(): void {
    const p = this.phys;
    if (this.crouched && this.state !== MoveState.Slide && p.canStand()) {
      p.height = STAND_HEIGHT;
      this.crouched = false;
    }
  }

  private applyGravity(dt: number, scale = 1): void {
    const p = this.phys;
    const g = MOVE.gravity * (p.vy < 0 ? MOVE.fallGravityMultiplier : 1) * scale;
    p.vy = Math.max(p.vy - g * dt, -MOVE.terminalVelocity);
  }

  private integrate(dt: number): void {
    const res = this.phys.step(dt);
    this.stepDelta += res.stepUp;
  }

  // -----------------------------------------------------------------------------------------
  // Ground
  // -----------------------------------------------------------------------------------------

  private updateGround(dt: number, inp: PlayerInput): void {
    const p = this.phys;
    this.coyote = MOVE.coyoteTime;
    this.airTime = 0;
    this.wallLockId = 0;
    this.wallBudget = MOVE.wallRunBudget;
    this.tryStandUp();

    const [wx, wz, mag] = this.wish(inp);
    this.accelerateGround(dt, wx, wz, mag, this.targetSpeed(inp));

    // Vault (E). Buffered so pressing slightly early still works while running at speed.
    if (this.vaultBuffer > 0 && !this.crouched && this.tryVault()) return;

    if (this.jumpBuffer > 0 && (!this.crouched || p.canStand())) {
      this.doJump();
    } else if (
      this.slideBuffer > 0 &&
      this.slideCooldown <= 0 &&
      !this.crouched &&
      Math.hypot(p.vx, p.vz) >= MOVE.slideMinSpeed
    ) {
      this.startSlide();
      this.updateSlide(dt, inp);
      return;
    }

    this.applyGravity(dt);
    this.integrate(dt);
    if (!p.grounded) this.state = MoveState.Air;
  }

  private doJump(): void {
    const p = this.phys;
    if (this.crouched) {
      p.height = STAND_HEIGHT;
      this.crouched = false;
    }
    p.vy = MOVE.jumpSpeed;
    p.grounded = false;
    this.state = MoveState.Air;
    this.jumping = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.events.push({ type: 'jump' });
  }

  private tryVault(): boolean {
    const [hx, hz] = this.heading();
    const plan = this.parkour.probeVault(hx, hz, this.speedH);
    if (!plan) return false;
    this.startAction(plan);
    return true;
  }

  // -----------------------------------------------------------------------------------------
  // Air
  // -----------------------------------------------------------------------------------------

  private updateAir(dt: number, inp: PlayerInput): void {
    const p = this.phys;
    this.airTime += dt;
    this.tryStandUp();

    // Variable jump height: releasing the button early cuts the ascent short.
    if (this.jumping) {
      if (!inp.jumpHeld && p.vy > MOVE.jumpCutSpeed) {
        p.vy = MOVE.jumpCutSpeed;
        this.jumping = false;
      } else if (p.vy <= 0) {
        this.jumping = false;
      }
    }

    // Coyote-time jump (just walked off an edge).
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.jumping && p.vy <= 0.5) {
      this.doJump();
    }

    if (this.tryAttachWall(inp)) {
      this.updateWallRun(dt, inp);
      return;
    }

    // Limited air control: steer without gaining speed beyond what we already carry.
    const [wx, wz, mag] = this.wish(inp);
    if (mag > 0.01) {
      const before = Math.hypot(p.vx, p.vz);
      p.vx += wx * MOVE.airAccel * dt;
      p.vz += wz * MOVE.airAccel * dt;
      const limit = Math.max(before, MOVE.walkSpeed);
      const after = Math.hypot(p.vx, p.vz);
      if (after > limit) {
        p.vx *= limit / after;
        p.vz *= limit / after;
      }
    }

    this.applyGravity(dt);
    const [hdx, hdz] = this.heading();
    const hs = Math.hypot(p.vx, p.vz);
    this.integrate(dt);

    if (p.grounded) {
      this.onLand(p.result.landImpact, inp);
      return;
    }

    // Ledge recovery: grab a ledge that is just within reach ahead of us.
    if (this.mantleCooldown <= 0 && (inp.moveY > 0.1 || inp.jumpHeld) && p.vy < 5) {
      const plan = this.parkour.probeMantle(hdx, hdz, hs);
      if (plan) this.startAction(plan);
    }
  }

  private onLand(impact: number, inp: PlayerInput): void {
    const p = this.phys;
    this.state = MoveState.Ground;
    this.jumping = false;
    this.airTime = 0;
    this.wallLockId = 0;
    this.wallBudget = MOVE.wallRunBudget;
    this.events.push({ type: 'land', impact });
    // Controlled landing friction: only very hard landings scrub speed.
    if (impact > MOVE.hardLandImpact) {
      const f = 1 - Math.min((impact - MOVE.hardLandImpact) / 12, 1) * 0.45;
      p.vx *= f;
      p.vz *= f;
    }
    // Landing while holding slide with speed rolls straight into a slide.
    if (inp.slideHeld && this.slideCooldown <= 0 && Math.hypot(p.vx, p.vz) >= MOVE.slideMinSpeed + 1) {
      this.startSlide();
    }
  }

  // -----------------------------------------------------------------------------------------
  // Slide
  // -----------------------------------------------------------------------------------------

  private startSlide(): void {
    const p = this.phys;
    const speed = Math.hypot(p.vx, p.vz);
    let dx: number;
    let dz: number;
    if (speed > 0.5) {
      dx = p.vx / speed;
      dz = p.vz / speed;
    } else {
      [dx, dz] = this.forward();
    }
    const boosted = Math.min(Math.max(speed * MOVE.slideBoost, MOVE.slideMinStartSpeed), MOVE.slideMaxStartSpeed);
    this.slideDirX = dx;
    this.slideDirZ = dz;
    p.vx = dx * boosted;
    p.vz = dz * boosted;
    p.height = SLIDE_HEIGHT;
    this.crouched = true;
    this.state = MoveState.Slide;
    this.slideTime = 0;
    this.slideAirTime = 0;
    this.slideBuffer = 0;
    this.events.push({ type: 'slideStart' });
  }

  private endSlide(): void {
    this.slideCooldown = MOVE.slideCooldown;
    this.events.push({ type: 'slideEnd' });
    this.state = this.phys.grounded ? MoveState.Ground : MoveState.Air;
    // Stand up now if there is headroom; otherwise tryStandUp() keeps trying each tick.
    this.tryStandUp();
  }

  private updateSlide(dt: number, inp: PlayerInput): void {
    const p = this.phys;
    this.slideTime += dt;
    const canStand = p.canStand();

    // Jump out of the slide (needs headroom).
    if (this.jumpBuffer > 0 && canStand) {
      this.endSlide();
      this.doJump();
      this.updateAir(dt, inp);
      return;
    }

    let speed = Math.hypot(p.vx, p.vz) - MOVE.slideFriction * dt;
    if (!canStand) speed = Math.max(speed, MOVE.slideStuckSpeed); // never get stuck under a low ceiling
    speed = Math.max(speed, 0);

    // Gentle steering of the slide direction.
    const [wx, wz, mag] = this.wish(inp);
    if (mag > 0.01) {
      const cross = this.slideDirX * wz - this.slideDirZ * wx;
      const dot = this.slideDirX * wx + this.slideDirZ * wz;
      const ang = Math.atan2(cross, dot);
      const turn = Math.max(-MOVE.slideSteerRate * dt, Math.min(MOVE.slideSteerRate * dt, ang));
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const nx = this.slideDirX * c - this.slideDirZ * s;
      const nz = this.slideDirX * s + this.slideDirZ * c;
      this.slideDirX = nx;
      this.slideDirZ = nz;
    }
    p.vx = this.slideDirX * speed;
    p.vz = this.slideDirZ * speed;

    this.applyGravity(dt);
    this.integrate(dt);
    const res = p.result;

    if (!p.grounded) {
      this.slideAirTime += dt;
      if (this.slideAirTime > 0.12) {
        this.endSlide();
        return;
      }
    } else {
      this.slideAirTime = 0;
    }

    // If a wall stopped us, the effective speed collapses: stop sliding.
    const actual = Math.hypot(p.vx, p.vz);
    const blocked = (res.hitX || res.hitZ) && actual < speed * 0.5;
    const finished =
      this.slideTime > MOVE.slideMinTime && (!inp.slideHeld || speed <= MOVE.slideEndSpeed || blocked);
    // If we cannot stand yet (low ceiling) we keep sliding at the minimum "stuck" speed, unless
    // a wall stopped us, in which case ground movement (crouch-walk) takes over.
    if (finished && (blocked || p.canStand())) this.endSlide();
  }

  // -----------------------------------------------------------------------------------------
  // Wall run
  // -----------------------------------------------------------------------------------------

  private tryAttachWall(inp: PlayerInput): boolean {
    const p = this.phys;
    if (this.wallCooldown > 0 || this.wallBudget <= 0) return false;
    if (inp.moveY <= 0.1 || this.crouched) return false;
    const hs = Math.hypot(p.vx, p.vz);
    if (hs < MOVE.wallRunMinSpeed) return false;
    const hdx = p.vx / hs;
    const hdz = p.vz / hs;

    const right = this.parkour.probeWall(hdx, hdz, 1, this.wallLockId);
    const left = this.parkour.probeWall(hdx, hdz, -1, this.wallLockId);
    let contact = right;
    if (left && (!right || left.dist < right.dist)) contact = left;
    if (!contact) return false;
    // Moving (mostly) parallel to the wall, not head-on.
    if (Math.abs(hdx * contact.nx + hdz * contact.nz) > 0.6) return false;

    this.wallSolidId = contact.solid.id;
    this.wallNx = contact.nx;
    this.wallNz = contact.nz;
    this.wallSide = contact.side;
    let tx = -contact.nz;
    let tz = contact.nx;
    if (tx * hdx + tz * hdz < 0) {
      tx = -tx;
      tz = -tz;
    }
    this.wallDirX = tx;
    this.wallDirZ = tz;
    const speed = Math.min(Math.max(hs, MOVE.wallRunSpeed), MOVE.maxSpeed);
    p.vx = tx * speed;
    p.vz = tz * speed;
    p.vy = Math.min(Math.max(p.vy, MOVE.wallMinAttachVy), MOVE.wallMaxAttachVy);
    this.wallTime = 0;
    this.jumping = false;
    this.state = MoveState.WallRun;
    this.events.push({ type: 'wallStart', side: contact.side });
    return true;
  }

  private endWallRun(): void {
    this.wallLockId = this.wallSolidId; // cannot re-attach to this wall until we touch the ground
    this.wallCooldown = MOVE.wallReattachCooldown;
    this.state = MoveState.Air;
    this.wallSide = 0;
    this.events.push({ type: 'wallEnd' });
  }

  private updateWallRun(dt: number, inp: PlayerInput): void {
    const p = this.phys;
    this.wallTime += dt;
    this.wallBudget -= dt;

    // Is the wall still beside us?
    const solidId = this.wallSolidId;
    const hit = p.world.sweepHorizontal(
      p.x,
      p.z,
      p.y + 0.4,
      p.y + 1.5,
      -this.wallNx,
      -this.wallNz,
      MOVE.wallDetectDistance + 0.1,
      PLAYER_RADIUS,
      (s) => s.id === solidId,
    );
    const along = p.vx * this.wallDirX + p.vz * this.wallDirZ;

    // Wall jump.
    if (this.jumpBuffer > 0) {
      const fwd = Math.max(along, MOVE.wallRunMinSpeed) * 0.96;
      p.vx = this.wallNx * MOVE.wallJumpOut + this.wallDirX * fwd;
      p.vz = this.wallNz * MOVE.wallJumpOut + this.wallDirZ * fwd;
      p.vy = MOVE.wallJumpUp;
      p.grounded = false;
      this.jumpBuffer = 0;
      this.jumping = false;
      this.events.push({ type: 'wallJump' });
      this.endWallRun();
      this.updateAir(dt, inp);
      return;
    }

    const ended =
      !hit ||
      inp.moveY <= 0.1 ||
      inp.slidePressed ||
      this.wallTime > MOVE.wallRunMaxTime ||
      this.wallBudget <= 0 ||
      along < MOVE.wallRunMinSpeed - 1.5;
    if (ended) {
      this.endWallRun();
      this.updateAir(dt, inp);
      return;
    }

    // Slightly decaying speed along the wall, pulled gently against it, reduced gravity.
    const speed = Math.max(along - MOVE.wallFriction * dt, MOVE.wallRunMinSpeed - 1.2);
    const stick = 3 + (hit ? hit.dist : 0) * 6;
    p.vx = this.wallDirX * speed - this.wallNx * stick;
    p.vz = this.wallDirZ * speed - this.wallNz * stick;
    p.vy = Math.max(p.vy - MOVE.gravity * MOVE.wallGravityScale * dt, -MOVE.wallMaxFall);

    this.integrate(dt);
    if (hit) {
      // Keep the contact normal fresh (walls are axis-aligned so this is stable).
      this.wallNx = hit.nx;
      this.wallNz = hit.nz;
    }
    if (p.grounded) {
      this.wallSide = 0;
      this.events.push({ type: 'wallEnd' });
      this.onLand(p.result.landImpact, inp);
    }
  }

  // -----------------------------------------------------------------------------------------
  // Scripted actions (vault / mantle)
  // -----------------------------------------------------------------------------------------

  private startAction(plan: ActionPlan): void {
    const p = this.phys;
    this.plan = plan;
    this.actionTime = 0;
    this.actionKind = plan.kind;
    this.actionProgress = 0;
    this.state = plan.kind === 'vault' ? MoveState.Vault : MoveState.Mantle;
    p.vx = p.vy = p.vz = 0;
    p.grounded = false;
    this.jumping = false;
    this.jumpBuffer = 0;
    this.vaultBuffer = 0;
    this.mantleCooldown = MOVE.mantleCooldown;
    this.events.push({ type: plan.kind });
  }

  private updateAction(dt: number): void {
    const p = this.phys;
    const plan = this.plan;
    if (!plan) {
      this.state = MoveState.Air;
      return;
    }
    this.actionTime += dt;
    const u = Math.min(this.actionTime / plan.duration, 1);
    // Vault keeps its entry speed (linear); mantle eases in/out.
    const e = plan.kind === 'vault' ? u : smoothstep(u);
    bezierPoint(plan, e, this.tmp);
    p.x = this.tmp.x;
    p.y = this.tmp.y;
    p.z = this.tmp.z;
    this.actionProgress = u;
    if (u < 1) return;

    p.x = plan.p2.x;
    p.y = plan.p2.y;
    p.z = plan.p2.z;
    p.vx = plan.exitDirX * plan.exitSpeed;
    p.vz = plan.exitDirZ * plan.exitSpeed;
    p.vy = 0;
    p.height = STAND_HEIGHT;
    this.crouched = false;
    p.settle();
    this.plan = null;
    this.actionKind = null;
    this.actionProgress = 0;
    this.state = p.grounded ? MoveState.Ground : MoveState.Air;
    this.coyote = p.grounded ? MOVE.coyoteTime : 0;
  }

  // -----------------------------------------------------------------------------------------
  // Audio / animation events
  // -----------------------------------------------------------------------------------------

  private emitFootsteps(dt: number): void {
    const p = this.phys;
    const onWall = this.state === MoveState.WallRun;
    if ((this.state !== MoveState.Ground && !onWall) || this.crouched) {
      this.stepDist = 0;
      return;
    }
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 1.5) return;
    const ratio = Math.min(Math.max((speed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed), 0), 1);
    const stride = 2.0 + 1.2 * ratio;
    this.stepDist += speed * dt;
    if (this.stepDist >= stride) {
      this.stepDist -= stride;
      this.events.push({ type: 'step', speed, wall: onWall });
    }
  }
}
