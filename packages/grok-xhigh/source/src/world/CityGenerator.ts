import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Course } from './Course'
import type { Materials } from './Materials'

export function buildCity(course: Course, mats: Materials): THREE.Group {
  const group = new THREE.Group()
  const rng = mulberry32(11)
  const glass: THREE.BufferGeometry[] = []
  const concrete: THREE.BufferGeometry[] = []
  const accent: THREE.BufferGeometry[] = []
  const bounds = course.bounds
  const pad = 14

  for (let ix = -7; ix <= 8; ix++) {
    for (let iz = -3; iz <= 20; iz++) {
      const x = ix * 42 + (rng() - 0.5) * 10
      const z = bounds.minZ + iz * 36 + (rng() - 0.5) * 8
      const w = 14 + rng() * 12
      const d = 14 + rng() * 12
      if (overlapsCourse(x, z, w, d, bounds, pad)) continue
      const roll = rng()
      const h = roll < 0.18 ? 8 + rng() * 7 : roll > 0.82 ? 55 + rng() * 45 : 20 + rng() * 28
      const geo = box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
      if (h > 38) glass.push(geo)
      else concrete.push(geo)
      if (rng() > 0.82) {
        accent.push(box(x - w * 0.3, h * 0.55, z + d / 2, x + w * 0.3, h * 0.55 + 3.2, z + d / 2 + 0.4))
      }
    }
  }

  // Landmark towers so the skyline has a few readable silhouettes.
  const marks: Array<[number, number, number, number, number]> = [
    [bounds.minX - 48, bounds.minZ + 40, 22, 22, 78],
    [bounds.maxX + 36, bounds.minZ + 120, 26, 18, 92],
    [bounds.minX - 40, bounds.maxZ * 0.55, 20, 28, 70],
    [bounds.maxX + 50, bounds.maxZ * 0.8, 24, 24, 84],
  ]
  for (const [x, z, w, d, h] of marks) {
    glass.push(box(x, 0, z, x + w, h, z + d))
  }

  pushMerged(group, glass, mats.byId.glass, false)
  pushMerged(group, concrete, mats.byId.concrete, false)
  pushMerged(group, accent, mats.byId.orange, false)

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(1800, 2, 1800),
    mats.byId.concrete,
  )
  ground.position.set((bounds.minX + bounds.maxX) / 2, -1, (bounds.minZ + bounds.maxZ) / 2)
  group.add(ground)

  group.add(buildCrane(bounds.maxX + 22, bounds.minZ + course.length * 0.42, mats))
  group.add(buildClouds(bounds, rng))
  return group
}

function buildCrane(x: number, z: number, mats: Materials) {
  const g = new THREE.Group()
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 48, 1.4), mats.byId.red)
  mast.position.set(x, 24, z)
  const jib = new THREE.Mesh(new THREE.BoxGeometry(36, 0.8, 1.1), mats.byId.red)
  jib.position.set(x + 10, 47, z)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 2.4), mats.byId.orange)
  cab.position.set(x, 44, z)
  g.add(mast, jib, cab)
  return g
}

function buildClouds(bounds: Course['bounds'], rng: () => number) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat)
    cloud.position.set(
      bounds.minX - 80 + rng() * (bounds.maxX - bounds.minX + 160),
      70 + rng() * 40,
      bounds.minZ + rng() * (bounds.maxZ - bounds.minZ),
    )
    cloud.scale.set(18 + rng() * 22, 5 + rng() * 4, 12 + rng() * 10)
    g.add(cloud)
  }
  return g
}

function overlapsCourse(
  x: number,
  z: number,
  w: number,
  d: number,
  bounds: Course['bounds'],
  pad: number,
) {
  return Math.abs(x - (bounds.minX + bounds.maxX) / 2) < (bounds.maxX - bounds.minX) / 2 + pad + w / 2
    && z > bounds.minZ - pad - d / 2
    && z < bounds.maxZ + pad + d / 2
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  scaleBoxUvs(g, x1 - x0, y1 - y0, z1 - z0, 0.12)
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return g
}

export function scaleBoxUvs(geo: THREE.BufferGeometry, w: number, h: number, d: number, tile: number) {
  const uv = geo.getAttribute('uv')
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ]
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i
      uv.setXY(idx, uv.getX(idx) * dims[f][0] * tile, uv.getY(idx) * dims[f][1] * tile)
    }
  }
  uv.needsUpdate = true
}

function pushMerged(group: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean) {
  if (!geos.length) return
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
  if (!merged) return
  const mesh = new THREE.Mesh(merged, mat)
  mesh.castShadow = shadow
  mesh.receiveShadow = shadow
  group.add(mesh)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
