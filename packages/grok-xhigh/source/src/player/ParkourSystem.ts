import { PHYS } from '../game/constants'
import type { MoveBasis, MoveInput, Solid } from '../game/types'
import { CollisionWorld } from '../world/CollisionWorld'
import { PlayerPhysics } from './PlayerPhysics'

export type MoveMode = 'ground' | 'air' | 'slide' | 'wall' | 'vault' | 'mantle'

export interface ParkourEvents {
  jump: boolean
  land: boolean
  step: boolean
  vault: boolean
  wall: boolean
  wallJump: boolean
  slideStart: boolean
  slideStop: boolean
}

interface Scripted {
  kind: 'vault' | 'mantle'
  t: number
  dur: number
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  peak: number
  dirX: number
  dirZ: number
  speed: number
}

interface WallState {
  solid: Solid
  nx: number
  ny: number
  nz: number
  tx: number
  tz: number
  time: number
  side: -1 | 1
}

/**
 * Slide, vault, wall-run and mantle on top of the rigid body.
 * Wall runs stick to a tagged vertical face and bleed a fraction of gravity
 * so a gap past the flat jump still has a readable, finite crossing.
 */
export class ParkourSystem {
  mode: MoveMode = 'ground'
  canVault = false
  wallSide: -1 | 0 | 1 = 0
  vaultT = 0
  events: ParkourEvents = emptyEvents()

  private coyote: number = PHYS.coyote
  private buffer = 0
  private jumpCut = false
  private script: Scripted | null = null
  private wall: WallState | null = null
  private wallBan: Solid | null = null
  private wallCooldown = 0
  private lowFriction = false
  private stride = 0

  constructor(
    private readonly physics: PlayerPhysics,
    private readonly world: CollisionWorld,
  ) {}

  reset() {
    this.mode = 'ground'
    this.canVault = false
    this.wallSide = 0
    this.vaultT = 0
    this.coyote = PHYS.coyote
    this.buffer = 0
    this.jumpCut = false
    this.script = null
    this.wall = null
    this.wallBan = null
    this.wallCooldown = 0
    this.lowFriction = false
    this.stride = 0
    this.events = emptyEvents()
    this.physics.trySetHeight(PHYS.standHeight)
  }

  step(dt: number, input: MoveInput, basis: MoveBasis) {
    this.events = emptyEvents()
    this.wallCooldown = Math.max(0, this.wallCooldown - dt)
    const body = this.physics

    if (this.script) {
      this.advanceScript(dt)
      return
    }

    this.canVault = this.probeVault(basis) !== null
    if (input.vaultPressed && (body.grounded || this.mode === 'slide')) {
      const vault = this.probeVault(basis)
      if (vault) {
        this.beginScript(vault, 'vault', PHYS.vaultDuration)
        this.events.vault = true
        return
      }
    }

    if (!body.grounded && this.mode !== 'wall') {
      const mantle = this.probeMantle(basis, input)
      if (mantle) {
        this.beginScript(mantle, 'mantle', PHYS.mantleDuration)
        return
      }
    }

    this.updateCrouch(input)
    if (this.wall) {
      this.sustainWall(dt, input, basis)
      return
    }

    if (body.grounded) this.wallBan = null

    const canJump = body.grounded || this.coyote > 0
    if ((input.jumpPressed || this.buffer > 0) && canJump && this.canStand()) {
      this.doJump()
    } else if (input.jumpPressed) {
      this.buffer = PHYS.jumpBuffer
    } else {
      this.buffer = Math.max(0, this.buffer - dt)
    }

    if (!input.jumpHeld && !this.jumpCut && body.vy > 0 && !body.grounded) {
      body.vy = Math.min(body.vy, PHYS.jumpSpeed * 0.46)
      this.jumpCut = true
    }

    this.accelerate(dt, input, basis)

    if (!body.grounded) body.vy -= PHYS.gravity * dt
    this.integrate(dt)

    if (body.grounded) {
      this.coyote = PHYS.coyote
      if (this.mode !== 'slide') this.mode = 'ground'
    } else {
      this.coyote = Math.max(0, this.coyote - dt)
      if (this.mode !== 'slide') this.mode = 'air'
      this.tryEnterWall(basis)
    }

    this.footsteps(dt)
  }

