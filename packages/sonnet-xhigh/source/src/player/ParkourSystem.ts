/**
 * ParkourSystem - detection and execution of the "special" traversal moves:
 *
 *  - Wall running (runnable vertical surfaces flagged by the level, left or right)
 *  - Vaulting     (low, thin obstacles directly in front of the player)
 *  - Mantling     (ledge recovery: the player is just below a rooftop edge)
 *
 * Wall running is driven by the normal physics integration (velocity is steered every
 * step). Vault and mantle are short scripted movements: the body is moved along a
 * pre-validated path that can never pass through geometry, which is far more reliable
 * than trying to push a physics body up and over an obstacle.
 */

import { type Box, type CollisionWorld, makeRayHit, type RayHit } from '../world/CollisionWorld';
import { MOVE } from './MovementConfig';
import { type PlayerPhysics } from './PlayerPhysics';

const EPS = 0.001;
/** Collision height used while the body is tucked up during a vault / mantle. */
export const TUCK_HEIGHT = 1.2;

export interface WallContact {
  box: Box;
  /** Face normal (pointing from the wall towards the player). */
  nx: number;
  nz: number;
  gap: number;
}

export type ScriptedKind = 'vault' | 'mantle';

export interface ScriptedMove {
  kind: ScriptedKind;
  box: Box | null;
  /** Horizontal travel direction (unit). */
  fx: number;
  fz: number;
  sx: number;
  sy: number;
  sz: number;
  /** Height the feet rise to. */
  riseY: number;
  /** Height the feet must have reached before the body may pass over the obstacle. */
  clearY: number;
  /** Seconds taken by the vertical rise. */
  rise: number;
  /** Horizontal distance (from start) at which the body touches the obstacle face. */
  faceDist: number;
  /** Horizontal distance at which the move ends. */
  endDist: number;
  /** Horizontal advance speed. */
  speed: number;
  exitSpeed: number;
  exitVy: number;
  /** Runtime state. */
  t: number;
  d: number;
  /** Estimated total duration and normalised progress 0..1 (for camera / arms). */
  duration: number;
  progress: number;
}

export function makeScriptedMove(): ScriptedMove {
  return {
    kind: 'vault', box: null, fx: 0, fz: -1, sx: 0, sy: 0, sz: 0,
    riseY: 0, clearY: 0, rise: 0.2, faceDist: 0, endDist: 1, speed: 6,
    exitSpeed: 6, exitVy: 0, t: 0, d: 0, duration: 0.3, progress: 0,
  };
}

export interface WallRunState {
  active: boolean;
  /** -1 wall on the left, +1 wall on the right. */
  side: -1 | 0 | 1;
  nx: number;
  nz: number;
  tx: number;
  tz: number;
  time: number;
  speed: number;
}

export type WallRunExit = 'none' | 'jump' | 'lost' | 'time' | 'released' | 'landed' | 'blocked';

function easeOutCubic(x: number): number {
  const k = 1 - x;
  return 1 - k * k * k;
}

/** Entry / exit parameters of a ray through the XZ footprint of a box. */
function footprintInterval(
  ox: number, oz: number, fx: number, fz: number, b: Box,
): { tmin: number; tmax: number } | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(fx) < 1e-9) {
    if (ox < b.minX || ox > b.maxX) return null;
  } else {
    let t1 = (b.minX - ox) / fx, t2 = (b.maxX - ox) / fx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(fz) < 1e-9) {
    if (oz < b.minZ || oz > b.maxZ) return null;
  } else {
    let t1 = (b.minZ - oz) / fz, t2 = (b.maxZ - oz) / fz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmin > tmax) return null;
  return { tmin, tmax };
}

export class ParkourSystem {
  readonly wall: WallRunState = { active: false, side: 0, nx: 0, nz: 0, tx: 0, tz: 0, time: 0, speed: 0 };
  /** Seconds of wall running still available before touching the ground again. */
  wallBudget: number = MOVE.wallRunBudget;
  wallCooldown = 0;

  /** The scripted move currently being executed (null when none). */
  active: ScriptedMove | null = null;
  /** Set each tick: there is a vaultable obstacle right in front of the player. */
  vaultAvailable = false;

