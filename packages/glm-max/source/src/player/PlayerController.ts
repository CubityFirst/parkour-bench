import * as THREE from 'three';
import type { CollisionWorld, Collider } from '../world/CollisionWorld';
import { PlayerPhysics, PLAYER_STAND_H, PLAYER_SLIDE_H } from './PlayerPhysics';
import { ParkourSystem, TraversalPlan } from './ParkourSystem';

/**
 * PlayerController — input handling, movement state machine and tuning.
 *
 * Phases: 'ground' (running), 'air' (jumps, wall runs, ledges),
 * 'slide' (sliding/crouched). Vault and mantle are short scripted traversals
 * during which normal physics is skipped.
 */

const WALK_SPEED = 5.4;
const SPRINT_SPEED = 9.6;
const GROUND_ACCEL = 62;
const GROUND_FRICTION = 9.0;
const AIR_ACCEL = 27;
const GRAVITY = 21.5;
const TERMINAL_FALL = 32;
const JUMP_SPEED = 8.8;
const JUMP_CUT_FACTOR = 0.42;
const COYOTE_TIME = 0.13;
const JUMP_BUFFER = 0.13;
const VAULT_BUFFER = 0.17;
const SLIDE_MIN_START_SPEED = 0.05;
const SLIDE_LAND_MIN_SPEED = 4.2;
const SLIDE_BOOST_MIN_SPEED = 1.6;
const SLIDE_END_SPEED = 3.1;
const SLIDE_END_TIME = 0.55;
const SLIDE_FRICTION = 1.6;
const SLIDE_STEER = 5.0;
const SLIDE_COOLDOWN = 0.25;
const SLIDE_JUMP_BOOST = 0.9;
const CRAWL_SPEED = 2.6;
const CRAWL_ACCEL = 14;
const AIR_DRAG = 0.12;

export type PlayerPhase = 'ground' | 'air' | 'slide';

export interface PlayerEvents {
  onFootstep?: (sprinting: boolean) => void;
  onJump?: () => void;
  onLand?: (impact: number) => void;
  onSlideStart?: () => void;
  onSlideEnd?: () => void;
  onVault?: () => void;
  onMantle?: () => void;
  onWallrunStart?: (side: number) => void;
  onWallrunEnd?: () => void;
  onHeadBump?: () => void;
}

export class PlayerController {
  /** three.js convention: yaw 0 → facing -Z. Spawn faces +Z → yaw = PI. */
  yaw = Math.PI;
  pitch = 0;

  phase: PlayerPhase = 'air';
  /** Camera lean feedback inputs [-1..1]. */
  inputForwardVec = 0;
  inputStrafeVec = 0;

  physics: PlayerPhysics;
  parkour: ParkourSystem;

  respawnPoint = { pos: new THREE.Vector3(0, 24, 4), yaw: Math.PI };

  events: PlayerEvents = {};

  private keys = new Set<string>();
  private jumpBufferT = 0;
  private vaultBufferT = 0;
  private coyoteT = 0;
  private jumpHeld = false;
  private jumpCutUsed = false;
  private slideHeld = false;
  private slideTime = 0;
  private slideCdT = 0;
  private airTime = 0;
  private scratch: Collider[] = [];

  constructor(collisionWorld: CollisionWorld) {
    this.physics = new PlayerPhysics(collisionWorld);
    this.parkour = new ParkourSystem(collisionWorld);
    this.installKeyListeners();
    this.physics.onLanded = (impact) => {
      if (
        this.slideHeld &&
        Math.hypot(this.physics.vel.x, this.physics.vel.z) > SLIDE_LAND_MIN_SPEED &&
        this.slideCdT <= 0
      ) {
        this.beginSlide();
      } else {
        this.phase = 'ground';
      }
      this.events.onLand?.(impact);
    };
  }

