import { FLOW, LEDGE, MOVE, PLAYER, SLIDE, WALL } from '../config.ts';
import { Emitter } from '../game/Events.ts';
import type { Collider, CollisionWorld } from '../world/CollisionWorld.ts';
import { ParkourSystem } from './ParkourSystem.ts';
import type { ScriptedMove, WallContact } from './ParkourSystem.ts';
import { PlayerBody } from './PlayerPhysics.ts';

export type PlayerState = 'ground' | 'air' | 'slide' | 'wallrun' | 'scripted';

/** One tick worth of player intent. Edge flags (`*Pressed`) are true only on the first tick after the key went down. */
export interface PlayerInput {
  /** Strafe axis: -1 = left, +1 = right. */
  moveX: number;
  /** Forward axis: +1 = forward, -1 = backward. */
  moveY: number;
  /** Facing direction (radians, 0 = looking down -Z, positive = turning left). */
  yaw: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  slideHeld: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
}

export function createInput(): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    yaw: 0,
    sprint: false,
    jumpHeld: false,
    jumpPressed: false,
    slideHeld: false,
    slidePressed: false,
    vaultPressed: false,
  };
}

export interface PlayerEvents {
  jump: { kind: 'ground' | 'coyote' | 'slide' | 'wall' };
  land: { impact: number; rolled: boolean };
  step: { sprint: boolean; speed: number; wall: boolean };
  slideStart: { speed: number; rolled: boolean };
  slideEnd: undefined;
  wallRunStart: { side: -1 | 1 };
  wallRunEnd: { jumped: boolean };
  scriptedStart: { kind: 'vault' | 'mantle'; rise: number };
  scriptedEnd: { kind: 'vault' | 'mantle' };
  bump: { speedLost: number };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const tmp = { x: 0, y: 0, z: 0 };

/**
 * First-person parkour movement state machine.
 *
 * States: `ground` (walk / sprint / crouch), `air`, `slide`, `wallrun` and `scripted`
 * (vault / mantle - a pre-validated curve). `update()` is called at a fixed 120 Hz.
 */
export class PlayerController {
  readonly body = new PlayerBody();
  readonly events = new Emitter<PlayerEvents>();
  readonly parkour: ParkourSystem;
  private readonly world: CollisionWorld;

  state: PlayerState = 'ground';
  crouched = false;
  /** 0..1 momentum bonus: builds while sprinting without losing speed, raises top speed. */
  flow = 0;
  scripted: ScriptedMove | null = null;
  /** Active wall-run contact (state === 'wallrun'). */
  wall: WallContact | null = null;
  /** Time since the run started (seconds) - used by HUD / hints. */
  time = 0;
  /** Whether a vault / mantle target is currently in reach (for the HUD hint). */
  ledgeHint: 'vault' | 'mantle' | null = null;
  /** Debug / test switch: disable the automatic mid-air ledge grab (used to measure raw jump margins). */
  autoLedge = true;

  // ---- timers ----
  private jumpBuffer = 0;
  private vaultBuffer = 0;
  private slideBuffer = 0;
  private coyote = 0;
  private airTime = 0;
  private groundTime = 0;
  private slideTime = 0;
  private landTimer = 0;

  private wallTime = 0;
  private wallGrace = 0;
  private wallForwardRelease = 0;
  private airWallTime = 0;
  private airWallAttaches = 0;
  private wallCooldown = 0;
  private sameWallCooldown = 0;
  private lastWall: Collider | null = null;

  private stepDist = 0;
  private hintTimer = 0;

  constructor(world: CollisionWorld) {
    this.world = world;
    this.parkour = new ParkourSystem(world);
  }

