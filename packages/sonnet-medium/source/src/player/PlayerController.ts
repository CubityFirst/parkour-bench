import { CollisionWorld, Box } from '../world/CollisionWorld';
import { BODY, PlayerPhysics } from './PlayerPhysics';
import { ParkourSystem, ScriptedMove, WallHit, vaultPoint } from './ParkourSystem';

/** Movement tuning (m, s). Level gaps are sized against these - change with care. */
export const MOVE = {
  walkSpeed: 5.0,
  sprintSpeed: 9.0,
  groundAccel: 34,
  groundDecel: 40,
  overspeedDecay: 5,
  airAccel: 11,
  airSpeedCap: 9.4,
  gravity: 22,
  fallGravityMul: 1.15,
  jumpCutGravityMul: 2.6,
  maxFall: 48,
  jumpSpeed: 7.8,
  coyoteTime: 0.12,
  jumpBuffer: 0.13,
  // sliding
  slideMinSpeed: 5.8,
  slideBoost: 1.08,
  slideMaxSpeed: 11,
  slideFriction: 5.2,
  slideEndSpeed: 2.6,
  crouchSpeed: 3.0,
  // wall running
  wallMinSpeed: 6.2,
  wallSpeed: 9.2,
  wallGravity: 3.5,
  wallMaxTime: 2.2,
  wallJumpAway: 5.5,
  wallJumpUp: 7.0,
  wallCooldown: 0.3,
};

export interface PlayerInput {
  /** -1 left .. +1 right */
  moveX: number;
  /** -1 back .. +1 forward */
  moveZ: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  slideHeld: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
  /** Camera yaw (radians, counter-clockwise from -Z). */
  yaw: number;
}

export interface PlayerEvents {
  jump?: () => void;
  land?: (impact: number) => void;
  footstep?: (sprinting: boolean) => void;
  slideStart?: () => void;
  wallRunStart?: () => void;
  wallJump?: () => void;
  vault?: () => void;
  mantle?: () => void;
}

export type MoveMode = 'ground' | 'air' | 'slide' | 'wallrun' | 'script';

export function emptyInput(): PlayerInput {
  return {
    moveX: 0, moveZ: 0, sprint: false, jumpHeld: false, jumpPressed: false,
    slideHeld: false, slidePressed: false, vaultPressed: false, yaw: 0,
  };
}

/**
 * Turns input into movement. Runs on a fixed timestep (see Game).
 * Modes: ground / air / slide / wallrun, plus 'script' for vault and mantle playback.
 */
export class PlayerController {
  readonly phys: PlayerPhysics;
  readonly parkour: ParkourSystem;
  events: PlayerEvents = {};

  mode: MoveMode = 'air';
  /** -1 wall on left, +1 wall on right, 0 none. */
  wallSide = 0;
  /** Smoothed visual state read by the camera / body. */
  sprinting = false;
  crouched = false;
  scriptMove: ScriptedMove | null = null;
  scriptT = 0;
  /** Phase for head bob / leg swing; advances half a turn (pi) per footstep. */
  bobPhase = 0;
  /** Vault/mantle hint availability (for the HUD). */
  canVaultHint = false;
  /** Position at the start of the last fixed step (render interpolation). */
  readonly prev = [0, 0, 0];
  lastInputX = 0;
  lastYaw = 0;

  private coyote = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private vaultBuffer = 0;
  private slideCooldown = 0;
  private jumpedUp = false;
  private landFriction = 0;
  private stepAccum = 0;
  private wall: WallHit | null = null;
  private wallTime = 0;
  private wallCooldown = 0;
  private lastWallId = -1;
  private wallRunsSinceGround = 0;
  private mantleCooldown = 0;
  private exitSpeed = 0;

  constructor(world: CollisionWorld) {
    this.phys = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(this.phys);
  }

