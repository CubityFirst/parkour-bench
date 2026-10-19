import { impossibleGap, maxComfortGap, PHYS } from '../game/constants'
import { LOOK_YAW, type Checkpoint, type HintZone, type Platform, type Solid, type WallDef } from '../game/types'

export interface Course {
  solids: Solid[]
  platforms: Platform[]
  walls: WallDef[]
  checkpoints: Checkpoint[]
  hints: HintZone[]
  spawn: { x: number; y: number; z: number; yaw: number }
  finish: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  length: number
}

interface Ceiling {
  x0: number
  x1: number
  z0: number
  z1: number
  y0: number
  y1: number
}

export function buildCourse(): Course {
  const b = new Builder()

  // --- Section 1: movement tutorial --------------------------------------
  const s1 = b.platform({
    id: 's1',
    x0: -12,
    x1: 12,
    z0: -4,
    z1: 22,
    y: 16,
    props: true,
    flag: false,
  }, { rails: true, rearRail: true })
  b.vault(s1, 8.4, 0)
  b.ceiling(s1, 14.2, 16.1)
  b.hint('move', 'WASD move  ·  Shift sprint  ·  Space jump', s1, 0, 7)
  b.hint('vault', 'Press E to vault the red block', s1, 6.2, 10.5)
  b.hint('slide', 'Hold Ctrl to slide under the duct', s1, 11, 16.4)
  b.hint('gap', 'Sprint, then hold Space to clear the gap', s1, 17.5, 22)

  // --- Section 2: rooftop jumps ------------------------------------------
  let prev = s1
  const jumpYs = [
    16, 16.4, 16.05, 16.5, 16.1, 16.45, 16.05, 16.5, 16.15, 16.4, 16.1,
    16.5, 16.1, 16.48, 16.12, 16.5, 16.15, 16.42, 16.08, 16.46, 16.12, 16.4,
  ]
  let x = 0
  for (let i = 0; i < jumpYs.length; i++) {
    const gap = i === 0 ? 3.55 : 5.05 + (i % 3) * 0.18
    x += i % 2 === 0 ? 1.05 : -0.7
    const len = 13 + (i % 3)
    const half = 6.2
    const next = b.platform({
      id: 'j' + i,
      x0: x - half,
      x1: x + half,
      z0: prev.z1 + gap,
      z1: prev.z1 + gap + len,
      y: jumpYs[i],
      props: true,
      flag: true,
    }, { rails: true })
    if (i === 5) b.checkpoint(next, 'ROOFTOPS', 3.2)
    if (i === 14) b.checkpoint(next, 'RIDGE', 3.2)
    prev = next
  }
  b.hint('roofs', 'Red marks the takeoff  ·  keep your speed', b.platforms[2], 0, 6)

  // --- Section 3: sliding challenge --------------------------------------
  const slide = b.platform({
    id: 'slide',
    x0: prev.x0 + 1.4,
    x1: prev.x1 - 1.4,
    z0: prev.z1 + 4.5,
    z1: prev.z1 + 4.5 + 130,
    y: prev.y,
    props: false,
    flag: true,
  }, { rails: true })
  // Four short ducts with open roof between them so speed can be rebuilt.
  const slideLen = slide.z1 - slide.z0
  for (const t of [0.08, 0.24, 0.4, 0.56, 0.72, 0.88]) {
    b.ceiling(slide, slide.z0 + slideLen * t, slide.z0 + slideLen * t + 4.2)
  }
  b.hint('ducts', 'Slide each duct  ·  release and sprint between them', slide, slide.z0, slide.z0 + 8)
  b.checkpoint(slide, 'DUCTS', 4)
  b.checkpoint(slide, 'CLEAR', slide.z1 - slide.z0 - 3.5)
  prev = slide

  // --- Section 4: wall run ------------------------------------------------
  const take1 = b.platform({
    id: 'wall-take-1',
    x0: prev.x0,
    x1: prev.x0 + 10,
    z0: prev.z1 + 4.4,
    z1: prev.z1 + 4.4 + 16,
    y: prev.y,
    hug: 'right',
    props: false,
    flag: true,
  }, { rails: true })
  const land1 = b.platform({
    id: 'wall-land-1',
    x0: take1.x0,
    x1: take1.x1 + 3.4,
    z0: take1.z1 + 11.2,
    z1: take1.z1 + 11.2 + 20,
    y: take1.y - 0.3,
    props: true,
    flag: true,
  }, { rails: true })
  b.wall('right', take1, land1)
  b.hint('wall', 'Jump onto the red wall  ·  it carries you across', take1, take1.z1 - 8, take1.z1)
  b.checkpoint(land1, 'WALL RUN', 4)
  prev = land1

  // --- Section 5: combination --------------------------------------------
  const combo = b.platform({
    id: 'combo',
    x0: prev.x0 + 0.4,
    x1: prev.x0 + 12,
    z0: prev.z1 + 4.7,
    z1: prev.z1 + 4.7 + 18,
    y: prev.y,
    hug: 'left',
    props: false,
    flag: true,
  }, { rails: true })
  b.vault(combo, combo.z0 + 6.5, (combo.x0 + combo.x1) * 0.5)
  const comboLand = b.platform({
    id: 'combo-land',
    x0: combo.x0 - 3.4,
    x1: combo.x1,
    z0: combo.z1 + 11.4,
    z1: combo.z1 + 11.4 + 26,
    y: combo.y - 0.25,
    props: false,
    flag: true,
  }, { rails: true })
  b.wall('left', combo, comboLand)
  b.ceiling(comboLand, comboLand.z0 + 12, comboLand.z0 + 16.4)
  b.hint('combo', 'Vault, wall-run, then slide  ·  chain them', combo, combo.z0, combo.z0 + 5)
  b.checkpoint(comboLand, 'FLOW', 6)
  prev = comboLand

  // --- Section 6: final sprint -------------------------------------------
  let y = prev.y
  let cx = (prev.x0 + prev.x1) * 0.5
  const finaleCount = 10
  for (let i = 0; i < finaleCount; i++) {
    const gap = 4.9 + (i % 3) * 0.2
    const dy = i % 2 === 0 ? 0.28 : -0.22
    y += dy
    cx += i % 2 === 0 ? 0.6 : -0.45
    const len = i === finaleCount - 1 ? 22 : 13 + (i % 2)
    const half = i === finaleCount - 1 ? 8 : 6.4
    const next = b.platform({
      id: i === finaleCount - 1 ? 'finish-roof' : 'fin' + i,
      x0: cx - half,
      x1: cx + half,
      z0: prev.z1 + gap,
      z1: prev.z1 + gap + len,
      y,
      props: i !== 7,
      flag: true,
    }, { rails: true, backRail: i === finaleCount - 1 })
    if (i === 0) b.checkpoint(next, 'FINAL', 3)
    prev = next
  }
  b.hint('final', 'Final sprint  ·  the red arch is the finish', b.platforms[b.platforms.length - finaleCount], 0, 5)

  const finishRoof = prev
  const fx = (finishRoof.x0 + finishRoof.x1) * 0.5
  b.arch(finishRoof, fx, finishRoof.z1 - 6)
  const finish = {
    minX: finishRoof.x0 + 0.4,
    maxX: finishRoof.x1 - 0.4,
    minY: finishRoof.y,
    maxY: finishRoof.y + 3,
    minZ: finishRoof.z1 - 8.5,
    maxZ: finishRoof.z1 - 2,
  }

  const course: Course = {
    solids: b.solids,
    platforms: b.platforms,
    walls: b.walls,
    checkpoints: b.checkpoints,
    hints: b.hints,
    spawn: { x: 0, y: s1.y, z: 2.2, yaw: LOOK_YAW },
    finish,
    bounds: b.bounds(),
    length: finishRoof.z1 - s1.z0,
  }
  const errors = validate(course)
  if (errors.length) {
    throw new Error('Course validation failed:\n' + errors.join('\n'))
  }
  return course
}