  /** Put the player back on its feet at a position with zero velocity and a clean movement state. */
  reset(x: number, y: number, z: number): void {
    const b = this.body;
    b.setPosition(x, y, z);
    b.vx = b.vy = b.vz = 0;
    b.height = PLAYER.standHeight;
    b.onGround = false;
    b.ground = null;
    this.state = 'ground';
    this.crouched = false;
    this.flow = 0;
    this.scripted = null;
    this.wall = null;
    this.jumpBuffer = this.vaultBuffer = this.slideBuffer = 0;
    this.coyote = MOVE.coyoteTime;
    this.airTime = this.groundTime = this.slideTime = this.landTimer = 0;
    this.wallTime = this.wallGrace = this.wallForwardRelease = 0;
    this.airWallTime = this.airWallAttaches = 0;
    this.wallCooldown = this.sameWallCooldown = 0;
    this.lastWall = null;
    this.stepDist = 0;
    this.ledgeHint = null;
    // Settle onto whatever is underneath.
    b.move(this.world, 0.0001);
  }

  get speed(): number {
    return this.body.horizontalSpeed;
  }

  /** Sprint top speed including the momentum bonus. */
  get sprintTarget(): number {
    return MOVE.sprintSpeed + (MOVE.sprintSpeedMax - MOVE.sprintSpeed) * this.flow;
  }

  // ==========================================================================================
  // Main tick
  // ==========================================================================================

  update(dt: number, input: PlayerInput): void {
    this.time += dt;

    // ---- input buffers ----
    this.jumpBuffer = input.jumpPressed ? MOVE.jumpBufferTime : Math.max(0, this.jumpBuffer - dt);
    this.vaultBuffer = input.vaultPressed ? MOVE.vaultBufferTime : Math.max(0, this.vaultBuffer - dt);
    this.slideBuffer = input.slidePressed ? SLIDE.rollWindow + 0.05 : Math.max(0, this.slideBuffer - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.sameWallCooldown = Math.max(0, this.sameWallCooldown - dt);

    if (this.state === 'scripted') {
      this.tickScripted(dt);
      return;
    }

    // ---- wish direction in world space ----
    const sinY = Math.sin(input.yaw);
    const cosY = Math.cos(input.yaw);
    let wx = -input.moveY * sinY + input.moveX * cosY;
    let wz = -input.moveY * cosY - input.moveX * sinY;
    const wl = Math.hypot(wx, wz);
    const hasInput = wl > 0.01;
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }

    this.updateFlow(dt, input, hasInput);
    this.updateHint(dt, input);

    switch (this.state) {
      case 'ground':
        this.tickGround(dt, input, wx, wz, hasInput);
        break;
      case 'air':
        this.tickAir(dt, input, wx, wz, hasInput);
        break;
      case 'slide':
        this.tickSlide(dt, input, wx, wz, hasInput);
        break;
      case 'wallrun':
        this.tickWallRun(dt, input, wx, wz, hasInput);
        break;
      default:
        break;
    }

  }

  // ==========================================================================================
  // Flow (momentum bonus)
  // ==========================================================================================

  private updateFlow(dt: number, input: PlayerInput, hasInput: boolean): void {
    const speed = this.body.horizontalSpeed;
    const sprinting = input.sprint && hasInput && input.moveY > 0.1 && !this.crouched;
    if (this.state === 'slide' || this.state === 'wallrun') {
      // Slides and wall runs neither build nor drain flow while they keep the speed up.
      if (speed < MOVE.sprintSpeed * 0.7) this.flow = Math.max(0, this.flow - FLOW.decayRate * dt);
      return;
    }
    if (this.state === 'air') {
      if (speed < MOVE.sprintSpeed * 0.75) this.flow = Math.max(0, this.flow - FLOW.decayRate * dt);
      return;
    }
    if (sprinting && speed >= MOVE.sprintSpeed * 0.9) {
      this.flow = Math.min(1, this.flow + FLOW.riseRate * dt);
    } else if (!sprinting || speed < MOVE.sprintSpeed * 0.75) {
      this.flow = Math.max(0, this.flow - FLOW.decayRate * dt);
    }
  }

  /** Cheap periodic probe that drives the "press E" HUD hint. */
  private updateHint(dt: number, input: PlayerInput): void {
    this.hintTimer -= dt;
    if (this.hintTimer > 0) return;
    this.hintTimer = 0.08;
    if (this.state === 'scripted' || this.state === 'wallrun') {
      this.ledgeHint = null;
      return;
    }
    const b = this.body;
    const fx = -Math.sin(input.yaw);
    const fz = -Math.cos(input.yaw);
    const move = this.parkour.findLedge(b, fx, fz, b.horizontalSpeed, b.onGround, true, true);
    this.ledgeHint = move ? move.kind : null;
  }

