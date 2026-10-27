import { Vector3 } from 'three';
import type { CollisionWorld } from '../world/CollisionWorld';
import { MOVE } from './MovementConfig';
import { ParkourSystem, TraversalMove, type WallContact } from './ParkourSystem';
import { PlayerPhysics } from './PlayerPhysics';

export type MoveState = 'ground' | 'crouch' | 'slide' | 'air' | 'wallrun' | 'vault' | 'mantle';

/** Input sampled once per physics step. */
export interface PlayerInput {
  /** Strafe axis, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward axis, -1 (back) .. 1 (forward). */
  moveZ: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  slideHeld: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
  /** Camera yaw in radians (0 = looking down -Z). */
  yaw: number;
}

export type PlayerEvent =
  | { type: 'jump'; speed: number }
  | { type: 'walljump' }
  | { type: 'land'; impact: number; hard: boolean }
  | { type: 'footstep'; speed: number; wall: boolean }
  | { type: 'slideStart'; speed: number }
  | { type: 'slideEnd' }
  | { type: 'wallrunStart'; side: -1 | 1 }
  | { type: 'wallrunEnd' }
  | { type: 'vault' }
  | { type: 'mantle'; height: number }
  | { type: 'step'; dy: number };

const _wish = new Vector3();
const _dir = new Vector3();
const _tmp = new Vector3();

/**
 * First-person parkour controller.
 *
 * Owns the player's position/velocity and a small state machine:
 *
 *   ground ⇄ crouch
 *     │  ↘ slide ──(edge)──┐
 *     └──(jump/edge)──→ air ⇄ wallrun
 *                       │ ↘ vault / mantle (scripted, then back to physics)
 *
 * Everything runs at a fixed timestep (see PHYSICS_DT) so movement is
 * identical regardless of frame rate.
 */
export class PlayerController {
  readonly physics: PlayerPhysics;
  readonly parkour: ParkourSystem;

  /** Feet position (bottom centre of the collision box). */
  readonly pos = new Vector3();
  readonly prevPos = new Vector3();
  readonly vel = new Vector3();

  state: MoveState = 'ground';
  height: number = MOVE.STAND_HEIGHT;
  grounded = true;

  /** Events produced since the last drain (audio, camera, HUD). */
  readonly events: PlayerEvent[] = [];

  // Timers
  private coyote = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private wallCooldown = 0;
  private wallJumpGrace = 0;
  private mantleCooldown = 0;
  private jumpCut = false;
  private jumpedSinceGround = false;
  private justJumped = false;

  // Slide
  slideTime = 0;
  private readonly slideDir = new Vector3(0, 0, -1);

  // Wall run
  wall: WallContact | null = null;
  wallTime = 0;
  private wallSpeed = 0;
  private lastWallKey: string | null = null;
  private lastWall: WallContact | null = null;

  // Vault / mantle
  traversal: TraversalMove | null = null;
  private traversalEntrySpeed = 0;

  /** Distance-based gait phase; every whole number is a footstep. */
  stepPhase = 0;
  /** Seconds spent continuously airborne. */
  airTime = 0;
  /** True while the jump came from a slide (camera/arms flavour only). */
  inputForward = 0;
  inputStrafe = 0;
  sprinting = false;

