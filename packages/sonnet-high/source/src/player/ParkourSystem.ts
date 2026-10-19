import { MOVE } from './MovementConfig.ts';
import { PLAYER_RADIUS, STAND_HEIGHT } from './PlayerPhysics.ts';
import type { PlayerPhysics } from './PlayerPhysics.ts';
import type { Solid, SweepHit } from '../world/CollisionWorld.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A scripted move (vault over an obstacle or mantle onto a ledge) described as a quadratic
 * Bezier from `p0` through control point `pc` to `p2`. Plans are only produced when the whole
 * path has been verified to be free of collisions, so playback can ignore physics entirely.
 */
export interface ActionPlan {
  kind: 'vault' | 'mantle';
  p0: Vec3;
  pc: Vec3;
  p2: Vec3;
  duration: number;
  exitSpeed: number;
  exitDirX: number;
  exitDirZ: number;
}

export interface WallContact {
  solid: Solid;
  /** Outward wall normal (points from the wall towards the player). */
  nx: number;
  nz: number;
  dist: number;
  /** +1 if the wall is on the player's right, -1 on the left. */
  side: 1 | -1;
}

export function bezierPoint(plan: ActionPlan, u: number, out: Vec3): Vec3 {
  const a = (1 - u) * (1 - u);
  const b = 2 * u * (1 - u);
  const c = u * u;
  out.x = a * plan.p0.x + b * plan.pc.x + c * plan.p2.x;
  out.y = a * plan.p0.y + b * plan.pc.y + c * plan.p2.y;
  out.z = a * plan.p0.z + b * plan.pc.z + c * plan.p2.z;
  return out;
}

/**
 * Detection logic for the contextual parkour moves: vaulting, ledge mantling and wall running.
 * It only *looks* at the world; PlayerController owns the state machine and executes the plans.
 */