  private canStand(): boolean {
    return this.physics.headroom(PHYS.standHeight)
  }

  private updateCrouch(input: MoveInput) {
    const body = this.physics
    const forced = !body.headroom(PHYS.standHeight)
    const want = (input.slide && body.grounded) || forced
    if (want) {
      if (this.mode !== 'slide') {
        this.lowFriction = body.speed > 4.8
        this.events.slideStart = true
      }
      body.trySetHeight(PHYS.slideHeight)
      this.mode = 'slide'
    } else if (this.mode === 'slide') {
      if (body.trySetHeight(PHYS.standHeight)) {
        this.mode = body.grounded ? 'ground' : 'air'
        this.lowFriction = false
        this.events.slideStop = true
      } else {
        body.trySetHeight(PHYS.slideHeight)
      }
    }
  }

  private doJump() {
    const body = this.physics
    if (this.mode === 'slide') {
      if (!body.trySetHeight(PHYS.standHeight)) return
      this.mode = 'air'
      this.lowFriction = false
      this.events.slideStop = true
    }
    body.vy = PHYS.jumpSpeed
    body.grounded = false
    this.coyote = 0
    this.buffer = 0
    this.jumpCut = false
    this.mode = 'air'
    this.events.jump = true
  }

  private accelerate(dt: number, input: MoveInput, basis: MoveBasis) {
    const body = this.physics
    let wishX = basis.forwardX * input.forward + basis.rightX * input.strafe
    let wishZ = basis.forwardZ * input.forward + basis.rightZ * input.strafe
    const wishLen = Math.hypot(wishX, wishZ)
    if (wishLen > 1) {
      wishX /= wishLen
      wishZ /= wishLen
    } else if (wishLen > 0.001) {
      wishX /= wishLen
      wishZ /= wishLen
    } else {
      wishX = 0
      wishZ = 0
    }

    const target = input.sprint ? PHYS.sprintSpeed : PHYS.walkSpeed
    if (body.grounded && this.mode === 'slide' && this.lowFriction) {
      const s = body.speed
      const drop = Math.min(s, PHYS.slideFriction * dt)
      if (s > 0.05) {
        const k = (s - drop) / s
        body.vx *= k
        body.vz *= k
      }
      approach(body, wishX * s, wishZ * s, 8 * dt)
    } else if (body.grounded) {
      if (wishLen > 0.08) approach(body, wishX * target, wishZ * target, PHYS.groundAccel * dt)
      else approach(body, 0, 0, PHYS.groundDecel * dt)
    } else {
      airAccelerate(body, wishX, wishZ, target, PHYS.airAccel, dt)
    }
    capHorizontal(body, PHYS.maxSpeed)
  }

  private integrate(dt: number) {
    const body = this.physics
    body.depenetrate()
    body.moveAxis('x', body.vx * dt)
    body.moveAxis('z', body.vz * dt)
    if (body.grounded && body.vy <= 0) {
      const was = body.y
      if (!body.stick()) {
        // Walked off a lip this step.
        body.vy -= PHYS.gravity * dt
        const impact = body.moveY(body.vy * dt)
        if (impact !== null && impact < -3.2 && was - body.y > 0.2) this.events.land = true
      }
    } else {
      const impact = body.moveY(body.vy * dt)
      if (impact !== null && impact < -3.2) this.events.land = true
    }
  }

