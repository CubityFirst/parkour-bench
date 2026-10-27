import * as THREE from 'three';
import { CollisionWorld } from '../world/CollisionWorld';
import { ParkourSystem, type WallContact } from './ParkourSystem';
import { PLAYER, PlayerPhysics } from './PlayerPhysics';

export type PlayerState = 'ground' | 'air' | 'slide' | 'wallrun' | 'vault' | 'mantle';

/** Input sampled once per fixed physics step. */
export interface InputSnapshot {
  /** -1..1, positive = forward */
  forward: number;
  /** -1..1, positive = right */
  right: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  slideHeld: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
}

export const EMPTY_INPUT: InputSnapshot = {
  forward: 0,
  right: 0,
  sprint: false,
  jumpHeld: false,
  jumpPressed: false,
  slideHeld: false,
  slidePressed: false,
  vaultPressed: false,
};

/** Hooks for audio, camera and body animation. */
export interface PlayerEvents {
  jump?(kind: 'ground' | 'slide' | 'wall'): void;
  land?(impact: number): void;
  footstep?(speed: number): void;
  slideStart?(): void;
  slideEnd?(): void;
  vault?(): void;
  mantle?(): void;
  wallRunStart?(side: number): void;
  wallRunEnd?(): void;
}

interface MoveAnimation {
  kind: 'vault' | 'mantle';
  from: THREE.Vector3;
  to: THREE.Vector3;
  top: number;
  t: number;
  duration: number;
  dir: THREE.Vector3;
  exitSpeed: number;
  crouchAtEnd: boolean;
}

interface ActiveWallRun {
  wall: WallContact;
  /** Direction of travel along the wall, fixed when the run starts. */
  tangent: THREE.Vector3;
  /** +1 wall on the right, -1 wall on the left */
  side: number;
  time: number;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();

function rotateToward(dx: number, dz: number, tx: number, tz: number, maxAngle: number): [number, number] {
  const a = Math.atan2(dz, dx);
  const b = Math.atan2(tz, tx);
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-maxAngle, Math.min(maxAngle, diff));
  const na = a + step;
  return [Math.cos(na), Math.sin(na)];
}