  constructor(world: CollisionWorld) {
    this.physics = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(world, this.physics);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get isCrouched(): boolean {
    return this.height < MOVE.STAND_HEIGHT - 0.01;
  }

  /** Puts the player at a spawn point with all movement state cleared. */
  respawn(position: Vector3): void {
    this.pos.copy(position);
    this.prevPos.copy(position);
    this.vel.set(0, 0, 0);
    this.state = 'ground';
    this.height = MOVE.STAND_HEIGHT;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.slideBuffer = 0;
    this.wallCooldown = 0;
    this.wallJumpGrace = 0;
    this.mantleCooldown = 0;
    this.jumpCut = false;
    this.jumpedSinceGround = false;
    this.justJumped = false;
    this.slideTime = 0;
    this.wall = null;
    this.lastWall = null;
    this.wallTime = 0;
    this.lastWallKey = null;
    this.traversal = null;
    this.airTime = 0;
    this.stepPhase = 0;
    this.events.length = 0;
    this.physics.depenetrate(this.pos, this.height);
  }

  /** Advances the simulation by one fixed step. */
  step(dt: number, input: PlayerInput): void {
    this.prevPos.copy(this.pos);
    this.justJumped = false;
    this.inputForward = input.moveZ;
    this.inputStrafe = input.moveX;

    // Timers & buffers
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.slideBuffer = Math.max(0, this.slideBuffer - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.wallJumpGrace = Math.max(0, this.wallJumpGrace - dt);
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);
    if (input.jumpPressed) this.jumpBuffer = MOVE.JUMP_BUFFER;
    if (input.slidePressed) this.slideBuffer = MOVE.SLIDE_BUFFER;

    // Wish direction from WASD relative to the camera yaw.
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    _wish.set(-sin * input.moveZ + cos * input.moveX, 0, -cos * input.moveZ - sin * input.moveX);
    const wishLen = _wish.length();
    if (wishLen > 1) _wish.multiplyScalar(1 / wishLen);
    const wishMag = Math.min(1, wishLen);
    this.sprinting = input.sprint && input.moveZ > 0;

    if (this.traversal) {
      this.updateTraversal(dt);
      return;
    }

    switch (this.state) {
      case 'ground':
      case 'crouch':
        this.updateGround(dt, input, wishMag);
        break;
      case 'slide':
        this.updateSlide(dt, input);
        break;
      case 'air':
        this.updateAir(dt, input, wishMag);
        break;
      case 'wallrun':
        this.updateWallRun(dt, input);
        break;
      default:
        break;
    }
    if (this.traversal) return; // a vault/mantle started this step

    this.applyGravity(dt, input);
    this.integrate(dt, input);
  }

  // ---------------------------------------------------------------------------
  // Ground
  // ---------------------------------------------------------------------------

  private updateGround(dt: number, input: PlayerInput, wishMag: number): void {
    const speed = this.horizontalSpeed;

    // Vault: E, or jump while running at a low obstacle with ground behind it.
    if (input.vaultPressed || (this.jumpBuffer > 0 && speed > 2.5)) {
      if (this.tryVault(input, input.vaultPressed)) return;
    }
    if (input.vaultPressed && this.tryMantle(input, MOVE.LEDGE_REACH - 0.25)) return;

    if (this.jumpBuffer > 0 && this.canStand()) {
      this.doJump();
      return;
    }

    if (this.state === 'ground') {
      if (this.slideBuffer > 0 && speed >= MOVE.SLIDE_MIN_START_SPEED) {
        this.startSlide();
        return;
      }
      if (input.slideHeld && speed < MOVE.SLIDE_MIN_START_SPEED) {
        this.state = 'crouch';
        this.height = MOVE.CROUCH_HEIGHT;
      }
    } else if (!input.slideHeld && this.canStand()) {
      this.state = 'ground';
      this.height = MOVE.STAND_HEIGHT;
    }

    let target: number;
    if (this.state === 'crouch') target = MOVE.CROUCH_SPEED;
    else target = this.sprinting ? MOVE.SPRINT_SPEED : MOVE.RUN_SPEED;
    this.applyGroundMovement(dt, wishMag, target * wishMag);
  }

  /**
   * Momentum-preserving ground movement: the velocity *direction* turns toward
   * the input direction at a speed-dependent rate, and the *speed* accelerates
   * toward the target. Fast runners turn wider; reversing brakes hard.
   */
  private applyGroundMovement(dt: number, wishMag: number, targetSpeed: number): void {
    let speed = this.horizontalSpeed;
    if (wishMag < 0.01) {
      speed = Math.max(0, speed - MOVE.GROUND_FRICTION * dt);
      if (speed > 0) {
        const k = speed / this.horizontalSpeed;
        this.vel.x *= k;
        this.vel.z *= k;
      } else {
        this.vel.x = 0;
        this.vel.z = 0;
      }
      return;
    }

    if (speed < 0.3) {
      _dir.copy(_wish).normalize();
    } else {
      _dir.set(this.vel.x / speed, 0, this.vel.z / speed);
      const wx = _wish.x / wishMag;
      const wz = _wish.z / wishMag;
      const dot = _dir.x * wx + _dir.z * wz;
      if (dot < -0.45) {
        // Pushing against our momentum: brake before turning around.
        speed = Math.max(0, speed - MOVE.REVERSE_BRAKE * dt);
        if (speed < 0.5) _dir.set(wx, 0, wz);
        this.vel.x = _dir.x * speed;
        this.vel.z = _dir.z * speed;
        return;
      }
      const cross = _dir.x * wz - _dir.z * wx;
      const angle = Math.atan2(cross, dot);
      const fast = clamp01((speed - 3) / (MOVE.SPRINT_SPEED - 3));
      const maxTurn = lerp(MOVE.TURN_RATE_SLOW, MOVE.TURN_RATE_FAST, fast) * dt;
      const turn = Math.abs(angle) <= maxTurn ? angle : Math.sign(angle) * maxTurn;
      rotateXZ(_dir, turn);
      // Sharp turns at speed cost a little momentum.
      speed -= speed * Math.min(1, Math.abs(angle)) * 1.4 * dt * fast;
    }

    if (speed < targetSpeed) {
      const accel = speed < MOVE.RUN_SPEED ? MOVE.GROUND_ACCEL : MOVE.SPRINT_ACCEL;
      speed = Math.min(targetSpeed, speed + accel * dt);
    } else if (speed > targetSpeed) {
      // Above sprint speed (after a slide or wall run) momentum bleeds slowly;
      // otherwise settle quickly onto the target.
      const decay = speed > MOVE.SPRINT_SPEED + 0.05 ? MOVE.OVERSPEED_DECAY : 14;
      speed = Math.max(targetSpeed, speed - decay * dt);
    }
    this.vel.x = _dir.x * speed;
    this.vel.z = _dir.z * speed;
  }

  private doJump(): void {
    if (this.state === 'slide') this.events.push({ type: 'slideEnd' });
    this.height = MOVE.STAND_HEIGHT;
    this.vel.y = MOVE.JUMP_VELOCITY;
    this.state = 'air';
    this.grounded = false;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.jumpCut = true;
    this.jumpedSinceGround = true;
    this.justJumped = true;
    this.airTime = 0;
    this.events.push({ type: 'jump', speed: this.horizontalSpeed });
  }

  // ---------------------------------------------------------------------------
  // Slide
  // ---------------------------------------------------------------------------

  private startSlide(): void {
    const speed = this.horizontalSpeed;
    this.state = 'slide';
    this.height = MOVE.CROUCH_HEIGHT;
    this.slideTime = 0;
    this.slideBuffer = 0;
    this.slideDir.set(this.vel.x / speed, 0, this.vel.z / speed);
    const boosted = Math.min(MOVE.SLIDE_MAX_SPEED, Math.max(speed, speed + MOVE.SLIDE_BOOST));
    this.vel.x = this.slideDir.x * boosted;
    this.vel.z = this.slideDir.z * boosted;
    this.events.push({ type: 'slideStart', speed: boosted });
  }

  private updateSlide(dt: number, input: PlayerInput): void {
    this.slideTime += dt;

    if (this.jumpBuffer > 0 && this.canStand()) {
      this.doJump();
      return;
    }

    let speed = this.horizontalSpeed;
    const friction = MOVE.SLIDE_FRICTION + MOVE.SLIDE_FRICTION_GROWTH * this.slideTime;
    speed = Math.max(0, speed - friction * dt);

    // Gentle steering while sliding.
    const wl = Math.hypot(_wish.x, _wish.z);
    if (wl > 0.01) {
      const wx = _wish.x / wl;
      const wz = _wish.z / wl;
      const dot = this.slideDir.x * wx + this.slideDir.z * wz;
      if (dot > -0.2) {
        const angle = Math.atan2(this.slideDir.x * wz - this.slideDir.z * wx, dot);
        const maxTurn = MOVE.SLIDE_STEER_RATE * dt;
        rotateXZ(this.slideDir, Math.abs(angle) <= maxTurn ? angle : Math.sign(angle) * maxTurn);
      }
    }
    this.vel.x = this.slideDir.x * speed;
    this.vel.z = this.slideDir.z * speed;

    const released = !input.slideHeld && this.slideTime > MOVE.SLIDE_MIN_TIME;
    if (speed < MOVE.SLIDE_END_SPEED || released) this.endSlide(input);
  }

  private endSlide(input: PlayerInput): void {
    this.events.push({ type: 'slideEnd' });
    if (this.canStand() && !(input.slideHeld && this.horizontalSpeed < MOVE.SLIDE_END_SPEED)) {
      this.state = 'ground';
      this.height = MOVE.STAND_HEIGHT;
    } else {
      // Under something low (or still holding crouch): stay crouched until there is headroom.
      this.state = 'crouch';
      this.height = MOVE.CROUCH_HEIGHT;
    }
  }

  // ---------------------------------------------------------------------------
  // Air
  // ---------------------------------------------------------------------------

  private updateAir(dt: number, input: PlayerInput, wishMag: number): void {
    this.airTime += dt;

    // Grow back to standing height as soon as there is room (e.g. after sliding off an edge).
    if (this.isCrouched && !input.slideHeld && this.canStand()) this.height = MOVE.STAND_HEIGHT;

    // Late wall jump just after leaving a wall.
    if (this.jumpBuffer > 0 && this.wallJumpGrace > 0 && this.lastWall) {
      this.wallJump(this.lastWall, input);
      return;
    }
    // Coyote-time jump just after running off an edge.
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.jumpedSinceGround && this.canStand()) {
      this.doJump();
      return;
    }

    // Ledge recovery: automatically pull up when a reachable ledge is in front.
    if (input.moveZ > 0 && this.mantleCooldown <= 0 && this.vel.y > -MOVE.LEDGE_MAX_FALL_SPEED) {
      if (this.tryMantle(input, MOVE.LEDGE_REACH)) return;
    }

    // Wall run start.
    if (input.moveZ > 0 && this.wallCooldown <= 0) this.tryStartWallRun();
    if (this.state === 'wallrun') return;

    // Limited air control: steer, but never gain speed beyond what we had (or a modest cap).
    if (wishMag > 0.01) {
      const before = this.horizontalSpeed;
      this.vel.x += _wish.x * MOVE.AIR_ACCEL * dt;
      this.vel.z += _wish.z * MOVE.AIR_ACCEL * dt;
      const after = this.horizontalSpeed;
      const cap = Math.max(before, MOVE.AIR_MAX_CONTROL_SPEED);
      if (after > cap) {
        const k = cap / after;
        this.vel.x *= k;
        this.vel.z *= k;
      }
    }
  }

