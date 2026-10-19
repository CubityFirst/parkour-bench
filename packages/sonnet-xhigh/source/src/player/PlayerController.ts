/**
 * PlayerController - the movement state machine.
 *
 * Turns player input into velocity every fixed physics step, then lets PlayerPhysics
 * resolve collisions. States:
 *
 *   ground  - running / sprinting on a surface
 *   air     - jumping or falling (limited air steering, momentum is conserved)
 *   slide   - low, fast slide with friction (can slide under low ceilings)
 *   wallrun - running along a flagged vertical surface, reduced gravity
 *   vault   - scripted hop over a low obstacle
 *   mantle  - scripted ledge pull-up
 *
 * The controller has no knowledge of rendering or the DOM. Camera, audio and body
 * animation consume its public state and the PlayerListener callbacks.
 */

import { type CollisionWorld } from '../world/CollisionWorld';
import { MOVE } from './MovementConfig';
import { ParkourSystem } from './ParkourSystem';
import { BODY, PlayerPhysics } from './PlayerPhysics';

export interface PlayerInput {
  /** Strafe axis, -1 (left) .. +1 (right). */
  moveX: number;
  /** Forward axis, -1 (back) .. +1 (forward). */
  moveZ: number;
  sprint: boolean;
  jumpHeld: boolean;
  /** True for the step(s) right after the jump key went down. */
  jumpPressed: boolean;
  slideHeld: boolean;
  slidePressed: boolean;
  interactPressed: boolean;
}

export function makePlayerInput(): PlayerInput {
  return {
    moveX: 0, moveZ: 0, sprint: false,
    jumpHeld: false, jumpPressed: false,
    slideHeld: false, slidePressed: false,
    interactPressed: false,
  };
}

export type MoveState = 'ground' | 'air' | 'slide' | 'wallrun' | 'vault' | 'mantle';

export interface PlayerListener {
  onJump?(): void;
  onWallJump?(): void;
  onLand?(impact: number): void;
  onFootstep?(sprinting: boolean): void;
  onSlideStart?(): void;
  onSlideEnd?(): void;
  onVault?(): void;
  onMantle?(): void;
  onWallRunStart?(side: number): void;
  onWallRunEnd?(): void;
}

export class PlayerController {
  readonly physics: PlayerPhysics;
  readonly parkour: ParkourSystem;
  listener: PlayerListener = {};

  state: MoveState = 'air';
  /** Seconds spent in the current state. */
  stateTime = 0;
  sprinting = false;
  /** Walk-cycle phase in radians (advances with distance covered on foot). */
  stridePhase = 0;
  /** Seconds since the player last left the ground (0 while grounded). */
  airTime = 0;

  /** Position at the start of the latest step, for render interpolation. */
  prevX = 0;
  prevY = 0;
  prevZ = 0;

  private coyote = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private interactBuffer = 0;
  private landingFriction = 0;
  private slideTime = 0;
  private mantleCooldown = 0;
  private vaultCooldown = 0;
  private stepAccum = 0;
  private lastYaw = 0;

  constructor(world: CollisionWorld) {
    this.physics = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(this.physics, world);
  }

  get speed(): number {
    return this.physics.horizontalSpeed;
  }

  /** Teleports the player and clears every transient movement state. */
  respawn(x: number, y: number, z: number): void {
    const p = this.physics;
    p.teleport(x, y, z);
    this.parkour.reset();
    this.state = p.grounded ? 'ground' : 'air';
    this.stateTime = 0;
    this.sprinting = false;
    this.airTime = 0;
    this.coyote = this.jumpBuffer = this.slideBuffer = this.interactBuffer = 0;
    this.landingFriction = 0;
    this.slideTime = 0;
    this.mantleCooldown = this.vaultCooldown = 0;
    this.stepAccum = 0;
    this.prevX = p.x; this.prevY = p.y; this.prevZ = p.z;
  }

  /** Advance one fixed physics step. `yaw` is the camera yaw in radians (0 = facing -Z). */
  update(dt: number, input: PlayerInput, yaw: number): void {
    const p = this.physics;
    this.prevX = p.x; this.prevY = p.y; this.prevZ = p.z;
    this.stateTime += dt;
    this.lastYaw = yaw;

    // ---- timers and input buffers
    this.jumpBuffer = input.jumpPressed ? MOVE.jumpBufferTime : Math.max(0, this.jumpBuffer - dt);
    this.slideBuffer = input.slidePressed ? MOVE.slideBufferTime : Math.max(0, this.slideBuffer - dt);
    this.interactBuffer = input.interactPressed ? MOVE.interactBufferTime : Math.max(0, this.interactBuffer - dt);
    this.coyote = p.grounded ? MOVE.coyoteTime : Math.max(0, this.coyote - dt);
    this.landingFriction = Math.max(0, this.landingFriction - dt);
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);
    this.vaultCooldown = Math.max(0, this.vaultCooldown - dt);
    this.airTime = p.grounded ? 0 : this.airTime + dt;
    this.parkour.tick(dt);