  // ==========================================================================================
  // Ground
  // ==========================================================================================

  private tickGround(dt: number, input: PlayerInput, wx: number, wz: number, hasInput: boolean): void {
    const b = this.body;
    this.groundTime += dt;
    this.coyote = MOVE.coyoteTime;
    const speed = b.horizontalSpeed;

    // --- jump (jump buffering) ---
    if (this.jumpBuffer > 0) {
      if (!this.crouched || b.setHeight(this.world, PLAYER.standHeight) === PLAYER.standHeight) {
        this.crouched = false;
        this.jump('ground');
        this.tickAir(dt, input, wx, wz, hasInput);
        return;
      }
    }

    // --- vault / mantle (E, buffered) ---
    if (this.vaultBuffer > 0 && !this.crouched) {
      const fx = -Math.sin(input.yaw);
      const fz = -Math.cos(input.yaw);
      const move = this.parkour.findLedge(b, fx, fz, speed, true, true, true);
      if (move) {
        this.startScripted(move);
        return;
      }
    }

    // --- low obstacle ahead while sprinting: hop it without needing E ---
    if (this.autoLedge && !this.crouched && input.sprint && input.moveY > 0.5 && speed >= LEDGE.autoVaultMinSpeed && this.groundTime > 0.12) {
      const fx = -Math.sin(input.yaw);
      const fz = -Math.cos(input.yaw);
      // A short reach means the hop starts about a metre before the obstacle; the real speed is kept for planning.
      const hop = this.parkour.findLedge(b, fx, fz, speed, true, true, false, 2);
      if (hop && hop.kind === 'vault' && hop.rise <= LEDGE.autoVaultMaxRise) {
        this.startScripted(hop);
        return;
      }
    }

    // --- slide / crouch ---
    if (this.slideBuffer > 0 && speed >= SLIDE.minSpeed && !this.crouched) {
      this.startSlide(false);
      this.tickSlide(dt, input, wx, wz, hasInput);
      return;
    }
    if (input.slideHeld) {
      if (!this.crouched) {
        this.crouched = true;
        b.height = PLAYER.slideHeight;
      }
    } else if (this.crouched) {
      if (b.setHeight(this.world, PLAYER.standHeight) === PLAYER.standHeight) this.crouched = false;
    }

    // --- horizontal velocity ---
    let target: number;
    if (this.crouched) target = MOVE.crouchSpeed;
    else if (input.sprint && hasInput && input.moveY > -0.5) target = this.sprintTarget;
    else target = MOVE.walkSpeed;
    if (hasInput) {
      // Moving backwards is slower than forwards.
      const fwd = wx * -Math.sin(input.yaw) + wz * -Math.cos(input.yaw);
      if (fwd < 0) target *= 1 + 0.28 * fwd;
    }
    this.applyGroundVelocity(dt, wx, wz, hasInput, target);

    // --- integrate ---
    const preSpeed = b.horizontalSpeed;
    b.vy = 0;
    b.stepHeight = PLAYER.stepHeight;
    b.move(this.world, dt);
    this.afterMove(preSpeed);

    if (b.onGround) {
      this.footsteps(dt, input.sprint && !this.crouched, false);
    } else {
      this.enterAir();
    }
  }

