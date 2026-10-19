import { PHYS } from '../player/constants';

export interface Solid {
  id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  vaultable: boolean;
  wallRun: boolean;
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  h: number;
}

export interface MoveResult {
  grounded: boolean;
  ceiling: boolean;
}

const EPS = 0.001;

export function overlap(b: Body, s: Solid): boolean {
  return (
    b.x - b.r < s.maxX - EPS &&
    b.x + b.r > s.minX + EPS &&
    b.y < s.maxY - EPS &&
    b.y + b.h > s.minY + EPS &&
    b.z - b.r < s.maxZ - EPS &&
    b.z + b.r > s.minZ + EPS
  );
}

export function canFit(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
): boolean {
  const b: Body = { x, y, z, vx: 0, vy: 0, vz: 0, r, h };
  for (const s of solids) {
    if (overlap(b, s)) return false;
  }
  return true;
}

export interface FloorHit {
  y: number;
  id: number;
}

/** Highest standable top under the point, within the rise/drop window. */
export function floorNear(
  solids: Solid[],
  x: number,
  z: number,
  refY: number,
  maxDrop: number,
  maxRise: number,
): FloorHit | null {
  let best: FloorHit | null = null;
  for (const s of solids) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    const top = s.maxY;
    if (top > refY + maxRise || top < refY - maxDrop) continue;
    if (!best || top > best.y) best = { y: top, id: s.id };
  }
  return best;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  solid: Solid;
  face: number;
  axis: 'x' | 'y' | 'z';
}