    // ---- scripted moves (vault / mantle) take over completely
    if (this.state === 'vault' || this.state === 'mantle') {
      if (this.parkour.updateScripted(dt)) {
        p.updateGrounded();
        this.setState(p.grounded ? 'ground' : 'air');
        if (p.grounded) this.parkour.onGrounded();
      }
      return;
    }

    // ---- basis vectors from the look direction
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    let wishX = rx * input.moveX + fx * input.moveZ;
    let wishZ = rz * input.moveX + fz * input.moveZ;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

    this.sprinting = input.sprint && input.moveZ > 0.1;

    // ---- E: vault, or pull up onto a taller ledge
    if (this.interactBuffer > 0 && this.state !== 'wallrun' && this.vaultCooldown <= 0) {
      if (this.tryInteract(fx, fz)) return;
    }

    // ---- hint helper: is there something to vault right now?
    this.parkour.vaultAvailable =
      (this.state === 'ground' || this.state === 'air') &&
      this.parkour.findVault(fx, fz, p.horizontalSpeed) !== null;

    // ---- state specific velocity update
    switch (this.state) {
      case 'ground': this.updateGround(dt, input, wishX, wishZ, wishLen, fx, fz); break;
      case 'slide': this.updateSlide(dt, input, wishX, wishZ, wishLen); break;
      case 'air': this.updateAir(dt, input, wishX, wishZ, wishLen, fx, fz); break;
      case 'wallrun': this.updateWallRun(dt, input); break;
    }
    if (this.isScripted()) return; // a vault / mantle started this step

    // ---- crouched body returns to full height as soon as there is room
    if (this.state !== 'slide' && p.height < BODY.standHeight) p.setHeight(BODY.standHeight);

    // ---- integrate + collide
    p.move(dt);