  private applyGroundVelocity(dt: number, wx: number, wz: number, hasInput: boolean, target: number): void {
    const b = this.body;
    // Friction is eased back in after a landing so touchdown does not scrub speed.
    const fric =
      this.landTimer > 0
        ? MOVE.landFrictionMin + (1 - MOVE.landFrictionMin) * (1 - this.landTimer / MOVE.landFrictionTime)
        : 1;
    let vx = b.vx;
    let vz = b.vz;
    if (hasInput) {
      const along = vx * wx + vz * wz;
      let px = vx - wx * along;
      let pz = vz - wz * along;
      const pl = Math.hypot(px, pz);
      if (pl > 1e-6) {
        const nl = Math.max(0, pl - MOVE.groundGrip * fric * dt);
        px *= nl / pl;
        pz *= nl / pl;
      }
      let na = along;
      if (along < target) {
        const accel = along < 0 ? MOVE.brakeAccel : MOVE.groundAccel;
        na = Math.min(target, along + accel * dt);
      } else if (along > target) {
        na = Math.max(target, along - MOVE.overspeedDecel * fric * dt);
      }
      vx = wx * na + px;
      vz = wz * na + pz;
    } else {
      const speed = Math.hypot(vx, vz);
      if (speed > 1e-6) {
        const ns = Math.max(0, speed - MOVE.stopDecel * fric * dt);
        vx *= ns / speed;
        vz *= ns / speed;
      }
    }
    const s = Math.hypot(vx, vz);
    if (s > MOVE.speedCap) {
      vx *= MOVE.speedCap / s;
      vz *= MOVE.speedCap / s;
    }
    b.vx = vx;
    b.vz = vz;
  }

  private footsteps(dt: number, sprint: boolean, wall: boolean): void {
    const speed = this.body.horizontalSpeed;
    if (speed < 1.2) {
      this.stepDist = 0;
      return;
    }
    this.stepDist += speed * dt;
    const stride = 1.15 + 0.17 * speed;
    if (this.stepDist >= stride) {
      this.stepDist -= stride;
      this.events.emit('step', { sprint, speed, wall });
    }
  }

  /** Records momentum loss from bumping into something so the flow bonus can be cancelled. */
  private afterMove(preSpeed: number): void {
    const b = this.body;
    if (b.blockedX !== 0 || b.blockedZ !== 0) {
      const lost = preSpeed - b.horizontalSpeed;
      if (lost > 3.5) {
        this.flow = 0;
        this.events.emit('bump', { speedLost: lost });
      }
    }
  }

  // ==========================================================================================
  // Jump / air
  // ==========================================================================================

  private jump(kind: 'ground' | 'coyote' | 'slide' | 'wall'): void {
    const b = this.body;
    b.vy = MOVE.jumpSpeed;
    b.onGround = false;
    b.ground = null;
    this.state = 'air';
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.airTime = 0;
    this.landTimer = 0;
    this.events.emit('jump', { kind });
  }

  private enterAir(): void {
    this.state = 'air';
    this.airTime = 0;
    this.groundTime = 0;
  }

  private tickAir(dt: number, input: PlayerInput, wx: number, wz: number, hasInput: boolean): void {
    const b = this.body;
    this.airTime += dt;
    this.coyote = Math.max(0, this.coyote - dt);

    // --- coyote jump ---
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.jump('coyote');
    }

    // --- stand back up if we left the ground crouched ---
    if (this.crouched && !input.slideHeld) {
      if (b.setHeight(this.world, PLAYER.standHeight) === PLAYER.standHeight) this.crouched = false;
    }

    // --- wall run ---
    if (this.tryStartWallRun(input)) {
      this.tickWallRun(dt, input, wx, wz, hasInput);
      return;
    }

    // --- ledge recovery / air vault ---
    if (this.tryAirLedge(input)) return;

    // --- air steering (rotates velocity, never adds free speed) ---
    if (hasInput) {
      const speed = b.horizontalSpeed;
      const cap = Math.max(speed, MOVE.walkSpeed * 0.8);
      let ax = wx * cap - b.vx;
      let az = wz * cap - b.vz;
      const al = Math.hypot(ax, az);
      if (al > 1e-6) {
        const maxD = MOVE.airAccel * dt;
        if (al > maxD) {
          ax *= maxD / al;
          az *= maxD / al;
        }
        // Braking in mid-air is much weaker than steering.
        if (speed > 1e-3) {
          const along = (ax * b.vx + az * b.vz) / speed;
          if (along < 0) {
            const k = 0.65 * (-along);
            ax += (b.vx / speed) * k;
            az += (b.vz / speed) * k;
          }
        }
        b.vx += ax;
        b.vz += az;
        const ns = Math.hypot(b.vx, b.vz);
        if (ns > cap) {
          b.vx *= cap / ns;
          b.vz *= cap / ns;
        }
      }
    }

