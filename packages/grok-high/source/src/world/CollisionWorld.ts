import { STAND_HEIGHT, STEP_UP, WALL_DETECT } from '../player/constants';
import type { LedgeHit, Solid, VaultHit, WallHit } from '../player/types';

export interface Mover {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  height: number;
}

const EPS = 0.001;

function overlap(
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  s: Solid,
): boolean {
  return (
    x + radius > s.minX + EPS &&
    x - radius < s.maxX - EPS &&
    y + height > s.minY + EPS &&
    y < s.maxY - EPS &&
    z + radius > s.minZ + EPS &&
    z - radius < s.maxZ - EPS
  );
}

export class CollisionWorld {
  readonly solids: Solid[];

  constructor(solids: Solid[]) {
    this.solids = solids;
  }

  blocked(x: number, y: number, z: number, radius: number, height: number): boolean {
    for (const s of this.solids) {
      if (overlap(x, y, z, radius, height, s)) return true;
    }
    return false;
  }

  /** Highest standable surface under a foot-sized probe. */
  support(x: number, y: number, z: number, probeDown: number): number | null {
    const r = 0.16;
    let best: number | null = null;
    for (const s of this.solids) {
      if (x + r <= s.minX || x - r >= s.maxX) continue;
      if (z + r <= s.minZ || z - r >= s.maxZ) continue;
      if (s.maxY > y + 0.08) continue;
      if (s.maxY < y - probeDown) continue;
      if (best === null || s.maxY > best) best = s.maxY;
    }
    return best;
  }

  /** Floor height at a point, ignoring surfaces above refY + 0.35. */
  floorAt(x: number, z: number, refY: number): number | null {
    let best: number | null = null;
    for (const s of this.solids) {
      if (x <= s.minX || x >= s.maxX || z <= s.minZ || z >= s.maxZ) continue;
      if (s.maxY > refY + 0.35) continue;
      if (s.maxY < refY - 8) continue;
      if (best === null || s.maxY > best) best = s.maxY;
    }
    return best;
  }