    // ---- post-move state transitions
    this.afterMove(dt, input);
  }

  // =============================================================== ground / slide

  private updateGround(
    dt: number, input: PlayerInput,
    wishX: number, wishZ: number, wishLen: number, fx: number, fz: number,
  ): void {
    const p = this.physics;
    void fx; void fz;

    // Jump (buffered + coyote)
    if (this.jumpBuffer > 0 && (p.grounded || this.coyote > 0) && this.tryJump()) {
      this.updateAir(dt, input, wishX, wishZ, wishLen, fx, fz);
      return;
    }

    // Slide
    if (this.slideBuffer > 0 && p.grounded && p.horizontalSpeed >= MOVE.slideMinEntrySpeed) {
      this.startSlide();
      this.updateSlide(dt, input, wishX, wishZ, wishLen);
      return;
    }

    // Ground acceleration / friction
    let top = this.sprinting ? MOVE.sprintSpeed : MOVE.runSpeed;
    if (input.moveZ < -0.1) top *= MOVE.backwardFactor;
    this.accelerateOnGround(dt, wishX, wishZ, wishLen, top);

    p.vy = Math.max(p.vy - MOVE.gravity * dt, -MOVE.terminalVelocity);
  }

  /**
   * Ground velocity model. Velocity is split into the part along the wish direction
   * and the part across it:
   *  - across: removed quickly (turning grip),
   *  - along:  accelerates towards the top speed, or bleeds off slowly when above it
   *            (so speed gained from slides, drops and vaults is conserved for a while).
   */
  private accelerateOnGround(dt: number, wishX: number, wishZ: number, wishLen: number, top: number): void {
    const p = this.physics;
    if (wishLen < 0.01) {
      const speed = p.horizontalSpeed;
      if (speed > 0) {
        const ns = Math.max(0, speed - MOVE.groundDecel * dt);
        const k = ns / speed;
        p.vx *= k; p.vz *= k;
      }
      return;
    }
    const dirX = wishX / wishLen;
    const dirZ = wishZ / wishLen;
    const target = top * wishLen;

    const along = p.vx * dirX + p.vz * dirZ;
    let perpX = p.vx - along * dirX;
    let perpZ = p.vz - along * dirZ;
    const perpLen = Math.hypot(perpX, perpZ);
    if (perpLen > 0) {
      const np = Math.max(0, perpLen - MOVE.turnGrip * dt);
      perpX *= np / perpLen; perpZ *= np / perpLen;
    }

    let nAlong: number;
    if (along < target) {
      nAlong = Math.min(target, along + MOVE.groundAccel * dt);
    } else {
      const bleed = this.landingFriction > 0 ? MOVE.landingOverspeedDecel : MOVE.overspeedDecel;
      nAlong = Math.max(target, along - bleed * dt);
    }
    p.vx = dirX * nAlong + perpX;
    p.vz = dirZ * nAlong + perpZ;
  }

  private tryJump(): boolean {
    const p = this.physics;
    if (this.state === 'slide') {
      if (!p.setHeight(BODY.standHeight)) return false; // no room to stand up
      this.endSlideEvent();
    }
    p.vy = MOVE.jumpSpeed;
    p.grounded = false;
    p.groundBox = null;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.setState('air');
    this.listener.onJump?.();
    return true;
  }

  private startSlide(): void {
    const p = this.physics;
    const speed = p.horizontalSpeed;
    // Slide preserves (and slightly boosts) the entry momentum.
    const ns = Math.min(speed * MOVE.slideBoost, MOVE.sprintSpeed * 1.2);
    if (speed > 0.01) { p.vx *= ns / speed; p.vz *= ns / speed; }
    p.setHeight(BODY.slideHeight);
    this.slideTime = 0;
    this.slideBuffer = 0;
    this.setState('slide');
    this.listener.onSlideStart?.();
  }

  private endSlideEvent(): void {
    this.listener.onSlideEnd?.();
  }

  private updateSlide(
    dt: number, input: PlayerInput, wishX: number, wishZ: number, wishLen: number,
  ): void {
    const p = this.physics;
    this.slideTime += dt;

    // Jump out of the slide.
    if (this.jumpBuffer > 0 && p.grounded && this.tryJump()) return;

    let speed = p.horizontalSpeed;
    const canStand = p.hasHeadroom(BODY.standHeight);

    // Gentle steering: rotate the velocity towards the wish direction.
    if (wishLen > 0.1 && speed > 0.5) {
      const cur = Math.atan2(p.vx, p.vz);
      const want = Math.atan2(wishX, wishZ);
      let diff = want - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = MOVE.slideSteerRate * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
      const a = cur + turn;
      p.vx = Math.sin(a) * speed;
      p.vz = Math.cos(a) * speed;
    }

    // Friction - speed gradually decreases.
    speed = Math.max(0, speed - MOVE.slideFriction * dt);
    if (!canStand && speed < MOVE.slideCrawlSpeed) {
      // Under a low ceiling: never stall, keep creeping out (cannot get stuck).
      speed = MOVE.slideCrawlSpeed;
      if (p.horizontalSpeed < 0.3) {
        // Stopped dead (e.g. facing a wall): push along the look direction.
        p.vx = (wishLen > 0.1 ? wishX / wishLen : -Math.sin(this.lastYaw)) * speed;
        p.vz = (wishLen > 0.1 ? wishZ / wishLen : -Math.cos(this.lastYaw)) * speed;
      }
    }
    const cur = p.horizontalSpeed;
    if (cur > 0.001) { p.vx *= speed / cur; p.vz *= speed / cur; }

    p.vy = Math.max(p.vy - MOVE.gravity * dt, -MOVE.terminalVelocity);

    // Exit conditions (only when there is headroom to stand).
    if (canStand) {
      const released = !input.slideHeld && this.slideTime >= MOVE.slideMinTime;
      if (speed <= MOVE.slideEndSpeed || released) {
        p.setHeight(BODY.standHeight);
        this.endSlideEvent();
        this.setState('ground');
      }
    }
  }

  // =============================================================== air

  private updateAir(
    dt: number, input: PlayerInput,
    wishX: number, wishZ: number, wishLen: number, fx: number, fz: number,
  ): void {
    const p = this.physics;

    // Coyote time: a jump pressed just after running off an edge still counts.
    if (this.state === 'air' && this.jumpBuffer > 0 && this.coyote > 0) this.tryJump();

    // Variable jump height + snappier fall.
    let g = MOVE.gravity;
    if (p.vy > 0) {
      if (!input.jumpHeld) g *= MOVE.jumpCutGravityMultiplier;
    } else {
      g *= MOVE.fallGravityMultiplier;
    }
    p.vy = Math.max(p.vy - g * dt, -MOVE.terminalVelocity);

    // Limited air steering that never adds speed beyond max(current, floor).
    if (wishLen > 0.01) {
      const before = p.horizontalSpeed;
      p.vx += wishX * MOVE.airAccel * dt;
      p.vz += wishZ * MOVE.airAccel * dt;
      const cap = Math.max(before, MOVE.airSpeedFloor);
      const after = p.horizontalSpeed;
      if (after > cap) { p.vx *= cap / after; p.vz *= cap / after; }
    }

    // Wall run attach.
    if (this.state === 'air' && this.parkour.tryStartWallRun(input.moveZ)) {
      this.setState('wallrun');
      this.listener.onWallRunStart?.(this.parkour.wall.side);
      return;
    }

    // Ledge recovery: just below a rooftop edge while pushing forward.
    if (this.mantleCooldown <= 0 && input.moveZ > 0.3 && p.vy < 7) {
      const speed = p.horizontalSpeed;
      if (speed > 1.5) {
        const vx = p.vx / speed;
        const vz = p.vz / speed;
        if (vx * fx + vz * fz > 0.3 && this.parkour.findMantle(vx, vz, speed)) {
          this.startScripted();
        }
      }
    }
  }

  // =============================================================== wall run

  private updateWallRun(dt: number, input: PlayerInput): void {
    const exit = this.parkour.updateWallRun(dt, input.moveZ, this.jumpBuffer > 0, this.slideBuffer > 0);
    if (exit === 'none') return;
    this.listener.onWallRunEnd?.();
    this.setState('air');
    if (exit === 'jump') {
      this.jumpBuffer = 0;
      this.listener.onWallJump?.();
    }
  }

  // =============================================================== scripted moves

  private tryInteract(fx: number, fz: number): boolean {
    const p = this.physics;
    if (this.state === 'slide') {
      // Stand first (vaulting requires full height); skip if there is no room.
      if (!p.hasHeadroom(BODY.standHeight)) return false;
    }
    const speed = p.horizontalSpeed;
    if (this.parkour.findVault(fx, fz, speed)) {
      if (this.state === 'slide') { p.setHeight(BODY.standHeight); this.endSlideEvent(); }
      this.startScripted();
      return true;
    }
    if (this.parkour.findMantle(fx, fz, speed)) {
      if (this.state === 'slide') { p.setHeight(BODY.standHeight); this.endSlideEvent(); }
      this.startScripted();
      return true;
    }
    return false;
  }

  private startScripted(): void {
    const move = this.parkour.beginScripted();
    this.interactBuffer = 0;
    this.jumpBuffer = 0;
    if (move.kind === 'vault') {
      this.vaultCooldown = 0.25;
      this.setState('vault');
      this.listener.onVault?.();
    } else {
      this.mantleCooldown = 0.45;
      this.setState('mantle');
      this.listener.onMantle?.();
    }
  }

  // =============================================================== after move

  private afterMove(dt: number, input: PlayerInput): void {
    const p = this.physics;

    // Landing
    if ((this.state === 'air' || this.state === 'wallrun') && p.grounded) {
      if (this.state === 'wallrun') {
        this.parkour.wall.active = false;
        this.parkour.wall.side = 0;
        this.listener.onWallRunEnd?.();
      }
      this.parkour.onGrounded();
      const impact = -p.landingImpact;
      this.landingFriction = MOVE.landingFrictionTime;
      // Very hard landings cost some momentum; a landing roll (slide) avoids it.
      const wantsRoll = (input.slideHeld || this.slideBuffer > 0) && p.horizontalSpeed >= MOVE.slideMinEntrySpeed;
      if (!wantsRoll && impact > 15) {
        const k = Math.max(0.6, 1 - (impact - 15) * 0.03);
        p.vx *= k; p.vz *= k;
      }
      this.setState('ground');
      this.listener.onLand?.(impact);
      if (wantsRoll) this.startSlide();
    } else if (this.state === 'ground' && !p.grounded) {
      this.setState('air');
    } else if (this.state === 'slide' && !p.grounded) {
      this.setState('air');
      this.endSlideEvent();
    }

    // Footsteps / stride phase while moving on foot
    if (this.state === 'ground' && p.grounded) {
      const dist = p.horizontalSpeed * dt;
      const stride = this.sprinting ? 2.7 : 1.9;
      this.stridePhase += (dist / stride) * Math.PI;
      this.stepAccum += dist;
      if (this.stepAccum >= stride) {
        this.stepAccum -= stride;
        this.listener.onFootstep?.(this.sprinting);
      }
    } else if (this.state === 'wallrun') {
      const dist = p.horizontalSpeed * dt;
      this.stridePhase += (dist / 2.2) * Math.PI;
      this.stepAccum += dist;
      if (this.stepAccum >= 2.2) {
        this.stepAccum -= 2.2;
        this.listener.onFootstep?.(true);
      }
    }
  }

  /** True while a vault / mantle is executing (a method so TS does not narrow `state` across calls). */
  private isScripted(): boolean {
    return this.state === 'vault' || this.state === 'mantle';
  }

  private setState(next: MoveState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
  }
}
