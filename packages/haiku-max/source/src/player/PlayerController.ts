import type { MoveInput } from '../input/InputManager';
import type { CollisionWorld } from '../world/CollisionWorld';
import { MOVE } from './MovementConfig';
import { ParkourSystem, type ScriptedPlan } from './ParkourSystem';
import { PlayerPhysics } from './PlayerPhysics';

export type MoveMode = 'ground' | 'air' | 'slide' | 'wallrun' | 'vault' | 'mantle';

/** Callbacks for moments the camera, audio and HUD care about. */
export interface MovementEvents {
  jump: () => void;
  land: (impactSpeed: number) => void;
  slideStart: () => void;
  slideEnd: () => void;
  wallRunStart: (side: 1 | -1) => void;
  scripted: (kind: 'vault' | 'mantle') => void;
  step: () => void;
}

interface Wish {
  x: number;
  z: number;
  active: boolean;
}

/** One stretch of a scripted vault or mantle, interpolated from one state to the next. */
interface Phase {
  duration: number;
  fromD: number;
  toD: number;
  fromY: number;
  toY: number;
  ease: (t: number) => number;
}

interface ScriptedMove {
  plan: ScriptedPlan;
  x0: number;
  y0: number;
  z0: number;
  dirX: number;
  dirZ: number;
  phases: Phase[];
  duration: number;
  elapsed: number;
  speedBefore: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
const easeInQuad = (t: number): number => t * t;
const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const linear = (t: number): number => t;

/**
 * Player state machine. Ground, air, slide and wall-run are driven by velocity and collision.
 * Vault and mantle are scripted paths that were validated at planning time.
 */
export class PlayerController {
  readonly physics: PlayerPhysics;
  readonly parkour: ParkourSystem;
  events: Partial<MovementEvents> = {};

  mode: MoveMode = 'air';
  /** The body is crouched (0.9 m tall). Stays true until there is headroom to stand. */
  crouched = false;
  /** Camera eye height above the feet, smoothed so crouching is not abrupt. */
  eyeHeight: number = MOVE.standEye;
  /** Feet position at the start of the latest step, used to interpolate the camera. */
  readonly prev = { x: 0, y: 0, z: 0 };
  /** Horizontal speed in m/s. */
  speed = 0;
  /** Which side a wall run is on: 1 = right, -1 = left, 0 = none. */
  wallSide: 0 | 1 | -1 = 0;
  /** -1..1, strafe intent. Used by the camera for roll. */
  strafe = 0;
  /** Set while a vault or mantle is playing, for camera and arm animation. */
  scriptKind: 'vault' | 'mantle' | null = null;
  /** Progress through the current vault or mantle, 0..1. */
  scriptProgress = 0;

  private coyote = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private slideTime = 0;
  private landingTimer = 0;
  private cutArmed = false;
  private wallId = -1;
  private wallTangent = 1;
  private wallSpeed = 0;
  private wallTime = 0;
  private wallCooldown = 0;
  private readonly wallUsed = new Set<number>();
  private script: ScriptedMove | null = null;
  private stepDistance = 0;

  constructor(world: CollisionWorld) {
    this.physics = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(world);
  }

  /** Feet position, read by the camera and the game loop. */
  get pos(): { x: number; y: number; z: number } {
    return this.physics.pos;
  }

  /** Puts the player at a spawn point with no momentum. */
  reset(x: number, y: number, z: number): void {
    this.physics.teleport(x, y, z);
    this.physics.height = MOVE.standHeight;
    this.crouched = false;
    this.eyeHeight = MOVE.standEye;
    this.mode = this.physics.probeGround() ? 'ground' : 'air';
    this.speed = 0;
    this.wallSide = 0;
    this.wallUsed.clear();
    this.wallCooldown = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.slideBuffer = 0;
    this.landingTimer = 0;
    this.cutArmed = false;
    this.script = null;
    this.scriptKind = null;
    this.scriptProgress = 0;
    this.stepDistance = 0;
    this.setPrevious();
  }

