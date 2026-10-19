import { CollisionWorld } from '../world/CollisionWorld';
import {
  AIR_ACCEL,
  COYOTE,
  EYE_SLIDE,
  EYE_STAND,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_SPEED,
  PERP_FRICTION,
  RADIUS,
  SPRINT_BLEED,
  SPRINT_SPEED,
  STAND_HEIGHT,
  WALK_SPEED,
} from './constants';
import {
  endSlide,
  horizontalDir,
  stickWall,
  tickKinematic,
  tickSlide,
  tickWall,
  tryMantle,
  trySlide,
  tryVault,
  tryWall,
  wallJump,
} from './ParkourSystem';
import { accelerate, applyFriction, bleedTo, shedLateral } from './PlayerPhysics';
import type { ParkourMode, PlayerInput, SpawnPoint } from './types';

/** Feet-origin player. Physics step is fixed-timestep and three-free. */
export class PlayerController {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  radius = RADIUS;
  height = STAND_HEIGHT;
  grounded = false;
  state: ParkourMode = 'ground';
  coyote = 0;
  jumpBuffer = 0;
  jumpLock = 0;
  jumpWasHeld = false;
  eye = EYE_STAND;
  stepCycle = 0;
  stepArmed = 0;
  landDip = 0;
  actionBlend = 0;
  horizontalSpeed = 0;
  slideTime = 0;
  slideSpeed = 0;
  slideDirX = 1;
  slideDirZ = 0;
  slideLatch = false;
  wallTime = 0;
  wallSpeed = 0;
  wallNx = 0;
  wallNz = 1;
  wallDirX = 1;
  wallDirZ = 0;
  wallId = -1;
  lastWallId = -1;
  wallCooldown = 0;
  kinT = 0;
  kinDur = 0.4;
  kinKind: 'vault' | 'mantle' = 'vault';
  kinSx = 0;
  kinSy = 0;
  kinSz = 0;
  kinEx = 0;
  kinEy = 0;
  kinEz = 0;
  kinPeak = 0;
  kinDirX = 1;
  kinDirZ = 0;
  kinSpeed = 0;
  spawnYaw = -Math.PI / 2;

  onJump?: () => void;
  onLand?: (impact: number) => void;
  onStep?: (speed: number) => void;
  onSlide?: (active: boolean) => void;
  onWall?: (active: boolean) => void;
  onVault?: () => void;
  onMantle?: () => void;

  constructor(readonly world: CollisionWorld) {}

  reset(spawn: SpawnPoint): void {
    this.x = spawn.x;
    this.y = spawn.y;
    this.z = spawn.z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.height = STAND_HEIGHT;
    this.grounded = true;
    this.state = 'ground';
    this.coyote = COYOTE;
    this.jumpBuffer = 0;
    this.jumpLock = 0.05;
    this.jumpWasHeld = false;
    this.eye = EYE_STAND;
    this.landDip = 0;
    this.actionBlend = 0;
    this.slideTime = 0;
    this.slideSpeed = 0;
    this.slideLatch = false;
    this.wallTime = 0;
    this.wallCooldown = 0;
    this.wallId = -1;
    this.lastWallId = -1;
    this.kinT = 0;
    this.spawnYaw = spawn.yaw;
    this.horizontalSpeed = 0;
  }

