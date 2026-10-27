import * as THREE from 'three';
import { CollisionWorld, Collider } from '../world/CollisionWorld';
import { PLAYER_STAND_H, PLAYER_HALF_W } from './PlayerPhysics';

/**
 * ParkourSystem — wall-running, vaulting and ledge recovery.
 *
 * All detection is probe based against the static AABB world:
 *  - wall run: sideways probe while airborne + holding forward
 *  - vault: forward probe for a low obstacle when E is pressed
 *  - mantle (ledge recovery): automatic forward probe just below a platform edge
 */

export type TraversalKind = 'vault' | 'mantle';

export interface TraversalPlan {
  kind: TraversalKind;
  t: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  exitVel: THREE.Vector3;
}

export interface WallData {
  active: boolean;
  side: number;            // +1 wall on the right, -1 wall on the left
  collider: Collider | null;
  nX: number; nZ: number;  // normal pointing away from the wall (towards the player)
  tX: number; tZ: number;  // tangent direction along the wall
  speed: number;
  time: number;
  lostTimer: number;
}

const WALLRUN_MAX_TIME = 3.4;
const WALLRUN_ATTACH_SPEED = 5.0;
const WALLRUN_MIN_SPEED = 4.4;
const WALLRUN_GRAV_FALL = 3.0;
const WALLRUN_GRAV_RISE = 4.2;
const WALLRUN_FALL_MIN = -4.0;
const SAME_WALL_COOLDOWN = 0.95;
const GLOBAL_WALLRUN_COOLDOWN = 0.3;
const WALL_GAP = 0.42;
const MANTLE_VY_MAX = 2.2;

export class ParkourSystem {
  /** Internal clock (advanced by updateCooldowns). */
  private time = 0;

  wall: WallData = {
    active: false, side: 0, collider: null,
    nX: 0, nZ: 0, tX: 0, tZ: 0,
    speed: 0, time: 0, lostTimer: 0
  };

  traversal: TraversalPlan | null = null;
  traversalCooldown = 0;

  private lastWallUsed: Collider | null = null;
  private sameWallCooldownUntil = -1;
  private globalCooldownUntil = -1;
  private scratch: Collider[] = [];

  constructor(private collision: CollisionWorld) {}

  updateCooldowns(dt: number): void {
    this.time += dt;
    this.traversalCooldown = Math.max(0, this.traversalCooldown - dt);
  }

  reset(): void {
    this.wall.active = false;
    this.wall.collider = null;
    this.wall.time = 0;
    this.wall.lostTimer = 0;
    this.traversal = null;
    this.traversalCooldown = 0;
    this.sameWallCooldownUntil = -1;
    this.globalCooldownUntil = -1;
  }

  // ------------------------------------------------------------- wall run

  /**
   * Tries to attach to a wall on either side. Returns true when attached.
   * Called while airborne with forward held and enough speed.
   */
  tryStartWallrun(
    feet: THREE.Vector3, height: number, yaw: number, vel: THREE.Vector3,
    preferSide: number
  ): boolean {
    if (this.wall.active || this.time < this.globalCooldownUntil) return false;

    // Right vector for yaw (three.js convention: yaw 0 faces -Z).
    const fX = -Math.sin(yaw), fZ = -Math.cos(yaw);
    const rX = Math.cos(yaw), rZ = -Math.sin(yaw);

    const sides: number[] = preferSide !== 0 ? [preferSide, -preferSide] : [1, -1];
    for (const side of sides) {
      const dX = rX * side, dZ = rZ * side;
      // Wide lateral magnet: forgiving attach, then snap to the wall face below.
      const hit = this.collision.probeWall(
        feet.x, feet.y, feet.z, PLAYER_HALF_W, height,
        dX, dZ, 8.7, 3.0, this.scratch
      );
      if (!hit) continue;

      // Ignore the wall we just detached from during its cooldown.
      if (hit.collider === this.lastWallUsed && this.time < this.sameWallCooldownUntil) continue;

      // Check we are actually moving along the wall (not straight into it).
      const facingWall = fX * -hit.nX + fZ * -hit.nZ; // >0 = looking into the wall
      const tX0 = fX + hit.nX * facingWall;
      const tZ0 = fZ + hit.nZ * facingWall;
      const tLen = Math.hypot(tX0, tZ0);
      if (tLen < 0.35) continue;
      const tX = tX0 / tLen, tZ = tZ0 / tLen;
      const tangentSpeed = vel.x * tX + vel.z * tZ;
      if (tangentSpeed < WALLRUN_ATTACH_SPEED) continue;

      const col = hit.collider;
      this.wall.active = true;
      this.wall.side = side;
      this.wall.collider = col;
      this.wall.nX = hit.nX;
      this.wall.nZ = hit.nZ;
      this.wall.tX = tX;
      this.wall.tZ = tZ;
      this.wall.speed = Math.max(tangentSpeed, WALLRUN_ATTACH_SPEED);
      this.wall.time = 0;
      this.wall.lostTimer = 0;
      this.lastWallUsed = col;

      // Snap to a comfortable distance from the wall and kill velocity into it.
      const gapAssert = (halfW: number): void => {
        if (hit.nX !== 0) {
          const face = hit.nX > 0 ? col.maxX : col.minX;
          feet.x = face + hit.nX * (halfW + WALL_GAP);
        } else if (hit.nZ !== 0) {
          const face = hit.nZ > 0 ? col.maxZ : col.minZ;
          feet.z = face + hit.nZ * (halfW + WALL_GAP);
        }
      };
      gapAssert(PLAYER_HALF_W);
      const intoWall = -(vel.x * hit.nX) - (vel.z * hit.nZ); // >0 = moving into the wall
      if (intoWall > 0) {
        vel.x += hit.nX * intoWall;
        vel.z += hit.nZ * intoWall;
      }
      // Small lift at attach to sell the move.
      if (vel.y < 0) vel.y = Math.max(vel.y * 0.4, -2.4);
      vel.y += 0.7;
      return true;
    }
    return false;
  }