  /** Advances the player by one fixed step. */
  tick(dt: number, input: MoveInput, yaw: number): void {
    this.setPrevious();
    this.coyote -= dt;
    this.jumpBuffer -= dt;
    this.slideBuffer -= dt;
    this.landingTimer -= dt;
    this.wallCooldown -= dt;
    if (input.jumpPressed) this.jumpBuffer = MOVE.jumpBuffer;
    if (input.slidePressed) this.slideBuffer = MOVE.slideBuffer;
    this.strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (this.script) {
      this.updateScript(dt);
      return;
    }

    if (input.vaultPressed && (this.mode === 'ground' || this.mode === 'air') && this.tryVault(yaw)) {
      return;
    }

    const wish = this.wishDirection(input, yaw);

    if (this.mode === 'wallrun' && this.jumpBuffer > 0) {
      this.wallJump();
    } else if (this.jumpBuffer > 0 && this.canJump()) {
      this.jump();
    } else if (this.slideBuffer > 0 && this.mode === 'ground' && this.physics.grounded && this.speed >= MOVE.slideMinSpeed) {
      this.startSlide();
    }

    switch (this.mode) {
      case 'ground':
        this.groundMove(dt, wish, input.sprint);
        break;
      case 'slide':
        this.slideMove(dt);
        break;
      case 'air':
        this.airMove(dt, wish);
        break;
      case 'wallrun':
        this.wallRunMove(dt);
        break;
      default:
        break;
    }

    this.applyVariableJump(input);
    this.updateCrouch();

    const impactSpeed = Math.max(0, -this.physics.vel.y);
    this.physics.integrate(dt);
    this.afterMove(dt, impactSpeed);
  }

  private setPrevious(): void {
    this.prev.x = this.physics.pos.x;
    this.prev.y = this.physics.pos.y;
    this.prev.z = this.physics.pos.z;
  }

  private wishDirection(input: MoveInput, yaw: number): Wish {
    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    let x = -sin * forward + cos * strafe;
    let z = -cos * forward - sin * strafe;
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    return { x, z, active: len > 0 };
  }

  private groundMove(dt: number, wish: Wish, sprinting: boolean): void {
    const v = this.physics.vel;
    const targetSpeed = this.crouched ? MOVE.crouchWalkSpeed : sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed;

    if (wish.active) {
      const accel = this.landingTimer > 0 ? MOVE.groundAccel * 0.5 : MOVE.groundAccel;
      const along = v.x * wish.x + v.z * wish.z;
      if (along < targetSpeed) {
        const add = Math.min(accel * dt, targetSpeed - along);
        v.x += wish.x * add;
        v.z += wish.z * add;
      } else {
        // Above the cap, from a slide or wall run: bleed off slowly so momentum survives.
        const bleed = Math.min(along - targetSpeed, MOVE.overspeedBleed * dt);
        v.x -= wish.x * bleed;
        v.z -= wish.z * bleed;
      }
      // Grip removes sideways drift so turns stay responsive.
      const alongNow = v.x * wish.x + v.z * wish.z;
      const perpX = v.x - wish.x * alongNow;
      const perpZ = v.z - wish.z * alongNow;
      const grip = Math.min(1, MOVE.lateralGrip * dt);
      v.x -= perpX * grip;
      v.z -= perpZ * grip;
    } else {
      this.applyFriction(MOVE.groundFriction * dt);
    }

    v.y = Math.max(v.y - MOVE.gravity * dt, -MOVE.maxFallSpeed);
  }

  private airMove(dt: number, wish: Wish): void {
    const v = this.physics.vel;
    if (wish.active) {
      // Steering only adds speed up to a cap. Existing momentum is never removed.
      const along = v.x * wish.x + v.z * wish.z;
      if (along < MOVE.airSteerCap) {
        const add = Math.min(MOVE.airAccel * dt, MOVE.airSteerCap - along);
        v.x += wish.x * add;
        v.z += wish.z * add;
      }
    }
    v.y = Math.max(v.y - MOVE.gravity * dt, -MOVE.maxFallSpeed);
  }

  private applyFriction(amount: number): void {
    const v = this.physics.vel;
    const speed = Math.hypot(v.x, v.z);
    if (speed <= 0) return;
    const next = Math.max(0, speed - amount);
    const k = next / speed;
    v.x *= k;
    v.z *= k;
  }

