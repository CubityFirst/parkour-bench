import { PHYS } from '../config';
import type { Input } from '../game/Input';
import type { CollisionWorld } from '../world/CollisionWorld';
import { ParkourSystem, type MovePlan, type WallContact } from './ParkourSystem';
import { PlayerPhysics } from './PlayerPhysics';

export type MoveState = 'ground' | 'air' | 'slide' | 'wallrun' | 'vault' | 'mantle';

export interface PlayerEvents {
  onJump?(fromSlide: boolean): void;
  onLand?(impact: number): void;
  onFootstep?(speed: number): void;
  onSlideStart?(): void;
  onSlideEnd?(): void;
  onWallRunStart?(side: number): void;
  onWallRunEnd?(): void;
  onWallJump?(): void;
  onVault?(): void;
  onMantle?(): void;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/**
 * Player movement state machine. Runs at a fixed timestep (see Game) and
 * turns input into velocity, then lets PlayerPhysics resolve collisions.
 *
 * States:
 *  ground  - running / sprinting / crouch-walking
 *  air     - jumping or falling, limited air control
 *  slide   - low, momentum preserving slide with friction
 *  wallrun - reduced gravity run along a vertical surface
 *  vault / mantle - short scripted moves over / onto geometry
 */
export class PlayerController {
  readonly body: PlayerPhysics;
  readonly parkour: ParkourSystem;
  events: PlayerEvents = {};

  yaw = 0;
  pitch = 0;
  state: MoveState = 'air';

  // Previous-step position for render interpolation.
  readonly prevPosition;

  private coyote = 0;
  private jumpBuffer = 0;
  /** True while a jump is still rising and can be cut short by releasing jump. */
  private jumpRising = false;
  crouched = false;
  slideTime = 0;

  wall: WallContact | null = null;
  wallTime = 0;
  private lastWallId = -1;
  private wallCooldown = 0;
  airTime = 0;

  plan: MovePlan | null = null;
  planT = 0;
  private planDuration = 0;
  private planExitSpeed = 0;
  private planDirX = 0;
  private planDirZ = 0;

  /** Accumulated stride phase, drives footsteps and head bob. */
  stridePhase = 0;
  /** Smoothed camera offset that hides instant step-ups. */
  stepSmooth = 0;
  /** Raw strafe input (-1..1) for camera roll. */
  strafe = 0;
  sprinting = false;
  /** Horizontal speed (m/s). */
  speed = 0;
  canVault = false;
  private vaultCheckTimer = 0;
  /** Seconds since the last jump - used for camera kick. */
  sinceJump = 10;

  constructor(world: CollisionWorld, private input: Input) {
    this.body = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(world);
    this.prevPosition = this.body.position.clone();
  }

  get forwardX(): number { return -Math.sin(this.yaw); }
  get forwardZ(): number { return -Math.cos(this.yaw); }

  respawn(x: number, y: number, z: number, yaw: number): void {
    const b = this.body;
    b.position.set(x, y + 0.01, z);
    b.velocity.set(0, 0, 0);
    b.height = PHYS.standHeight;
    b.grounded = false;
    this.prevPosition.copy(b.position);
    this.yaw = yaw;
    this.pitch = 0;
    this.state = 'air';
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpRising = false;
    this.crouched = false;
    this.slideTime = 0;
    this.wall = null;
    this.wallTime = 0;
    this.lastWallId = -1;
    this.wallCooldown = 0;
    this.plan = null;
    this.planT = 0;
    this.stepSmooth = 0;
    this.airTime = 0;
    this.speed = 0;
  }