    // --- gravity (variable jump height: releasing the key while rising cuts the jump) ---
    let g = MOVE.gravity;
    if (b.vy > 0) {
      if (!input.jumpHeld) g *= MOVE.jumpCutMult;
    } else {
      g *= MOVE.fallGravityMult;
    }
    b.vy = Math.max(-MOVE.terminalVelocity, b.vy - g * dt);

    // --- integrate ---
    const preSpeed = b.horizontalSpeed;
    b.stepHeight = b.vy <= 0 ? PLAYER.stepHeightAir : 0;
    b.move(this.world, dt);
    this.afterMove(preSpeed);

    if (b.onGround && b.vy <= 0) this.land(input);
  }

  private land(input: PlayerInput): void {
    const b = this.body;
    const impact = b.landedSpeed;
    const speed = b.horizontalSpeed;
    this.airTime = 0;
    this.coyote = MOVE.coyoteTime;
    this.airWallTime = 0;
    this.airWallAttaches = 0;
    this.lastWall = null;
    this.sameWallCooldown = 0;

    const wantsRoll = (input.slideHeld || this.slideBuffer > 0) && speed >= SLIDE.minSpeed;
    if (wantsRoll) {
      this.startSlide(true);
      this.events.emit('land', { impact, rolled: true });
      return;
    }

    if (impact > MOVE.hardLandSpeed) {
      const loss = Math.min(0.4, (impact - MOVE.hardLandSpeed) * 0.025);
      b.vx *= 1 - loss;
      b.vz *= 1 - loss;
    }
    this.landTimer = MOVE.landFrictionTime;
    this.state = 'ground';
    this.groundTime = 0;
    if (impact > 1.5) this.events.emit('land', { impact, rolled: false });
  }

  // ==========================================================================================
  // Slide
  // ==========================================================================================

  private startSlide(rolled: boolean): void {
    const b = this.body;
    const speed = b.horizontalSpeed;
    if (speed > 1e-4) {
      const boosted = rolled ? speed : speed * SLIDE.startBoost;
      const ns = boosted > SLIDE.maxStartSpeed ? Math.max(SLIDE.maxStartSpeed, speed) : boosted;
      b.vx *= ns / speed;
      b.vz *= ns / speed;
    }
    b.height = PLAYER.slideHeight;
    this.crouched = true;
    this.state = 'slide';
    this.slideTime = 0;
    this.slideBuffer = 0;
    this.events.emit('slideStart', { speed: b.horizontalSpeed, rolled });
  }

  private endSlide(): void {
    this.state = 'ground';
    this.events.emit('slideEnd', undefined);
  }

  private tickSlide(dt: number, input: PlayerInput, wx: number, wz: number, hasInput: boolean): void {
    const b = this.body;
    this.slideTime += dt;
    this.coyote = MOVE.coyoteTime;

    // --- friction + gentle steering ---
    let speed = b.horizontalSpeed;
    let dx: number;
    let dz: number;
    if (speed > 1e-4) {
      dx = b.vx / speed;
      dz = b.vz / speed;
    } else {
      dx = -Math.sin(input.yaw);
      dz = -Math.cos(input.yaw);
    }
    if (hasInput && speed > 1) {
      const cross = dx * wz - dz * wx;
      const dot = dx * wx + dz * wz;
      const ang = Math.atan2(cross, dot);
      const maxTurn = SLIDE.steerRate * dt;
      const turn = clamp(ang, -maxTurn, maxTurn);
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const nx = dx * c - dz * s;
      const nz = dx * s + dz * c;
      dx = nx;
      dz = nz;
    }
    speed = Math.max(0, speed - SLIDE.friction * dt);
    b.vx = dx * speed;
    b.vz = dz * speed;

    // --- slide jump ---
    if (this.jumpBuffer > 0 && b.setHeight(this.world, PLAYER.standHeight) === PLAYER.standHeight) {
      this.crouched = false;
      this.endSlide();
      this.jump('slide');
      this.tickAir(dt, input, wx, wz, hasInput);
      return;
    }

    const preSpeed = b.horizontalSpeed;
    b.vy = 0;
    b.stepHeight = PLAYER.stepHeight;
    b.move(this.world, dt);
    this.afterMove(preSpeed);

    if (!b.onGround) {
      this.endSlide();
      this.enterAir();
      return;
    }

    const slow = b.horizontalSpeed < SLIDE.endSpeed;
    const released = !input.slideHeld && this.slideTime > SLIDE.minTime;
    if (slow || released) {
      if (!input.slideHeld && b.setHeight(this.world, PLAYER.standHeight) === PLAYER.standHeight) {
        this.crouched = false;
        this.endSlide();
      } else if (slow) {
        // Held (or stuck under a low ceiling): carry on as a crouch-walk, never stuck.
        this.endSlide();
      }
    }
  }

