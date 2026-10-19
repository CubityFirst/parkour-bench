import * as THREE from 'three';
import { CollisionWorld } from '../world/CollisionWorld';
import { PlayerPhysics, STAND_H, SLIDE_H } from './PlayerPhysics';
import { ParkourSystem } from './ParkourSystem';
import { FirstPersonCamera } from './FirstPersonCamera';

export interface PlayerEvents {
  jump(): void;
  land(impact: number): void;
  step(sprint: boolean): void;
  slide(on: boolean): void;
  mantle(): void;
}

// Movement tuning (metres, seconds)
const WALK = 6.2;
const SPRINT = 10;
const GROUND_ACCEL = 45;
const SPRINT_ACCEL = 30;
const GROUND_FRICTION = 42;
const OVERSPEED_FRICTION = 6;  // how fast excess momentum bleeds off on the ground
const AIR_ACCEL = 16;
const AIR_WALK = 6.5;
const JUMP_V = 9.6;
const GRAVITY_UP_HELD = 26;
const GRAVITY_UP_RELEASED = 55; // variable jump height: letting go cuts the jump short
const GRAVITY_DOWN = 32;
const MAX_FALL = 45;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.13;
const SLIDE_FRICTION = 4.5;
const SLIDE_MIN_ENTRY = 5.5;
const WALL_MIN_SPEED = 5.5;
const WALL_MAX_TIME = 2.0;

/** Input handling + movement state machine. Call update() with a fixed dt. */
export class PlayerController {
  physics: PlayerPhysics;
  parkour = new ParkourSystem();
  cam: FirstPersonCamera;
  events: Partial<PlayerEvents> = {};

  private keys = new Set<string>();
  private pressed = new Set<string>();
  private prevPos = new THREE.Vector3();
  private interpPos = new THREE.Vector3();
  private jumpBuffer = 0;
  private crouchBuffer = 0;
  private coyote = 0;
  private lastWall: import('../world/CollisionWorld').Box | null = null;
  private stepDist = 0;
  private strafe = 0;
  private sprinting = false;

  constructor(world: CollisionWorld, aspect: number) {
    this.physics = new PlayerPhysics(world);
    this.cam = new FirstPersonCamera(aspect);
  }

  get hSpeed(): number { return Math.hypot(this.physics.vel.x, this.physics.vel.z); }
  get mode(): string { return this.parkour.mode; }