  respawn(x: number, y: number, z: number): void {
    const p = this.phys;
    p.teleport(x, y, z);
    this.mode = 'air';
    this.wallSide = 0;
    this.wall = null;
    this.scriptMove = null;
    this.coyote = this.jumpBuffer = this.slideBuffer = this.vaultBuffer = 0;
    this.slideCooldown = this.wallCooldown = this.mantleCooldown = 0;
    this.lastWallId = -1;
    this.wallRunsSinceGround = 0;
    this.landFriction = 0;
    this.jumpedUp = false;
    this.sprinting = false;
    this.crouched = false;
    this.prev[0] = x; this.prev[1] = y; this.prev[2] = z;
  }

  get speed(): number { return this.phys.hSpeed; }

  /** True while a vault/mantle is playing (mode may change inside update, so TS narrowing needs a getter). */
  get scripting(): boolean { return this.mode === 'script'; }

  // ------------------------------------------------------------------ update

  update(dt: number, input: PlayerInput): void {
    const p = this.phys;
    this.prev[0] = p.p[0]; this.prev[1] = p.p[1]; this.prev[2] = p.p[2];
    this.lastInputX = input.moveX;
    this.lastYaw = input.yaw;

    // timers & input buffers
    this.coyote = p.grounded ? MOVE.coyoteTime : Math.max(0, this.coyote - dt);
    this.jumpBuffer = input.jumpPressed ? MOVE.jumpBuffer : Math.max(0, this.jumpBuffer - dt);
    this.slideBuffer = input.slidePressed ? 0.25 : Math.max(0, this.slideBuffer - dt);
    this.vaultBuffer = input.vaultPressed ? 0.25 : Math.max(0, this.vaultBuffer - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);
    this.landFriction = Math.max(0, this.landFriction - dt);

    if (this.mode === 'script') {
      this.updateScript(dt);
      return;
    }

    // wish direction in world space (forward = -Z at yaw 0)
    const sinY = Math.sin(input.yaw), cosY = Math.cos(input.yaw);
    const fx = -sinY, fz = -cosY, rx = cosY, rz = -sinY;
    let wx = fx * input.moveZ + rx * input.moveX;
    let wz = fz * input.moveZ + rz * input.moveX;
    const wl = Math.hypot(wx, wz);
    const hasInput = wl > 0.01;
    if (hasInput) { wx /= wl; wz /= wl; }

    // stand back up when possible (after a slide / crouch)
    if (this.mode !== 'slide' && p.height < BODY.standHeight) {
      if (p.canStand()) { p.height = BODY.standHeight; this.crouched = false; } else this.crouched = true;
    }

    // ---- vault (E): works from ground or air, preserves momentum
    if (this.vaultBuffer > 0 && this.mode !== 'wallrun') {
      const dir = this.facingDir(input, wx, wz, hasInput);
      const move = this.parkour.findVault(dir[0], dir[1], p.hSpeed);
      if (move) {
        this.beginScript(move, Math.max(p.hSpeed, MOVE.walkSpeed + 1.5));
        this.vaultBuffer = 0;
        this.events.vault?.();
        return;
      }
    }

    this.sprinting = input.sprint && input.moveZ > 0.1 && !this.crouched && this.mode !== 'slide';

    // ---- sliding
    if (this.mode === 'slide') this.updateSlide(dt, input, wx, wz, hasInput);
    else if (
      this.slideBuffer > 0 && p.grounded && this.slideCooldown <= 0 &&
      p.hSpeed >= MOVE.slideMinSpeed
    ) {
      this.beginSlide();
    }

    // ---- ground / air movement
    if (this.mode === 'ground' || this.mode === 'air' || this.mode === 'slide') {
      if (this.mode !== 'slide') {
        if (p.grounded) this.groundMove(dt, wx, wz, hasInput);
        else this.airMove(dt, wx, wz, hasInput);
      }
      // ---- jump (also out of a slide, if there is headroom to stand)
      if (this.jumpBuffer > 0 && (p.grounded || this.coyote > 0) && this.canJumpNow()) {
        this.doJump();
      }
    }

    // ---- wall run
    if (this.mode === 'wallrun') {
      this.updateWallRun(dt, input, wx, wz);
    } else if (!p.grounded && this.mode !== 'slide') {
      this.tryStartWallRun(input);
    }

    // ---- gravity (not while wall running; it has its own)
    if (this.mode !== 'wallrun') {
      let g = MOVE.gravity;
      if (p.v[1] < 0) g *= MOVE.fallGravityMul;
      else if (!input.jumpHeld && this.jumpedUp) g *= MOVE.jumpCutGravityMul; // variable jump height
      if (!p.grounded) p.v[1] = Math.max(-MOVE.maxFall, p.v[1] - g * dt);
    }

    // ---- integrate with collision
    const r = p.move(dt);
    if (r.hitCeiling) this.jumpedUp = false;

    if (r.landed) this.onLanded(r.impact, input);
    else if (!p.grounded && this.mode === 'ground') this.mode = 'air';

    // footsteps / bob phase
    if (p.grounded && this.mode === 'ground') {
      const stride = this.sprinting ? 2.3 : 1.6;
      this.stepAccum += p.hSpeed * dt;
      this.bobPhase += (p.hSpeed * dt / stride) * Math.PI;
      if (this.stepAccum >= stride) {
        this.stepAccum -= stride;
        this.events.footstep?.(this.sprinting);
      }
    }

    // ---- ledge recovery: airborne, pushing into a ledge just above reach
    if (
      !p.grounded && this.mode === 'air' && this.mantleCooldown <= 0 &&
      input.moveZ > 0.1 && p.v[1] < 4.0
    ) {
      const dir = this.facingDir(input, wx, wz, hasInput);
      const move = this.parkour.findMantle(dir[0], dir[1]);
      if (move) {
        this.beginScript(move, Math.min(Math.max(p.hSpeed, 4), 7));
        this.events.mantle?.();
      }
    }

    this.canVaultHint = !this.scripting && this.mode !== 'wallrun' &&
      this.parkour.findVault(...this.facingDir(input, wx, wz, hasInput), p.hSpeed) !== null;
  }