  private applyGravity(dt: number, input: PlayerInput): void {
    let g = MOVE.GRAVITY;
    if (this.state === 'wallrun') {
      g = MOVE.WALLRUN_GRAVITY_START + MOVE.WALLRUN_GRAVITY_RAMP * this.wallTime;
    } else if (this.state === 'air') {
      if (this.vel.y < 0) {
        g *= MOVE.FALL_GRAVITY_MULT;
        this.jumpCut = false;
      } else if (this.jumpCut && !input.jumpHeld) {
        // Variable jump height: releasing jump early cuts the rise short.
        g *= MOVE.JUMP_CUT_GRAVITY_MULT;
      }
    }
    this.vel.y = Math.max(-MOVE.MAX_FALL_SPEED, this.vel.y - g * dt);
  }

  // ---------------------------------------------------------------------------
  // Wall run
  // ---------------------------------------------------------------------------

  private tryStartWallRun(): void {
    const speed = this.horizontalSpeed;
    if (speed < MOVE.WALLRUN_MIN_SPEED) return;
    if (this.vel.y < -MOVE.WALLRUN_MAX_FALL_SPEED_TO_START) return;
    if (this.isCrouched) return;
    _dir.set(this.vel.x / speed, 0, this.vel.z / speed);
    const contact = this.parkour.findWall(this.pos, this.height, _dir);
    if (!contact) return;
    if (contact.key === this.lastWallKey) return; // one run per wall until you touch the ground

    // Not when we are basically still on the floor next to a wall.
    if (this.physics.world.surfaceBelow(this.pos.x, this.pos.z, this.pos.y + 0.01, 0.45)) return;

    const along = this.vel.x * contact.tangent.x + this.vel.z * contact.tangent.z;
    if (along < MOVE.WALLRUN_MIN_SPEED) return;

    this.state = 'wallrun';
    this.wall = contact;
    this.lastWall = contact;
    this.lastWallKey = contact.key;
    this.wallTime = 0;
    this.wallSpeed = clamp(along, MOVE.WALLRUN_MIN_SPEED_KEEP, MOVE.WALLRUN_MAX_SPEED);
    this.vel.y = clamp(this.vel.y, MOVE.WALLRUN_START_VY_MIN, MOVE.WALLRUN_START_VY_MAX);
    this.jumpCut = false;
    this.events.push({ type: 'wallrunStart', side: contact.side });
  }

