import { Box } from '../world/CollisionWorld';
import { BODY, PlayerPhysics } from './PlayerPhysics';

/**
 * Geometry queries for the parkour moves. These only *detect* and *plan* a move;
 * PlayerController decides when to trigger it and plays it back.
 */

export const WALL_REACH = 0.5;

export interface WallHit {
  box: Box;
  /** Wall normal pointing from the wall towards the player (axis-aligned). */
  nx: number; nz: number;
  /** Run direction along the wall (unit, aligned with the player's velocity). */
  tx: number; tz: number;
}

export interface ScriptedMove {
  kind: 'vault' | 'mantle';
  sx: number; sy: number; sz: number;
  ex: number; ey: number; ez: number;
  /** Highest feet height reached (vault arc apex). */
  apex: number;
  duration: number;
  /** Direction of travel (unit XZ). */
  dx: number; dz: number;
}

const tmp: Box[] = [];

export class ParkourSystem {
  constructor(private phys: PlayerPhysics) {}

  /**
   * Finds a wall-runnable surface touching the player's side, running roughly parallel to velocity.
   * If `onlyBox` is given, only that box is considered (used to keep an active wall run attached).
   */
  findWall(velX: number, velZ: number, onlyBox?: Box): WallHit | null {
    const p = this.phys;
    const speed = Math.hypot(velX, velZ);
    if (speed < 0.5) return null;
    const hw = BODY.halfWidth;
    const R = WALL_REACH;
    const x0 = p.x - hw, x1 = p.x + hw, z0 = p.z - hw, z1 = p.z + hw;
    const boxes = p.world.query(x0 - R, p.y, z0 - R, x1 + R, p.y + p.height, z1 + R, tmp);
    let best: WallHit | null = null;
    let bestDist = Infinity;
    const consider = (box: Box, nx: number, nz: number, dist: number) => {
      // tangent axis perpendicular to the normal, signed to match the velocity
      const tAxisX = nz !== 0 ? 1 : 0;
      const tAxisZ = nx !== 0 ? 1 : 0;
      const along = velX * tAxisX + velZ * tAxisZ;
      if (Math.abs(along) / speed < 0.7) return; // heading into / away from the wall - not a run
      const s = along >= 0 ? 1 : -1;
      if (dist < bestDist) {
        bestDist = dist;
        best = { box, nx, nz, tx: tAxisX * s, tz: tAxisZ * s };
      }
    };
    for (const b of boxes) {
      if (!b.wallRun) continue;
      if (onlyBox && b !== onlyBox) continue;
      // wall must span the player's torso height
      if (b.maxY < p.y + 1.2 || b.minY > p.y + 0.4) continue;
      const zOverlap = z1 > b.minZ + 0.1 && z0 < b.maxZ - 0.1;
      const xOverlap = x1 > b.minX + 0.1 && x0 < b.maxX - 0.1;
      if (zOverlap) {
        const d1 = x0 - b.maxX;        // wall on the player's -x side
        if (d1 >= -0.05 && d1 <= R) consider(b, 1, 0, d1);
        const d2 = b.minX - x1;        // wall on the player's +x side
        if (d2 >= -0.05 && d2 <= R) consider(b, -1, 0, d2);
      }
      if (xOverlap) {
        const d3 = z0 - b.maxZ;
        if (d3 >= -0.05 && d3 <= R) consider(b, 0, 1, d3);
        const d4 = b.minZ - z1;
        if (d4 >= -0.05 && d4 <= R) consider(b, 0, -1, d4);
      }
    }
    return best;
  }