  // ==========================================================================================
  // Wall run
  // ==========================================================================================

  private tryStartWallRun(input: PlayerInput): boolean {
    const b = this.body;
    if (this.wallCooldown > 0) return false;
    if (this.airTime < 0.04) return false;
    if (this.airWallAttaches >= WALL.maxAttachesPerAir || this.airWallTime >= WALL.maxTimePerAir) return false;
    if (input.moveY < 0.3) return false;
    const speed = b.horizontalSpeed;
    if (speed < WALL.minSpeed) return false;
    const vdx = b.vx / speed;
    const vdz = b.vz / speed;
    const ignore = this.sameWallCooldown > 0 ? this.lastWall : null;
    const wc = this.parkour.findWall(b, vdx, vdz, WALL.attachReach, ignore, true);
    if (!wc) return false;

    this.state = 'wallrun';
    this.wall = wc;
    this.wallTime = 0;
    this.wallGrace = 0;
    this.wallForwardRelease = 0;
    this.airWallAttaches++;
    this.lastWall = wc.collider;
    this.landTimer = 0;
    const run = clamp(speed, WALL.runSpeedMin, WALL.runSpeedMax);
    b.vx = wc.tx * run;
    b.vz = wc.tz * run;
    if (b.vy > 3) b.vy = 3;
    this.events.emit('wallRunStart', { side: wc.side });
    return true;
  }

  private endWallRun(jumped: boolean): void {
    this.state = 'air';
    this.wallCooldown = 0.12;
    this.sameWallCooldown = WALL.sameWallCooldown;
    this.wall = null;
    this.airTime = 0.05;
    this.events.emit('wallRunEnd', { jumped });
  }