  private updateWallRun(dt: number, input: PlayerInput): void {
    const wall = this.wall;
    if (!wall) {
      this.state = 'air';
      return;
    }
    this.wallTime += dt;

    if (this.jumpBuffer > 0) {
      this.wallJump(wall, input);
      return;
    }

    // Still beside the same wall plane?
    const contact = this.parkour.findWall(this.pos, this.height, wall.tangent, wall.side);
    const sameWall = contact !== null && contact.normal.dot(wall.normal) > 0.99;
    if (!sameWall || input.moveZ <= 0 || this.wallTime > MOVE.WALLRUN_MAX_TIME) {
      this.endWallRun(true);
      return;
    }

    // Run along the wall at constant speed, with a slight push into it to stay attached.
    this.wallSpeed = Math.min(MOVE.WALLRUN_MAX_SPEED, this.wallSpeed + (this.sprinting ? 1.5 : 0) * dt);
    this.vel.x = wall.tangent.x * this.wallSpeed - wall.normal.x * 1.5;
    this.vel.z = wall.tangent.z * this.wallSpeed - wall.normal.z * 1.5;
  }

  private endWallRun(pushOff: boolean): void {
    const wall = this.wall;
    this.state = 'air';
    this.wall = null;
    this.wallCooldown = MOVE.WALLRUN_COOLDOWN;
    this.wallJumpGrace = MOVE.WALL_JUMP_GRACE;
    if (wall && pushOff) {
      this.vel.x = wall.tangent.x * this.wallSpeed + wall.normal.x * 1.2;
      this.vel.z = wall.tangent.z * this.wallSpeed + wall.normal.z * 1.2;
    }
    this.events.push({ type: 'wallrunEnd' });
  }