  // ------------------------------------------------------------------ pieces

  private facingDir(input: PlayerInput, wx: number, wz: number, hasInput: boolean): [number, number] {
    const p = this.phys;
    if (p.hSpeed > 2) return [p.v[0] / p.hSpeed, p.v[2] / p.hSpeed];
    if (hasInput) return [wx, wz];
    return [-Math.sin(input.yaw), -Math.cos(input.yaw)];
  }

  private canJumpNow(): boolean {
    const p = this.phys;
    if (this.mode === 'slide') return p.canStand();
    return true;
  }

  private doJump(): void {
    const p = this.phys;
    if (this.mode === 'slide') this.endSlide();
    p.v[1] = MOVE.jumpSpeed;
    p.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpedUp = true;
    this.mode = 'air';
    this.events.jump?.();
  }

  private onLanded(impact: number, input: PlayerInput): void {
    const p = this.phys;
    this.jumpedUp = false;
    if (this.mode === 'wallrun') this.endWallRun(0);
    this.wallRunsSinceGround = 0;
    this.lastWallId = -1;
    if (this.mode === 'air' || this.mode === 'wallrun') this.mode = 'ground';
    // controlled landing friction: hard landings bleed a little speed unless you keep sprinting
    if (this.mode === 'ground' && impact > 9) {
      const keep = input.sprint && input.moveZ > 0.1 ? 0.5 : 1;
      const loss = Math.min(1, (impact - 9) / 14) * 0.28 * keep;
      p.v[0] *= 1 - loss;
      p.v[2] *= 1 - loss;
      this.landFriction = 0.15;
    }
    this.events.land?.(impact);
    // buffered slide key pressed just before touchdown
    if (this.slideBuffer > 0 && this.mode === 'ground' && p.hSpeed >= MOVE.slideMinSpeed && this.slideCooldown <= 0) {
      this.beginSlide();
    }
  }