  update(dt: number, input: PlayerInput, fwdX: number, fwdZ: number, rightX: number, rightZ: number): void {
    this.jumpLock = Math.max(0, this.jumpLock - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    if (input.jumpPressed) this.jumpBuffer = JUMP_BUFFER;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (!input.slide) this.slideLatch = false;

    if (this.state === 'vault' || this.state === 'mantle') {
      tickKinematic(this, dt);
      this.finishPost(dt);
      return;
    }

    const wish = this.wish(input, fwdX, fwdZ, rightX, rightZ);
    const sprinting = input.sprint || input.slide;

    if (this.state === 'wallrun') {
      if (this.jumpBuffer > 0) wallJump(this);
      if (this.state === 'wallrun') tickWall(this, dt);
    } else if (this.state === 'slide') {
      tickSlide(this, input, rightX, rightZ, dt);
    } else if (this.grounded) {
      let v = { vx: this.vx, vz: this.vz };
      if (!sprinting) v = bleedTo(v.vx, v.vz, WALK_SPEED, SPRINT_BLEED, dt);
      if (wish.len > 0.01) {
        v = accelerate(v.vx, v.vz, wish.x, wish.z, sprinting ? SPRINT_SPEED : WALK_SPEED, GROUND_ACCEL, dt);
        v = shedLateral(v.vx, v.vz, wish.x, wish.z, PERP_FRICTION, dt);
      } else {
        v = applyFriction(v.vx, v.vz, GROUND_FRICTION, dt);
      }
      this.vx = v.vx;
      this.vz = v.vz;
      this.vy = 0;
    } else {
      if (wish.len > 0.01) {
        const v = accelerate(this.vx, this.vz, wish.x, wish.z, SPRINT_SPEED, AIR_ACCEL, dt);
        this.vx = v.vx;
        this.vz = v.vz;
      }
      this.vy -= GRAVITY * dt;
    }

    if (this.jumpWasHeld && !input.jump && this.vy > 0 && this.state !== 'wallrun') {
      this.vy *= JUMP_CUT;
    }
    this.jumpWasHeld = input.jump;

    const canGroundJump =
      this.state !== 'wallrun' &&
      this.jumpBuffer > 0 &&
      this.jumpLock <= 0 &&
      (this.grounded || this.coyote > 0);
    if (canGroundJump) {
      if (this.state === 'slide') {
        const room = !this.world.blocked(this.x, this.y + 0.02, this.z, this.radius * 0.9, 1.15);
        if (room) {
          endSlide(this);
          this.doJump();
        }
      } else {
        this.doJump();
      }
    }

    const wasAir = !this.grounded;
    const fallSpeed = this.vy;
    const sticking = this.state === 'wallrun';
    this.world.move(this, dt);
    if (sticking && this.state === 'wallrun') stickWall(this);

    if (this.state === 'wallrun') {
      this.grounded = false;
      this.coyote = 0;
    } else if (this.vy <= 0 && this.jumpLock <= 0) {
      const support = this.world.support(this.x, this.y, this.z, this.grounded ? 0.22 : 0.16);
      if (support !== null) {
        this.y = support;
        this.vy = 0;
        this.grounded = true;
        this.coyote = COYOTE;
      } else {
        this.grounded = false;
        this.coyote = Math.max(0, this.coyote - dt);
      }
    } else {
      this.grounded = false;
      this.coyote = Math.max(0, this.coyote - dt);
    }

    if (this.grounded && wasAir && this.state !== 'slide') {
      this.state = 'ground';
      const impact = -fallSpeed;
      if (impact > 3.2) {
        this.landDip = Math.min(0.11, impact * 0.01);
        this.onLand?.(impact);
      }
    } else if (!this.grounded && this.state === 'ground') {
      this.state = 'air';
    } else if (this.grounded && this.state === 'air') {
      this.state = 'ground';
    }

    if (input.vaultPressed) {
      const dir = horizontalDir(this, fwdX, fwdZ);
      tryVault(this, dir.x, dir.z);
    }
    if (this.state === 'air') tryMantle(this);
    if (this.state === 'air') tryWall(this);
    if (this.state === 'ground' || this.state === 'air') trySlide(this, input);

    this.finishPost(dt);
  }

  private doJump(): void {
    this.vy = JUMP_SPEED;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpLock = 0.1;
    this.jumpWasHeld = true;
    this.state = 'air';
    this.onJump?.();
  }

  private wish(
    input: PlayerInput,
    fwdX: number,
    fwdZ: number,
    rightX: number,
    rightZ: number,
  ): { x: number; z: number; len: number } {
    let x = fwdX * input.forward + rightX * input.strafe;
    let z = fwdZ * input.forward + rightZ * input.strafe;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
      return { x, z, len: 1 };
    }
    if (len > 0.001) return { x: x / len, z: z / len, len };
    return { x: 0, z: 0, len: 0 };
  }

  private finishPost(dt: number): void {
    this.horizontalSpeed = Math.hypot(this.vx, this.vz);
    const targetEye = this.height < 1.1 ? EYE_SLIDE : EYE_STAND;
    const eyeRate = 1 - Math.exp(-12 * dt);
    this.eye += (targetEye - this.eye) * eyeRate;
    this.landDip *= Math.max(0, 1 - 8 * dt);
    if (this.grounded && this.state !== 'slide' && this.horizontalSpeed > 2.1) {
      this.stepCycle += this.horizontalSpeed * dt * 0.92;
      if (this.stepCycle - this.stepArmed > Math.PI) {
        this.stepArmed = this.stepCycle;
        this.onStep?.(this.horizontalSpeed);
      }
    }
  }
}