  private wallJump(wall: WallContact, input: PlayerInput): void {
    if (this.state === 'wallrun') this.events.push({ type: 'wallrunEnd' });
    const speed = Math.max(this.wallSpeed, MOVE.WALLRUN_MIN_SPEED_KEEP) * 0.95;
    let hx = wall.tangent.x * speed + wall.normal.x * MOVE.WALL_JUMP_PUSH;
    let hz = wall.tangent.z * speed + wall.normal.z * MOVE.WALL_JUMP_PUSH;

    // If the player looks away from the wall, bias the jump toward the view direction.
    const lookX = -Math.sin(input.yaw);
    const lookZ = -Math.cos(input.yaw);
    const away = lookX * wall.normal.x + lookZ * wall.normal.z;
    if (away > 0.2) {
      const len = Math.hypot(hx, hz);
      const t = Math.min(1, (away - 0.2) * 1.2) * 0.6;
      hx = lerp(hx / len, lookX, t);
      hz = lerp(hz / len, lookZ, t);
      const l2 = Math.hypot(hx, hz);
      hx = (hx / l2) * len;
      hz = (hz / l2) * len;
    }

    this.vel.set(hx, MOVE.WALL_JUMP_VY, hz);
    this.state = 'air';
    this.wall = null;
    this.lastWall = null;
    this.wallCooldown = MOVE.WALLRUN_COOLDOWN;
    this.wallJumpGrace = 0;
    this.jumpBuffer = 0;
    this.jumpCut = true;
    this.justJumped = true;
    this.events.push({ type: 'walljump' });
  }

  // ---------------------------------------------------------------------------
  // Vault & mantle
  // ---------------------------------------------------------------------------

  private lookDir(input: PlayerInput, out: Vector3): Vector3 {
    return out.set(-Math.sin(input.yaw), 0, -Math.cos(input.yaw));
  }