  /** One fixed simulation step. */
  step(dt: number): void {
    const inp = this.input;
    const b = this.body;
    this.prevPosition.copy(b.position);
    this.sinceJump += dt;

    if (inp.consume('jump')) this.jumpBuffer = PHYS.jumpBuffer;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const crouchPressed = inp.consume('crouch');
    const vaultPressed = inp.consume('vault');
    const jumpHeld = inp.isDown('jump');
    const fwdHeld = inp.isDown('forward');

    const mz = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    const mx = (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0);
    this.strafe = mx;
    const fx = this.forwardX, fz = this.forwardZ;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    this.sprinting = inp.isDown('sprint') && mz > 0;

    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.stepSmooth *= Math.exp(-dt * 14);

    if (this.state === 'vault' || this.state === 'mantle') {
      this.updatePlan(dt);
      this.finishStep();
      return;
    }

    // Vault on demand (E). Allowed from ground, air and slide.
    if (vaultPressed && this.state !== 'wallrun') {
      const plan = this.parkour.findVault(b, fx, fz);
      if (plan) {
        this.startPlan('vault', plan, Math.max(this.speed, 6.5), fx, fz);
        this.finishStep();
        return;
      }
    }

    switch (this.state) {
      case 'wallrun': this.updateWallRun(dt, fwdHeld); break;
      case 'slide': this.updateSlide(dt, wx, wz); break;
      default: this.updateGroundAir(dt, wx, wz, wl > 0, crouchPressed, jumpHeld, fwdHeld); break;
    }

    // Periodic vault availability check for the HUD hint.
    this.vaultCheckTimer -= dt;
    if (this.vaultCheckTimer <= 0) {
      this.vaultCheckTimer = 0.08;
      this.canVault = (this.state === 'ground' || this.state === 'air' || this.state === 'slide') &&
        this.parkour.findVault(b, fx, fz) !== null;
    }
    this.finishStep();
  }

  private finishStep(): void {
    const v = this.body.velocity;
    this.speed = Math.hypot(v.x, v.z);
  }

  // ---------------------------------------------------------------- ground / air

  private updateGroundAir(dt: number, wx: number, wz: number, hasInput: boolean,
    crouchPressed: boolean, jumpHeld: boolean, fwdHeld: boolean): void {
    const b = this.body, v = b.velocity;
    const grounded = b.grounded;
    const hs = Math.hypot(v.x, v.z);

    if (grounded) this.coyote = PHYS.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);

    // Start a slide when crouch is pressed while moving fast on the ground.
    if (grounded && crouchPressed && hs > PHYS.slideMinSpeed) {
      this.startSlide();
      this.updateSlide(dt, wx, wz);
      return;
    }

    // Crouch walking.
    const crouchHeld = this.input.isDown('crouch');
    if (grounded && crouchHeld) this.setCrouched(true);
    else if (this.crouched && !crouchHeld) this.setCrouched(false);

    const maxSpeed = this.crouched ? PHYS.crouchSpeed : this.sprinting ? PHYS.sprintSpeed : PHYS.walkSpeed;

    if (grounded) {
      const tx = wx * maxSpeed, tz = wz * maxSpeed;
      let dx = tx - v.x, dz = tz - v.z;
      let rate: number;
      if (!hasInput) rate = PHYS.groundDecel;
      else if (hs > maxSpeed && (v.x * wx + v.z * wz) > 0) rate = PHYS.groundDecel * 0.45; // bleed excess speed gently
      else rate = PHYS.groundAccel;
      const dl = Math.hypot(dx, dz), maxStep = rate * dt;
      if (dl > maxStep) { dx *= maxStep / dl; dz *= maxStep / dl; }
      v.x += dx; v.z += dz;
    } else if (hasInput) {
      // Limited air control that never adds speed beyond what we already had.
      const limit = Math.max(hs, maxSpeed * 0.75);
      v.x += wx * PHYS.airAccel * dt;
      v.z += wz * PHYS.airAccel * dt;
      const ns = Math.hypot(v.x, v.z);
      if (ns > limit) { v.x *= limit / ns; v.z *= limit / ns; }
    }

    // Jump (with coyote time + buffering).
    let jumped = false;
    if (this.jumpBuffer > 0 && (grounded || this.coyote > 0) && (!this.crouched || b.hasHeadroom())) {
      this.setCrouched(false);
      this.doJump(false);
      jumped = true;
    }

    this.applyGravity(dt, jumpHeld);