  /**
   * Advances an active wall run. Returns 'jump' when the player jumped off,
   * 'detach' when the run ended, 'continue' otherwise.
   */
  updateWallrun(
    dt: number, vel: THREE.Vector3, feet: THREE.Vector3, height: number, yaw: number,
    jumpBuffered: boolean
  ): 'jump' | 'detach' | 'continue' {
    if (!this.wall.active) return 'continue';
    this.wall.time += dt;

    // Momentum bleeds slowly at first, faster later.
    const bleed = this.wall.time < WALLRUN_MAX_TIME * 0.55 ? 0.55 : 1.9;
    this.wall.speed = Math.max(this.wall.speed - bleed * dt, WALLRUN_MIN_SPEED);

    // Reduced gravity during the run (flatter arc, keeps height along the wall).
    if (vel.y > 0) vel.y -= WALLRUN_GRAV_RISE * dt;
    else vel.y -= WALLRUN_GRAV_FALL * dt;
    vel.y = Math.max(vel.y, WALLRUN_FALL_MIN);

    // Move along the tangent with a gentle press into the wall.
    vel.x = this.wall.tX * this.wall.speed + this.wall.nX * 0.55;
    vel.z = this.wall.tZ * this.wall.speed + this.wall.nZ * 0.55;

    // Jump off the wall.
    if (jumpBuffered) {
      vel.x = this.wall.tX * this.wall.speed * 1.03 + this.wall.nX * 4.4;
      vel.z = this.wall.tZ * this.wall.speed * 1.03 + this.wall.nZ * 4.4;
      vel.y = 6.4;
      this.endWallrun();
      return 'jump';
    }

    // Natural end conditions.
    if (this.wall.time > WALLRUN_MAX_TIME || this.wall.speed <= WALLRUN_MIN_SPEED + 0.001) {
      this.endWallrun();
      return 'detach';
    }

    // Maintain contact: probe on the side we are running along.
    const rX = Math.cos(yaw), rZ = -Math.sin(yaw);
    const dX = rX * this.wall.side, dZ = rZ * this.wall.side;
    const hit = this.collision.probeWall(
      feet.x, feet.y, feet.z, PLAYER_HALF_W, height,
      dX, dZ, 1.6, 2.0, this.scratch
    );
    if (!hit) {
      this.wall.lostTimer += dt;
      if (this.wall.lostTimer > 0.14) {
        this.endWallrun();
        return 'detach';
      }
    } else {
      this.wall.lostTimer = 0;
      // Blend onto an adjacent wall that continues the run.
      if (hit.collider !== this.wall.collider &&
          Math.abs(hit.nX - this.wall.nX) < 0.01 &&
          Math.abs(hit.nZ - this.wall.nZ) < 0.01) {
        this.wall.collider = hit.collider;
        this.lastWallUsed = hit.collider;
      }
    }
    return 'continue';
  }

  private endWallrun(): void {
    this.lastWallUsed = this.wall.collider;
    this.wall.active = false;
    this.globalCooldownUntil = this.time + GLOBAL_WALLRUN_COOLDOWN;
    this.sameWallCooldownUntil = this.time + SAME_WALL_COOLDOWN;
  }