export function platformAt(course: Course, z: number): Platform | undefined {
  for (const p of course.platforms) {
    if (z >= p.z0 && z <= p.z1) return p
  }
  return undefined
}

export function preferredX(course: Course, z: number): number {
  const here = platformAt(course, z)
  // Hug the lip while still on the roof. hangX sits just past that lip, so
  // aiming at it early walks the body off the side before the gap.
  if (here?.hug && z > here.z1 - 9) {
    return here.hug === 'right' ? here.x1 + 0.12 : here.x0 - 0.12
  }
  if (!here) {
    for (const w of course.walls) {
      const from = course.platforms.find((p) => p.id === w.fromId)
      const to = course.platforms.find((p) => p.id === w.toId)
      if (!from || !to) continue
      if (z > from.z1 && z < to.z0 + 1.6) return w.hangX
    }
  }
  if (!here) {
    const next = course.platforms.find((p) => p.z0 > z)
    const prev = [...course.platforms].reverse().find((p) => p.z1 <= z)
    if (next && prev) {
      const wall = course.walls.find((w) => w.fromId === prev.id && w.toId === next.id)
      if (wall) return wall.hangX
      return overlapCenter(prev, next)
    }
    if (next) return (next.x0 + next.x1) * 0.5
    return 0
  }
  if (here.hug && z > here.z1 - 9) {
    return here.hug === 'right' ? here.x1 + 0.12 : here.x0 - 0.12
  }
  const index = course.platforms.indexOf(here)
  const next = course.platforms[index + 1]
  if (next && !course.walls.some((w) => w.fromId === here.id)) {
    return overlapCenter(here, next)
  }
  return (here.x0 + here.x1) * 0.5
}