  // ------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space') {
      this.jumpBufferT = JUMP_BUFFER;
      this.jumpHeld = true;
      e.preventDefault();
    }
    if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') {
      e.preventDefault();
    }
    if (e.code === 'KeyE') {
      this.vaultBufferT = VAULT_BUFFER;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'Space') this.jumpHeld = false;
  };

  private installKeyListeners(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
  }

  disposeInput(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
  }

  clearInputState(): void {
    this.keys.clear();
    this.jumpHeld = false;
    this.jumpBufferT = 0;
    this.vaultBufferT = 0;
  }

  // ------------------------------------------------------------- accessors

  get pos(): THREE.Vector3 { return this.physics.pos; }

  speed(): number {
    return Math.hypot(this.physics.vel.x, this.physics.vel.z);
  }

  totalSpeed(): number {
    return this.physics.vel.length();
  }

  isSprinting(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  sliding(): boolean { return this.phase === 'slide'; }

  wallRunning(): boolean { return this.parkour.wall.active; }

  wallSide(): number { return this.parkour.wall.active ? this.parkour.wall.side : 0; }

  traversalKind(): string | null { return this.parkour.traversal ? this.parkour.traversal.kind : null; }

  forwardXZ(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  hasFallen(): boolean {
    return this.pos.y < 2.0;
  }

  // ------------------------------------------------------------- respawn

  setRespawn(pos: THREE.Vector3, yaw: number): void {
    this.respawnPoint.pos.copy(pos);
    this.respawnPoint.yaw = yaw;
  }

  respawn(): void {
    const p = this.respawnPoint;
    this.physics.teleport(_v1.set(p.pos.x, p.pos.y + 0.03, p.pos.z), null, PLAYER_STAND_H);
    this.physics.grounded = true;
    this.yaw = p.yaw;
    this.pitch = 0;
    this.phase = 'ground';
    this.jumpBufferT = 0;
    this.vaultBufferT = 0;
    this.coyoteT = 0;
    this.slideHeld = false;
    this.slideCdT = 0;
    this.airTime = 0;
    this.jumpCutUsed = false;
    this.parkour.reset();
  }

  // ------------------------------------------------------------- main update

  update(dt: number): void {
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.inputForwardVec = fwd;
    this.inputStrafeVec = strafe;
    const jumpBuffered = this.jumpBufferT > 0;
    const vaultPressed = this.vaultBufferT > 0;
    this.slideHeld = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC');
    const holdingForward = fwd > 0;

    // Traversal (vault/mantle animation) takes over completely.
    const tr = this.parkour.traversal;
    if (tr) {
      const done = this.parkour.updateTraversal(tr, dt, this.physics.pos);
      this.jumpBufferT -= dt;
      this.vaultBufferT -= dt;
      this.parkour.updateCooldowns(dt);
      if (done) {
        this.physics.vel.copy(tr.exitVel);
        if (this.physics.canStandAtHeight(PLAYER_STAND_H)) this.physics.setHeight(PLAYER_STAND_H);
        this.parkour.traversal = null;
        this.parkour.traversalCooldown = 0.12;
      }
      return;
    }

    this.jumpBufferT -= dt;
    this.vaultBufferT -= dt;
    this.coyoteT -= dt;
    this.slideCdT -= dt;
    this.airTime += dt;
    this.parkour.updateCooldowns(dt);

    const vel = this.physics.vel;
    const feet = this.physics.pos;
    const phys = this.physics;

    // ---- Active wall run maintains itself before locomotion.
    if (this.parkour.wall.active) {
      const r = this.parkour.updateWallrun(dt, vel, feet, phys.height, this.yaw, jumpBuffered);
      if (r === 'jump') {
        this.jumpBufferT = 0;
        this.airTime = 0;
        this.events.onWallrunEnd?.();
        this.events.onJump?.();
      } else if (r === 'detach') {
        this.events.onWallrunEnd?.();
      } else if (phys.grounded) {
        this.parkour.landDuringWallrun();
        this.events.onWallrunEnd?.();
      }
    } else {
      // ---- Locomotion acceleration.
      if (this.phase === 'slide') {
        this.steerSlide(dt, vel, fwd, strafe);
      } else {
        this.locomotion(dt, vel, phys.grounded, fwd, strafe);
      }

      // Regular gravity (wall run applies its own reduced gravity).
      if (!this.parkour.wall.active) {
        vel.y -= GRAVITY * dt;
        if (vel.y < -TERMINAL_FALL) vel.y = -TERMINAL_FALL;
      }

      // ---- Jump (with buffer & coyote time).
      const canJump = (phys.grounded || this.coyoteT > 0) && !this.parkour.wall.active;
      if (jumpBuffered && canJump) {
        if (this.phase === 'slide') {
          // Jumping out of a slide requires standing headroom.
          if (phys.canStandAtHeight(PLAYER_STAND_H)) {
            this.endSlide(true);
            // Small forward boost so slide→jump chains keep their flow.
            const vel2 = phys.vel;
            const sp = Math.hypot(vel2.x, vel2.z);
            if (sp > 0.05) {
              const f = (sp + SLIDE_JUMP_BOOST) / sp;
              vel2.x *= f;
              vel2.z *= f;
            }
            this.performJump();
          }
        } else {
          this.performJump();
        }
      }

      // ---- Variable jump height: cut when the button is released early.
      if (!this.jumpHeld && !this.jumpCutUsed && vel.y > 3.6) {
        vel.y *= JUMP_CUT_FACTOR;
        this.jumpCutUsed = true;
      }

      // ---- Slide start.
      const hSpeed = Math.hypot(vel.x, vel.z);
      if (
        this.phase !== 'slide' && this.slideHeld && phys.grounded &&
        hSpeed >= SLIDE_MIN_START_SPEED && this.slideCdT <= 0
      ) {
        this.beginSlide();
      }

      // ---- Stand tall when possible (after crouch/slide under covers).
      if (phys.height !== PLAYER_STAND_H && this.phase !== 'slide') {
        if (phys.canStandAtHeight(PLAYER_STAND_H)) {
          phys.setHeight(PLAYER_STAND_H);
        }
      }
    }

    // ---- Physics move for this fixed step.
    phys.move(dt);

    // ---- Post-move phase transitions.
    if (phys.grounded) {
      if (this.phase === 'air') {
        this.phase = 'ground';
        this.coyoteT = 0;
      }
    } else {
      if (this.phase === 'ground') {
        this.phase = 'air';
        this.coyoteT = COYOTE_TIME;
        this.airTime = 0;
      } else if (this.phase === 'slide') {
        this.phase = 'air';
        this.airTime = 0;
      }
    }

    if (phys.bumpedHead) this.events.onHeadBump?.();

    // ---- Wall run attach: airborne + fast + forward held.
    if (
      !this.parkour.wall.active && this.phase === 'air' && !phys.grounded &&
      holdingForward && this.speed() >= 5.0 && vel.y < 6 && Math.abs(vel.y) < 12
    ) {
      const prefer = this.keys.has('KeyD') ? 1 : this.keys.has('KeyA') ? -1 : 0;
      if (this.parkour.tryStartWallrun(feet, phys.height, this.yaw, vel, prefer)) {
        this.airTime = 0;
        this.events.onWallrunStart?.(this.parkour.wall.side);
      }
    }

    // ---- Automatic ledge recovery (mantle).
    if (
      this.phase === 'air' && !this.parkour.wall.active &&
      this.parkour.traversalCooldown <= 0 && holdingForward && this.airTime > 0.08
    ) {
      const plan = this.parkour.tryMantle(feet, phys.height, this.yaw, vel, this.scratch);
      if (plan) this.commitTraversal(plan);
    }

    // ---- Vault (E).
    if (vaultPressed && (phys.grounded || this.phase === 'slide') && holdingForward) {
      const plan = this.parkour.tryVault(feet, phys.height, this.yaw, vel, this.scratch);
      if (plan) {
        if (this.phase === 'slide' && phys.canStandAtHeight(PLAYER_STAND_H)) {
          this.endSlide(true);
        }
        this.commitTraversal(plan);
      }
      this.vaultBufferT = 0;
    }
  }

  private performJump(): void {
    this.physics.vel.y = JUMP_SPEED;
    this.jumpBufferT = 0;
    this.coyoteT = 0;
    this.jumpCutUsed = false;
    this.airTime = 0;
    this.phase = 'air';
    this.events.onJump?.();
  }

  private beginSlide(): void {
    this.phase = 'slide';
    this.physics.setHeight(PLAYER_SLIDE_H);
    const vel = this.physics.vel;
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > SLIDE_BOOST_MIN_SPEED && sp < SPRINT_SPEED * 1.2) {
      const f = (sp + 0.45) / sp;
      vel.x *= f;
      vel.z *= f;
    }
    this.slideTime = 0;
    this.slideCdT = SLIDE_COOLDOWN;
    this.events.onSlideStart?.();
  }

  private endSlide(skipEvent = false): void {
    this.phase = 'ground';
    if (this.physics.canStandAtHeight(PLAYER_STAND_H)) {
      this.physics.setHeight(PLAYER_STAND_H);
    }
    if (!skipEvent) this.events.onSlideEnd?.();
  }

  private commitTraversal(plan: TraversalPlan): void {
    this.physics.vel.set(0, 0, 0);
    this.parkour.traversal = plan;
    this.physics.landedImpact = 0;
    if (plan.kind === 'mantle') {
      this.events.onMantle?.();
    } else {
      this.events.onVault?.();
    }
    this.jumpBufferT = 0;
    this.vaultBufferT = 0;
  }

  /** Ground/air locomotion with Source-style accelerate. */
  private locomotion(dt: number, vel: THREE.Vector3, grounded: boolean, fwd: number, strafe: number): void {
    const maxSpeed = this.isSprinting() ? SPRINT_SPEED : WALK_SPEED;
    let wishX = 0, wishZ = 0;
    let wish = false;
    if (fwd !== 0 || strafe !== 0) {
      wishX = -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * strafe;
      wishZ = -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * strafe;
      const len = Math.hypot(wishX, wishZ) || 1;
      wishX /= len; wishZ /= len;
      wish = true;
    }

    if (grounded) {
      if (wish) {
        const proj = vel.x * wishX + vel.z * wishZ;
        const addSpeed = maxSpeed - proj;
        if (addSpeed > 0) {
          const add = Math.min(GROUND_ACCEL * dt, addSpeed);
          vel.x += wishX * add;
          vel.z += wishZ * add;
        }
      } else {
        const f = Math.max(0, 1 - GROUND_FRICTION * dt);
        vel.x *= f;
        vel.z *= f;
        if (Math.hypot(vel.x, vel.z) < 0.35) { vel.x = 0; vel.z = 0; }
      }
    } else {
      // Air control: steer without gaining beyond momentum carried into the air.
      if (wish) {
        const proj = vel.x * wishX + vel.z * wishZ;
        const carriableMax = Math.max(this.speed(), WALK_SPEED * 1.05);
        if (proj < carriableMax) {
          const add = Math.min(AIR_ACCEL * dt, carriableMax - proj);
          vel.x += wishX * add;
          vel.z += wishZ * add;
        }
      }
      // Slight drag on extreme speeds (fall damage-free but sane).
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > SPRINT_SPEED * 1.35) {
        const f = Math.max(0, 1 - AIR_DRAG * dt);
        vel.x *= f;
        vel.z *= f;
      }
    }
  }

  /** Slide handling: low friction, gentle steering, crouch-crawl when slow. */
  private steerSlide(dt: number, vel: THREE.Vector3, fwd: number, strafe: number): void {
    const sp = Math.hypot(vel.x, vel.z);
    let dirX = sp > 0.01 ? vel.x / sp : 0;
    let dirZ = sp > 0.01 ? vel.z / sp : 0;

    if (sp > 0.8 && (fwd !== 0 || strafe !== 0)) {
      // Gentle steering while sliding, only along the slide direction.
      let wishX = -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * strafe;
      let wishZ = -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * strafe;
      const wLen = Math.hypot(wishX, wishZ) || 1;
      wishX /= wLen; wishZ /= wLen;
      const along = wishX * dirX + wishZ * dirZ;
      if (along > 0.5) {
        const k = Math.min(1, SLIDE_STEER * dt);
        let nx = dirX + (wishX - dirX) * k;
        let nz = dirZ + (wishZ - dirZ) * k;
        const nl = Math.hypot(nx, nz) || 1;
        dirX = nx / nl;
        dirZ = nz / nl;
      }
    }

    let newSp = Math.max(0, sp - SLIDE_FRICTION * dt);

    // Crouch-crawl when the slide has nearly stopped and the player is stuck
    // under a low cover: keep gliding in the held direction.
    if (newSp < 1.2 && (fwd !== 0 || strafe !== 0)) {
      let wishX = -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * strafe;
      let wishZ = -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * strafe;
      const wLen = Math.hypot(wishX, wishZ) || 1;
      wishX /= wLen; wishZ /= wLen;
      newSp += CRAWL_ACCEL * dt;
      newSp = Math.min(newSp, CRAWL_SPEED);
      dirX = wishX; dirZ = wishZ;
    }

    vel.x = dirX * newSp;
    vel.z = dirZ * newSp;
    this.slideTime += dt;

    const wantRelease = !this.slideHeld && this.slideTime > SLIDE_END_TIME;
    if (newSp <= SLIDE_END_SPEED || wantRelease) {
      if (this.physics.canStandAtHeight(PLAYER_STAND_H)) {
        this.endSlide();
      }
      // Under a low cover: stay crouched until there is headroom.
    }
  }
}

const _v1 = new THREE.Vector3();