  private tryEnterWall(basis: MoveBasis) {
    const body = this.physics
    if (this.wallCooldown > 0) return
    if (body.speed < PHYS.wallMinSpeed && body.vy < 1) return
    const hit = this.probeWall(basis)
    if (!hit) return
    if (hit.solid === this.wallBan) return

    const txPair = tangent(hit.nx, hit.nz, body.vx, body.vz, basis)
    let along = body.vx * txPair.tx + body.vz * txPair.tz
    if (along < PHYS.wallBoost) along = PHYS.wallBoost
    body.vx = txPair.tx * along
    body.vz = txPair.tz * along
    body.vy = clamp(body.vy, -0.4, 2.1)
    this.wall = {
      solid: hit.solid,
      nx: hit.nx,
      ny: 0,
      nz: hit.nz,
      tx: txPair.tx,
      tz: txPair.tz,
      time: 0,
      side: hit.side,
    }
    this.wallSide = hit.side
    this.mode = 'wall'
    this.buffer = 0
    this.stickToWall(hit)
    this.events.wall = true
  }

  private sustainWall(dt: number, input: MoveInput, basis: MoveBasis) {
    const body = this.physics
    const wall = this.wall
    if (!wall) return
    wall.time += dt

    if (input.jumpPressed && wall.time > 0.14) {
      this.leaveWall(true)
      return
    }

    const fresh = this.probeWall(basis, wall.side)
    if (!fresh || fresh.solid !== wall.solid || wall.time > PHYS.wallMaxTime) {
      this.leaveWall(false)
      return
    }
    wall.nx = fresh.nx
    wall.nz = fresh.nz
    const txPair = tangent(fresh.nx, fresh.nz, body.vx, body.vz, basis)
    wall.tx = txPair.tx
    wall.tz = txPair.tz
    let along = body.vx * wall.tx + body.vz * wall.tz
    if (along < PHYS.wallBoost * 0.85) along = PHYS.wallBoost * 0.85
    body.vx = wall.tx * along
    body.vz = wall.tz * along
    body.vy -= PHYS.gravity * PHYS.wallGravity * dt
    body.vy = clamp(body.vy, -3.2, 2.4)

    body.moveAxis('x', body.vx * dt)
    body.moveAxis('z', body.vz * dt)
    const impact = body.moveY(body.vy * dt)
    this.stickToWall(fresh)
    body.vx = wall.tx * along
    body.vz = wall.tz * along

    if (body.grounded || impact !== null) {
      if (impact !== null && impact < -3.2) this.events.land = true
      this.wallBan = wall.solid
      this.wall = null
      this.wallSide = 0
      this.wallCooldown = 0.35
      this.mode = 'ground'
      return
    }
    if (body.blocked(body.x, body.y, body.z, body.height)) {
      this.leaveWall(false)
    }
  }

  private leaveWall(jumped: boolean) {
    const body = this.physics
    const wall = this.wall
    if (!wall) return
    if (jumped) {
      const along = body.vx * wall.tx + body.vz * wall.tz
      body.vx = wall.tx * along + wall.nx * PHYS.wallJumpOff
      body.vz = wall.tz * along + wall.nz * PHYS.wallJumpOff
      body.vy = PHYS.wallJumpUp
      this.jumpCut = false
      this.events.wallJump = true
      this.events.jump = true
      capHorizontal(body, PHYS.maxSpeed)
    }
    this.wallBan = wall.solid
    this.wall = null
    this.wallSide = 0
    this.wallCooldown = 0.4
    this.mode = 'air'
    body.grounded = false
  }

  private stickToWall(hit: { x: number; z: number; nx: number; nz: number }) {
    const body = this.physics
    const skin = PHYS.radius + PHYS.wallSkin
    if (Math.abs(hit.nx) >= Math.abs(hit.nz)) {
      body.x = hit.x + hit.nx * skin
      body.vx = body.vx * (1 - Math.abs(hit.nx))
    } else {
      body.z = hit.z + hit.nz * skin
    }
  }