function overlapCenter(a: Platform, b: Platform): number {
  const x0 = Math.max(a.x0, b.x0)
  const x1 = Math.min(a.x1, b.x1)
  if (x1 > x0) return (x0 + x1) * 0.5
  return (b.x0 + b.x1) * 0.5
}

function validate(course: Course): string[] {
  const errors: string[] = []
  const platforms = course.platforms
  for (let i = 0; i < platforms.length - 1; i++) {
    const a = platforms[i]
    const b = platforms[i + 1]
    const gap = b.z0 - a.z1
    const dy = b.y - a.y
    const wall = course.walls.find((w) => w.fromId === a.id && w.toId === b.id)
    if (wall) {
      if (gap <= impossibleGap(Math.max(0, dy))) {
        errors.push(`${a.id} → ${b.id} wall gap ${gap.toFixed(2)} is jumpable (limit ${impossibleGap(Math.max(0, dy)).toFixed(2)})`)
      }
      const hangOnLand = wall.hangX > b.x0 + PHYS.radius && wall.hangX < b.x1 - PHYS.radius
      if (!hangOnLand) errors.push(`${wall.fromId} hang x ${wall.hangX.toFixed(2)} misses ${b.id}`)
      if (wall.z0 > a.z1 - 4) errors.push(`${a.id} wall starts too late`)
      if (wall.z1 < b.z0 + 6) errors.push(`${b.id} wall ends before the landing`)
    } else {
      const comfort = maxComfortGap(PHYS.sprintSpeed, dy, 1)
      if (gap > comfort) {
        errors.push(`${a.id} → ${b.id} gap ${gap.toFixed(2)} dy ${dy.toFixed(2)} exceeds comfort ${comfort.toFixed(2)}`)
      }
      const x0 = Math.max(a.x0, b.x0)
      const x1 = Math.min(a.x1, b.x1)
      if (x1 - x0 < 2.2) errors.push(`${a.id} → ${b.id} x-overlap ${(x1 - x0).toFixed(2)} is tight`)
    }
  }
  if (course.checkpoints[0]?.id !== 0) errors.push('missing spawn checkpoint')
  if (course.platforms.length < 12) errors.push('course is too short')
  if (course.length < 560) errors.push(`course length ${course.length.toFixed(0)}m is under 560`)
  return errors
}