  /** Plans a vault over a low obstacle straight ahead (dx,dz unit). Returns null if there is nothing vaultable. */
  findVault(dx: number, dz: number, speed: number): ScriptedMove | null {
    const p = this.phys;
    const w = p.world;
    const feet = p.y;
    let near = -1;
    let top = 0;
    for (let d = 0.3; d <= 1.5; d += 0.1) {
      const b = w.topAt(p.x + dx * d, p.z + dz * d, feet + 0.3, feet + 1.35, feet + 0.4);
      if (b) { near = d; top = b.maxY; break; }
    }
    if (near < 0) return null;
    // find where the far side is clear (obstacle depth limited so walls can't be vaulted)
    let far = -1;
    for (let d = near + 0.3; d <= near + 2.3; d += 0.1) {
      if (!p.overlapsAt(p.x + dx * d, feet, p.z + dz * d, BODY.standHeight)) { far = d; break; }
    }
    if (far < 0) return null;
    far += 0.3; // landing margin so the body has fully cleared the obstacle while still high
    const ex = p.x + dx * far, ez = p.z + dz * far;
    if (p.overlapsAt(ex, feet, ez, BODY.standHeight)) return null;
    const apex = top + 0.12;
    const move: ScriptedMove = {
      kind: 'vault', sx: p.x, sy: feet, sz: p.z, ex, ey: feet, ez, apex,
      duration: Math.min(0.55, Math.max(0.3, far / Math.max(speed, 6.5))),
      dx, dz,
    };
    // validate the whole arc with a compact body (arms/legs tucked)
    for (let i = 0; i <= 24; i++) {
      const s = i / 24;
      const [x, y, z] = vaultPoint(move, s);
      if (p.overlapsAt(x, y, z, 1.0)) return null;
    }
    return move;
  }

  /** Plans a mantle onto a ledge just ahead whose top is within reach. */
  findMantle(dx: number, dz: number): ScriptedMove | null {
    const p = this.phys;
    const w = p.world;
    const feet = p.y;
    const reachMin = 0.5, reachMax = 1.95;
    let b: Box | null = null;
    let faceD = 0;
    for (const d of [0.4, 0.55]) {
      b = w.topAt(p.x + dx * d, p.z + dz * d, feet + reachMin, feet + reachMax, feet + 0.9);
      if (b) { faceD = d; break; }
    }
    if (!b) return null;
    const top = b.maxY;
    // landing spot on top of the ledge
    for (let d = faceD + 0.2; d <= faceD + 1.1; d += 0.1) {
      const ex = p.x + dx * d, ez = p.z + dz * d;
      const surf = w.topAt(ex, ez, top - 0.1, top + 0.1);
      if (!surf) continue;
      if (p.overlapsAt(ex, top + 0.02, ez, BODY.standHeight)) continue;
      // vertical rise must be unobstructed
      if (p.overlapsAt(p.x, feet, p.z, top + 0.05 - feet + BODY.standHeight)) return null;
      return {
        kind: 'mantle', sx: p.x, sy: feet, sz: p.z, ex, ey: top + 0.02, ez,
        apex: top + 0.05, duration: 0.5, dx, dz,
      };
    }
    return null;
  }
}

/** Position along a planned move at progress s in [0,1] (feet position). */
export function vaultPoint(m: ScriptedMove, s: number): [number, number, number] {
  if (m.kind === 'vault') {
    const x = m.sx + (m.ex - m.sx) * s;
    const z = m.sz + (m.ez - m.sz) * s;
    const base = m.sy + (m.ey - m.sy) * s;
    const arc = Math.max(0, m.apex - (m.sy + m.ey) / 2);
    return [x, base + arc * Math.min(1, 2.5 * Math.sin(Math.PI * s)), z];
  }
  // mantle: pull up first (0..0.55), then step forward onto the ledge
  const split = 0.55;
  if (s < split) {
    const k = s / split;
    const e = k * k * (3 - 2 * k);
    return [m.sx + (m.ex - m.sx) * 0.12 * e, m.sy + (m.apex - m.sy) * e, m.sz + (m.ez - m.sz) * 0.12 * e];
  }
  const k = (s - split) / (1 - split);
  const e = k * k * (3 - 2 * k);
  const x0 = m.sx + (m.ex - m.sx) * 0.12, z0 = m.sz + (m.ez - m.sz) * 0.12;
  return [x0 + (m.ex - x0) * e, m.apex + (m.ey - m.apex) * e, z0 + (m.ez - z0) * e];
}
