import { F_SOLID, HW, SKIN } from "../core/constants";

export interface AABB {
  id: number;
  flags: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

const EPS = 0.001;

export class CollisionWorld {
  readonly boxes: AABB[] = [];

  add(box: AABB): void {
    this.boxes.push(box);
  }

  boxById(id: number): AABB | undefined {
    return this.boxes.find((b) => b.id === id);
  }

  overlaps(x: number, y: number, z: number, hw: number, height: number, eps = EPS): AABB | null {
    for (const b of this.boxes) {
      if (overlapsBox(x, y, z, hw, height, b, eps)) return b;
    }
    return null;
  }

  /**
   * Highest solid top under the point, at or below `refY + 0.08`,
   * and no more than `maxDown` meters below `refY`.
   */
  surfaceBelow(x: number, z: number, refY: number, maxDown: number): number | null {
    let best: number | null = null;
    for (const b of this.boxes) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const top = b.maxY;
      if (top > refY + 0.08) continue;
      if (refY - top > maxDown) continue;
      if (best === null || top > best) best = top;
    }
    return best;
  }
}

export function overlapsBox(
  x: number,
  y: number,
  z: number,
  hw: number,
  height: number,
  b: AABB,
  eps = EPS,
): boolean {
  return (
    x - hw < b.maxX - eps &&
    x + hw > b.minX + eps &&
    y < b.maxY - eps &&
    y + height > b.minY + eps &&
    z - hw < b.maxZ - eps &&
    z + hw > b.minZ + eps
  );
}

export interface MoveHit {
  grounded: boolean;
  ceiling: boolean;
  wallId: number;
  wallNx: number;
  wallNz: number;
}

/**
 * Move an upright AABB player. `s` is feet position plus velocity.
 * Substeps stay under 10 cm so a fast fall cannot skip a roof slab.
 */
export function moveBody(
  world: CollisionWorld,
  s: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  height: number,
  dt: number,
  canStep: boolean,
): MoveHit {
  const dist = Math.hypot(s.vx, s.vy, s.vz) * dt;
  const n = Math.min(8, Math.max(1, Math.ceil(dist / 0.1)));
  const sdt = dt / n;
  let grounded = false;
  let ceiling = false;
  let wallId = 0;
  let wallNx = 0;
  let wallNz = 0;

  for (let i = 0; i < n; i++) {
    const dx = s.vx * sdt;
    const dz = s.vz * sdt;
    const dy = s.vy * sdt;

    if (canStep && s.vy <= 0.25 && dx * dx + dz * dz > 0) {
      tryStep(world, s, dx, dz, height);
    }

    s.x += dx;
    const hitX = resolveAxis(world, s, "x", dx, height);
    if (hitX) {
      s.vx = 0;
      wallId = hitX.id;
      wallNx = hitX.nx;
      wallNz = 0;
    }

    s.z += dz;
    const hitZ = resolveAxis(world, s, "z", dz, height);
    if (hitZ) {
      s.vz = 0;
      wallId = hitZ.id;
      wallNx = 0;
      wallNz = hitZ.nz;
    }

    s.y += dy;
    const hitY = resolveAxis(world, s, "y", dy, height);
    if (hitY) {
      if (dy > 0) {
        s.vy = 0;
        ceiling = true;
      } else {
        s.vy = 0;
        grounded = true;
      }
    }
  }

  if (s.vy <= 0.02) {
    const floor = world.surfaceBelow(s.x, s.z, s.y + 0.04, 0.2);
    if (floor !== null && s.y - floor <= 0.2 && s.y - floor >= -0.02) {
      const prev = s.y;
      s.y = floor + SKIN;
      if (world.overlaps(s.x, s.y, s.z, HW, height)) s.y = prev;
      else {
        s.vy = 0;
        grounded = true;
      }
    }
  }

  depenetrate(world, s, height);
  return { grounded, ceiling, wallId, wallNx, wallNz };
}

function tryStep(
  world: CollisionWorld,
  s: { x: number; y: number; z: number },
  dx: number,
  dz: number,
  height: number,
): void {
  const nx = s.x + dx;
  const nz = s.z + dz;
  if (!world.overlaps(nx, s.y, nz, HW, height)) return;
  const raised = s.y + 0.28;
  if (world.overlaps(s.x, raised, s.z, HW, height)) return;
  if (world.overlaps(nx, raised, nz, HW, height)) return;
  const surf = world.surfaceBelow(nx, nz, s.y + 0.28 + 0.05, 0.36);
  if (surf === null || surf <= s.y + 0.02 || surf > s.y + 0.28) return;
  s.y = surf + SKIN;
}