  private tickWallRun(dt: number, input: PlayerInput, wx: number, wz: number, hasInput: boolean): void {
    const b = this.body;
    const wall = this.wall;
    if (!wall) {
      this.state = 'air';
      return;
    }
    this.wallTime += dt;
    this.airWallTime += dt;

    // Re-probe the wall along the direction of travel.
    const wc = this.parkour.findWall(b, wall.tx, wall.tz, WALL.stickReach, null, false);
    if (wc && wc.nx === wall.nx && wc.nz === wall.nz) {
      this.wall = wc;
      this.wallGrace = 0;
    } else {
      this.wallGrace += dt;
    }
    const w = this.wall ?? wall;

    this.wallForwardRelease = input.moveY < 0.1 ? this.wallForwardRelease + dt : 0;

    // --- jump off the wall ---
    if (this.jumpBuffer > 0 && this.wallTime >= WALL.attachGrace) {
      const along = Math.max(b.vx * w.tx + b.vz * w.tz, WALL.runSpeedMin);
      b.vx = w.tx * along * 0.95 + w.nx * WALL.jumpOut;
      b.vz = w.tz * along * 0.95 + w.nz * WALL.jumpOut;
      b.vy = WALL.jumpUp;
      this.jumpBuffer = 0;
      this.endWallRun(true);
      this.events.emit('jump', { kind: 'wall' });
      return;
    }

    const alongNow = b.vx * w.tx + b.vz * w.tz;
    const done =
      this.wallGrace > 0.1 ||
      this.wallTime >= WALL.maxTime ||
      this.airWallTime >= WALL.maxTimePerAir ||
      this.wallForwardRelease > 0.15 ||
      input.slideHeld ||
      alongNow < WALL.minSpeed * 0.6;
    if (done) {
      // Let go with a small push away from the wall so the player does not re-snap to it.
      b.vx += w.nx * 1.2;
      b.vz += w.nz * 1.2;
      this.endWallRun(false);
      this.tickAir(dt, input, wx, wz, hasInput);
      return;
    }

    // --- run along the wall, pressed lightly into it ---
    const run = clamp(alongNow, WALL.runSpeedMin, WALL.runSpeedMax);
    const pull = this.wallGrace > 0 ? 0 : WALL.pullSpeed;
    b.vx = w.tx * run - w.nx * pull;
    b.vz = w.tz * run - w.nz * pull;
    const k = Math.min(1, this.wallTime / WALL.maxTime);
    const gs = WALL.gravityStart + (WALL.gravityEnd - WALL.gravityStart) * k * k;
    b.vy = Math.max(-WALL.maxFallSpeed, b.vy - MOVE.gravity * gs * dt);

    b.stepHeight = 0;
    b.move(this.world, dt);

    if (b.onGround && b.vy <= 0) {
      this.endWallRun(false);
      this.land(input);
      return;
    }
    if (b.hitCeiling) {
      this.endWallRun(false);
      return;
    }
    this.footsteps(dt, true, true);
  }

  // ==========================================================================================
  // Vault / mantle
  // ==========================================================================================

  private tryAirLedge(input: PlayerInput): boolean {
    const b = this.body;
    if (this.airTime < 0.04 || !this.autoLedge) return false;
    const manual = this.vaultBuffer > 0 || (this.jumpBuffer > 0 && this.coyote <= 0 && this.airTime > 0.1);
    const auto = b.vy < 1.2 && input.moveY > 0.3;
    if (!manual && !auto) return false;
    const fx = -Math.sin(input.yaw);
    const fz = -Math.cos(input.yaw);
    const move = this.parkour.findLedge(b, fx, fz, b.horizontalSpeed, false, manual, true);
    if (!move) return false;
    if (!manual && (move.kind !== 'mantle' || move.rise < LEDGE.mantleMinRise)) return false;
    this.startScripted(move);
    return true;
  }

  private startScripted(move: ScriptedMove): void {
    const b = this.body;
    this.scripted = move;
    move.t = 0;
    this.state = 'scripted';
    this.vaultBuffer = 0;
    this.jumpBuffer = 0;
    this.crouched = false;
    b.onGround = false;
    b.ground = null;
    b.height = PLAYER.slideHeight;
    this.events.emit('scriptedStart', { kind: move.kind, rise: move.rise });
  }

  private tickScripted(dt: number): void {
    const move = this.scripted;
    const b = this.body;
    if (!move) {
      this.state = 'air';
      return;
    }
    move.t += dt;
    const u = Math.min(1, move.t / move.duration);
    const px = b.x;
    const pz = b.z;
    move.sample(u, tmp);
    b.x = tmp.x;
    b.y = tmp.y;
    b.z = tmp.z;
    // Report the curve velocity so camera / audio effects see real motion.
    b.vx = (b.x - px) / dt;
    b.vz = (b.z - pz) / dt;
    b.vy = 0;
    if (u >= 1) {
      b.vx = move.dirX * move.exitSpeed;
      b.vz = move.dirZ * move.exitSpeed;
      b.vy = move.kind === 'vault' ? -0.5 : 0;
      if (move.endCrouched) {
        b.height = PLAYER.slideHeight;
        this.crouched = true;
      } else {
        b.height = PLAYER.standHeight;
        this.crouched = false;
      }
      this.scripted = null;
      this.state = 'air';
      this.airTime = 0.06;
      this.coyote = 0;
      this.landTimer = 0.1;
      this.events.emit('scriptedEnd', { kind: move.kind });
    }
  }
}
