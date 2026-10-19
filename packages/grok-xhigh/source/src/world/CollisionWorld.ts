import type { Solid } from '../game/types'

export interface RayHit {
  solid: Solid
  index: number
  t: number
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
}

interface Aabb {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

const CELL = 8

export class CollisionWorld {
  private cells = new Map<string, number[]>()

  constructor(readonly solids: Solid[]) {
    for (let i = 0; i < solids.length; i++) this.insert(i)
  }

  private insert(index: number) {
    const s = this.solids[index]
    const x0 = Math.floor(s.minX / CELL)
    const x1 = Math.floor((s.maxX - 1e-4) / CELL)
    const y0 = Math.floor(s.minY / CELL)
    const y1 = Math.floor((s.maxY - 1e-4) / CELL)
    const z0 = Math.floor(s.minZ / CELL)
    const z1 = Math.floor((s.maxZ - 1e-4) / CELL)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const key = x + ',' + y + ',' + z
          let bucket = this.cells.get(key)
          if (!bucket) {
            bucket = []
            this.cells.set(key, bucket)
          }
          bucket.push(index)
        }
      }
    }
  }

  queryOverlap(box: Aabb, out: Solid[] = []): Solid[] {
    out.length = 0
    const seen = new Set<number>()
    const x0 = Math.floor(box.minX / CELL)
    const x1 = Math.floor((box.maxX - 1e-4) / CELL)
    const y0 = Math.floor(box.minY / CELL)
    const y1 = Math.floor((box.maxY - 1e-4) / CELL)
    const z0 = Math.floor(box.minZ / CELL)
    const z1 = Math.floor((box.maxZ - 1e-4) / CELL)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const bucket = this.cells.get(x + ',' + y + ',' + z)
          if (!bucket) continue
          for (const index of bucket) {
            if (seen.has(index)) continue
            seen.add(index)
            const s = this.solids[index]
            if (overlaps(box, s)) out.push(s)
          }
        }
      }
    }
    return out
  }

  /**
   * Highest walkable top under a footprint. Ceilings and walls whose tops
   * are above the feet are ignored, so rails do not become floors.
   */
  floorBelow(x: number, z: number, feet: number, radius: number, probe: number): number | null {
    const box: Aabb = {
      minX: x - radius,
      maxX: x + radius,
      minY: feet - probe,
      maxY: feet + 0.08,
      minZ: z - radius,
      maxZ: z + radius,
    }
    const foot: Aabb = {
      minX: x - radius + 0.01,
      maxX: x + radius - 0.01,
      minY: feet - probe,
      maxY: feet + 0.08,
      minZ: z - radius + 0.01,
      maxZ: z + radius - 0.01,
    }
    let best: number | null = null
    const hits = this.queryOverlap(box)
    for (const s of hits) {
      if (s.ceiling) continue
      if (s.maxX <= foot.minX || s.minX >= foot.maxX) continue
      if (s.maxZ <= foot.minZ || s.minZ >= foot.maxZ) continue
      if (s.maxY > feet + 0.06) continue
      if (s.maxY < feet - probe) continue
      if (best === null || s.maxY > best) best = s.maxY
    }
    return best
  }

  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    accept: (solid: Solid) => boolean,
  ): RayHit | null {
    const reach = Math.abs(dx) * maxDist + Math.abs(dy) * maxDist + Math.abs(dz) * maxDist + 0.5
    const hits = this.queryOverlap({
      minX: Math.min(ox, ox + dx * maxDist) - 0.05,
      maxX: Math.max(ox, ox + dx * maxDist) + 0.05,
      minY: Math.min(oy, oy + dy * maxDist) - 0.05,
      maxY: Math.max(oy, oy + dy * maxDist) + 0.05,
      minZ: Math.min(oz, oz + dz * maxDist) - 0.05,
      maxZ: Math.max(oz, oz + dz * maxDist) + 0.05,
    })
    void reach
    let best: RayHit | null = null
    for (const solid of hits) {
      if (!accept(solid)) continue
      const hit = rayAabb(ox, oy, oz, dx, dy, dz, maxDist, solid)
      if (!hit) continue
      const index = this.solids.indexOf(solid)
      if (!best || hit.t < best.t) best = { solid, index, ...hit }
    }
    return best
  }
}

function overlaps(a: Aabb, b: Aabb): boolean {
  const eps = 0.0008
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps
    && a.minY < b.maxY - eps && a.maxY > b.minY + eps
    && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps
}

function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  box: Aabb,
): { t: number; x: number; y: number; z: number; nx: number; ny: number; nz: number } | null {
  let tmin = 0
  let tmax = maxDist
  let axis = -1
  let sign = 1
  const o = [ox, oy, oz]
  const d = [dx, dy, dz]
  const mn = [box.minX, box.minY, box.minZ]
  const mx = [box.maxX, box.maxY, box.maxZ]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null
      continue
    }
    let t1 = (mn[i] - o[i]) / d[i]
    let t2 = (mx[i] - o[i]) / d[i]
    let s = -1
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
      s = 1
    }
    if (t1 > tmin) {
      tmin = t1
      axis = i
      sign = s
    }
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  if (tmin < 0 || tmin > maxDist || axis < 0) return null
  const n = [0, 0, 0]
  n[axis] = sign
  return {
    t: tmin,
    x: ox + dx * tmin,
    y: oy + dy * tmin,
    z: oz + dz * tmin,
    nx: n[0],
    ny: n[1],
    nz: n[2],
  }
}