    if (!grounded && !jumped) {
      this.airTime += dt;
      // Wall run: airborne, moving fast, holding forward.
      if (fwdHeld && this.wallCooldown <= 0 && v.y > -9 && this.airTime > 0.04) {
        const w = this.parkour.findWall(b, this.lastWallId);
        if (w) { this.startWallRun(w); return; }
      }
      // Jumping into a low obstacle while pushing forward vaults it automatically.
      if (fwdHeld && (b.hitWallX !== 0 || b.hitWallZ !== 0)) {
        const plan = this.parkour.findVault(b, this.forwardX, this.forwardZ);
        if (plan) {
          this.startPlan('vault', plan, Math.max(hs, 8.5), this.forwardX, this.forwardZ);
          return;
        }
      }
      // Ledge grab / mantle.
      if (fwdHeld && v.y < 6) {
        const plan = this.parkour.findLedge(b, this.forwardX, this.forwardZ);
        if (plan) {
          this.startPlan('mantle', plan, Math.max(hs * 0.6, 5), this.forwardX, this.forwardZ);
          return;
        }
      }
    }

    this.integrate(dt, grounded);
    this.state = b.grounded ? 'ground' : 'air';
    if (b.grounded) this.airTime = 0;
    this.updateStride(dt);
  }

  private doJump(fromSlide: boolean): void {
    const b = this.body;
    b.velocity.y = PHYS.jumpVelocity;
    this.jumpRising = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    b.grounded = false;
    this.state = 'air';
    this.airTime = 0;
    this.sinceJump = 0;
    this.events.onJump?.(fromSlide);
  }

  private applyGravity(dt: number, jumpHeld: boolean): void {
    const v = this.body.velocity;
    // Variable jump height: releasing jump early cuts the rise.
    if (this.jumpRising) {
      if (v.y <= 0) this.jumpRising = false;
      else if (!jumpHeld) { v.y *= PHYS.jumpCutMul; this.jumpRising = false; }
    }
    const g = v.y < 0 ? PHYS.gravity * PHYS.fallGravityMul : PHYS.gravity;
    v.y = Math.max(-PHYS.maxFallSpeed, v.y - g * dt);
  }

  /** Move the body and detect landings. */
  private integrate(dt: number, wasGrounded: boolean): void {
    const b = this.body;
    const vyBefore = b.velocity.y;
    b.move(dt);
    if (b.steppedUp > 0) this.stepSmooth -= b.steppedUp;
    if (!wasGrounded && b.grounded) {
      const impact = -vyBefore;
      if (impact > 13) {
        // Hard landings scrub a bit of speed.
        b.velocity.x *= 0.88; b.velocity.z *= 0.88;
      }
      this.wallCooldown = 0;
      this.lastWallId = -1;
      this.events.onLand?.(impact);
    }
    if (b.grounded) this.lastWallId = -1;
  }

  private updateStride(dt: number): void {
    const b = this.body;
    if (!b.grounded || this.state === 'slide') return;
    const sp = Math.hypot(b.velocity.x, b.velocity.z);
    if (sp < 0.5) return;
    const stride = this.crouched ? 1.1 : 1.6 + sp * 0.06;
    const before = Math.floor(this.stridePhase);
    this.stridePhase += (sp * dt) / stride;
    if (Math.floor(this.stridePhase) !== before) this.events.onFootstep?.(sp);
  }

  private setCrouched(c: boolean): void {
    if (c === this.crouched) return;
    if (!c && !this.body.hasHeadroom()) return; // stay low under obstacles
    this.crouched = c;
    this.body.height = c ? PHYS.slideHeight : PHYS.standHeight;
  }

  // ---------------------------------------------------------------- slide

  private startSlide(): void {
    const b = this.body, v = b.velocity;
    const hs = Math.hypot(v.x, v.z);
    const ns = Math.min(hs + PHYS.slideBoost, PHYS.slideMaxSpeed);
    if (hs > 0.01) { v.x *= ns / hs; v.z *= ns / hs; }
    this.state = 'slide';
    this.slideTime = 0;
    this.crouched = true;
    b.height = PHYS.slideHeight;
    this.events.onSlideStart?.();
  }