  /**
   * Integrate velocity with substeps. X and Z resolve as walls.
   * A penetration whose feet are near a top face is left for the Y pass
   * so landings do not get shoved off edges. Y then lands or bonks.
   */
  move(b: Mover, dt: number): { ceiling: boolean } {
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / 0.2)));
    const h = dt / steps;
    let ceiling = false;

    for (let step = 0; step < steps; step++) {
      b.x += b.vx * h;
      this.solveHorizontal(b, 'x');
      b.z += b.vz * h;
      this.solveHorizontal(b, 'z');
      b.y += b.vy * h;
      const hit = this.solveVertical(b);
      if (hit === 'ceiling') {
        ceiling = true;
        b.vy = Math.min(0, b.vy);
      } else if (hit === 'floor') {
        b.vy = 0;
      }
    }
    if (b.vy < -42) b.vy = -42;
    return { ceiling };
  }

  private solveHorizontal(b: Mover, axis: 'x' | 'z'): void {
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.solids) {
        if (!overlap(b.x, b.y, b.z, b.radius, b.height, s)) continue;
        const feetNearTop = b.y >= s.maxY - STEP_UP && b.vy <= 0.8;
        const headUnder = b.y + b.height <= s.minY + 0.2 && b.vy >= 0;
        if (feetNearTop || headUnder) continue;
        if (axis === 'x') {
          const pushOut = s.minX - b.radius - EPS;
          const pushIn = s.maxX + b.radius + EPS;
          if (b.vx > 0 || (b.vx === 0 && Math.abs(pushOut - b.x) < Math.abs(pushIn - b.x))) {
            b.x = pushOut;
          } else {
            b.x = pushIn;
          }
          b.vx = 0;
        } else {
          const pushOut = s.minZ - b.radius - EPS;
          const pushIn = s.maxZ + b.radius + EPS;
          if (b.vz > 0 || (b.vz === 0 && Math.abs(pushOut - b.z) < Math.abs(pushIn - b.z))) {
            b.z = pushOut;
          } else {
            b.z = pushIn;
          }
          b.vz = 0;
        }
      }
    }
  }

  private solveVertical(b: Mover): 'floor' | 'ceiling' | 'none' {
    let result: 'floor' | 'ceiling' | 'none' = 'none';
    for (const s of this.solids) {
      if (!overlap(b.x, b.y, b.z, b.radius, b.height, s)) continue;
      if (b.vy > 0) {
        b.y = s.minY - b.height - EPS;
        result = 'ceiling';
      } else {
        const belowTop = s.maxY - b.y;
        if (belowTop <= STEP_UP + 0.12) {
          b.y = s.maxY;
          result = 'floor';
        } else {
          const toMinX = Math.abs(b.x - (s.minX - b.radius));
          const toMaxX = Math.abs(b.x - (s.maxX + b.radius));
          const toMinZ = Math.abs(b.z - (s.minZ - b.radius));
          const toMaxZ = Math.abs(b.z - (s.maxZ + b.radius));
          const min = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          if (min === toMinX) b.x = s.minX - b.radius - EPS;
          else if (min === toMaxX) b.x = s.maxX + b.radius + EPS;
          else if (min === toMinZ) b.z = s.minZ - b.radius - EPS;
          else b.z = s.maxZ + b.radius + EPS;
        }
      }
    }
    return result;
  }

  findWall(b: Mover, ignoreId = -1): WallHit | null {
    let best: WallHit | null = null;
    let bestDist = Infinity;
    const head = b.y + b.height;
    for (const s of this.solids) {
      if (s.id === ignoreId) continue;
      if (s.maxY - s.minY < 8) continue;
      if (s.maxY < head + 1.25) continue;
      if (s.minY > head - 0.3) continue;
      const cx = clamp(b.x, s.minX, s.maxX);
      const cz = clamp(b.z, s.minZ, s.maxZ);
      const dx = b.x - cx;
      const dz = b.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.02 || dist > b.radius + WALL_DETECT) continue;
      const onX = cx === s.minX || cx === s.maxX;
      const onZ = cz === s.minZ || cz === s.maxZ;
      if (onX && onZ) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = { solid: s, nx: dx / dist, nz: dz / dist, dist };
      }
    }
    return best;
  }

  findVault(b: Mover, dirX: number, dirZ: number): VaultHit | null {
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.2) return null;
    const fx = dirX / len;
    const fz = dirZ / len;
    let best: VaultHit | null = null;
    let bestDist = Infinity;
    for (const s of this.solids) {
      const rise = s.maxY - b.y;
      if (rise < 0.4 || rise > 1.2) continue;
      if (s.minY > b.y + 0.25) continue;
      const cx = clamp(b.x, s.minX, s.maxX);
      const cz = clamp(b.z, s.minZ, s.maxZ);
      const dx = b.x - cx;
      const dz = b.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist > b.radius + 0.9) continue;
      if (dist > 0.02) {
        const toward = -dx * fx + -dz * fz;
        if (toward < 0.2) continue;
        const onX = cx === s.minX || cx === s.maxX;
        const onZ = cz === s.minZ || cz === s.maxZ;
        if (onX && onZ) continue;
      }
      const nx = dist > 0.02 ? dx / dist : -fx;
      const nz = dist > 0.02 ? dz / dist : -fz;
      const travelX = -nx;
      const travelZ = -nz;
      const along = Math.abs(travelX) >= Math.abs(travelZ) ? s.maxX - s.minX : s.maxZ - s.minZ;
      if (along > 1.45 || along < 0.05) continue;
      const travel = dist + along + b.radius + 0.22;
      const ex = b.x + travelX * travel;
      const ez = b.z + travelZ * travel;
      const floor = this.floorAt(ex, ez, b.y + 0.4);
      const ey = floor ?? b.y;
      if (ey < b.y - 2.5) continue;
      if (this.blocked(ex, ey, ez, b.radius * 0.8, STAND_HEIGHT * 0.9)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          top: s.maxY,
          sx: b.x,
          sy: b.y,
          sz: b.z,
          ex,
          ey,
          ez,
          dirX: travelX,
          dirZ: travelZ,
          peak: s.maxY + 0.05,
        };
      }
    }
    return best;
  }

  findLedge(b: Mover, vx: number, vz: number): LedgeHit | null {
    let best: LedgeHit | null = null;
    let bestDist = Infinity;
    for (const s of this.solids) {
      const rise = s.maxY - b.y;
      if (rise < 0.55 || rise > 1.72) continue;
      if (s.maxY - s.minY < 1.3) continue;
      if (s.maxY < b.y + b.height + 0.8 && s.maxY - s.minY > 8) continue;
      const cx = clamp(b.x, s.minX, s.maxX);
      const cz = clamp(b.z, s.minZ, s.maxZ);
      const dx = b.x - cx;
      const dz = b.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.02 || dist > b.radius + 0.5) continue;
      const onX = cx === s.minX || cx === s.maxX;
      const onZ = cz === s.minZ || cz === s.maxZ;
      if (onX && onZ) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const into = vx * -nx + vz * -nz;
      if (into < 0.3 && dist > b.radius + 0.12) continue;
      const landX = cx - nx * (b.radius + 0.26);
      const landZ = cz - nz * (b.radius + 0.26);
      if (landX <= s.minX + 0.05 || landX >= s.maxX - 0.05) continue;
      if (landZ <= s.minZ + 0.05 || landZ >= s.maxZ - 0.05) continue;
      if (this.blocked(landX, s.maxY + 0.02, landZ, b.radius * 0.85, STAND_HEIGHT)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          top: s.maxY,
          sx: b.x,
          sy: b.y,
          sz: b.z,
          ex: landX,
          ey: s.maxY,
          ez: landZ,
          dirX: -nx,
          dirZ: -nz,
        };
      }
    }
    return best;
  }
}

/** Distance from the feet up to the next solid. Infinity when the sky is clear. */
export function clearanceAbove(
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  radius: number,
): number {
  let best = Infinity;
  for (const s of world.solids) {
    if (x + radius <= s.minX || x - radius >= s.maxX) continue;
    if (z + radius <= s.minZ || z - radius >= s.maxZ) continue;
    if (s.minY < y - 0.02) continue;
    const gap = s.minY - y;
    if (gap < best) best = gap;
  }
  return best;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