  private groundMove(dt: number, wx: number, wz: number, hasInput: boolean): void {
    const p = this.phys;
    this.mode = 'ground';
    const v = p.v;
    const maxSpeed = this.crouched ? MOVE.crouchSpeed : this.sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed;
    const speed = p.hSpeed;
    if (!hasInput) {
      const dec = MOVE.groundDecel * (this.landFriction > 0 ? 1.6 : 1);
      const s = Math.max(0, speed - dec * dt);
      if (speed > 0) { v[0] *= s / speed; v[2] *= s / speed; }
      return;
    }
    if (speed <= maxSpeed + 0.05) {
      // accelerate towards the desired velocity vector
      const tx = wx * maxSpeed, tz = wz * maxSpeed;
      const dx = tx - v[0], dz = tz - v[2];
      const dl = Math.hypot(dx, dz);
      const step = MOVE.groundAccel * dt;
      if (dl <= step) { v[0] = tx; v[2] = tz; } else { v[0] += (dx / dl) * step; v[2] += (dz / dl) * step; }
    } else {
      // over-speed (landing out of a slide / long jump): keep momentum, decay gently, allow steering
      const ns = Math.max(maxSpeed, speed - MOVE.overspeedDecay * dt);
      let dx = v[0] / speed + wx * 5 * dt, dz = v[2] / speed + wz * 5 * dt;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      v[0] = dx * ns; v[2] = dz * ns;
    }
  }

  private airMove(dt: number, wx: number, wz: number, hasInput: boolean): void {
    const p = this.phys;
    this.mode = 'air';
    if (!hasInput) return; // momentum is conserved in the air
    const v = p.v;
    const proj = v[0] * wx + v[2] * wz;
    // limited air control: add speed along the wish dir up to a cap, weaker when braking
    let accel = MOVE.airAccel;
    if (proj < 0) accel *= 0.45;
    const add = Math.min(accel * dt, Math.max(0, MOVE.airSpeedCap - proj));
    v[0] += wx * add;
    v[2] += wz * add;
  }

  // ---- sliding -----------------------------------------------------------

  private beginSlide(): void {
    const p = this.phys;
    const speed = p.hSpeed;
    const boosted = Math.min(MOVE.slideMaxSpeed, Math.max(speed, MOVE.sprintSpeed) * MOVE.slideBoost);
    if (speed > 0) { p.v[0] *= boosted / speed; p.v[2] *= boosted / speed; }
    p.height = BODY.slideHeight;
    this.mode = 'slide';
    this.crouched = true;
    this.slideBuffer = 0;
    this.sprinting = false;
    this.events.slideStart?.();
  }

  private endSlide(): void {
    const p = this.phys;
    this.slideCooldown = 0.2;
    if (p.canStand()) { p.height = BODY.standHeight; this.crouched = false; }
    this.mode = p.grounded ? 'ground' : 'air';
  }

  private updateSlide(dt: number, input: PlayerInput, wx: number, wz: number, hasInput: boolean): void {
    const p = this.phys;
    const v = p.v;
    const headroom = p.canStand();
    let speed = p.hSpeed;
    // gentle steering while sliding (rotate velocity towards the wish direction, no speed gain)
    if (hasInput && speed > 0.1) {
      let dx = v[0] / speed + wx * 1.6 * dt, dz = v[2] / speed + wz * 1.6 * dt;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      v[0] = dx * speed; v[2] = dz * speed;
    }
    // friction; if something low is overhead keep a crawl speed so the slide can never wedge
    const floor = headroom ? 0 : MOVE.crouchSpeed;
    speed = Math.max(floor, speed - MOVE.slideFriction * dt);
    const cur = p.hSpeed;
    if (cur > 0.001) { v[0] *= speed / cur; v[2] *= speed / cur; }
    else if (!headroom) {
      v[0] = -Math.sin(input.yaw) * floor; v[2] = -Math.cos(input.yaw) * floor;
    }
    if (!p.grounded) { this.endSlide(); return; }
    if (headroom && (!input.slideHeld || speed < MOVE.slideEndSpeed)) this.endSlide();
  }

  // ---- wall running ------------------------------------------------------