  private canJump(): boolean {
    switch (this.mode) {
      case 'ground':
        return this.crouched ? this.physics.canStandAt(MOVE.standHeight) : true;
      case 'slide':
        // Jumping out of a slide needs headroom to stand up first.
        return this.physics.canStandAt(MOVE.standHeight);
      case 'air':
        return this.coyote > 0;
      default:
        return false;
    }
  }

  private jump(): void {
    if (this.mode === 'slide') this.endSlide();
    this.mode = 'air';
    this.crouched = false;
    this.physics.height = MOVE.standHeight;
    this.physics.vel.y = MOVE.jumpSpeed;
    this.physics.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.cutArmed = true;
    this.events.jump?.();
  }

  /** Releasing jump early shortens the arc. Holding it gives the full apex. */
  private applyVariableJump(input: MoveInput): void {
    if (!this.cutArmed) return;
    const v = this.physics.vel;
    if (v.y <= 0) {
      this.cutArmed = false;
    } else if (!input.jumpHeld) {
      v.y *= MOVE.jumpCut;
      this.cutArmed = false;
    }
  }

  private startSlide(): void {
    this.mode = 'slide';
    this.crouched = true;
    this.physics.height = MOVE.crouchHeight;
    this.slideTime = 0;
    this.slideBuffer = 0;
    this.events.slideStart?.();
  }

  /** Momentum carries through the slide. Friction bleeds the speed off gradually. */
  private slideMove(dt: number): void {
    const before = Math.hypot(this.physics.vel.x, this.physics.vel.z);
    this.applyFriction(MOVE.slideFriction * dt);
    const after = Math.hypot(this.physics.vel.x, this.physics.vel.z);
    this.physics.vel.y = Math.max(this.physics.vel.y - MOVE.gravity * dt, -MOVE.maxFallSpeed);
    this.slideTime += dt;
    if (after < MOVE.slideEndSpeed || this.slideTime > MOVE.slideMaxTime || before <= 0) this.endSlide();
  }

  private endSlide(): void {
    if (this.mode !== 'slide') return;
    this.mode = 'ground';
    this.events.slideEnd?.();
  }

  /** Stands up when there is headroom. Otherwise the body stays low and keeps moving slowly. */
  private updateCrouch(): void {
    if (this.mode === 'slide') {
      this.crouched = true;
    } else if (this.crouched && this.physics.canStandAt(MOVE.standHeight)) {
      this.crouched = false;
    }
    this.physics.height = this.crouched ? MOVE.crouchHeight : MOVE.standHeight;
  }

  private wallRunMove(dt: number): void {
    const v = this.physics.vel;
    const p = this.physics.pos;
    this.wallTime += dt;

    const wall = this.parkour.findWall(p.x, p.y, p.z, this.physics.height, this.wallSide as 1 | -1);
    if (!wall || wall.id !== this.wallId || this.wallTime > MOVE.wallMaxTime) {
      this.endWallRun();
      return;
    }

    // Run along the wall, pressed gently into it so contact is kept.
    this.wallSpeed = Math.max(MOVE.wallMinSpeed, this.wallSpeed - MOVE.wallDecay * dt);
    v.z = this.wallTangent * this.wallSpeed;
    v.x = this.wallSide * MOVE.wallStick;

    // Reduced gravity, with vertical speed pulled toward zero so the runner holds height.
    v.y -= MOVE.gravity * MOVE.wallGravity * dt;
    v.y += -v.y * Math.min(1, MOVE.wallHoverDamp * dt);
  }

  private tryLatchWall(): void {
    if (this.wallCooldown > 0) return;
    const p = this.physics.pos;
    const v = this.physics.vel;
    const speed = Math.hypot(v.x, v.z);
    if (speed < MOVE.wallMinSpeed) return;

    for (const side of [1, -1] as const) {
      const wall = this.parkour.findWall(p.x, p.y, p.z, this.physics.height, side);
      if (!wall || this.wallUsed.has(wall.id)) continue;
      // Only runs that travel mostly along the wall latch on, within about 40° of its face.
      if (Math.abs(v.x) > 0.643 * speed) continue;

      this.wallId = wall.id;
      this.wallSide = side;
      this.wallTangent = v.z >= 0 ? 1 : -1;
      this.wallSpeed = speed;
      this.wallTime = 0;
      this.wallUsed.add(wall.id);
      this.mode = 'wallrun';
      this.cutArmed = false;
      this.events.wallRunStart?.(side);
      return;
    }
  }

