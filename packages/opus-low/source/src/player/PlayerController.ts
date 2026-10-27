import * as THREE from 'three';
import { Box, CollisionWorld } from '../world/CollisionWorld';
import { PlayerBody, moveAndCollide } from './PlayerPhysics';
import { ParkourSystem } from './ParkourSystem';

/** Tunable movement values. Level gaps are designed around these numbers. */
export const MOVE = {
  walkSpeed: 6.2,
  sprintSpeed: 10.5,
  groundAccel: 14,      // exponential approach rate toward target velocity
  groundDecel: 11,
  overspeedDecay: 2.2,  // gentle decay when above target speed (keeps momentum)
  airAccel: 14,         // m/s^2 of air steering
  gravity: 22,
  fallMultiplier: 1.25,
  jumpVelocity: 7.2,
  jumpCutFactor: 0.5,   // vertical speed multiplier when jump is released early
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  standHeight: 1.8,
  slideHeight: 0.85,
  slideMinSpeed: 5,
  slideFriction: 3.2,
  slideMaxTime: 1.15,
  slideBoost: 1.08,
  crawlSpeed: 3,
};

export type MoveState = 'move' | 'slide' | 'wallrun' | 'traverse';

export interface PlayerInput {
  forward: number;
  right: number;
  sprint: boolean;
  jumpHeld: boolean;
  slideHeld: boolean;
  yaw: number;
}

export type PlayerEvent =
  | { type: 'jump' } | { type: 'land'; impact: number } | { type: 'slideStart' } | { type: 'slideEnd' }
  | { type: 'wallStart' } | { type: 'wallEnd' } | { type: 'vault' } | { type: 'mantle' };

export class PlayerController {
  body = new PlayerBody();
  state: MoveState = 'move';
  parkour: ParkourSystem;
  events: PlayerEvent[] = [];

  coyote = 0;
  jumpBuffer = 0;
  slideBuffer = 0;
  vaultBuffer = 0;
  jumping = false;
  slideTime = 0;
  slideCooldown = 0;
  /** Last wall run surface; cannot be reused until touching the ground (prevents exploits). */
  lastWall: Box | null = null;

  readonly fwd = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  private wish = new THREE.Vector3();

  constructor(public world: CollisionWorld) {
    this.parkour = new ParkourSystem(this);
  }

  get horizontalSpeed(): number { return Math.hypot(this.body.vel.x, this.body.vel.z); }

  respawn(pos: THREE.Vector3) {
    this.body.pos.copy(pos);
    this.body.vel.set(0, 0, 0);
    this.body.height = MOVE.standHeight;
    this.body.grounded = false;
    this.state = 'move';
    this.coyote = this.jumpBuffer = this.slideBuffer = this.vaultBuffer = 0;
    this.jumping = false;
    this.lastWall = null;
    this.parkour.reset();
  }

  hasHeadroom(): boolean {
    const p = this.body.pos;
    return this.world.isFree(p.x, p.y + 0.01, p.z, this.body.radius, MOVE.standHeight - 0.01);
  }

  /** One fixed-timestep update. */
  step(dt: number, inp: PlayerInput) {
    const body = this.body;
    this.fwd.set(-Math.sin(inp.yaw), 0, -Math.cos(inp.yaw));
    this.right.set(Math.cos(inp.yaw), 0, -Math.sin(inp.yaw));
    this.wish.copy(this.fwd).multiplyScalar(inp.forward).addScaledVector(this.right, inp.right);
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    this.jumpBuffer -= dt;
    this.slideBuffer -= dt;
    this.vaultBuffer -= dt;
    this.slideCooldown -= dt;
    this.coyote = body.grounded ? MOVE.coyoteTime : this.coyote - dt;
    this.parkour.tick(dt);

    if (this.state === 'traverse') { this.parkour.updateTraverse(dt); return; }

    if (this.vaultBuffer > 0 && this.state !== 'wallrun' && this.parkour.tryTraverse('vault')) {
      this.vaultBuffer = 0;
      return;
    }

    if (this.state === 'wallrun') this.parkour.updateWallrun(dt, inp);
    else if (this.state === 'slide') this.updateSlide(dt, inp);
    else this.updateMove(dt, inp);
    if ((this.state as MoveState) === 'traverse') return;

    if (this.state !== 'wallrun') {
      const g = MOVE.gravity * (body.vel.y < 0 ? MOVE.fallMultiplier : 1);
      body.vel.y = Math.max(body.vel.y - g * dt, -45);
    }

    const res = moveAndCollide(body, this.world, dt);
    if (res.landed) {
      this.events.push({ type: 'land', impact: res.impact });
      this.lastWall = null;
      this.jumping = false;
      if (this.state === 'wallrun') this.parkour.endWallrun(false);
    }
  }

