import { MOVE } from './MovementConfig';
import { EPS, overlaps, type Bounds, type CollisionWorld, type Solid } from '../world/CollisionWorld';

/**
 * A scripted vault or mantle. The controller animates the body along it, so the path only has
 * to be clear of geometry at planning time: the body rises at the obstacle face and clears the
 * top before it travels over.
 */
export interface ScriptedPlan {
  kind: 'vault' | 'mantle';
  /** Top of the obstacle the body must clear. */
  topY: number;
  /** Feet height on the landing surface. */
  landY: number;
  /** Distance along the direction where the body front first touches the obstacle face. */
  dFace: number;
  /** Distance where the body back has fully cleared the far face (vault only). */
  dClear: number;
  /** Distance of the landing spot from the start. */
  dLand: number;
}

interface Hit {
  tEnter: number;
  tExit: number;
}

/**
 * Distance interval over which a ray from (px, pz) along (dx, dz) lies inside a box's footprint.
 * Returns null when the ray misses or the box is behind the start.
 */
function rayFootprint(px: number, pz: number, dx: number, dz: number, box: Bounds): Hit | null {
  let tEnter = -Infinity;
  let tExit = Infinity;

  if (Math.abs(dx) < 1e-6) {
    if (px < box.minX || px > box.maxX) return null;
  } else {
    let t1 = (box.minX - px) / dx;
    let t2 = (box.maxX - px) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
  }

  if (Math.abs(dz) < 1e-6) {
    if (pz < box.minZ || pz > box.maxZ) return null;
  } else {
    let t1 = (box.minZ - pz) / dz;
    let t2 = (box.maxZ - pz) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
  }

  if (tEnter > tExit || tExit < 0) return null;
  return { tEnter, tExit };
}

/**
 * Finds wall-run walls, vault obstacles and ledges around the player. Everything here is a
 * pure query against the collision world, so it can also drive HUD hints.
 */
export class ParkourSystem {
  constructor(private readonly world: CollisionWorld) {}

  /**
   * A wall-run wall on one side of the body that the body is close enough to latch onto.
   * side = +1 is the player's right (+X when facing -Z), side = -1 is the left.
   */
  findWall(x: number, feetY: number, z: number, height: number, side: 1 | -1): Solid | null {
    const half = MOVE.bodyHalfWidth;
    const probe = MOVE.wallProbe;
    const bounds: Bounds = {
      minX: side > 0 ? x + half : x - half - probe,
      maxX: side > 0 ? x + half + probe : x - half,
      minY: feetY + 0.3,
      maxY: feetY + height - 0.2,
      minZ: z - half + 0.05,
      maxZ: z + half - 0.05,
    };
    for (const solid of this.world.solids) {
      if (!solid.wallRun) continue;
      if (side > 0 ? solid.minX < x - 0.1 : solid.maxX > x + 0.1) continue;
      if (overlaps(bounds, solid)) return solid;
    }
    return null;
  }

  /** A low obstacle directly ahead that can be vaulted, with a clear, supported landing beyond it. */
  findVault(x: number, feetY: number, z: number, dirX: number, dirZ: number): ScriptedPlan | null {
    const half = MOVE.bodyHalfWidth;
    let best: { solid: Solid; hit: Hit } | null = null;

    for (const solid of this.world.solids) {
      if (solid.wallRun) continue;
      const height = solid.maxY - feetY;
      if (height < MOVE.vaultMinHeight || height > MOVE.vaultMaxHeight) continue;
      // Vaults are for ground-based obstacles, not things hanging overhead.
      if (solid.minY > feetY + 0.4) continue;
      const hit = rayFootprint(x, z, dirX, dirZ, solid);
      if (!hit) continue;
      if (hit.tEnter < half - 0.1 || hit.tEnter > half + MOVE.vaultReach) continue;
      if (hit.tExit - hit.tEnter > MOVE.vaultMaxDepth) continue;
      if (!best || hit.tEnter < best.hit.tEnter) best = { solid, hit };
    }
    if (!best) return null;

    const dLand = best.hit.tExit + half + 0.3;
    const landY = this.landingSurface(x, feetY, z, dirX, dirZ, dLand, best.solid);
    if (landY === null) return null;

    return {
      kind: 'vault',
      topY: best.solid.maxY,
      landY,
      dFace: Math.max(0, best.hit.tEnter - half),
      dClear: best.hit.tExit + half + 0.02,
      dLand,
    };
  }

  /** A ledge just above the feet that the airborne body can pull itself up onto. */
  findMantle(x: number, feetY: number, z: number, dirX: number, dirZ: number): ScriptedPlan | null {
    const half = MOVE.bodyHalfWidth;
    let best: { solid: Solid; hit: Hit } | null = null;

    for (const solid of this.world.solids) {
      const height = solid.maxY - feetY;
      if (height < MOVE.mantleMinHeight || height > MOVE.mantleMaxHeight) continue;
      const hit = rayFootprint(x, z, dirX, dirZ, solid);
      if (!hit) continue;
      if (hit.tEnter < half - 0.1 || hit.tEnter > half + MOVE.mantleReach) continue;
      // The top must be deep enough to stand on.
      if (hit.tExit - hit.tEnter < 0.9) continue;
      if (!best || hit.tEnter < best.hit.tEnter) best = { solid, hit };
    }
    if (!best) return null;

    const s = best.solid;
    const dLand = best.hit.tEnter + 0.45;
    const lx = x + dirX * dLand;
    const lz = z + dirZ * dLand;
    if (lx - half < s.minX || lx + half > s.maxX || lz - half < s.minZ || lz + half > s.maxZ) return null;
    if (!this.world.isFree(lx, s.maxY + 0.02, lz, half, MOVE.standHeight)) return null;

    return {
      kind: 'mantle',
      topY: s.maxY,
      landY: s.maxY,
      dFace: Math.max(0, best.hit.tEnter - half),
      dClear: dLand,
      dLand,
    };
  }

  /**
   * Height of the surface a body can land on at the given distance, or null when the landing
   * footprint is not fully supported by one top surface or is blocked overhead.
   */
  private landingSurface(
    x: number,
    feetY: number,
    z: number,
    dirX: number,
    dirZ: number,
    dist: number,
    ignore: Solid,
  ): number | null {
    const half = MOVE.bodyHalfWidth;
    const lx = x + dirX * dist;
    const lz = z + dirZ * dist;

    let support: Solid | null = null;
    for (const solid of this.world.solids) {
      if (solid === ignore) continue;
      if (solid.maxY > feetY + MOVE.mantleMaxHeight || solid.maxY < feetY - 3.5) continue;
      if (lx < solid.minX - EPS || lx > solid.maxX + EPS) continue;
      if (lz < solid.minZ - EPS || lz > solid.maxZ + EPS) continue;
      if (!support || solid.maxY > support.maxY) support = solid;
    }
    if (!support) return null;

    const fullyOnTop =
      lx - half >= support.minX - EPS &&
      lx + half <= support.maxX + EPS &&
      lz - half >= support.minZ - EPS &&
      lz + half <= support.maxZ + EPS;
    if (!fullyOnTop) return null;
    if (!this.world.isFree(lx, support.maxY + 0.02, lz, half, MOVE.standHeight)) return null;
    return support.maxY;
  }
}