export class ParkourSystem {
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };

  private readonly phys: PlayerPhysics;

  constructor(phys: PlayerPhysics) {
    this.phys = phys;
  }

  // ---------------------------------------------------------------------------------------
  // Vault
  // ---------------------------------------------------------------------------------------

  /**
   * Looks for a small obstacle in front of the player (direction dirX/dirZ) that can be hopped
   * over. Falls back to climbing on top when the obstacle is too deep to clear in one go.
   */
  probeVault(dirX: number, dirZ: number, speed: number): ActionPlan | null {
    const p = this.phys;
    const world = p.world;
    const hit = world.sweepHorizontal(
      p.x,
      p.z,
      p.y + 0.12,
      p.y + MOVE.vaultMaxRise,
      dirX,
      dirZ,
      MOVE.vaultReach,
      PLAYER_RADIUS,
    );
    if (!hit) return null;
    const s = hit.solid;
    const rise = s.maxY - p.y;
    if (rise < MOVE.vaultMinRise || rise > MOVE.vaultMaxRise) return null;

    const nx = hit.nx;
    const nz = hit.nz;
    const alongX = nx !== 0;
    const depth = alongX ? s.maxX - s.minX : s.maxZ - s.minZ;
    // Coordinates (on the face axis) of the near / far faces.
    const nearFace = alongX ? (nx > 0 ? s.maxX : s.minX) : nz > 0 ? s.maxZ : s.minZ;
    const farFace = alongX ? (nx > 0 ? s.minX : s.maxX) : nz > 0 ? s.minZ : s.maxZ;
    const dirx = -nx;
    const dirz = -nz;
    const top = s.maxY;
    const exitSpeed = Math.min(Math.max(speed * 0.95, 4.2), 10.5);

    if (depth <= MOVE.vaultMaxDepth) {
      // Hop over: land just beyond the far face.
      // Taller obstacles need more room beyond the far face to come back down smoothly.
      const off = PLAYER_RADIUS + 0.35 + 0.7 * rise;
      const ex = alongX ? farFace + dirx * off : p.x;
      const ez = alongX ? p.z : farFace + dirz * off;
      const gy = world.groundBelow(ex, ez, PLAYER_RADIUS, top + 0.02, 3.5, 0.0);
      if (gy !== null && p.isFreeAt(ex, gy, ez, STAND_HEIGHT)) {
        const p0: Vec3 = { x: p.x, y: p.y, z: p.z };
        const p2: Vec3 = { x: ex, y: gy, z: ez };
        const plan = this.buildArc(p0, p2, top, exitSpeed, dirx, dirz, speed, alongX, (nearFace + farFace) / 2);
        if (plan) return plan;
      }
    }
    // Climb on top instead.
    return this.planMantle(hit, speed, MOVE.vaultMaxRise + 0.01);
  }

  private buildArc(
    p0: Vec3,
    p2: Vec3,
    top: number,
    exitSpeed: number,
    dirx: number,
    dirz: number,
    speed: number,
    alongX: boolean,
    midAxis: number,
  ): ActionPlan | null {
    // The curve is forced through a point above the obstacle's centre line so the body clears it
    // even though the take-off point is usually further from the obstacle than the landing point.
    const mx = alongX ? midAxis : p0.x;
    const mz = alongX ? p0.z : midAxis;
    const dA = Math.hypot(mx - p0.x, mz - p0.z);
    const dB = Math.hypot(p2.x - mx, p2.z - mz);
    const um = Math.min(Math.max(dA / Math.max(dA + dB, 1e-3), 0.25), 0.75);
    const k = 2 * um * (1 - um);
    for (let attempt = 0; attempt < 4; attempt++) {
      const ym = top + 0.3 + attempt * 0.25;
      // Solve Q(um) = (mx, ym, mz) for the control point.
      const a = (1 - um) * (1 - um);
      const c = um * um;
      const plan: ActionPlan = {
        kind: 'vault',
        p0,
        pc: {
          x: (mx - a * p0.x - c * p2.x) / k,
          y: (ym - a * p0.y - c * p2.y) / k,
          z: (mz - a * p0.z - c * p2.z) / k,
        },
        p2,
        duration: 0.4,
        exitSpeed,
        exitDirX: dirx,
        exitDirZ: dirz,
      };
      if (!this.pathIsClear(plan, 0.1)) continue;
      const len = Math.hypot(p2.x - p0.x, p2.z - p0.z) + (ym - p0.y) * 0.8;
      plan.duration = Math.min(Math.max(len / Math.max(speed, 6.5), 0.36), 0.72);
      return plan;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------
  // Mantle (ledge recovery)
  // ---------------------------------------------------------------------------------------

  /** Airborne ledge grab: a ledge directly ahead whose top is within reach. */
  probeMantle(dirX: number, dirZ: number, speed: number): ActionPlan | null {
    const p = this.phys;
    const hit = p.world.sweepHorizontal(
      p.x,
      p.z,
      p.y + MOVE.mantleMinRise,
      p.y + 1.0,
      dirX,
      dirZ,
      MOVE.mantleReach,
      PLAYER_RADIUS,
    );
    if (!hit) return null;
    const len = Math.hypot(dirX, dirZ);
    // Must be facing the wall reasonably squarely.
    if ((dirX * -hit.nx + dirZ * -hit.nz) / len < 0.5) return null;
    return this.planMantle(hit, speed, MOVE.mantleMaxRise);
  }

  private planMantle(hit: SweepHit, speed: number, maxRise: number): ActionPlan | null {
    const p = this.phys;
    const s = hit.solid;
    const top = s.maxY;
    const rise = top - p.y;
    if (rise < 0.2 || rise > maxRise) return null;
    const nx = hit.nx;
    const nz = hit.nz;
    const alongX = nx !== 0;
    const nearFace = alongX ? (nx > 0 ? s.maxX : s.minX) : nz > 0 ? s.maxZ : s.minZ;
    const dirx = -nx;
    const dirz = -nz;

    // Target: stand on the ledge just past its edge, clamped to the solid's own extents.
    const inset = PLAYER_RADIUS + 0.25;
    let tx = alongX ? nearFace + dirx * inset : p.x;
    let tz = alongX ? p.z : nearFace + dirz * inset;
    const m = 0.08;
    tx = Math.min(Math.max(tx, s.minX + m), s.maxX - m);
    tz = Math.min(Math.max(tz, s.minZ + m), s.maxZ - m);
    if (!p.isFreeAt(tx, top, tz, STAND_HEIGHT)) return null;
    const support = p.world.groundBelow(tx, tz, 0.05, top + 0.02, 0.2, 0.0);
    if (support === null || Math.abs(support - top) > 0.03) return null;

    const outward = PLAYER_RADIUS + 0.25;
    const pc: Vec3 = {
      x: alongX ? nearFace + nx * outward : p.x,
      y: top + 0.4,
      z: alongX ? p.z : nearFace + nz * outward,
    };
    const plan: ActionPlan = {
      kind: 'mantle',
      p0: { x: p.x, y: p.y, z: p.z },
      pc,
      p2: { x: tx, y: top, z: tz },
      duration: 0.34 + rise * 0.12,
      exitSpeed: Math.min(Math.max(speed * 0.8, 3.5), 9.0),
      exitDirX: dirx,
      exitDirZ: dirz,
    };
    if (!this.pathIsClear(plan, 0.1)) return null;
    return plan;
  }

  /**
   * Samples the plan's path and makes sure a standing player never meaningfully intersects a
   * solid. The test box is shrunk a few centimetres so brushing a ledge edge is tolerated
   * (the scripted motion itself has no collision, and the body is invisible in first person).
   */
  private pathIsClear(plan: ActionPlan, skip: number): boolean {
    const p = this.phys;
    const t = this.tmp;
    for (let i = 1; i <= 20; i++) {
      const u = i / 20;
      if (u < skip) continue;
      bezierPoint(plan, u, t);
      if (!p.isFreeAt(t.x, t.y + 0.06, t.z, STAND_HEIGHT - 0.06, 0.06)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // Wall run
  // ---------------------------------------------------------------------------------------

  /** Finds a runnable wall on the given side (+1 right, -1 left) of the heading (hx, hz). */
  probeWall(hx: number, hz: number, side: 1 | -1, lockId: number): WallContact | null {
    const p = this.phys;
    // Right-hand vector of a heading (hx, hz) in this y-up world: (-hz, hx).
    // e.g. facing -z (0,-1) -> right = (+1, 0); facing +x (1,0) -> right = (0, +1).
    const rx = -hz * side;
    const rz = hx * side;
    const hit = p.world.sweepHorizontal(
      p.x,
      p.z,
      p.y + 0.4,
      p.y + 1.5,
      rx,
      rz,
      MOVE.wallDetectDistance,
      PLAYER_RADIUS,
      (s) => s.runnable && s.id !== lockId,
    );
    if (!hit) return null;
    return { solid: hit.solid, nx: hit.nx, nz: hit.nz, dist: hit.dist, side };
  }
}