  private updateMove(dt: number, inp: PlayerInput) {
    const body = this.body;
    const v = body.vel;
    const hs = this.horizontalSpeed;
    const wishing = this.wish.lengthSq() > 0.01;
    const target = inp.sprint && inp.forward > 0 ? MOVE.sprintSpeed : MOVE.walkSpeed;

    if (body.grounded) {
      // Tapping slide always works (slow = crouch); holding it re-triggers after a short cooldown.
      if (this.slideBuffer > 0 || (inp.slideHeld && this.slideCooldown <= 0 && hs > MOVE.slideMinSpeed)) {
        this.startSlide(this.slideBuffer > 0 && hs > MOVE.slideMinSpeed);
        return;
      }
      const rate = !wishing ? MOVE.groundDecel : hs > target + 0.5 ? MOVE.overspeedDecay : MOVE.groundAccel;
      const k = 1 - Math.exp(-rate * dt);
      v.x += (this.wish.x * target - v.x) * k;
      v.z += (this.wish.z * target - v.z) * k;
    } else {
      // Limited air control: steer, but never gain speed beyond what we already had.
      if (wishing) {
        v.x += this.wish.x * MOVE.airAccel * dt;
        v.z += this.wish.z * MOVE.airAccel * dt;
        const cap = Math.max(hs, target);
        const ns = Math.hypot(v.x, v.z);
        if (ns > cap) { v.x *= cap / ns; v.z *= cap / ns; }
      }
      if (inp.forward > 0 && this.parkour.tryStartWallrun()) return;
      if (inp.forward > 0 && v.y < 5 && this.parkour.tryTraverse('mantle')) return;
    }

    if (this.jumpBuffer > 0 && (body.grounded || this.coyote > 0)) this.doJump();

    // Variable jump height: releasing space early cuts the ascent.
    if (this.jumping && !inp.jumpHeld && v.y > 0) { v.y *= MOVE.jumpCutFactor; this.jumping = false; }
    if (v.y <= 0) this.jumping = false;
  }

  doJump() {
    this.body.vel.y = MOVE.jumpVelocity;
    this.body.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumping = true;
    this.events.push({ type: 'jump' });
  }

  private startSlide(boosted: boolean) {
    const v = this.body.vel;
    const hs = this.horizontalSpeed;
    const boost = boosted ? Math.min(MOVE.slideBoost, 13 / hs) : 1;
    v.x *= boost; v.z *= boost;
    this.state = 'slide';
    this.slideTime = 0;
    this.slideBuffer = 0;
    this.body.height = MOVE.slideHeight;
    this.events.push({ type: 'slideStart' });
  }

  private endSlide() {
    this.state = 'move';
    this.body.height = MOVE.standHeight;
    this.slideCooldown = 0.15;
    this.events.push({ type: 'slideEnd' });
  }

  private updateSlide(dt: number, inp: PlayerInput) {
    const body = this.body;
    const v = body.vel;
    this.slideTime += dt;
    let hs = this.horizontalSpeed;
    if (body.grounded && hs > 0) {
      const ns = Math.max(0, hs - MOVE.slideFriction * dt);
      v.x *= ns / hs; v.z *= ns / hs;
      hs = ns;
    }
    const headroom = this.hasHeadroom();

    if (this.jumpBuffer > 0 && (body.grounded || this.coyote > 0) && headroom) {
      this.endSlide();
      this.doJump();
      return;
    }
    if (!body.grounded && headroom && this.coyote <= 0) { this.endSlide(); return; }

    // Momentum phase is over: crouch-walk while slide is held or there is no room to stand.
    const momentumOver = this.slideTime > MOVE.slideMaxTime || hs < MOVE.crawlSpeed + 0.1;
    if ((!inp.slideHeld && this.slideTime > 0.25) || momentumOver) {
      if (headroom && !(momentumOver && inp.slideHeld)) { this.endSlide(); return; }
      if (momentumOver) {
        const k = 1 - Math.exp(-10 * dt);
        v.x += (this.wish.x * MOVE.crawlSpeed - v.x) * k;
        v.z += (this.wish.z * MOVE.crawlSpeed - v.z) * k;
      }
    }
  }
}