type Axis = "x" | "y" | "z";

function resolveAxis(
  world: CollisionWorld,
  s: { x: number; y: number; z: number },
  axis: Axis,
  delta: number,
  height: number,
): { id: number; nx: number; nz: number } | null {
  if (Math.abs(delta) < 1e-9) return null;
  let hit: { id: number; nx: number; nz: number } | null = null;
  for (let iter = 0; iter < 4; iter++) {
    const box = shallowest(world, s, height, axis, delta);
    if (!box) break;
    if (axis === "x") {
      s.x = delta > 0 ? box.minX - HW - SKIN : box.maxX + HW + SKIN;
      hit = { id: box.id, nx: delta > 0 ? -1 : 1, nz: 0 };
    } else if (axis === "z") {
      s.z = delta > 0 ? box.minZ - HW - SKIN : box.maxZ + HW + SKIN;
      hit = { id: box.id, nx: 0, nz: delta > 0 ? -1 : 1 };
    } else if (delta > 0) {
      s.y = box.minY - height - SKIN;
      hit = { id: box.id, nx: 0, nz: 0 };
    } else {
      s.y = box.maxY + SKIN;
      hit = { id: box.id, nx: 0, nz: 0 };
    }
  }
  return hit;
}

function shallowest(
  world: CollisionWorld,
  s: { x: number; y: number; z: number },
  height: number,
  axis: Axis,
  delta: number,
): AABB | null {
  let best: AABB | null = null;
  let bestPen = Infinity;
  for (const b of world.boxes) {
    if (!overlapsBox(s.x, s.y, s.z, HW, height, b)) continue;
    let pen: number;
    if (axis === "x") pen = delta > 0 ? s.x + HW - b.minX : b.maxX - (s.x - HW);
    else if (axis === "z") pen = delta > 0 ? s.z + HW - b.minZ : b.maxZ - (s.z - HW);
    else pen = delta > 0 ? s.y + height - b.minY : b.maxY - s.y;
    if (pen < bestPen) {
      bestPen = pen;
      best = b;
    }
  }
  return best;
}

export function depenetrate(
  world: CollisionWorld,
  s: { x: number; y: number; z: number },
  height: number,
): void {
  for (let iter = 0; iter < 4; iter++) {
    const box = world.overlaps(s.x, s.y, s.z, HW, height, 0);
    if (!box) return;
    const options = [
      { d: s.x + HW - box.minX, x: -1, y: 0, z: 0 },
      { d: box.maxX - (s.x - HW), x: 1, y: 0, z: 0 },
      { d: s.y + height - box.minY, x: 0, y: -1, z: 0 },
      { d: box.maxY - s.y, x: 0, y: 1, z: 0 },
      { d: s.z + HW - box.minZ, x: 0, y: 0, z: -1 },
      { d: box.maxZ - (s.z - HW), x: 0, y: 0, z: 1 },
    ];
    let best = options[0];
    for (const o of options) if (o.d >= 0 && o.d < best.d) best = o;
    if (best.d < 0) return;
    const push = best.d + SKIN;
    s.x += best.x * push;
    s.y += best.y * push;
    s.z += best.z * push;
  }
}

/** Signed gap from the player surface to a vertical face. Positive means separated. */
export function gapToWall(
  x: number,
  z: number,
  hw: number,
  box: AABB,
  nx: number,
  nz: number,
): number {
  if (nx < -0.5) return box.minX - (x + hw);
  if (nx > 0.5) return x - hw - box.maxX;
  if (nz < -0.5) return box.minZ - (z + hw);
  return z - hw - box.maxZ;
}

export function alongsideWall(x: number, z: number, box: AABB, nx: number, nz: number): boolean {
  const pad = 0.25;
  if (Math.abs(nx) >= Math.abs(nz)) return z > box.minZ - pad && z < box.maxZ + pad;
  return x > box.minX - pad && x < box.maxX + pad;
}

/** Outward normal of the box face closest to the player center. */
export function faceNormal(x: number, z: number, box: AABB): { x: number; z: number } {
  const dl = Math.abs(x - box.minX);
  const dr = Math.abs(x - box.maxX);
  const dn = Math.abs(z - box.minZ);
  const df = Math.abs(z - box.maxZ);
  const m = Math.min(dl, dr, dn, df);
  if (m === dl) return { x: -1, z: 0 };
  if (m === dr) return { x: 1, z: 0 };
  if (m === dn) return { x: 0, z: -1 };
  return { x: 0, z: 1 };
}

export function solidFlags(flags: number | undefined): number {
  return flags ?? F_SOLID;
}