  private tryVault(input: PlayerInput, explicit: boolean): boolean {
    this.lookDir(input, _dir);
    const speed = this.horizontalSpeed;
    // Faster runners can start the vault from further away.
    const reach = Math.min(MOVE.VAULT_REACH, 0.7 + speed * 0.09);
    const info = this.parkour.findVault(this.pos, _dir, reach);
    if (!info) return false;
    // A jump at a roof edge with a low wall is still a jump; only E vaults into the void.
    if (!explicit && !info.groundBeyond) return false;

    const extent = MOVE.HALF_WIDTH * (Math.abs(_dir.x) + Math.abs(_dir.z));
    const riseDistance = Math.max(0, info.nearDistance - extent - 0.03);
    const totalDistance = Math.max(riseDistance + 0.1, info.farDistance + extent + 0.06);
    const clearY = this.pos.y + info.rise + 0.06;
    const riseTime = 0.09 + 0.11 * info.rise;
    const crossSpeed = clamp(speed, 5.5, 9.5);
    const exitSpeed = Math.max(speed, MOVE.VAULT_MIN_EXIT_SPEED);
    const move = new TraversalMove('vault', this.pos, _dir, riseDistance, totalDistance, clearY, riseTime, crossSpeed, exitSpeed);
    if (!this.parkour.pathIsClear(move, MOVE.CROUCH_HEIGHT + 0.25)) return false;

    this.beginTraversal(move, 'vault');
    this.events.push({ type: 'vault' });
    return true;
  }

  private tryMantle(input: PlayerInput, reach: number): boolean {
    this.lookDir(input, _dir);
    const ledge = this.parkour.findLedge(this.pos, _dir, MOVE.LEDGE_MIN_HEIGHT, reach);
    if (!ledge) return false;
    const rise = ledge.top - this.pos.y;

    // If we are rising fast enough to clear the ledge on our own, let the jump play out.
    if (this.state === 'air' && this.vel.y > 0) {
      const natural = (this.vel.y * this.vel.y) / (2 * MOVE.GRAVITY);
      if (natural > rise + 0.15) return false;
    }

    const extent = MOVE.HALF_WIDTH * (Math.abs(_dir.x) + Math.abs(_dir.z));
    const riseDistance = Math.max(0, ledge.faceDistance - extent - 0.03);
    _tmp.set(ledge.target.x - this.pos.x, 0, ledge.target.z - this.pos.z);
    const totalDistance = Math.max(riseDistance + 0.1, _tmp.length());
    const speed = this.horizontalSpeed;
    const riseTime = 0.12 + 0.12 * Math.max(0, rise);
    const crossSpeed = clamp(speed * 0.8, 3.5, 7);
    const exitSpeed = Math.max(speed * 0.7, 3.5);
    const move = new TraversalMove('mantle', this.pos, _dir, riseDistance, totalDistance, ledge.top + 0.02, riseTime, crossSpeed, exitSpeed);

    this.beginTraversal(move, 'mantle');
    this.events.push({ type: 'mantle', height: rise });
    return true;
  }

  private beginTraversal(move: TraversalMove, state: 'vault' | 'mantle'): void {
    if (this.state === 'slide') this.events.push({ type: 'slideEnd' });
    if (this.state === 'wallrun') this.events.push({ type: 'wallrunEnd' });
    this.traversalEntrySpeed = this.horizontalSpeed;
    this.traversal = move;
    this.state = state;
    this.wall = null;
    this.jumpBuffer = state === 'vault' ? 0 : this.jumpBuffer;
    this.height = MOVE.STAND_HEIGHT;
    this.grounded = false;
  }

  private updateTraversal(dt: number): void {
    const move = this.traversal!;
    move.time += dt;
    move.sample(Math.min(move.time, move.duration), _tmp);
    // Velocity is derived from the path so camera effects keep working.
    this.vel.set((_tmp.x - this.pos.x) / dt, (_tmp.y - this.pos.y) / dt, (_tmp.z - this.pos.z) / dt);
    this.pos.copy(_tmp);
    if (!move.finished) return;

    // Hand control back to physics with preserved momentum.
    this.traversal = null;
    const exitSpeed = Math.max(move.exitSpeed, this.traversalEntrySpeed * (move.kind === 'vault' ? 1 : 0.7));
    this.vel.set(move.dir.x * exitSpeed, 0, move.dir.z * exitSpeed);
    const hasGround = this.physics.world.surfaceBelow(this.pos.x, this.pos.z, this.pos.y + 0.01, 1.4) !== null;
    if (this.jumpBuffer > 0 && move.kind === 'vault') {
      // Vault-jump: chain straight into a jump.
      this.vel.y = MOVE.JUMP_VELOCITY * 0.9;
      this.jumpBuffer = 0;
      this.jumpCut = true;
      this.justJumped = true;
      this.events.push({ type: 'jump', speed: exitSpeed });
    } else if (!hasGround) {
      this.vel.y = 2.5; // vaulting off an edge gives a small hop
    }
    this.state = 'air';
    this.jumpedSinceGround = true;
    this.mantleCooldown = 0.2;
    if (!this.physics.isFree(this.pos, this.height)) {
      if (this.physics.isFree(this.pos, MOVE.CROUCH_HEIGHT)) this.height = MOVE.CROUCH_HEIGHT;
      else this.physics.depenetrate(this.pos, this.height);
    }
  }