  private tryStartWallRun(input: PlayerInput): void {
    const p = this.phys;
    if (this.wallCooldown > 0 || input.moveZ <= 0.1) return;
    if (p.hSpeed < MOVE.wallMinSpeed) return;
    if (this.wallRunsSinceGround >= 2) return;
    const hit = this.parkour.findWall(p.v[0], p.v[2]);
    if (!hit || hit.box.id === this.lastWallId) return;
    this.wall = hit;
    this.wallTime = 0;
    this.wallRunsSinceGround++;
    this.mode = 'wallrun';
    this.jumpedUp = false;
    const right = [Math.cos(input.yaw), -Math.sin(input.yaw)];
    this.wallSide = (-hit.nx * right[0] + -hit.nz * right[1]) > 0 ? 1 : -1;
    // enter with a controlled vertical speed so every wall run starts with a similar arc
    p.v[1] = Math.min(3.2, Math.max(1.0, p.v[1]));
    this.events.wallRunStart?.();
  }

  private updateWallRun(dt: number, input: PlayerInput, wx: number, wz: number): void {
    const p = this.phys;
    const w = this.wall!;
    this.wallTime += dt;
    const still = this.parkour.findWall(w.tx * 5, w.tz * 5, w.box);
    const speed = Math.min(11, Math.max(MOVE.wallSpeed, p.hSpeed));
    // wall jump
    if (this.jumpBuffer > 0) {
      p.v[0] = w.tx * speed * 0.9 + w.nx * MOVE.wallJumpAway;
      p.v[2] = w.tz * speed * 0.9 + w.nz * MOVE.wallJumpAway;
      p.v[1] = MOVE.wallJumpUp;
      this.endWallRun(MOVE.wallCooldown);
      this.jumpBuffer = 0;
      this.jumpedUp = true;
      this.events.wallJump?.();
      return;
    }
    if (!still || this.wallTime > MOVE.wallMaxTime || input.moveZ <= 0.1) {
      this.endWallRun(this.wallTime > MOVE.wallMaxTime ? 0.5 : MOVE.wallCooldown);
      return;
    }
    // run along the wall, lightly pressed into it so contact is never lost
    p.v[0] = w.tx * speed - w.nx * 1.5;
    p.v[2] = w.tz * speed - w.nz * 1.5;
    p.v[1] -= MOVE.wallGravity * dt;
    p.v[1] = Math.max(p.v[1], -6);
    this.bobPhase += dt * 9;
  }

  private endWallRun(cooldown: number): void {
    if (this.wall) this.lastWallId = this.wall.box.id; // can't re-attach to the same wall until you land
    this.wall = null;
    this.wallSide = 0;
    this.wallCooldown = cooldown;
    if (this.mode === 'wallrun') this.mode = this.phys.grounded ? 'ground' : 'air';
  }

  // ---- vault / mantle playback ---------------------------------------------

  private beginScript(move: ScriptedMove, exitSpeed: number): void {
    const p = this.phys;
    this.scriptMove = move;
    this.scriptT = 0;
    this.exitSpeed = exitSpeed;
    this.mode = 'script';
    p.height = move.kind === 'vault' ? 1.0 : BODY.standHeight;
    p.v[0] = p.v[1] = p.v[2] = 0;
    p.grounded = false;
    this.sprinting = false;
  }

  private updateScript(dt: number): void {
    const p = this.phys;
    const m = this.scriptMove!;
    this.scriptT = Math.min(1, this.scriptT + dt / m.duration);
    const [x, y, z] = vaultPoint(m, this.scriptT);
    p.p[0] = x; p.p[1] = y; p.p[2] = z;
    if (this.scriptT >= 1) {
      this.scriptMove = null;
      p.height = BODY.standHeight;
      if (p.overlapsAt(p.p[0], p.p[1], p.p[2], p.height)) {
        // end spot unexpectedly blocked (e.g. height change) - crouch and let sliding logic recover
        p.height = BODY.slideHeight;
        this.crouched = true;
      }
      const speed = m.kind === 'vault' ? this.exitSpeed : Math.min(this.exitSpeed, 5);
      p.v[0] = m.dx * speed;
      p.v[2] = m.dz * speed;
      p.v[1] = 0;
      this.mode = 'air';
      this.mantleCooldown = 0.35;
      this.jumpedUp = false;
    }
  }

  // for tests / debug
  get wallBox(): Box | null { return this.wall?.box ?? null; }
}