export function raycastSolids(
  solids: Solid[],
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): RayHit | null {
  let best: RayHit | null = null;
  for (const s of solids) {
    const hit = rayAABB(ox, oy, oz, dx, dy, dz, s, maxT);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

function rayAABB(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  s: Solid,
  maxT: number,
): RayHit | null {
  let tmin = 0;
  let tmax = maxT;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let face = 0;
  let axis: 'x' | 'y' | 'z' = 'x';

  const slab = (
    o: number,
    d: number,
    min: number,
    max: number,
    which: 'x' | 'y' | 'z',
  ): boolean => {
    if (Math.abs(d) < 1e-8) return o >= min && o <= max;
    let t1 = (min - o) / d;
    let t2 = (max - o) / d;
    let n1 = -1;
    let n2 = 1;
    if (t1 > t2) {
      const ts = t1;
      t1 = t2;
      t2 = ts;
      n1 = 1;
      n2 = -1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = which === 'x' ? n1 : 0;
      ny = which === 'y' ? n1 : 0;
      nz = which === 'z' ? n1 : 0;
      face = n1 < 0 ? min : max;
      axis = which;
    }
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };

  if (!slab(ox, dx, s.minX, s.maxX, 'x')) return null;
  if (!slab(oy, dy, s.minY, s.maxY, 'y')) return null;
  if (!slab(oz, dz, s.minZ, s.maxZ, 'z')) return null;
  if (tmin <= 0.0008 || tmin > maxT) return null;
  return { t: tmin, nx, ny, nz, solid: s, face, axis };
}

/**
 * Axis-separated move with substeps. Step-up only clears low lips while
 * grounded-ish, so walls and vault boxes stay solid.
 */
export function moveBody(b: Body, solids: Solid[], dt: number, stepUp: boolean): MoveResult {
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  const steps = Math.min(6, Math.max(1, Math.ceil((speed * dt) / 0.18)));
  const h = dt / steps;
  let grounded = false;
  let ceiling = false;

  for (let i = 0; i < steps; i++) {
    b.x += b.vx * h;
    resolveAxis(b, solids, 'x', stepUp);
    b.z += b.vz * h;
    resolveAxis(b, solids, 'z', stepUp);
    b.y += b.vy * h;
    const yHit = resolveY(b, solids);
    if (yHit === 'floor') {
      grounded = true;
      b.vy = 0;
    } else if (yHit === 'ceil') {
      ceiling = true;
      b.vy = 0;
    }
  }

  // Seam snap: keep feet glued to a floor we are already touching.
  if (b.vy <= 0.01) {
    const foot = supportFloor(b, solids, 0.18);
    if (foot && canFit(solids, b.x, foot, b.z, b.r, b.h)) {
      b.y = foot;
      b.vy = 0;
      grounded = true;
    }
  }

  recover(b, solids);
  return { grounded, ceiling };
}

function supportFloor(b: Body, solids: Solid[], probe: number): number | null {
  let best: number | null = null;
  for (const s of solids) {
    if (b.x - b.r > s.maxX || b.x + b.r < s.minX) continue;
    if (b.z - b.r > s.maxZ || b.z + b.r < s.minZ) continue;
    const top = s.maxY;
    if (top > b.y + 0.04 || top < b.y - probe) continue;
    if (best === null || top > best) best = top;
  }
  return best;
}

function resolveAxis(b: Body, solids: Solid[], axis: 'x' | 'z', stepUp: boolean): void {
  for (let pass = 0; pass < 4; pass++) {
    let hit = false;
    for (const s of solids) {
      if (!overlap(b, s)) continue;
      const top = s.maxY;
      if (
        stepUp &&
        b.vy <= 0.35 &&
        top > b.y + 0.001 &&
        top - b.y <= PHYS.stepHeight &&
        canFit(solids, b.x, top, b.z, b.r, b.h)
      ) {
        b.y = top;
        continue;
      }
      if (axis === 'x') {
        const penL = b.x + b.r - s.minX;
        const penR = s.maxX - (b.x - b.r);
        if (penL < penR) {
          b.x = s.minX - b.r - EPS;
          if (b.vx > 0) b.vx = 0;
        } else {
          b.x = s.maxX + b.r + EPS;
          if (b.vx < 0) b.vx = 0;
        }
      } else {
        const penN = b.z + b.r - s.minZ;
        const penP = s.maxZ - (b.z - b.r);
        if (penN < penP) {
          b.z = s.minZ - b.r - EPS;
          if (b.vz > 0) b.vz = 0;
        } else {
          b.z = s.maxZ + b.r + EPS;
          if (b.vz < 0) b.vz = 0;
        }
      }
      hit = true;
    }
    if (!hit) break;
  }
}

function resolveY(b: Body, solids: Solid[]): 'floor' | 'ceil' | 'none' {
  let kind: 'floor' | 'ceil' | 'none' = 'none';
  for (let pass = 0; pass < 4; pass++) {
    let hit = false;
    for (const s of solids) {
      if (!overlap(b, s)) continue;
      const penDown = b.y + b.h - s.minY;
      const penUp = s.maxY - b.y;
      // Falling or resting: prefer the floor face when the top is near our feet.
      const fromAbove = b.vy <= 0.01 && penUp < penDown;
      if (fromAbove || (b.vy < 0 && penUp <= penDown)) {
        b.y = s.maxY;
        kind = 'floor';
      } else {
        b.y = s.minY - b.h - EPS;
        kind = 'ceil';
      }
      hit = true;
    }
    if (!hit) break;
  }
  return kind;
}

function recover(b: Body, solids: Solid[]): void {
  if (canFit(solids, b.x, b.y, b.z, b.r, b.h)) return;
  for (let i = 1; i <= 8; i++) {
    const y = b.y + i * 0.15;
    if (canFit(solids, b.x, y, b.z, b.r, b.h)) {
      b.y = y;
      b.vy = Math.max(0, b.vy);
      return;
    }
  }
}

export function horizBlocked(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  dx: number,
  dz: number,
  dist: number,
): boolean {
  const b: Body = { x: x + dx * dist, y: y + 0.05, z: z + dz * dist, vx: 0, vy: 0, vz: 0, r, h };
  for (const s of solids) {
    if (overlap(b, s)) return true;
  }
  return false;
}