  // ---------------------------------------------------------------------------
  // Integration & landing
  // ---------------------------------------------------------------------------

  private integrate(dt: number, input: PlayerInput): void {
    const groundedState = this.state === 'ground' || this.state === 'crouch' || this.state === 'slide';
    const res = this.physics.move(this.pos, this.vel, dt, this.height, {
      allowStep: groundedState,
      snapToGround: groundedState && this.grounded && !this.justJumped,
    });
    if (res.stepOffset !== 0) this.events.push({ type: 'step', dy: res.stepOffset });

    // Hitting a wall head-on during a wall run ends it.
    if (this.state === 'wallrun' && this.wall) {
      const t = this.wall.tangent;
      if ((res.blockedX && Math.abs(t.x) > 0.5) || (res.blockedZ && Math.abs(t.z) > 0.5)) this.endWallRun(false);
    }

    if (res.onFloor) {
      if (this.state === 'air' || this.state === 'wallrun') this.land(res.impactSpeed, input);
      this.grounded = true;
      this.coyote = MOVE.COYOTE_TIME;
      this.jumpedSinceGround = false;
      this.lastWallKey = null;
      this.airTime = 0;
    } else {
      if (groundedState) {
        // Walked or slid off an edge.
        if (this.state === 'slide') {
          this.events.push({ type: 'slideEnd' });
        }
        this.state = 'air';
        this.jumpCut = false;
        this.jumpedSinceGround = false;
      }
      this.grounded = false;
    }

    // Footsteps / gait phase from distance travelled on the ground or on a wall.
    if ((this.state === 'ground' || this.state === 'crouch' || this.state === 'wallrun') && (this.grounded || this.state === 'wallrun')) {
      const dist = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z);
      const speed = this.horizontalSpeed;
      const stride = this.state === 'crouch' ? 0.9 : lerp(1.15, 2.0, clamp01(speed / MOVE.SPRINT_SPEED));
      const before = Math.floor(this.stepPhase);
      this.stepPhase += dist / stride;
      if (Math.floor(this.stepPhase) !== before && speed > 1.0) {
        this.events.push({ type: 'footstep', speed, wall: this.state === 'wallrun' });
      }
    }
  }

  private land(impact: number, input: PlayerInput): void {
    if (this.state === 'wallrun') this.events.push({ type: 'wallrunEnd' });
    this.wall = null;
    const speed = this.horizontalSpeed;
    const wantsSlide = input.slideHeld || this.slideBuffer > 0;
    const hard = impact > MOVE.HARD_LANDING_SPEED && !wantsSlide;
    if (hard) {
      // Hard landing: lose a chunk of momentum (rolling via slide avoids this).
      this.vel.x *= 0.55;
      this.vel.z *= 0.55;
    }
    this.events.push({ type: 'land', impact, hard });

    if (wantsSlide && speed >= MOVE.SLIDE_MIN_START_SPEED) {
      this.state = 'ground';
      this.startSlide();
      return;
    }
    if (this.isCrouched && !this.canStand()) {
      this.state = 'crouch';
    } else {
      this.state = 'ground';
      this.height = MOVE.STAND_HEIGHT;
    }
  }

  canStand(): boolean {
    if (!this.isCrouched) return true;
    return this.physics.isFree(this.pos, MOVE.STAND_HEIGHT);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Rotates the (x, z) part of a vector as a plain 2D vector. A positive angle
 * matches the sign of the 2D cross product used to measure it above, so
 * `rotateXZ(dir, atan2(cross(dir, wish), dot(dir, wish)))` turns dir onto wish.
 */
function rotateXZ(v: Vector3, angle: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = v.x * c - v.z * s;
  const z = v.x * s + v.z * c;
  v.x = x;
  v.z = z;
}