  private wallJump(): void {
    const v = this.physics.vel;
    v.y = MOVE.wallJumpUp;
    v.x = -this.wallSide * MOVE.wallJumpOut;
    v.z = this.wallTangent * this.wallSpeed * 0.8;
    this.endWallRun(MOVE.wallCooldown);
    this.jumpBuffer = 0;
    this.cutArmed = true;
    this.events.jump?.();
  }

  private endWallRun(cooldown = 0): void {
    if (this.mode !== 'wallrun') return;
    this.mode = 'air';
    this.wallSide = 0;
    this.wallCooldown = cooldown;
  }

  private land(impactSpeed: number): void {
    if (this.mode === 'wallrun') this.endWallRun();
    this.mode = 'ground';
    this.coyote = 0;
    this.wallUsed.clear();
    this.landingTimer = MOVE.landingControl;
    if (impactSpeed > MOVE.hardLandingSpeed) {
      const keep = 1 - MOVE.landingLoss;
      this.physics.vel.x *= keep;
      this.physics.vel.z *= keep;
    }
    this.events.land?.(impactSpeed);
  }

  /** Ground and air transitions, wall latching and auto-mantle, all evaluated after movement. */
  private afterMove(dt: number, impactSpeed: number): void {
    const grounded = this.physics.probeGround();

    if (grounded) {
      if (this.mode === 'air' || this.mode === 'wallrun') this.land(impactSpeed);
    } else if (this.mode === 'ground') {
      this.mode = 'air';
      this.coyote = MOVE.coyoteTime;
    } else if (this.mode === 'slide') {
      this.endSlide();
      this.mode = 'air';
      this.coyote = 0;
    }

    if (this.mode === 'air') {
      this.tryLatchWall();
    }
    if (this.mode === 'air') {
      this.tryAutoMantle();
    }

    const targetEye = this.crouched ? MOVE.crouchEye : MOVE.standEye;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, MOVE.eyeLerp * dt);

    const v = this.physics.vel;
    this.speed = Math.hypot(v.x, v.z);

    if (this.mode === 'ground' && this.physics.grounded && this.speed > 1) {
      this.stepDistance += this.speed * dt;
      const stride = this.speed > MOVE.walkSpeed + 0.5 ? 2.2 : 1.8;
      if (this.stepDistance >= stride) {
        this.stepDistance -= stride;
        this.events.step?.();
      }
    } else {
      this.stepDistance = 0;
    }
  }

  private actionDirection(yaw: number): { x: number; z: number } {
    const v = this.physics.vel;
    const speed = Math.hypot(v.x, v.z);
    if (speed > 1.5) return { x: v.x / speed, z: v.z / speed };
    // Standing still, vault in the direction the player is looking.
    return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  }

  private tryVault(yaw: number): boolean {
    const dir = this.actionDirection(yaw);
    const p = this.physics.pos;
    const plan = this.parkour.findVault(p.x, p.y, p.z, dir.x, dir.z);
    if (!plan) return false;
    this.startScript(plan, dir.x, dir.z);
    return true;
  }

  /** True when pressing vault now would start a vault. Used for the HUD hint. */
  canVaultNow(yaw: number): boolean {
    if (this.script || (this.mode !== 'ground' && this.mode !== 'air')) return false;
    const dir = this.actionDirection(yaw);
    const p = this.physics.pos;
    return this.parkour.findVault(p.x, p.y, p.z, dir.x, dir.z) !== null;
  }