  // ---------- input ----------
  keyDown(code: string): void {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }
  keyUp(code: string): void { this.keys.delete(code); }
  clearInput(): void { this.keys.clear(); this.pressed.clear(); }
  private consume(...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  respawn(pos: THREE.Vector3, yaw = 0): void {
    const p = this.physics;
    p.pos.copy(pos);
    p.vel.set(0, 0, 0);
    p.setHeight(STAND_H);
    p.grounded = false;
    this.parkour.reset();
    this.lastWall = null;
    this.jumpBuffer = this.crouchBuffer = this.coyote = 0;
    this.cam.yaw = yaw;
    this.cam.pitch = 0;
    this.prevPos.copy(pos);
    this.events.slide?.(false);
  }

  // ---------- fixed-step update ----------
  update(dt: number): void {
    const p = this.physics, pk = this.parkour, k = this.keys;
    this.prevPos.copy(p.pos);

    const fwdIn = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const strIn = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    const crouchHeld = k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight');
    const jumpHeld = k.has('Space');
    this.strafe = strIn;

    if (this.consume('Space')) this.jumpBuffer = JUMP_BUFFER; else this.jumpBuffer -= dt;
    if (this.consume('KeyC', 'ControlLeft', 'ControlRight')) this.crouchBuffer = 0.25; else this.crouchBuffer -= dt;
    const vaultPressed = this.consume('KeyE');

    const yaw = this.cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let wx = fx * fwdIn + rx * strIn, wz = fz * fwdIn + rz * strIn;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    const hSpeed = this.hSpeed;
    this.sprinting = shift && fwdIn > 0;

    // ----- mantle / vault in progress -----
    if (pk.mode === 'tween') {
      const tw = pk.tween!;
      if (pk.stepTween(dt, p)) {
        p.vel.set(tw.dirX * tw.exitSpeed, 0, tw.dirZ * tw.exitSpeed);
        pk.tween = null;
        pk.mode = 'normal';
      }
      return;
    }

    if (p.grounded) { this.coyote = COYOTE; this.lastWall = null; } else this.coyote -= dt;
    const wasGrounded = p.grounded;

    // E: vault over low obstacles (works on the ground or just after leaving it)
    if (vaultPressed && pk.mode === 'normal' && (p.grounded || this.coyote > 0)) {
      let dx = fx, dz = fz;
      if (hSpeed > 2) { dx = p.vel.x / hSpeed; dz = p.vel.z / hSpeed; }
      if (pk.startVaultIfAny(p, dx, dz, hSpeed)) { this.events.mantle?.(); return; }
    }

    if (pk.mode === 'slide') this.updateSlide(dt, strIn, crouchHeld, jumpHeld);
    else if (pk.mode === 'wallrun') this.updateWallRun(dt, fwdIn, crouchHeld);
    else this.updateNormal(dt, wx, wz, wl, hSpeed, fwdIn, crouchHeld, jumpHeld);

    // mode may have switched to tween (mantle) inside updateNormal
    if ((pk.mode as string) === 'tween') return;

    const vyBefore = p.vel.y;
    p.move(dt);

    // slide: if we ran into something, keep the stored speed consistent
    if (pk.mode === 'slide') pk.slideSpeed = Math.min(pk.slideSpeed, Math.max(this.hSpeed + 0.5, 0));

    // landing
    if (p.grounded && !wasGrounded && vyBefore < -3) {
      const impact = -vyBefore;
      this.events.land?.(impact);
      this.cam.kickLand(impact);
      if (pk.mode === 'normal') {
        if (this.crouchBuffer > 0 && crouchHeld && this.hSpeed > SLIDE_MIN_ENTRY) this.startSlide();
        else {
          // controlled landing friction (hard landings cost a little speed)
          const f = 1 - Math.min(0.18, Math.max(0, impact - 6) * 0.012);
          p.vel.x *= f; p.vel.z *= f;
        }
      }
    }

    // footsteps
    if (p.grounded && pk.mode === 'normal' && this.hSpeed > 2) {
      this.stepDist += this.hSpeed * dt;
      const stride = this.sprinting ? 3.1 : 2.2;
      if (this.stepDist > stride) { this.stepDist = 0; this.events.step?.(this.sprinting); }
    }
  }

  private startSlide(): void {
    const p = this.physics, pk = this.parkour;
    const s = this.hSpeed;
    if (s < 0.1) return;
    pk.mode = 'slide';
    pk.slideDirX = p.vel.x / s;
    pk.slideDirZ = p.vel.z / s;
    pk.slideSpeed = Math.max(s, 8.5); // sliding keeps (and slightly boosts) entry momentum
    p.setHeight(SLIDE_H);
    this.crouchBuffer = 0;
    this.events.slide?.(true);
  }

  private endSlide(): void {
    const p = this.physics, pk = this.parkour;
    pk.mode = 'normal';
    p.vel.x = pk.slideDirX * pk.slideSpeed;
    p.vel.z = pk.slideDirZ * pk.slideSpeed;
    p.setHeight(STAND_H);
    this.events.slide?.(false);
  }

  private updateSlide(dt: number, strIn: number, crouchHeld: boolean, jumpHeld: boolean): void {
    const p = this.physics, pk = this.parkour;
    pk.slideSpeed = Math.max(0, pk.slideSpeed - SLIDE_FRICTION * dt);
    // slight steering
    if (strIn !== 0) {
      const rx = -pk.slideDirZ, rz = pk.slideDirX; // right of slide dir (-z is forward)
      const nx = pk.slideDirX + rx * strIn * 1.2 * dt, nz = pk.slideDirZ + rz * strIn * 1.2 * dt;
      const l = Math.hypot(nx, nz) || 1;
      pk.slideDirX = nx / l; pk.slideDirZ = nz / l;
    }
    p.vel.x = pk.slideDirX * pk.slideSpeed;
    p.vel.z = pk.slideDirZ * pk.slideSpeed;
    p.vel.y = Math.max(p.vel.y - GRAVITY_DOWN * dt, -MAX_FALL);

    const canStand = p.canStand();
    if (this.jumpBuffer > 0 && canStand && p.grounded) {
      // jump out of the slide, momentum kept
      this.endSlide();
      this.doJump();
    } else if (!crouchHeld && canStand) {
      this.endSlide();
    } else if (pk.slideSpeed < 2.8) {
      if (canStand) this.endSlide();
      else pk.slideSpeed = 3; // low ceiling: keep creeping so we never get stuck
    } else if (!p.grounded && canStand && this.coyote <= 0) {
      this.endSlide();
    }
    void jumpHeld;
  }

  private doJump(): void {
    const p = this.physics;
    p.vel.y = JUMP_V;
    p.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.events.jump?.();
    this.cam.kickJump();
  }

  private updateNormal(dt: number, wx: number, wz: number, wl: number, hSpeed: number, fwdIn: number, crouchHeld: boolean, jumpHeld: boolean): void {
    const p = this.physics, pk = this.parkour;
    const vel = p.vel;

    // slide start
    if (p.grounded && this.crouchBuffer > 0 && hSpeed > SLIDE_MIN_ENTRY && (crouchHeld || this.crouchBuffer > 0)) {
      this.startSlide();
      if (pk.mode === 'slide') return this.updateSlide(dt, 0, crouchHeld, jumpHeld);
    }

    const target = this.sprinting ? SPRINT : WALK;
    if (p.grounded) {
      if (wl > 0) {
        const accel = this.sprinting ? SPRINT_ACCEL : GROUND_ACCEL;
        vel.x += wx * accel * dt; vel.z += wz * accel * dt;
        const sp = Math.hypot(vel.x, vel.z);
        // momentum above the cap bleeds off slowly instead of snapping down
        const limit = hSpeed > target ? Math.max(target, hSpeed - OVERSPEED_FRICTION * dt) : target;
        if (sp > limit) { vel.x *= limit / sp; vel.z *= limit / sp; }
      } else if (hSpeed > 0) {
        const ns = Math.max(0, hSpeed - GROUND_FRICTION * dt);
        vel.x *= ns / hSpeed; vel.z *= ns / hSpeed;
      }
    } else if (wl > 0) {
      // limited air control: steer, but never gain speed beyond what we had
      vel.x += wx * AIR_ACCEL * dt; vel.z += wz * AIR_ACCEL * dt;
      const sp = Math.hypot(vel.x, vel.z);
      const limit = Math.max(hSpeed, AIR_WALK);
      if (sp > limit) { vel.x *= limit / sp; vel.z *= limit / sp; }
    }

    // jump (buffered + coyote)
    if (this.jumpBuffer > 0 && this.coyote > 0) this.doJump();

    // gravity with variable jump height
    const g = vel.y > 0 ? (jumpHeld ? GRAVITY_UP_HELD : GRAVITY_UP_RELEASED) : GRAVITY_DOWN;
    vel.y = Math.max(vel.y - g * dt, -MAX_FALL);

    if (!p.grounded) {
      const sp = Math.hypot(vel.x, vel.z);

      // wall run: airborne, fast enough, holding forward, touching a runnable wall
      if (sp >= WALL_MIN_SPEED && fwdIn > 0) {
        const hit = pk.detectWall(p, this.lastWall);
        if (hit) {
          const tx = -hit.nz, tz = hit.nx;
          const along = (vel.x * tx + vel.z * tz) / sp;
          const dir = Math.sign(along) || 1;
          if (Math.abs(along) > 0.6) {
            pk.mode = 'wallrun';
            pk.wallBox = hit.box;
            pk.wallNx = hit.nx; pk.wallNz = hit.nz;
            pk.wallTx = tx * dir; pk.wallTz = tz * dir;
            pk.wallTime = 0;
            pk.wallSpeed = Math.min(13, Math.max(sp, 8.5));
            const rx = Math.cos(this.cam.yaw), rz = -Math.sin(this.cam.yaw);
            pk.wallSide = (-hit.nx * rx + -hit.nz * rz) > 0 ? 1 : -1;
            vel.y = Math.min(vel.y, 2.5);
            return;
          }
        }
      }

      // ledge recovery / mantle
      if (sp > 2.5 && fwdIn > 0 && vel.y < 5 && pk.startMantleIfAny(p, vel.x / sp, vel.z / sp, Math.max(sp * 0.85, 5))) {
        this.events.mantle?.();
      }
    }
  }

  private updateWallRun(dt: number, fwdIn: number, crouchHeld: boolean): void {
    const p = this.physics, pk = this.parkour, vel = p.vel;
    pk.wallTime += dt;
    const hit = pk.detectWall(p, null);
    const stillOn = hit && hit.box === pk.wallBox;

    const exit = () => {
      this.lastWall = pk.wallBox; // cannot re-attach to the same wall until we touch the ground
      pk.mode = 'normal';
      pk.wallSide = 0;
    };

    if (this.jumpBuffer > 0) {
      vel.x = pk.wallNx * 6.5 + pk.wallTx * pk.wallSpeed * 0.9;
      vel.z = pk.wallNz * 6.5 + pk.wallTz * pk.wallSpeed * 0.9;
      vel.y = 8.5;
      this.jumpBuffer = 0;
      this.events.jump?.();
      this.cam.kickJump();
      exit();
    } else if (!stillOn || pk.wallTime > WALL_MAX_TIME || fwdIn <= 0 || crouchHeld || p.grounded) {
      exit();
      vel.y = Math.max(vel.y, -2);
    } else {
      // slide along the wall, pressing gently into it; gravity is heavily reduced
      vel.x = pk.wallTx * pk.wallSpeed - pk.wallNx * 1.2;
      vel.z = pk.wallTz * pk.wallSpeed - pk.wallNz * 1.2;
      vel.y = Math.max(vel.y - 2 * dt, -0.8);
    }
  }

  // ---------- per-frame camera update ----------
  updateCamera(dt: number, alpha: number): void {
    const p = this.physics, pk = this.parkour;
    this.interpPos.lerpVectors(this.prevPos, p.pos, Math.min(1, alpha));
    this.cam.update(dt, {
      pos: this.interpPos,
      height: p.height,
      hSpeed: this.hSpeed,
      grounded: p.grounded,
      strafe: this.strafe,
      wallSide: pk.mode === 'wallrun' ? pk.wallSide : 0,
      sliding: pk.mode === 'slide',
      tweenKind: pk.tween ? pk.tween.kind : null,
      tweenProgress: pk.tweenProgress,
      sprinting: this.sprinting && this.hSpeed > 4,
    });
  }
}