  private updateSlide(dt: number, wx: number, wz: number): void {
    const b = this.body, v = b.velocity;
    this.slideTime += dt;
    let hs = Math.hypot(v.x, v.z);

    // Friction ramps up the longer the slide lasts.
    const friction = PHYS.slideFriction * (1 + this.slideTime * 0.6);
    const headroom = b.hasHeadroom();
    // Never come to a stop underneath an obstacle - keep a minimum crawl speed.
    const floor = headroom ? 0 : PHYS.crouchSpeed;
    const ns = Math.max(floor, hs - friction * dt);
    if (hs > 0.01) { v.x *= ns / hs; v.z *= ns / hs; hs = ns; }

    // Slight steering.
    if (hs > 0.5 && (wx || wz)) {
      v.x += wx * PHYS.slideSteer * dt * hs * 0.3;
      v.z += wz * PHYS.slideSteer * dt * hs * 0.3;
      const s2 = Math.hypot(v.x, v.z);
      v.x *= hs / s2; v.z *= hs / s2;
    }

    // Jump out of a slide keeps the slide momentum.
    if (this.jumpBuffer > 0 && headroom) {
      this.crouched = false;
      b.height = PHYS.standHeight;
      this.events.onSlideEnd?.();
      this.doJump(true);
      this.applyGravity(dt, true);
      this.integrate(dt, true);
      return;
    }

    this.applyGravity(dt, true);
    this.integrate(dt, true);

    // A tap gives a short slide; holding crouch keeps sliding until friction wins.
    const crouchHeld = this.input.isDown('crouch');
    const ended = headroom && (hs < PHYS.slideEndSpeed || (!crouchHeld && this.slideTime > 0.5));
    if (!b.grounded) {
      // Slid off an edge: become airborne, stand up when there's space.
      this.state = 'air';
      this.coyote = PHYS.coyoteTime;
      this.events.onSlideEnd?.();
      if (b.hasHeadroom()) { this.crouched = false; b.height = PHYS.standHeight; }
    } else if (ended) {
      this.state = 'ground';
      this.events.onSlideEnd?.();
      if (!this.input.isDown('crouch')) { this.crouched = false; b.height = PHYS.standHeight; }
    }
  }

  // ---------------------------------------------------------------- wall run

  private startWallRun(w: WallContact): void {
    const b = this.body, v = b.velocity;
    this.state = 'wallrun';
    this.wall = w;
    this.wallTime = 0;
    this.lastWallId = w.collider.id;
    this.jumpRising = false;
    v.y = v.y < PHYS.wallRunUpBoost ? PHYS.wallRunUpBoost : Math.max(PHYS.wallRunUpBoost, v.y * 0.6);
    const along = Math.max(w.along, PHYS.wallRunMinAlongSpeed);
    v.x = w.tx * along; v.z = w.tz * along;
    this.events.onWallRunStart?.(w.side);
  }

  private updateWallRun(dt: number, fwdHeld: boolean): void {
    const b = this.body, v = b.velocity, w = this.wall!;
    this.wallTime += dt;
    const along = Math.max(Math.hypot(v.x, v.z), PHYS.wallRunMinAlongSpeed * 0.95);

    // Wall jump.
    if (this.jumpBuffer > 0) {
      v.x = w.tx * along * 0.95 + w.nx * PHYS.wallJumpOut;
      v.z = w.tz * along * 0.95 + w.nz * PHYS.wallJumpOut;
      this.wall = null;
      this.state = 'air';
      this.wallCooldown = 0.2;
      this.doJump(false);
      v.y = PHYS.wallJumpUp;
      this.events.onWallJump?.();
      this.events.onWallRunEnd?.();
      this.integrate(dt, false);
      return;
    }

    // Reduced gravity which grows towards the end of the run.
    const g = PHYS.wallRunGravity * (this.wallTime > PHYS.wallRunMaxTime * 0.7 ? 2.2 : 1);
    v.y -= g * dt;
    // Run along the wall, with a slight pull into it to maintain contact.
    v.x = w.tx * along - w.nx * 0.6;
    v.z = w.tz * along - w.nz * 0.6;
    this.integrate(dt, false);
    this.stridePhase += (along * dt) / 2.0;

    // Contact test against the same wall collider.
    const c = w.collider, p = b.position, r = b.radius;
    let dist: number, inRange: boolean;
    if (w.nx !== 0) {
      dist = w.nx > 0 ? (p.x - r) - c.maxX : c.minX - (p.x + r);
      inRange = p.z > c.minZ - r * 0.5 && p.z < c.maxZ + r * 0.5;
    } else {
      dist = w.nz > 0 ? (p.z - r) - c.maxZ : c.minZ - (p.z + r);
      inRange = p.x > c.minX - r * 0.5 && p.x < c.maxX + r * 0.5;
    }
    const covered = c.minY <= p.y + 0.5 && c.maxY >= p.y + 1.2;
    const blocked = (w.nx !== 0 ? b.hitWallZ !== 0 : b.hitWallX !== 0);

    if (b.grounded || !fwdHeld || this.wallTime > PHYS.wallRunMaxTime || dist > PHYS.wallRunProbe + 0.1 ||
        !inRange || !covered || blocked || v.y < -7) {
      // Detach with a small push away from the wall.
      v.x += w.nx * 1.2; v.z += w.nz * 1.2;
      this.wall = null;
      this.wallCooldown = 0.25;
      this.state = b.grounded ? 'ground' : 'air';
      this.events.onWallRunEnd?.();
    }
  }

