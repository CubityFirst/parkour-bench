import { PHYS } from '../game/constants'
import type { MoveBasis, MoveInput } from '../game/types'
import { CollisionWorld } from '../world/CollisionWorld'
import { ParkourSystem, type ParkourEvents } from './ParkourSystem'
import { PlayerPhysics } from './PlayerPhysics'

export class PlayerController {
  readonly physics: PlayerPhysics
  readonly parkour: ParkourSystem

  prevX = 0
  prevY = 0
  prevZ = 0
  eye = PHYS.standEye
  bob = 0
  bobX = 0
  bobY = 0
  landDip = 0
  roll = 0

  constructor(world: CollisionWorld) {
    this.physics = new PlayerPhysics(world)
    this.parkour = new ParkourSystem(this.physics, world)
  }

  get x() { return this.physics.x }
  get y() { return this.physics.y }
  get z() { return this.physics.z }
  get vx() { return this.physics.vx }
  get vy() { return this.physics.vy }
  get vz() { return this.physics.vz }
  get speed() { return this.physics.speed }
  get grounded() { return this.physics.grounded }
  get height() { return this.physics.height }
  get mode() { return this.parkour.mode }
  get canVault() { return this.parkour.canVault }
  get wallSide() { return this.parkour.wallSide }
  get vaultT() { return this.parkour.vaultT }
  get events(): ParkourEvents { return this.parkour.events }

  reset(x: number, y: number, z: number) {
    this.physics.reset(x, y, z)
    this.parkour.reset()
    this.prevX = x
    this.prevY = y
    this.prevZ = z
    this.eye = PHYS.standEye
    this.bob = 0
    this.bobX = 0
    this.bobY = 0
    this.landDip = 0
    this.roll = 0
  }

  update(dt: number, input: MoveInput, basis: MoveBasis) {
    this.prevX = this.x
    this.prevY = this.y
    this.prevZ = this.z
    this.parkour.step(dt, input, basis)
    this.updateCameraFeel(dt, input)
  }

  private updateCameraFeel(dt: number, input: MoveInput) {
    const heightT = (this.height - PHYS.slideHeight) / (PHYS.standHeight - PHYS.slideHeight)
    const targetEye = PHYS.slideEye + (PHYS.standEye - PHYS.slideEye) * clamp01(heightT)
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12)

    const moving = this.grounded && this.mode !== 'slide' && this.speed > 1.4
    if (moving) this.bob += dt * this.speed * 2.15
    const bobAmp = moving ? 0.028 + Math.min(0.02, this.speed * 0.0015) : 0
    this.bobX = Math.cos(this.bob * 0.5) * bobAmp * 0.65
    this.bobY = Math.sin(this.bob) * bobAmp

    if (this.events.land) {
      const impact = Math.min(14, Math.abs(this.vy) + 6)
      this.landDip = Math.min(0.16, this.landDip + impact * 0.008)
    }
    this.landDip += (0 - this.landDip) * Math.min(1, dt * 7)

    const strafe = clamp(input.strafe, -1, 1)
    const targetRoll = strafe * -0.03 + this.wallSide * 0.2
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8)
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}
