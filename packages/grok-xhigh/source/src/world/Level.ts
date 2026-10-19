import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MatId } from '../game/types'
import type { Course } from './Course'
import { labelTexture, type Materials } from './Materials'
import { scaleBoxUvs } from './CityGenerator'

export class LevelView {
  readonly group = new THREE.Group()
  private readonly flags: THREE.Object3D[] = []
  private readonly beams: Array<{ mesh: THREE.Mesh; id: number }> = []
  private readonly finish: THREE.Mesh

  constructor(course: Course, mats: Materials) {
    const buckets = new Map<MatId, THREE.BufferGeometry[]>()
    for (const solid of course.solids) {
      const geo = solidGeo(solid.minX, solid.minY, solid.minZ, solid.maxX, solid.maxY, solid.maxZ)
      const list = buckets.get(solid.mat) ?? []
      list.push(geo)
      buckets.set(solid.mat, list)
    }
    for (const [mat, geos] of buckets) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, mats.byId[mat])
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
    }

    for (const wall of course.walls) {
      const from = course.platforms.find((p) => p.id === wall.fromId)
      const baseY = from ? from.y - 0.4 : 14
      const panelW = 2.4
      const inset = wall.side === 'right' ? -0.06 : 0.06
      for (let z = wall.z0 + 1; z < wall.z1 - 1; z += 3.6) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, panelW), mats.byId.red)
        mesh.position.set(wall.face + inset, baseY + 1.8, z)
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.group.add(mesh)
      }
    }

    for (const platform of course.platforms) {
      if (platform.flag !== false && platform.z1 - platform.z0 > 8) {
        const flag = makeFlag(platform.x0 + 1.1, platform.y, platform.z1 - 0.6, mats)
        this.flags.push(flag.pivot)
        this.group.add(flag.root)
      }
      const cx = (platform.x0 + platform.x1) * 0.5
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(6.5, platform.x1 - platform.x0 - 1), 0.045, 0.72),
        mats.trim,
      )
      trim.position.set(cx, platform.y + 0.03, platform.z1 - 0.5)
      trim.receiveShadow = true
      this.group.add(trim)

      if (platform.z1 - platform.z0 > 14 && platform.x1 - platform.x0 > 8) {
        const grate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 2.4), mats.byId.dark)
        grate.position.set(cx - 2.2, platform.y + 0.025, platform.z0 + (platform.z1 - platform.z0) * 0.42)
        grate.receiveShadow = true
        this.group.add(grate)
      }
    }

    for (const cp of course.checkpoints) {
      if (cp.id === 0) continue
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), mats.beam.clone())
      mesh.position.set(cp.x + 2.4, cp.y + 1.6, cp.z)
      this.group.add(mesh)
      this.beams.push({ mesh, id: cp.id })
    }

    const start = course.platforms[0]
    const startSign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.5, 1.4),
      new THREE.MeshStandardMaterial({
        map: labelTexture('ROOFTOP FLOW', '#f4f7fb', '#ff2430'),
        roughness: 0.6,
        metalness: 0.04,
      }),
    )
    startSign.position.set(-7.2, start.y + 2.6, 0.4)
    // Face the opening camera, which sits on the negative-X side of the roof.
    startSign.rotation.y = -Math.PI / 2
    this.group.add(startSign)

    const end = course.platforms[course.platforms.length - 1]
    this.finish = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), mats.banner)
    this.finish.position.set((end.x0 + end.x1) / 2, end.y + 2.85, end.z1 - 6.35)
    this.finish.rotation.y = Math.PI
    this.group.add(this.finish)

    }

  update(time: number, checkpointId: number) {
    for (const flag of this.flags) {
      const z = flag.parent?.position.z ?? 0
      flag.rotation.y = Math.sin(time * 1.7 + z * 0.15) * 0.35
    }
    for (const beam of this.beams) {
      const mat = beam.mesh.material as THREE.MeshStandardMaterial
      const seen = beam.id <= checkpointId
      const pulse = 0.55 + Math.sin(time * 3 + beam.id) * 0.25
      mat.emissiveIntensity = seen ? 0.35 : pulse
    }
    const banner = this.finish.material as THREE.MeshStandardMaterial
    banner.emissiveIntensity = 0.25 + Math.sin(time * 2.4) * 0.15
  }
}

function solidGeo(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  const w = Math.max(0.02, maxX - minX)
  const h = Math.max(0.02, maxY - minY)
  const d = Math.max(0.02, maxZ - minZ)
  const geo = new THREE.BoxGeometry(w, h, d)
  scaleBoxUvs(geo, w, h, d, 0.2)
  geo.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  return geo
}

function makeFlag(x: number, y: number, z: number, mats: Materials) {
  const root = new THREE.Group()
  root.position.set(x, y, z)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.3, 6), mats.byId.metal)
  pole.position.set(0, 1.15, 0)
  pole.castShadow = true
  const pivot = new THREE.Group()
  pivot.position.set(0, 2.15, 0)
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.42), mats.flag)
  cloth.position.x = 0.39
  pivot.add(cloth)
  root.add(pole, pivot)
  return { root, pivot }
}