  private probeWall(basis: MoveBasis, prefer?: -1 | 1): { solid: Solid; x: number; z: number; nx: number; nz: number; side: -1 | 1 } | null {
    const body = this.physics
    const sides: Array<-1 | 1> = prefer ? [prefer, (-prefer as -1 | 1)] : [1, -1]
    for (const side of sides) {
      // Straight to the side, then a forward fan so an angled approach still catches.
      const dirs = [
        [basis.rightX * side, basis.rightZ * side],
        [basis.rightX * side + basis.forwardX * 0.45, basis.rightZ * side + basis.forwardZ * 0.45],
      ]
      for (const [rx, rz] of dirs) {
        const len = Math.hypot(rx, rz)
        if (len < 1e-4) continue
        const dx = rx / len
        const dz = rz / len
        for (const h of [0.5, 1.05, 1.4]) {
          const hit = this.world.raycast(
            body.x,
            body.y + h,
            body.z,
            dx,
            0,
            dz,
            PHYS.wallProbe,
            (s) => !!s.wallRun,
          )
          if (!hit) continue
          if (Math.abs(hit.ny) > 0.45) continue
          return { solid: hit.solid, x: hit.x, z: hit.z, nx: hit.nx, nz: hit.nz, side }
        }
      }
    }
    return null
  }

  private probeVault(basis: MoveBasis): Scripted | null {
    const body = this.physics
    let fx = basis.forwardX
    let fz = basis.forwardZ
    const vlen = body.speed
    if (vlen > 2) {
      fx = body.vx / vlen
      fz = body.vz / vlen
    }
    const hit = this.world.raycast(body.x, body.y + 0.42, body.z, fx, 0, fz, 1.2, (s) => !!s.vault)
    if (!hit || hit.t > 1.05) return null
    const top = hit.solid.maxY
    const rise = top - body.y
    if (rise < 0.35 || rise > 1.2) return null
    const depth = Math.abs((hit.solid.maxX - hit.solid.minX) * fx) + Math.abs((hit.solid.maxZ - hit.solid.minZ) * fz)
    if (depth > 1.8) return null
    const travel = hit.t + depth + 0.7
    const x1 = body.x + fx * travel
    const z1 = body.z + fz * travel
    const floor = this.world.floorBelow(x1, z1, body.y + 0.2, PHYS.radius, 1.4)
    if (floor === null) return null
    if (Math.abs(floor - body.y) > 0.85) return null
    if (body.blocked(x1, floor, z1, PHYS.standHeight)) return null
    return {
      kind: 'vault',
      t: 0,
      dur: PHYS.vaultDuration,
      x0: body.x,
      y0: body.y,
      z0: body.z,
      x1,
      y1: floor,
      z1,
      peak: top + 0.24,
      dirX: fx,
      dirZ: fz,
      speed: Math.max(body.speed, PHYS.sprintSpeed * 0.9),
    }
  }

  private probeMantle(basis: MoveBasis, input: MoveInput): Scripted | null {
    const body = this.physics
    if (body.vy > 4.5 || body.vy < -8) return null
    if (input.forward < 0.15 && body.speed < 1.5) return null
    let fx = basis.forwardX
    let fz = basis.forwardZ
    if (body.speed > 3) {
      fx = body.vx / body.speed
      fz = body.vz / body.speed
    }
    for (const dist of [0.4, 0.68, 0.95]) {
      const x = body.x + fx * dist
      const z = body.z + fz * dist
      const hits = this.world.queryOverlap({
        minX: x - 0.05,
        maxX: x + 0.05,
        minY: body.y + 0.6,
        maxY: body.y + 1.7,
        minZ: z - 0.05,
        maxZ: z + 0.05,
      })
      for (const s of hits) {
        if (!s.mantle) continue
        if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue
        const top = s.maxY
        if (top < body.y + 0.78 || top > body.y + PHYS.standHeight + 0.05) continue
        if (body.y > top - 0.18) continue
        const destX = clamp(x + fx * 0.25, s.minX + PHYS.radius + 0.08, s.maxX - PHYS.radius - 0.08)
        const destZ = clamp(z + fz * 0.25, s.minZ + PHYS.radius + 0.08, s.maxZ - PHYS.radius - 0.08)
        if (body.blocked(destX, top, destZ, PHYS.standHeight)) continue
        return {
          kind: 'mantle',
          t: 0,
          dur: PHYS.mantleDuration,
          x0: body.x,
          y0: body.y,
          z0: body.z,
          x1: destX,
          y1: top,
          z1: destZ,
          peak: top + 0.05,
          dirX: fx,
          dirZ: fz,
          speed: Math.max(4.5, body.speed * 0.8),
        }
      }
    }
    return null
  }