class Builder {
  solids: Solid[] = []
  platforms: Platform[] = []
  walls: WallDef[] = []
  checkpoints: Checkpoint[] = []
  hints: HintZone[] = []
  private cpCount = 0

  constructor() {
    this.checkpoints.push({
      id: 0,
      name: 'START',
      x: 0,
      y: 16,
      z: 2.2,
      yaw: LOOK_YAW,
      zone: null,
    })
  }

  platform(p: Platform, opts: { rails?: boolean; backRail?: boolean; rearRail?: boolean } = {}): Platform {
    this.platforms.push(p)
    this.solids.push({
      minX: p.x0,
      maxX: p.x1,
      minY: p.y - 0.5,
      maxY: p.y,
      minZ: p.z0,
      maxZ: p.z1,
      mat: 'white',
      mantle: true,
    })
    this.solids.push({
      minX: p.x0,
      maxX: p.x1,
      minY: p.y - 14,
      maxY: p.y - 0.32,
      minZ: p.z0,
      maxZ: p.z1,
      mat: 'skirt',
    })
    if (opts.rails) this.sideRails(p)
    if (opts.rearRail) {
      this.solids.push({
        minX: p.x0 + 0.4,
        maxX: p.x1 - 0.4,
        minY: p.y,
        maxY: p.y + 0.95,
        minZ: p.z0,
        maxZ: p.z0 + 0.35,
        mat: 'metal',
      })
    }
    if (opts.backRail) {
      this.solids.push({
        minX: p.x0 + 0.4,
        maxX: p.x1 - 0.4,
        minY: p.y,
        maxY: p.y + 0.95,
        minZ: p.z1 - 0.35,
        maxZ: p.z1,
        mat: 'metal',
      })
    }
    if (p.props) this.dress(p)
    return p
  }

  private sideRails(p: Platform) {
    const z0 = p.z0 + 1.7
    const z1 = p.z1 - 1.9
    if (z1 - z0 < 2) return
    const h = 0.9
    const t = 0.28
    if (p.hug !== 'left') {
      this.solids.push({
        minX: p.x0,
        maxX: p.x0 + t,
        minY: p.y,
        maxY: p.y + h,
        minZ: z0,
        maxZ: z1,
        mat: 'metal',
      })
    }
    if (p.hug !== 'right') {
      this.solids.push({
        minX: p.x1 - t,
        maxX: p.x1,
        minY: p.y,
        maxY: p.y + h,
        minZ: z0,
        maxZ: z1,
        mat: 'metal',
      })
    }
  }

  private dress(p: Platform) {
    const len = p.z1 - p.z0
    const wid = p.x1 - p.x0
    if (len < 12 || wid < 10) return
    // Air-conditioning unit off the running line.
    const ax0 = p.x0 + 0.8
    const az = p.z0 + len * 0.58
    this.solids.push({
      minX: ax0,
      maxX: ax0 + 1.35,
      minY: p.y,
      maxY: p.y + 1.05,
      minZ: az,
      maxZ: az + 1.2,
      mat: 'metal',
    })
    if (len > 15 && wid > 11 && !p.hug && this.platforms.length % 3 === 0) {
      this.solids.push({
        minX: p.x1 - 3.3,
        maxX: p.x1 - 0.45,
        minY: p.y,
        maxY: p.y + 2.7,
        minZ: p.z0 + 4.2,
        maxZ: p.z0 + 8.4,
        mat: 'glass',
      })
    }
  }

  vault(p: Platform, z0: number, xCenter: number) {
    this.solids.push({
      minX: xCenter - 1.35,
      maxX: xCenter + 1.35,
      minY: p.y,
      maxY: p.y + 0.86,
      minZ: z0,
      maxZ: z0 + 1.15,
      mat: 'red',
      vault: true,
    })
  }