  private readonly plan: ScriptedMove = makeScriptedMove();
  /** Scratch box used to sweep the player's footprint against an obstacle. */
  private readonly sweep = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } as unknown as Box;
  private readonly running: ScriptedMove = makeScriptedMove();
  private readonly hit: RayHit = makeRayHit();
  private readonly boxes: Box[] = [];

  constructor(
    private readonly p: PlayerPhysics,
    private readonly world: CollisionWorld,
  ) {}

  reset(): void {
    this.wall.active = false;
    this.wall.side = 0;
    this.wall.time = 0;
    this.wallBudget = MOVE.wallRunBudget;
    this.wallCooldown = 0;
    this.active = null;
    this.vaultAvailable = false;
  }

  tick(dt: number): void {
    if (this.wallCooldown > 0) this.wallCooldown -= dt;
  }

  /** Called when the player touches the ground: refills the wall-run budget. */
  onGrounded(): void {
    this.wallBudget = MOVE.wallRunBudget;
  }

  // ================================================================ wall running

  /**
   * Looks for a wall-runnable face next to the player's body. If (nx, nz) is given only
   * faces with that exact normal count (used to keep following the same wall).
   */
  findWall(reach: number, nx?: number, nz?: number): WallContact | null {
    const p = this.p;
    const r = p.radius;
    const hits = this.world.query(
      p.x - r - reach, p.y + 0.5, p.z - r - reach,
      p.x + r + reach, p.y + 1.3, p.z + r + reach,
      this.boxes,
    );
    let best: WallContact | null = null;
    for (let i = 0; i < hits.length; i++) {
      const b = hits[i];
      if (!b.flags.wallRun) continue;
      const zOverlap = Math.min(p.z + r, b.maxZ) - Math.max(p.z - r, b.minZ);
      const xOverlap = Math.min(p.x + r, b.maxX) - Math.max(p.x - r, b.minX);
      if (zOverlap > 0.1) {
        const gapA = (p.x - r) - b.maxX; // wall on the -X side, face normal +X
        if (gapA > -0.05 && gapA <= reach && (nx === undefined || (nx === 1 && nz === 0))) {
          if (!best || gapA < best.gap) best = { box: b, nx: 1, nz: 0, gap: Math.max(gapA, 0) };
        }
        const gapB = b.minX - (p.x + r); // wall on the +X side, face normal -X
        if (gapB > -0.05 && gapB <= reach && (nx === undefined || (nx === -1 && nz === 0))) {
          if (!best || gapB < best.gap) best = { box: b, nx: -1, nz: 0, gap: Math.max(gapB, 0) };
        }
      }
      if (xOverlap > 0.1) {
        const gapC = (p.z - r) - b.maxZ; // wall on the -Z side, face normal +Z
        if (gapC > -0.05 && gapC <= reach && (nx === undefined || (nx === 0 && nz === 1))) {
          if (!best || gapC < best.gap) best = { box: b, nx: 0, nz: 1, gap: Math.max(gapC, 0) };
        }
        const gapD = b.minZ - (p.z + r); // wall on the +Z side, face normal -Z
        if (gapD > -0.05 && gapD <= reach && (nx === undefined || (nx === 0 && nz === -1))) {
          if (!best || gapD < best.gap) best = { box: b, nx: 0, nz: -1, gap: Math.max(gapD, 0) };
        }
      }
    }
    return best;
  }

  /**
   * Attempts to attach to a wall. Requirements: airborne (checked by caller), forward input,
   * enough horizontal speed, a runnable wall alongside, travelling roughly parallel to it,
   * not on cooldown and wall-run budget left.
   */
  tryStartWallRun(wishForward: number): boolean {
    const p = this.p;
    if (this.wallCooldown > 0 || this.wallBudget <= 0.08) return false;
    if (wishForward < 0.3) return false;
    const speed = p.horizontalSpeed;
    if (speed < MOVE.wallRunMinSpeed || p.vy < -16) return false;

    const c = this.findWall(MOVE.wallRunAttachReach);
    if (!c) return false;

    const dirX = p.vx / speed;
    const dirZ = p.vz / speed;
    const into = dirX * c.nx + dirZ * c.nz; // < 0 means moving into the wall
    if (into < -0.82 || into > 0.35) return false;

    let tx = -c.nz;
    let tz = c.nx;
    if (tx * dirX + tz * dirZ < 0) { tx = -tx; tz = -tz; }

    const w = this.wall;
    w.active = true;
    w.nx = c.nx;
    w.nz = c.nz;
    w.tx = tx;
    w.tz = tz;
    // Wall direction = -normal; right-of-travel = (-tz, tx)
    w.side = (c.nx * tz - c.nz * tx) > 0 ? 1 : -1;
    w.time = 0;
    w.speed = Math.max(speed, MOVE.wallRunSpeedFloor);
    p.vy = Math.min(Math.max(p.vy, MOVE.wallRunEntryLift), 3.2);
    return true;
  }

  /** Steers the player along the wall for one step. Returns why the run ended, or 'none'. */
  updateWallRun(dt: number, wishForward: number, jumpBuffered: boolean, dropPressed: boolean): WallRunExit {
    const p = this.p;
    const w = this.wall;
    w.time += dt;
    this.wallBudget -= dt;

    let exit: WallRunExit = 'none';

    if (jumpBuffered) {
      // Wall jump: kick off along the wall's normal and keep the run speed.
      const s = Math.max(w.speed, MOVE.wallRunSpeedFloor);
      p.vx = w.tx * s + w.nx * MOVE.wallJumpPush;
      p.vz = w.tz * s + w.nz * MOVE.wallJumpPush;
      p.vy = MOVE.wallJumpUp;
      this.wallCooldown = MOVE.wallRunCooldown;
      exit = 'jump';
    } else if (dropPressed || wishForward < 0.1) {
      this.wallCooldown = MOVE.wallRunCooldown;
      exit = 'released';
    } else if (w.time > MOVE.wallRunMaxTime || this.wallBudget <= 0) {
      this.wallCooldown = MOVE.wallRunCooldown + 0.3;
      exit = 'time';
    } else if (p.grounded) {
      exit = 'landed';
    } else if (!this.findWall(w.time < 0.4 ? MOVE.wallRunAttachReach : MOVE.wallRunReach, w.nx, w.nz)) {
      this.wallCooldown = 0.12;
      exit = 'lost';
    } else if (p.hitWall && (p.hitWallNx !== w.nx || p.hitWallNz !== w.nz)) {
      this.wallCooldown = MOVE.wallRunCooldown;
      exit = 'blocked';
    }

    if (exit !== 'none') {
      w.active = false;
      w.side = 0;
      return exit;
    }

    w.speed = Math.max(MOVE.wallRunSpeedFloor, w.speed - MOVE.wallRunDecel * dt);
    // Run along the wall while gently pressing into it so we stay in contact.
    p.vx = w.tx * w.speed - w.nx * MOVE.wallRunPull;
    p.vz = w.tz * w.speed - w.nz * MOVE.wallRunPull;
    p.vy = Math.max(p.vy - MOVE.wallRunGravity * dt, -MOVE.wallRunMaxFall);
    return 'none';
  }

  // ================================================================ vault / mantle

  /**
   * Distances along the travel direction at which the player's centre enters / leaves the
   * obstacle's footprint grown by the player's radius - i.e. when the body (an AABB) first
   * touches and last touches it. Correct for oblique approaches, unlike a plain ray hit.
   */
  private sweepBox(b: Box, fx: number, fz: number): { tin: number; tout: number } | null {
    const r = this.p.radius;
    const s = this.sweep;
    s.minX = b.minX - r; s.maxX = b.maxX + r;
    s.minZ = b.minZ - r; s.maxZ = b.maxZ + r;
    const iv = footprintInterval(this.p.x, this.p.z, fx, fz, s);
    if (!iv || iv.tmax < 0) return null;
    return { tin: Math.max(iv.tmin, 0), tout: iv.tmax };
  }

  /**
   * Looks for a low obstacle straight ahead that can be vaulted. Fills `this.plan` and
   * returns it, or null.
   */
  findVault(fx: number, fz: number, speed: number): ScriptedMove | null {
    const p = this.p;
    const r = p.radius;
    const reach = r + MOVE.vaultLookahead + Math.min(speed, 10) * 0.07;
    const rx = -fz;
    const rz = fx;
    const hit = this.hit;
    let best: ScriptedMove | null = null;
    let bestT = Infinity;

    for (let k = 0; k < 3; k++) {
      const off = k === 0 ? 0 : (k === 1 ? -0.22 : 0.22);
      const ox = p.x + rx * off;
      const oz = p.z + rz * off;
      const oy = p.y + 0.35;
      if (!this.world.raycast(ox, oy, oz, fx, 0, fz, reach, hit)) continue;
      const b = hit.box;
      if (!b || hit.ny !== 0 || hit.t >= bestT) continue;
      const rel = b.maxY - p.y;
      if (rel < MOVE.vaultMinHeight || rel > MOVE.vaultMaxHeight || b.flags.noVault) continue;
      const sw = this.sweepBox(b, fx, fz);
      if (!sw) continue;
      // Thickness along the travel direction (the swept interval includes the body width).
      if (sw.tout - sw.tin - 2 * r > MOVE.vaultMaxDepth) continue;

      const faceDist = Math.max(0, sw.tin - 0.002);
      const endDist = sw.tout + 0.1;
      const riseY = b.maxY + 0.14;

      // Validate: the tucked body must be able to rise beside the start position and to pass
      // above the obstacle without touching anything else (ceilings, other props).
      const h = TUCK_HEIGHT;
      let clear = p.canOccupy(p.x, p.y + EPS, p.z, riseY + h - p.y, b);
      clear = clear && p.canOccupy(p.x + fx * faceDist, p.y + EPS, p.z + fz * faceDist, riseY + h - p.y, b);
      for (let s = 1; clear && s <= 4; s++) {
        const d = faceDist + (endDist - faceDist) * (s / 4);
        clear = p.canOccupy(p.x + fx * d, riseY, p.z + fz * d, h, b);
      }
      if (!clear) continue;
      // The body must be able to stand again where the move ends.
      if (!p.canOccupy(p.x + fx * endDist, riseY, p.z + fz * endDist, 1.8, b)) continue;

      const m = this.plan;
      m.kind = 'vault';
      m.box = b;
      m.fx = fx; m.fz = fz;
      m.sx = p.x; m.sy = p.y; m.sz = p.z;
      m.riseY = riseY;
      m.clearY = b.maxY + 0.02;
      m.rise = 0.10 + 0.11 * rel;
      m.faceDist = faceDist;
      m.endDist = endDist;
      m.speed = Math.max(speed * 0.95, 5.5);
      m.exitSpeed = Math.max(speed * 0.94, 5.6);
      m.exitVy = -0.5;
      m.t = 0; m.d = 0;
      m.duration = Math.max(m.rise, endDist / m.speed) + 0.03;
      m.progress = 0;
      best = m;
      bestT = hit.t;
    }
    return best;
  }

  /**
   * Looks for a ledge the player can pull up onto (just below a rooftop edge, or a tall
   * obstacle in front when pressing the interact key). Fills `this.plan` or returns null.
   */
  findMantle(fx: number, fz: number, speed: number): ScriptedMove | null {
    const p = this.p;
    const r = p.radius;
    const reach = r + 0.55;
    const rx = -fz;
    const rz = fx;
    const hit = this.hit;
    let best: ScriptedMove | null = null;
    let bestT = Infinity;

    // Several ray heights so ledges only slightly above the feet are still found.
    const heights = [0.12, 0.6, 1.1, 1.6];
    const offsets = [0, -0.2, 0.2];
    for (let hi = 0; hi < heights.length; hi++) {
      for (let oi = 0; oi < offsets.length; oi++) {
        const ox = p.x + rx * offsets[oi];
        const oz = p.z + rz * offsets[oi];
        const oy = p.y + heights[hi];
        if (!this.world.raycast(ox, oy, oz, fx, 0, fz, reach, hit)) continue;
        const b = hit.box;
        if (!b || hit.ny !== 0 || hit.t >= bestT) continue;
        // Thin things (railings, pipes) are not ledges you can stand on.
        if (b.maxX - b.minX < 0.3 || b.maxZ - b.minZ < 0.3) continue;
        const rel = b.maxY - p.y;
        // Plunging quickly? Only a ledge right at hand level can still be caught.
        const maxRel = p.vy < -6 ? MOVE.mantleMaxHeightFalling : MOVE.mantleMaxHeight;
        if (rel < MOVE.mantleMinHeight || rel > maxRel) continue;

        const sw = this.sweepBox(b, fx, fz);
        if (!sw) continue;
        const faceDist = Math.max(0, sw.tin - 0.002);
        // Centre ends up 0.2 m beyond the near face of the ledge (tin is when the body touches it).
        const endDist = sw.tin + 2 * r + 0.2;
        const topY = b.maxY + EPS;

        // Standing room on top of the ledge, and a free column for the tucked body to rise
        // along (start, half way and at the wall) - other props must not be in the way.
        if (!p.canOccupy(p.x + fx * endDist, topY, p.z + fz * endDist, 1.8)) continue;
        const colH = topY + TUCK_HEIGHT - p.y;
        let free = true;
        for (let s = 0; free && s <= 2; s++) {
          const d = (faceDist * s) / 2;
          free = p.canOccupy(p.x + fx * d, p.y + EPS, p.z + fz * d, colH, b);
        }
        if (!free) continue;

        const m = this.plan;
        m.kind = 'mantle';
        m.box = b;
        m.fx = fx; m.fz = fz;
        m.sx = p.x; m.sy = p.y; m.sz = p.z;
        m.riseY = topY;
        m.clearY = topY - 0.004;
        m.rise = 0.17 + 0.17 * rel;
        m.faceDist = faceDist;
        m.endDist = endDist;
        m.speed = 4.8;
        m.exitSpeed = Math.min(Math.max(speed * 0.7, 3.8), MOVE.sprintSpeed);
        m.exitVy = 0;
        m.t = 0; m.d = 0;
        m.duration = m.rise + 0.2;
        m.progress = 0;
        best = m;
        bestT = hit.t;
      }
    }
    return best;
  }

  /** Begins executing the most recently found plan. */
  beginScripted(): ScriptedMove {
    const run = this.running;
    Object.assign(run, this.plan);
    this.active = run;
    this.wall.active = false;
    this.wall.side = 0;
    this.p.vx = this.p.vy = this.p.vz = 0;
    this.p.height = TUCK_HEIGHT;
    return run;
  }

  /**
   * Moves the body along the scripted path. The horizontal advance is gated so the body
   * can only pass over the obstacle once it has been lifted high enough - this is what
   * makes the move look like "hands on top, pull up, swing over" without ever clipping.
   * Returns true when the move has finished.
   */
  updateScripted(dt: number): boolean {
    const m = this.active;
    if (!m) return true;
    const p = this.p;
    m.t += dt;

    const riseT = Math.min(1, m.t / m.rise);
    const y = m.sy + (m.riseY - m.sy) * easeOutCubic(riseT);
    const maxD = y >= m.clearY ? m.endDist : m.faceDist;
    m.d = Math.min(maxD, m.d + m.speed * dt);

    p.x = m.sx + m.fx * m.d;
    p.z = m.sz + m.fz * m.d;
    p.y = y;
    // Oblique paths can drift a few millimetres into neighbouring geometry; push back out.
    p.depenetrate();
    m.progress = Math.min(1, m.t / m.duration);

    if (m.d >= m.endDist - 1e-4 && riseT >= 1) {
      this.finishScripted();
      return true;
    }
    // Safety valve: a scripted move can never take longer than a second.
    if (m.t > 1.0) {
      p.x = m.sx + m.fx * m.endDist;
      p.z = m.sz + m.fz * m.endDist;
      p.y = m.riseY;
      this.finishScripted();
      return true;
    }
    return false;
  }

  private finishScripted(): void {
    const m = this.active;
    const p = this.p;
    if (!m) return;
    p.vx = m.fx * m.exitSpeed;
    p.vz = m.fz * m.exitSpeed;
    p.vy = m.exitVy;
    p.height = 1.8;
    if (!p.canOccupy(p.x, p.y, p.z, 1.8)) p.depenetrate();
    this.active = null;
  }
}