  private beginScript(move: Scripted, kind: 'vault' | 'mantle', dur: number) {
    this.script = move
    this.script.kind = kind
    this.script.dur = dur
    this.script.t = 0
    this.mode = kind
    this.vaultT = 0
    this.physics.grounded = false
    this.wall = null
    this.wallSide = 0
  }

  private advanceScript(dt: number) {
    const move = this.script
    const body = this.physics
    if (!move) return
    move.t += dt
    const u = clamp(move.t / move.dur, 0, 1)
    const s = u * u * (3 - 2 * u)
    body.x = move.x0 + (move.x1 - move.x0) * s
    body.z = move.z0 + (move.z1 - move.z0) * s
    let y: number
    if (move.kind === 'vault') {
      if (u < 0.32) y = lerp(move.y0, move.peak, smooth(u / 0.32))
      else y = lerp(move.peak, move.y1, smooth((u - 0.32) / 0.68))
    } else {
      y = lerp(move.y0, move.y1, smooth(Math.min(1, u / 0.7)))
    }
    body.y = y
    body.vx = move.dirX * move.speed
    body.vz = move.dirZ * move.speed
    body.vy = 0
    this.vaultT = move.kind === 'vault' ? Math.sin(u * Math.PI) : 0
    if (u >= 1) {
      body.y = move.y1
      body.grounded = true
      body.trySetHeight(PHYS.standHeight)
      this.mode = 'ground'
      this.script = null
      this.vaultT = 0
      this.coyote = PHYS.coyote
    }
  }

  private footsteps(dt: number) {
    const body = this.physics
    if (!body.grounded || this.mode === 'slide' || this.mode === 'vault' || this.mode === 'mantle') return
    if (body.speed < 2) {
      this.stride = 0
      return
    }
    const stride = lerp(1.35, 2.15, Math.min(1, body.speed / PHYS.sprintSpeed))
    this.stride += body.speed * dt
    if (this.stride >= stride) {
      this.stride = 0
      this.events.step = true
    }
  }
}

function emptyEvents(): ParkourEvents {
  return {
    jump: false,
    land: false,
    step: false,
    vault: false,
    wall: false,
    wallJump: false,
    slideStart: false,
    slideStop: false,
  }
}

function approach(body: PlayerPhysics, tx: number, tz: number, maxDelta: number) {
  const dx = tx - body.vx
  const dz = tz - body.vz
  const len = Math.hypot(dx, dz)
  if (len <= maxDelta || len < 1e-6) {
    body.vx = tx
    body.vz = tz
    return
  }
  body.vx += (dx / len) * maxDelta
  body.vz += (dz / len) * maxDelta
}

function airAccelerate(body: PlayerPhysics, wishX: number, wishZ: number, wishSpeed: number, accel: number, dt: number) {
  const current = body.vx * wishX + body.vz * wishZ
  const add = wishSpeed - current
  if (add <= 0) return
  let accelSpeed = accel * dt * wishSpeed
  if (accelSpeed > add) accelSpeed = add
  body.vx += wishX * accelSpeed
  body.vz += wishZ * accelSpeed
}

function capHorizontal(body: PlayerPhysics, max: number) {
  const s = body.speed
  if (s > max) {
    const k = max / s
    body.vx *= k
    body.vz *= k
  }
}

function tangent(nx: number, nz: number, vx: number, vz: number, basis: MoveBasis): { tx: number; tz: number } {
  let tx = -nz
  let tz = nx
  const along = tx * vx + tz * vz
  if (Math.abs(along) > 0.4) {
    if (along < 0) {
      tx = -tx
      tz = -tz
    }
    return { tx, tz }
  }
  const forward = tx * basis.forwardX + tz * basis.forwardZ
  if (forward < 0) {
    tx = -tx
    tz = -tz
  }
  return { tx, tz }
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smooth(t: number): number {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}