  /** While airborne and moving into a ledge that is just above the feet, pull the body up onto it. */
  private tryAutoMantle(): void {
    const v = this.physics.vel;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1.5 || v.y > 2.5) return;
    const dirX = v.x / speed;
    const dirZ = v.z / speed;
    const p = this.physics.pos;
    const plan = this.parkour.findMantle(p.x, p.y, p.z, dirX, dirZ);
    if (plan) this.startScript(plan, dirX, dirZ);
  }

  /** Starts a scripted vault or mantle along the given horizontal direction. */
  private startScript(plan: ScriptedPlan, dirX: number, dirZ: number): void {
    const p = this.physics.pos;
    const speedBefore = Math.hypot(this.physics.vel.x, this.physics.vel.z);
    const phases =
      plan.kind === 'vault' ? this.vaultPhases(plan, speedBefore, p.y) : this.mantlePhases(plan, p.y);
    const duration = phases.reduce((sum, phase) => sum + phase.duration, 0);

    this.script = {
      plan,
      x0: p.x,
      y0: p.y,
      z0: p.z,
      dirX,
      dirZ,
      phases,
      duration,
      elapsed: 0,
      speedBefore,
    };
    this.mode = plan.kind;
    this.scriptKind = plan.kind;
    this.scriptProgress = 0;
    this.wallSide = 0;
    this.physics.vel.x = 0;
    this.physics.vel.y = 0;
    this.physics.vel.z = 0;
    this.physics.grounded = false;
    this.events.scripted?.(plan.kind);
  }

  /** Rise at the face, travel over the top, then drop onto the landing. */
  private vaultPhases(plan: ScriptedPlan, speed: number, y0: number): Phase[] {
    const clearY = plan.topY + 0.06;
    const overDuration = Math.min(0.28, Math.max(0.12, (plan.dClear - plan.dFace) / Math.max(speed, 7)));
    return [
      { duration: 0.13, fromD: 0, toD: plan.dFace, fromY: y0, toY: clearY, ease: easeOutQuad },
      { duration: overDuration, fromD: plan.dFace, toD: plan.dClear, fromY: clearY, toY: clearY, ease: linear },
      { duration: 0.16, fromD: plan.dClear, toD: plan.dLand, fromY: clearY, toY: plan.landY, ease: easeInQuad },
    ];
  }

  /** Pull up at the ledge face, then move onto the top. */
  private mantlePhases(plan: ScriptedPlan, y0: number): Phase[] {
    const topY = plan.topY + 0.01;
    return [
      { duration: 0.14, fromD: 0, toD: plan.dFace, fromY: y0, toY: topY, ease: easeOutQuad },
      { duration: 0.22, fromD: plan.dFace, toD: plan.dLand, fromY: topY, toY: plan.landY, ease: easeInOutQuad },
    ];
  }

  private updateScript(dt: number): void {
    const s = this.script;
    if (!s) return;

    s.elapsed += dt;
    let remaining = s.elapsed;
    let d = 0;
    let y = s.y0;
    let finished = true;

    for (const phase of s.phases) {
      if (remaining < phase.duration) {
        const eased = phase.ease(remaining / phase.duration);
        d = lerp(phase.fromD, phase.toD, eased);
        y = lerp(phase.fromY, phase.toY, eased);
        finished = false;
        break;
      }
      remaining -= phase.duration;
      d = phase.toD;
      y = phase.toY;
    }

    const p = this.physics.pos;
    p.x = s.x0 + s.dirX * d;
    p.z = s.z0 + s.dirZ * d;
    p.y = y;
    this.speed = s.speedBefore;
    this.scriptProgress = Math.min(1, s.elapsed / s.duration);

    if (finished) this.finishScript();
  }

  private finishScript(): void {
    const s = this.script;
    if (!s) return;
    const plan = s.plan;
    const p = this.physics.pos;
    p.x = s.x0 + s.dirX * plan.dLand;
    p.z = s.z0 + s.dirZ * plan.dLand;
    p.y = plan.landY;

    // Keep most of the run speed through a vault, and some through a mantle.
    const keep = plan.kind === 'vault' ? 0.9 : 0.6;
    const v = this.physics.vel;
    v.x = s.dirX * s.speedBefore * keep;
    v.z = s.dirZ * s.speedBefore * keep;
    v.y = 0;

    this.script = null;
    this.scriptKind = null;
    this.scriptProgress = 0;
    this.coyote = 0;
    this.mode = this.physics.probeGround() ? 'ground' : 'air';
    if (this.mode === 'air') this.coyote = MOVE.coyoteTime;
    this.speed = Math.hypot(v.x, v.z);
  }
}