/**
 * First-person parkour controller.
 *
 * A small state machine (ground / air / slide / wallrun / vault / mantle) driven
 * by a fixed timestep. Positions are the centre of the player's feet.
 */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  state: PlayerState = 'air';
  /** Current collision height. */
  height: number = PLAYER.standHeight;
  crouched = false;
  yaw = 0;

  /** Accumulated stride phase for footsteps and head bob (radians, π per step). */
  bobPhase = 0;
  /** Vertical distance gained by step-ups since the camera last read it. */
  pendingStepUp = 0;
  airTime = 0;
  wallRun: ActiveWallRun | null = null;
  anim: MoveAnimation | null = null;
  /** Normalised 0..1 progress of the current vault/mantle (for camera and arms). */
  animProgress = 0;

  readonly physics: PlayerPhysics;
  readonly parkour: ParkourSystem;

  private coyote = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private vaultBuffer = 0;
  private slideCooldown = 0;
  private slideTime = 0;
  private wallRunCooldown = 0;
  private jumpCutAvailable = false;
  private usedWalls = new Set<string>();

  constructor(world: CollisionWorld, private readonly events: PlayerEvents = {}) {
    this.physics = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(this.physics);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get grounded(): boolean {
    return this.state === 'ground' || this.state === 'slide';
  }

  get sliding(): boolean {
    return this.state === 'slide';
  }

  /** Eye height the camera should ease toward. */
  get eyeHeightTarget(): number {
    if (this.state === 'vault') return PLAYER.eyeStand - 0.3;
    if (this.state === 'mantle') return PLAYER.eyeStand - 0.2;
    return this.crouched ? PLAYER.eyeCrouch : PLAYER.eyeStand;
  }

  reset(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position);
    this.prevPosition.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.state = 'air';
    this.height = PLAYER.standHeight;
    this.crouched = false;
    this.wallRun = null;
    this.anim = null;
    this.animProgress = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.slideBuffer = 0;
    this.vaultBuffer = 0;
    this.slideCooldown = 0;
    this.slideTime = 0;
    this.wallRunCooldown = 0;
    this.jumpCutAvailable = false;
    this.usedWalls.clear();
    this.airTime = 0;
    this.pendingStepUp = 0;
  }

  /** Advances the simulation by one fixed step. */
  fixedUpdate(dt: number, input: InputSnapshot, yaw: number): void {
    this.prevPosition.copy(this.position);
    this.yaw = yaw;

    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _wish.set(0, 0, 0).addScaledVector(_fwd, input.forward).addScaledVector(_right, input.right);
    if (_wish.lengthSq() > 1) _wish.normalize();

    // Input buffers make jumps/slides/vaults pressed slightly early still count.
    this.jumpBuffer = input.jumpPressed ? PLAYER.jumpBufferTime : this.jumpBuffer - dt;
    this.slideBuffer = input.slidePressed ? PLAYER.slideBufferTime : this.slideBuffer - dt;
    this.vaultBuffer = input.vaultPressed ? PLAYER.vaultBufferTime : this.vaultBuffer - dt;
    this.slideCooldown -= dt;
    this.wallRunCooldown -= dt;

    // Variable jump height: releasing jump early cuts the ascent.
    if (this.jumpCutAvailable) {
      if (this.velocity.y <= 0) this.jumpCutAvailable = false;
      else if (!input.jumpHeld) {
        this.velocity.y *= PLAYER.jumpCutFactor;
        this.jumpCutAvailable = false;
      }
    }

    switch (this.state) {
      case 'vault':
      case 'mantle':
        this.updateAnimation(dt, input);
        break;
      case 'wallrun':
        this.updateWallRun(dt, input);
        break;
      case 'slide':
        this.updateSlide(dt, input);
        break;
      default:
        this.updateGroundAir(dt, input);
    }
  }

  // ---------------------------------------------------------------------------
  // Ground & air
  // ---------------------------------------------------------------------------

  private updateGroundAir(dt: number, input: InputSnapshot): void {
    const onGround = this.state === 'ground';

    // E: vault over low obstacles, or climb onto chest-high ledges.
    if (this.vaultBuffer > 0 && !this.crouched) {
      const vault = this.parkour.findVault(this.position, _fwd);
      if (vault) {
        this.startVault(vault.top, vault.target, vault.crouchAtEnd);
        return;
      }
      if (onGround) {
        const m = this.parkour.findMantle(this.position, _fwd, PLAYER.groundMantleMinReach, PLAYER.groundMantleMaxReach);
        if (m) {
          this.startMantle(m.top, m.target, m.crouchAtEnd);
          return;
        }
      }
    }

    if (onGround && this.slideBuffer > 0 && this.slideCooldown <= 0 && this.horizontalSpeed >= PLAYER.slideMinStartSpeed) {
      this.startSlide();
      this.updateSlide(dt, input);
      return;
    }

    if (this.jumpBuffer > 0 && (onGround || this.coyote > 0) && this.tryStand()) {
      this.doJump('ground');
    }

    // Crouch (holding slide while slow) – stand back up only when there is headroom.
    if (this.state === 'ground' && input.slideHeld) this.setCrouch(true);
    else if (this.crouched) this.tryStand();

    if (this.state === 'ground') this.groundMove(dt, input);
    else this.airMove(dt);

    this.integrate(dt, input);
  }

  private groundMove(dt: number, input: InputSnapshot): void {
    const maxSpeed = this.crouched ? PLAYER.crouchSpeed : input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    let vx = this.velocity.x;
    let vz = this.velocity.z;
    let speed = Math.hypot(vx, vz);
    const wishLen = _wish.length();

    if (wishLen > 0.01) {
      const wx = _wish.x / wishLen;
      const wz = _wish.z / wishLen;
      const target = maxSpeed * Math.min(1, wishLen);
      let dx = speed > 0.01 ? vx / speed : wx;
      let dz = speed > 0.01 ? vz / speed : wz;
      const dot = dx * wx + dz * wz;

      if (speed < 0.6) {
        dx = wx;
        dz = wz;
      } else if (dot < -0.65) {
        // Reversing direction: brake hard first.
        speed = Math.max(0, speed - PLAYER.groundFriction * dt);
        if (speed < 0.6) {
          dx = wx;
          dz = wz;
        }
      } else {
        // Quick but not instant turning keeps momentum readable.
        [dx, dz] = rotateToward(dx, dz, wx, wz, 13 * dt);
      }

      if (dot >= -0.65) {
        if (speed < target) {
          // Acceleration tapers near top speed for a smooth build-up.
          const accel = PLAYER.groundAccel * (1 - 0.6 * Math.min(1, speed / PLAYER.sprintSpeed));
          speed = Math.min(target, speed + accel * dt);
        } else {
          // Above the cap (after slides / wall jumps): conserve momentum, bleed it slowly.
          speed = Math.max(target, speed - PLAYER.overspeedDecay * dt);
        }
      }
      vx = dx * speed;
      vz = dz * speed;
    } else {
      speed = Math.max(0, speed - PLAYER.groundFriction * dt);
      const s = Math.hypot(vx, vz);
      if (s > 0) {
        vx = (vx / s) * speed;
        vz = (vz / s) * speed;
      }
    }
    this.velocity.x = vx;
    this.velocity.z = vz;
  }

  /** Limited air control: steer, but never gain speed beyond what you took off with. */
  private airMove(dt: number): void {
    const wishLen = _wish.length();
    if (wishLen < 0.01) return;
    const speed = this.horizontalSpeed;
    const cap = Math.max(speed, 6);
    let vx = this.velocity.x + _wish.x * PLAYER.airAccel * dt;
    let vz = this.velocity.z + _wish.z * PLAYER.airAccel * dt;
    const ns = Math.hypot(vx, vz);
    if (ns > cap) {
      vx = (vx / ns) * cap;
      vz = (vz / ns) * cap;
    }
    this.velocity.x = vx;
    this.velocity.z = vz;
  }

  /** Applies gravity, moves through the world and resolves ground/air transitions. */
  private integrate(dt: number, input: InputSnapshot): void {
    this.velocity.y = Math.max(this.velocity.y - PLAYER.gravity * dt, -PLAYER.maxFallSpeed);
    const fallSpeed = -this.velocity.y;
    const wasGround = this.state === 'ground' || this.state === 'slide';
    const step = wasGround ? PLAYER.stepHeight : PLAYER.airStepHeight;
    const res = this.physics.move(this.position, this.velocity, dt, this.height, step);
    if (res.stepped > 0) this.pendingStepUp += res.stepped;

    if (res.grounded) {
      if (!wasGround) this.land(fallSpeed, input);
      else if (this.state !== 'slide') this.state = 'ground';
      this.coyote = PLAYER.coyoteTime;
      this.airTime = 0;
      this.usedWalls.clear();
    } else {
      if (wasGround) {
        // Walked or slid off an edge.
        if (this.state === 'slide') this.endSlide(false);
        this.state = 'air';
        this.tryStand();
      }
      this.coyote -= dt;
      this.airTime += dt;
    }

    if (this.state === 'ground') this.advanceStride(dt, input.sprint ? 2.25 : 1.85);

    if (this.state === 'air') {
      if (this.tryStartWallRun(input)) return;
      if (input.forward > 0.2 && this.velocity.y < 7) {
        const m = this.parkour.findMantle(this.position, _fwd, PLAYER.mantleMinReach, PLAYER.mantleMaxReach);
        if (m) this.startMantle(m.top, m.target, m.crouchAtEnd);
      }
    }
  }

  private land(impact: number, input: InputSnapshot): void {
    this.state = 'ground';
    this.events.land?.(impact);
    // Hard landings scrub a little speed; soft ones keep the flow going.
    if (impact > 13) {
      const k = impact > 18 ? 0.75 : 0.88;
      this.velocity.x *= k;
      this.velocity.z *= k;
    }
    // Slide straight out of a landing if the player is holding / just pressed slide.
    const wantSlide = this.slideBuffer > 0 || (input.slideHeld && this.horizontalSpeed > 7);
    if (wantSlide && this.slideCooldown <= 0 && this.horizontalSpeed >= PLAYER.slideMinStartSpeed) this.startSlide();
  }

  private doJump(kind: 'ground' | 'slide'): void {
    this.velocity.y = PLAYER.jumpSpeed;
    this.state = 'air';
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCutAvailable = true;
    this.events.jump?.(kind);
  }

  private advanceStride(dt: number, strideLength: number): void {
    const speed = this.horizontalSpeed;
    if (speed < 0.5) return;
    const before = Math.floor(this.bobPhase / Math.PI);
    this.bobPhase += (speed / strideLength) * Math.PI * dt;
    if (Math.floor(this.bobPhase / Math.PI) !== before) this.events.footstep?.(speed);
  }

  // ---------------------------------------------------------------------------
  // Crouch helpers
  // ---------------------------------------------------------------------------

  private setCrouch(on: boolean): void {
    if (on) {
      this.crouched = true;
      this.height = PLAYER.crouchHeight;
    }
  }

  /** Stands up if there is headroom. Returns true when standing. */
  private tryStand(): boolean {
    if (!this.crouched) return true;
    if (this.physics.fits(this.position.x, this.position.y, this.position.z, PLAYER.standHeight)) {
      this.crouched = false;
      this.height = PLAYER.standHeight;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Slide
  // ---------------------------------------------------------------------------

  private startSlide(): void {
    const speed = this.horizontalSpeed;
    const boosted = Math.max(speed, Math.min(speed + PLAYER.slideBoost, PLAYER.slideMaxSpeed));
    this.velocity.x *= boosted / speed;
    this.velocity.z *= boosted / speed;
    this.state = 'slide';
    this.slideTime = 0;
    this.slideBuffer = 0;
    this.setCrouch(true);
    this.events.slideStart?.();
  }

  private updateSlide(dt: number, input: InputSnapshot): void {
    this.slideTime += dt;

    // Jumping out of a slide keeps all of its momentum.
    if (this.jumpBuffer > 0 && this.tryStand()) {
      this.endSlide(true);
      this.doJump('slide');
      this.integrate(dt, input);
      return;
    }

    let speed = this.horizontalSpeed;
    speed = Math.max(0, speed - PLAYER.slideFriction * dt);
    let dx = this.velocity.x;
    let dz = this.velocity.z;
    const s = Math.hypot(dx, dz) || 1;
    dx /= s;
    dz /= s;
    // Gentle steering while sliding.
    if (_wish.lengthSq() > 0.01) {
      [dx, dz] = rotateToward(dx, dz, _wish.x, _wish.z, PLAYER.slideSteer * dt);
    }
    this.velocity.x = dx * speed;
    this.velocity.z = dz * speed;

    this.integrate(dt, input);
    if (this.state !== 'slide') return;

    const released = !input.slideHeld && this.slideTime > PLAYER.slideMinTime;
    if (this.horizontalSpeed < PLAYER.slideEndSpeed || released) {
      this.endSlide(false);
      this.state = 'ground';
      // Stay crouched while under a low ceiling or while still holding the key.
      if (!input.slideHeld) this.tryStand();
    }
  }

  private endSlide(_jumping: boolean): void {
    this.slideCooldown = PLAYER.slideCooldown;
    this.events.slideEnd?.();
  }

  // ---------------------------------------------------------------------------
  // Wall run
  // ---------------------------------------------------------------------------

  private tryStartWallRun(input: InputSnapshot): boolean {
    if (this.wallRunCooldown > 0 || input.forward < 0.1) return false;
    if (this.horizontalSpeed < PLAYER.wallRunMinSpeed) return false;
    // Do not start a wall run right above the floor; just let the player land.
    const ground = this.physics.world.groundBelow(this.position.x, this.position.z, PLAYER.radius, this.position.y + 0.01);
    if (this.position.y - ground < 0.5) return false;

    const wall = this.parkour.findWall(this.position, this.velocity, this.usedWalls);
    if (!wall) return false;

    const n = wall.normal;
    // Wall on the right when the normal points to the player's left.
    const side = n.x * _right.x + n.z * _right.z < 0 ? 1 : -1;
    this.usedWalls.add(ParkourSystem.wallKey(wall));
    // Travel direction along the wall follows the current motion.
    const tangent = new THREE.Vector3(-n.z, 0, n.x);
    if (this.velocity.x * tangent.x + this.velocity.z * tangent.z < 0) tangent.negate();
    this.wallRun = { wall, side, time: 0, tangent };
    this.state = 'wallrun';
    this.tryStand();
    this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, PLAYER.wallRunMinVy, PLAYER.wallRunMaxVy);
    this.jumpCutAvailable = false;
    this.events.wallRunStart?.(side);
    return true;
  }

  private updateWallRun(dt: number, input: InputSnapshot): void {
    const wr = this.wallRun!;
    const n = wr.wall.normal;
    wr.time += dt;

    const tx = wr.tangent.x;
    const tz = wr.tangent.z;
    let along = Math.max(this.velocity.x * tx + this.velocity.z * tz, PLAYER.wallRunMinSpeed);
    if (along < PLAYER.wallRunSpeed) along = Math.min(PLAYER.wallRunSpeed, along + 6 * dt);

    // Jump away from the wall.
    if (this.jumpBuffer > 0) {
      this.endWallRun();
      this.velocity.x = tx * along * 0.95 + n.x * PLAYER.wallJumpOut;
      this.velocity.z = tz * along * 0.95 + n.z * PLAYER.wallJumpOut;
      this.velocity.y = PLAYER.wallJumpUp;
      this.jumpBuffer = 0;
      this.jumpCutAvailable = true;
      this.wallRunCooldown = 0.2;
      this.events.jump?.('wall');
      this.integrate(dt, input);
      return;
    }

    // Small push into the wall keeps the contact stable.
    this.velocity.x = tx * along - n.x * 1.0;
    this.velocity.z = tz * along - n.z * 1.0;
    // Gravity starts weak and grows, so a wall run naturally curves downward.
    const g = PLAYER.wallRunGravityStart + PLAYER.wallRunGravityGrowth * wr.time;
    this.velocity.y = Math.max(this.velocity.y - g * dt, -8);

    const fallSpeed = -this.velocity.y;
    const res = this.physics.move(this.position, this.velocity, dt, this.height, PLAYER.airStepHeight);
    if (res.stepped > 0) this.pendingStepUp += res.stepped;
    this.advanceStride(dt, 1.6);

    if (res.grounded) {
      this.endWallRun();
      this.land(fallSpeed, input);
      this.coyote = PLAYER.coyoteTime;
      this.usedWalls.clear();
      return;
    }

    const awayFromWall = _wish.x * n.x + _wish.z * n.z > 0.6;
    const lostWall = !this.parkour.stillOnWall(this.position, wr.wall);
    // Something blocked the run (e.g. the face of the next building).
    const blocked = res.hitWall && Math.abs(this.velocity.x * tx + this.velocity.z * tz) < 0.5;
    if (blocked) {
      this.endWallRun();
      this.velocity.x = n.x * 1.5;
      this.velocity.z = n.z * 1.5;
      this.wallRunCooldown = 0.25;
      return;
    }
    if (lostWall || awayFromWall || input.forward <= 0 || wr.time > PLAYER.wallRunMaxTime || along < PLAYER.wallRunMinSpeed - 0.5) {
      this.endWallRun();
      // Restore the along-wall velocity (the stick force was absorbed by the wall) and push off slightly.
      this.velocity.x = tx * along + n.x * 1.2;
      this.velocity.z = tz * along + n.z * 1.2;
      this.wallRunCooldown = 0.25;
      // Grant a short coyote window so a jump right after leaving the wall still works.
      this.coyote = lostWall ? 0.1 : 0;
    }
  }

  private endWallRun(): void {
    this.wallRun = null;
    this.state = 'air';
    this.events.wallRunEnd?.();
  }

  // ---------------------------------------------------------------------------
  // Vault & mantle (short scripted moves)
  // ---------------------------------------------------------------------------

  private startVault(top: number, target: THREE.Vector3, crouchAtEnd: boolean): void {
    const dist = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    const exitSpeed = Math.max(this.horizontalSpeed, PLAYER.walkSpeed);
    this.anim = {
      kind: 'vault',
      from: this.position.clone(),
      to: target,
      top,
      t: 0,
      duration: THREE.MathUtils.clamp(dist / Math.max(exitSpeed, 6), 0.26, 0.42),
      dir: _fwd.clone(),
      exitSpeed,
      crouchAtEnd,
    };
    this.state = 'vault';
    this.vaultBuffer = 0;
    this.jumpBuffer = 0;
    this.height = PLAYER.crouchHeight;
    this.events.vault?.();
  }

  private startMantle(top: number, target: THREE.Vector3, crouchAtEnd: boolean): void {
    const rise = Math.max(0, top - this.position.y);
    this.anim = {
      kind: 'mantle',
      from: this.position.clone(),
      to: target,
      top,
      t: 0,
      duration: 0.26 + rise * 0.07,
      dir: _fwd.clone(),
      exitSpeed: Math.max(4.5, Math.min(this.horizontalSpeed, 7)),
      crouchAtEnd,
    };
    this.state = 'mantle';
    this.vaultBuffer = 0;
    this.jumpBuffer = 0;
    this.wallRun = null;
    this.height = PLAYER.crouchHeight;
    this.events.mantle?.();
  }

  private updateAnimation(dt: number, input: InputSnapshot): void {
    const a = this.anim!;
    a.t = Math.min(1, a.t + dt / a.duration);
    this.animProgress = a.t;
    const t = a.t;

    if (a.kind === 'vault') {
      // Linear forward travel with a sine arc that peaks just above the obstacle.
      const base = a.from.y + (a.to.y - a.from.y) * t;
      const bump = Math.max(0, a.top + 0.1 - (a.from.y + a.to.y) * 0.5);
      this.position.set(
        a.from.x + (a.to.x - a.from.x) * t,
        base + bump * Math.sin(Math.PI * t),
        a.from.z + (a.to.z - a.from.z) * t,
      );
      this.velocity.set(a.dir.x * a.exitSpeed, 0, a.dir.z * a.exitSpeed);
    } else {
      // Mantle: pull up first, then roll forward onto the ledge.
      const upEnd = 0.6;
      if (t < upEnd) {
        const k = 1 - Math.pow(1 - t / upEnd, 2);
        this.position.set(a.from.x, a.from.y + (a.to.y - a.from.y) * k, a.from.z);
      } else {
        const k = (t - upEnd) / (1 - upEnd);
        const e = k * k * (3 - 2 * k);
        this.position.set(a.from.x + (a.to.x - a.from.x) * e, a.to.y, a.from.z + (a.to.z - a.from.z) * e);
      }
      this.velocity.set(0, 0, 0);
    }

    if (t >= 1) {
      this.position.copy(a.to);
      this.anim = null;
      this.animProgress = 0;
      this.crouched = a.crouchAtEnd;
      this.height = a.crouchAtEnd ? PLAYER.crouchHeight : PLAYER.standHeight;
      const speed = a.kind === 'vault' ? a.exitSpeed : input.forward > 0 ? a.exitSpeed : 1.5;
      this.velocity.set(a.dir.x * speed, 0, a.dir.z * speed);
      const onGround = this.physics.world.groundBelow(this.position.x, this.position.z, PLAYER.radius - 0.01, this.position.y + 0.01);
      if (this.position.y - onGround < 0.03) {
        this.state = 'ground';
        this.coyote = PLAYER.coyoteTime;
        this.usedWalls.clear();
        this.events.land?.(a.kind === 'vault' ? 4 : 3);
      } else {
        this.state = 'air';
        this.coyote = 0.1;
      }
    }
  }
}
