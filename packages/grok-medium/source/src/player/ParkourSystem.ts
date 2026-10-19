import { PHYS } from './constants';
import {
  canFit,
  floorNear,
  raycastSolids,
  type Solid,
} from '../world/CollisionWorld';

export interface VaultMove {
  kind: 'vault';
  t: number;
  dur: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  peak: number;
  vx: number;
  vz: number;
}

export interface MantleMove {
  kind: 'mantle';
  t: number;
  dur: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export type ActionMove = VaultMove | MantleMove;

export interface WallContact {
  id: number;
  nx: number;
  nz: number;
  axis: 'x' | 'z';
  face: number;
  side: 1 | -1;
  ignoreFloorId: number;
  attachY: number;
  time: number;
}

function horizOverlap(
  x: number,
  z: number,
  r: number,
  s: Solid,
): boolean {
  return x + r > s.minX && x - r < s.maxX && z + r > s.minZ && z - r < s.maxZ;
}

/** True when a floating slab ahead will catch a standing body but not a slide. */
export function slideCeilingAhead(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  r: number,
  fx: number,
  fz: number,
): boolean {
  for (const dist of [0, 0.7, 1.25]) {
    const px = x + fx * dist;
    const pz = z + fz * dist;
    for (const s of solids) {
      if (!horizOverlap(px, pz, r * 0.85, s)) continue;
      if (s.minY > y + 0.48 && s.minY < y + PHYS.standH - 0.02) return true;
    }
  }
  return false;
}

export function findVault(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  r: number,
  fx: number,
  fz: number,
  speed: number,
): VaultMove | null {
  let best: Solid | null = null;
  let bestAhead = Infinity;
  for (const s of solids) {
    if (!s.vaultable) continue;
    const top = s.maxY;
    if (top < y + 0.4 || top > y + 1.2) continue;
    if (s.minY > y + 0.35) continue;
    const cx = Math.max(s.minX, Math.min(x, s.maxX));
    const cz = Math.max(s.minZ, Math.min(z, s.maxZ));
    const dx = cx - x;
    const dz = cz - z;
    const ahead = dx * fx + dz * fz;
    const lateral = Math.abs(dx * fz - dz * fx);
    if (ahead < 0.15 || ahead > 1.45 || lateral > 0.7) continue;
    if (ahead < bestAhead) {
      best = s;
      bestAhead = ahead;
    }
  }
  if (!best) return null;

  // Distance along forward until the far side of the box, plus a landing margin.
  let exit = bestAhead + 0.4;
  const step = 0.1;
  for (let t = 0; t < 3; t += step) {
    const px = x + fx * t;
    const pz = z + fz * t;
    const inside =
      px >= best.minX && px <= best.maxX && pz >= best.minZ && pz <= best.maxZ;
    if (t > bestAhead && !inside) {
      exit = t;
      break;
    }
  }
  const dist = exit + r + 0.28;
  const x1 = x + fx * dist;
  const z1 = z + fz * dist;
  const land = floorNear(solids, x1, z1, y, 1.4, 0.45);
  const y1 = land ? land.y : y;
  if (!canFit(solids, x1, y1, z1, r, PHYS.standH)) return null;
  // The arc's crest must clear the obstacle without entering a ceiling.
  const peak = best.maxY + 0.05;
  if (!canFit(solids, x + fx * (bestAhead + 0.05), peak, z + fz * (bestAhead + 0.05), r * 0.8, PHYS.standH)) {
    return null;
  }
  const spd = Math.max(speed, PHYS.sprint * 0.82);
  return {
    kind: 'vault',
    t: 0,
    dur: 0.38,
    x0: x,
    y0: y,
    z0: z,
    x1,
    y1,
    z1,
    peak,
    vx: fx * spd,
    vz: fz * spd,
  };
}

export function findMantle(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  r: number,
  fx: number,
  fz: number,
): MantleMove | null {
  // Low origins catch a lip the jump has already risen toward. A chest-high
  // ray alone sails over a 1.5 m ledge once the jump is near its apex.
  const origins = [y + 0.28, y + 0.62, y + 1.0, y + 1.4];
  for (const oy of origins) {
    const hit = raycastSolids(solids, x, oy, z, fx, 0, fz, 1.2);
    if (!hit) continue;
    if (Math.abs(hit.ny) > 0.4) continue;
    if (hit.t > 1.05) continue;
    const s = hit.solid;
    if (s.vaultable || s.wallRun) continue;
    if (s.minY > y + 0.2) continue;
    const lip = s.maxY;
    if (lip < y + 0.08 || lip > y + 2.35) continue;
    if (s.maxX - s.minX < 1.2 || s.maxZ - s.minZ < 1.2) continue;
    const onto = hit.t + r + 0.22;
    const x1 = x + fx * onto;
    const z1 = z + fz * onto;
    if (x1 < s.minX + 0.05 || x1 > s.maxX - 0.05 || z1 < s.minZ + 0.05 || z1 > s.maxZ - 0.05) {
      continue;
    }
    if (!canFit(solids, x1, lip + 0.01, z1, r, PHYS.standH)) continue;
    return {
      kind: 'mantle',
      t: 0,
      dur: 0.34,
      x0: x,
      y0: y,
      z0: z,
      x1,
      y1: lip,
      z1,
    };
  }
  return null;
}

export function probeWall(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
  rx: number,
  rz: number,
): Omit<WallContact, 'ignoreFloorId' | 'attachY' | 'time'> | null {
  type Probe = Omit<WallContact, 'ignoreFloorId' | 'attachY' | 'time'>;
  const sides: Array<{ sx: number; sz: number; side: 1 | -1 }> = [
    { sx: rx, sz: rz, side: 1 },
    { sx: -rx, sz: -rz, side: -1 },
  ];
  let best: Probe | null = null;
  let bestT = Infinity;
  for (const side of sides) {
    let hits = 0;
    let chosen: Probe | null = null;
    let sideT = Infinity;
    for (const oy of [0.45, 1.0, 1.45]) {
      const hit = raycastSolids(solids, x, y + oy, z, side.sx, 0, side.sz, 1.05);
      if (!hit || !hit.solid.wallRun) continue;
      if (Math.abs(hit.ny) > 0.35 || hit.axis === 'y') continue;
      if (hit.t > 0.92) continue;
      hits++;
      if (hit.t < sideT) {
        sideT = hit.t;
        chosen = {
          id: hit.solid.id,
          nx: hit.nx,
          nz: hit.nz,
          axis: hit.axis === 'z' ? 'z' : 'x',
          face: hit.face,
          side: side.side,
        };
      }
    }
    if (hits >= 2 && chosen && sideT < bestT) {
      best = chosen;
      bestT = sideT;
    }
  }
  void fx;
  void fz;
  return best;
}

export function sampleAction(a: ActionMove, u: number): { x: number; y: number; z: number } {
  if (a.kind === 'vault') {
    const k = u * u * (3 - 2 * u);
    const arc = Math.sin(Math.PI * u) * (a.peak - Math.max(a.y0, a.y1));
    return {
      x: a.x0 + (a.x1 - a.x0) * k,
      z: a.z0 + (a.z1 - a.z0) * k,
      y: a.y0 + (a.y1 - a.y0) * k + arc,
    };
  }
  if (u < 0.62) {
    const k = u / 0.62;
    const ease = k * k;
    return { x: a.x0, y: a.y0 + (a.y1 - a.y0) * ease, z: a.z0 };
  }
  const k = (u - 0.62) / 0.38;
  return {
    x: a.x0 + (a.x1 - a.x0) * k,
    y: a.y1,
    z: a.z0 + (a.z1 - a.z0) * k,
  };
}
