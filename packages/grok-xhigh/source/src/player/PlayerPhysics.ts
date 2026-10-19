import { PHYS } from '../game/constants'
import type { Solid } from '../game/types'
import { CollisionWorld } from '../world/CollisionWorld'

interface Body {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

/**
 * Axis-separated AABB body. One axis moves at a time so a fast sprint
 * cannot tunnel a wall thicker than a single 1/120 s step.
 */
export class PlayerPhysics {
  x = 0
  y = 0
  z = 0
  vx = 0
  vy = 0
  vz = 0
  height: number = PHYS.standHeight
  grounded = false
  private readonly radius = PHYS.radius
  private readonly scratch: Solid[] = []

  constructor(private readonly world: CollisionWorld) {}

  get speed(): number {
    return Math.hypot(this.vx, this.vz)
  }

  reset(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
    this.vx = 0
    this.vy = 0
    this.vz = 0
    this.height = PHYS.standHeight
    this.grounded = true
  }

  bodyAt(x: number, y: number, z: number, height: number): Body {
    return {
      minX: x - this.radius,
      maxX: x + this.radius,
      minY: y,
      maxY: y + height,
      minZ: z - this.radius,
      maxZ: z + this.radius,
    }
  }

  blocked(x: number, y: number, z: number, height: number): boolean {
    return this.world.queryOverlap(this.bodyAt(x, y, z, height)).length > 0
  }

  overlaps(): Solid[] {
    return this.world.queryOverlap(this.bodyAt(this.x, this.y, this.z, this.height), this.scratch)
  }

  headroom(height: number): boolean {
    return !this.blocked(this.x, this.y, this.z, height)
  }

  /** Grow only when the taller body fits. Shrinking always succeeds. */
  trySetHeight(height: number): boolean {
    if (height > this.height + 0.001 && !this.headroom(height)) return false
    this.height = height
    return true
  }

  depenetrate() {
    for (let n = 0; n < 4; n++) {
      const hits = this.world.queryOverlap(this.bodyAt(this.x, this.y, this.z, this.height))
      if (!hits.length) return
      const h = hits[0]
      const penX = Math.min(this.x + this.radius - h.minX, h.maxX - (this.x - this.radius))
      const penY = Math.min(this.y + this.height - h.minY, h.maxY - this.y)
      const penZ = Math.min(this.z + this.radius - h.minZ, h.maxZ - (this.z - this.radius))
      const skin = 0.002
      if (penY <= penX && penY <= penZ) {
        const mid = (h.minY + h.maxY) * 0.5
        if (this.y + this.height * 0.5 >= mid) this.y += penY + skin
        else this.y -= penY + skin
      } else if (penX <= penZ) {
        const mid = (h.minX + h.maxX) * 0.5
        if (this.x >= mid) this.x += penX + skin
        else this.x -= penX + skin
      } else {
        const mid = (h.minZ + h.maxZ) * 0.5
        if (this.z >= mid) this.z += penZ + skin
        else this.z -= penZ + skin
      }
    }
  }

  moveAxis(axis: 'x' | 'z', delta: number) {
    if (delta === 0) return
    const before = axis === 'x' ? this.x : this.z
    if (axis === 'x') this.x += delta
    else this.z += delta
    let hits = this.world.queryOverlap(this.bodyAt(this.x, this.y, this.z, this.height))
    if (!hits.length) return

    if (this.grounded && this.tryStep(hits)) return

    if (axis === 'x') this.x = before
    else this.z = before
    if (axis === 'x') this.x = before + delta
    else this.z = before + delta

    for (let i = 0; i < 3; i++) {
      hits = this.world.queryOverlap(this.bodyAt(this.x, this.y, this.z, this.height))
      if (!hits.length) return
      if (delta > 0) {
        let limit = Infinity
        for (const h of hits) limit = Math.min(limit, axis === 'x' ? h.minX : h.minZ)
        const next = limit - this.radius - 0.001
        if (axis === 'x') {
          if (!(next < this.x)) break
          this.x = next
        } else {
          if (!(next < this.z)) break
          this.z = next
        }
      } else {
        let limit = -Infinity
        for (const h of hits) limit = Math.max(limit, axis === 'x' ? h.maxX : h.maxZ)
        const next = limit + this.radius + 0.001
        if (axis === 'x') {
          if (!(next > this.x)) break
          this.x = next
        } else {
          if (!(next > this.z)) break
          this.z = next
        }
      }
    }
    if (axis === 'x') this.vx = 0
    else this.vz = 0
  }

  private tryStep(hits: Solid[]): boolean {
    let stepTo = this.y
    for (const h of hits) {
      if (h.maxY <= this.y + 0.02) continue
      if (h.maxY - this.y <= PHYS.stepHeight) stepTo = Math.max(stepTo, h.maxY)
      else return false
    }
    if (stepTo <= this.y + 0.001) return false
    const old = this.y
    this.y = stepTo + 0.001
    if (!this.world.queryOverlap(this.bodyAt(this.x, this.y, this.z, this.height)).length) return true
    this.y = old
    return false
  }

  /** @returns impact speed (negative) when the feet land on a surface. */
  moveY(delta: number): number | null {
    if (delta === 0) return null
    const prev = this.y
    this.y += delta
    const hits = this.world.queryOverlap(this.bodyAt(this.x, this.y, this.z, this.height))
    if (!hits.length) {
      if (delta < 0) this.grounded = false
      return null
    }
    if (delta < 0) {
      let top = -Infinity
      for (const h of hits) {
        if (h.ceiling) continue
        if (prev >= h.maxY - 0.03 && h.maxY > top) top = h.maxY
      }
      if (top > -Infinity) {
        const impact = this.vy
        this.y = top
        this.vy = 0
        this.grounded = true
        return impact
      }
    } else {
      let bot = Infinity
      for (const h of hits) {
        if (prev + this.height <= h.minY + 0.03 && h.minY < bot) bot = h.minY
      }
      if (bot < Infinity) {
        this.y = bot - this.height - 0.001
        if (this.vy > 0) this.vy = 0
        return null
      }
    }
    this.y = prev
    if (delta < 0) this.vy = 0
    return null
  }

  /**
   * Keep a grounded body on the roof it is already standing on.
   * A miss means the ledge was walked off — do not pull toward a lower roof.
   */
  stick(): boolean {
    const floor = this.world.floorBelow(this.x, this.z, this.y, this.radius, 0.34)
    if (floor === null) {
      this.grounded = false
      return false
    }
    this.y = floor
    this.vy = 0
    this.grounded = true
    return true
  }
}