  /** Detached because we touched the ground during a wall run. */
  landDuringWallrun(): void {
    if (this.wall.active) this.endWallrun();
  }

  // ------------------------------------------------------------- vault

  /**
   * Attempts to vault a low obstacle in front of the player.
   */
  tryVault(
    feet: THREE.Vector3, height: number, yaw: number, vel: THREE.Vector3,
    outScratch: Collider[]
  ): TraversalPlan | null {
    const fX = -Math.sin(yaw), fZ = -Math.cos(yaw);
    const speed = Math.hypot(vel.x, vel.z);
    const probe = this.collision.probeForward(
      feet.x, feet.y, feet.z, PLAYER_HALF_W, height, fX, fZ, 1.05, outScratch
    );
    if (!probe) return null;
    const c = probe.collider;
    const relTop = c.maxY - feet.y;
    if (relTop < 0.5 || relTop > 1.34) return null;

    // Landing spot: on top of the obstacle, slightly past its front face.
    const landing = new THREE.Vector3(
      feet.x + fX * (probe.distance + 0.68),
      c.maxY,
      feet.z + fZ * (probe.distance + 0.68)
    );
    // Standing room at the landing point — prevents vaulting into walls or under lintels.
    if (this.collision.isBlocked(
      landing.x - PLAYER_HALF_W + 0.04, landing.y + 0.05, landing.z - PLAYER_HALF_W + 0.04,
      landing.x + PLAYER_HALF_W - 0.04, landing.y + PLAYER_STAND_H - 0.05, landing.z + PLAYER_HALF_W - 0.04
    )) return null;

    const exitSpeed = Math.max(speed * 0.96, 4.9);
    return {
      kind: 'vault',
      t: 0,
      dur: 0.3,
      from: new THREE.Vector3(feet.x, feet.y, feet.z),
      to: landing,
      exitVel: new THREE.Vector3(fX * exitSpeed, 0.4, fZ * exitSpeed)
    };
  }

  // ------------------------------------------------------------- mantle

  /**
   * Automatic ledge recovery: when airborne just under a platform edge with
   * forward held, mantle up onto it.
   */
  tryMantle(
    feet: THREE.Vector3, height: number, yaw: number, vel: THREE.Vector3,
    outScratch: Collider[]
  ): TraversalPlan | null {
    const fX = -Math.sin(yaw), fZ = -Math.cos(yaw);
    if (vel.x * fX + vel.z * fZ < 0.9) return null;
    if (vel.y > MANTLE_VY_MAX) return null;
    const speed = Math.hypot(vel.x, vel.z);
    const probe = this.collision.probeForward(
      feet.x, feet.y, feet.z, PLAYER_HALF_W, height, fX, fZ, 0.95, outScratch
    );
    if (!probe) return null;
    const c = probe.collider;
    const relTop = c.maxY - feet.y;
    if (relTop < 0.32 || relTop > 1.5) return null;

    const landing = new THREE.Vector3(
      feet.x + fX * (probe.distance + 0.5),
      c.maxY,
      feet.z + fZ * (probe.distance + 0.5)
    );
    if (this.collision.isBlocked(
      landing.x - PLAYER_HALF_W + 0.04, landing.y + 0.05, landing.z - PLAYER_HALF_W + 0.04,
      landing.x + PLAYER_HALF_W - 0.04, landing.y + PLAYER_STAND_H - 0.05, landing.z + PLAYER_HALF_W - 0.04
    )) return null;

    const exitSpeed = Math.max(speed * 0.82, 3.6);
    return {
      kind: 'mantle',
      t: 0,
      dur: 0.42,
      from: new THREE.Vector3(feet.x, feet.y, feet.z),
      to: landing,
      exitVel: new THREE.Vector3(fX * exitSpeed, 1.9, fZ * exitSpeed)
    };
  }

  /** Advances a committed traversal. Returns true when it finished this step. */
  updateTraversal(tr: TraversalPlan, dt: number, feet: THREE.Vector3): boolean {
    tr.t += dt;
    const raw = Math.min(1, tr.t / tr.dur);
    const e = raw * raw * (3 - 2 * raw); // smoothstep
    feet.x = tr.from.x + (tr.to.x - tr.from.x) * e;
    feet.z = tr.from.z + (tr.to.z - tr.from.z) * e;
    // vertical: rise fast, settle gently
    const vE = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    feet.y = tr.from.y + (tr.to.y - tr.from.y) * vE;
    if (raw >= 1) {
      feet.copy(tr.to);
      return true;
    }
    return false;
  }
}