  ceiling(p: Platform, z0: number, z1: number) {
    const c: Ceiling = {
      x0: p.x0,
      x1: p.x1,
      z0,
      z1,
      y0: p.y + 1.02,
      y1: p.y + 1.72,
    }
    this.solids.push({
      minX: c.x0,
      maxX: c.x1,
      minY: c.y0,
      maxY: c.y1,
      minZ: c.z0,
      maxZ: c.z1,
      mat: 'metal',
      ceiling: true,
    })
    // Supports at the ends so the duct reads as a structure, not a floating slab.
    for (const z of [z0, z1 - 0.28]) {
      this.solids.push({
        minX: p.x0,
        maxX: p.x0 + 0.35,
        minY: p.y,
        maxY: c.y0,
        minZ: z,
        maxZ: z + 0.28,
        mat: 'metal',
      })
      this.solids.push({
        minX: p.x1 - 0.35,
        maxX: p.x1,
        minY: p.y,
        maxY: c.y0,
        minZ: z,
        maxZ: z + 0.28,
        mat: 'metal',
      })
    }
  }

  wall(side: 'left' | 'right', from: Platform, to: Platform) {
    const face = side === 'right' ? from.x1 + PHYS.wallFaceGap : from.x0 - PHYS.wallFaceGap
    const hangX = side === 'right'
      ? face - PHYS.radius - PHYS.wallSkin
      : face + PHYS.radius + PHYS.wallSkin
    const y0 = Math.min(from.y, to.y) - 8
    const y1 = Math.max(from.y, to.y) + 14
    const z0 = from.z1 - 8
    const z1 = to.z0 + 12
    const thick = 2.6
    const solid: Solid = side === 'right'
      ? { minX: face, maxX: face + thick, minY: y0, maxY: y1, minZ: z0, maxZ: z1, mat: 'concrete', wallRun: true }
      : { minX: face - thick, maxX: face, minY: y0, maxY: y1, minZ: z0, maxZ: z1, mat: 'concrete', wallRun: true }
    this.solids.push(solid)
    this.walls.push({ side, face, hangX, z0, z1, y0, y1, fromId: from.id, toId: to.id })
  }

  checkpoint(p: Platform, name: string, localZ: number) {
    this.cpCount += 1
    const z = p.z0 + localZ
    const x = (p.x0 + p.x1) * 0.5
    this.checkpoints.push({
      id: this.cpCount,
      name,
      x,
      y: p.y,
      z,
      yaw: LOOK_YAW,
      zone: {
        minX: p.x0,
        maxX: p.x1,
        minY: p.y,
        maxY: p.y + 3,
        minZ: z - 1.2,
        maxZ: z + 2.4,
      },
    })
  }

  hint(id: string, text: string, p: Platform, z0: number, z1: number) {
    // Values that fall before the platform are distances along it.
    const minZ = z0 >= p.z0 ? z0 : p.z0 + z0
    const maxZ = z1 >= p.z0 ? z1 : p.z0 + z1
    this.hints.push({
      id,
      text,
      minX: p.x0 - 1,
      maxX: p.x1 + 1,
      minY: p.y - 0.2,
      maxY: p.y + 3,
      minZ,
      maxZ,
    })
  }

  arch(p: Platform, x: number, z: number) {
    const y = p.y
    const pillar = 0.55
    const gap = 2.35
    this.solids.push({
      minX: x - gap - pillar,
      maxX: x - gap,
      minY: y,
      maxY: y + 4.6,
      minZ: z,
      maxZ: z + 0.55,
      mat: 'red',
    })
    this.solids.push({
      minX: x + gap,
      maxX: x + gap + pillar,
      minY: y,
      maxY: y + 4.6,
      minZ: z,
      maxZ: z + 0.55,
      mat: 'red',
    })
    this.solids.push({
      minX: x - gap - pillar,
      maxX: x + gap + pillar,
      minY: y + 4.05,
      maxY: y + 4.6,
      minZ: z,
      maxZ: z + 0.55,
      mat: 'red',
    })
  }

  bounds() {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const p of this.platforms) {
      minX = Math.min(minX, p.x0)
      maxX = Math.max(maxX, p.x1)
      minZ = Math.min(minZ, p.z0)
      maxZ = Math.max(maxZ, p.z1)
    }
    return { minX, maxX, minZ, maxZ }
  }
}