  // ---------------------------------------------------------------- vault / mantle

  private startPlan(kind: 'vault' | 'mantle', plan: MovePlan, exitSpeed: number, dx: number, dz: number): void {
    this.state = kind;
    this.plan = plan;
    this.planT = 0;
    this.planDuration = kind === 'vault' ? PHYS.vaultDuration : PHYS.mantleDuration;
    this.planExitSpeed = exitSpeed;
    this.planDirX = dx; this.planDirZ = dz;
    this.wall = null;
    this.jumpRising = false;
    this.body.velocity.set(0, 0, 0);
    if (kind === 'vault') this.events.onVault?.(); else this.events.onMantle?.();
  }

  private updatePlan(dt: number): void {
    const plan = this.plan!, b = this.body, p = b.position;
    this.planT = Math.min(1, this.planT + dt / this.planDuration);
    const t = this.planT;
    const prevX = p.x, prevY = p.y, prevZ = p.z;

    if (this.state === 'vault') {
      // Horizontal: steady, slightly eased. Vertical: pop up fast, hang, then drop.
      const ht = smooth(clamp(t * 1.1, 0, 1));
      p.x = plan.fromX + (plan.toX - plan.fromX) * ht;
      p.z = plan.fromZ + (plan.toZ - plan.fromZ) * ht;
      if (t < 0.4) p.y = plan.fromY + (plan.apexY - plan.fromY) * easeOut(t / 0.4);
      else if (t < 0.65) p.y = plan.apexY;
      else {
        const k = (t - 0.65) / 0.35;
        p.y = plan.apexY + (plan.toY - plan.apexY) * k * k;
      }
    } else {
      // Mantle: pull up first, then roll forward onto the ledge.
      if (t < 0.6) {
        const k = easeOut(t / 0.6);
        p.y = plan.fromY + (plan.toY + 0.08 - plan.fromY) * k;
        p.x = plan.fromX + (plan.toX - plan.fromX) * 0.15 * k;
        p.z = plan.fromZ + (plan.toZ - plan.fromZ) * 0.15 * k;
      } else {
        const k = smooth((t - 0.6) / 0.4);
        p.y = plan.toY + 0.08 * (1 - k);
        p.x = plan.fromX + (plan.toX - plan.fromX) * (0.15 + 0.85 * k);
        p.z = plan.fromZ + (plan.toZ - plan.fromZ) * (0.15 + 0.85 * k);
      }
    }
    // Expose an approximate velocity for camera/audio while scripted.
    b.velocity.set((p.x - prevX) / dt, (p.y - prevY) / dt, (p.z - prevZ) / dt);

    if (t >= 1) {
      p.set(plan.toX, plan.toY, plan.toZ);
      b.velocity.set(this.planDirX * this.planExitSpeed, 0, this.planDirZ * this.planExitSpeed);
      this.plan = null;
      this.state = 'air';
      this.coyote = PHYS.coyoteTime;
      this.crouched = !b.hasHeadroom();
      b.height = this.crouched ? PHYS.slideHeight : PHYS.standHeight;
      b.move(dt);
      if (b.grounded) {
        this.state = 'ground';
        this.events.onLand?.(3);
      }
    }
  }
}
