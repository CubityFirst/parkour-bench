import * as THREE from 'three'
import { PHYS } from '../game/constants'
import type { MoveInput, Solid } from '../game/types'
import { basisFromAngles, FALLBACK_BASIS, planarBasis } from '../player/basis'
import { PlayerController } from '../player/PlayerController'
import { buildCourse, platformAt, preferredX, type Course } from '../world/Course'
import { CollisionWorld } from '../world/CollisionWorld'

const DT = PHYS.fixedDt

function fail(message: string): never {
  console.error('FAIL', message)
  throw new Error(message)
}

function assert(cond: boolean, message: string) {
  if (!cond) fail(message)
}

function basisOf(yaw: number) {
  return basisFromAngles(yaw, 0, FALLBACK_BASIS)
}

function stepHold(player: PlayerController, seconds: number, input: MoveInput, yaw: number) {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) player.update(DT, input, basisOf(yaw))
}

function controlFrame() {
  const cam = new THREE.PerspectiveCamera()
  cam.rotation.order = 'YXZ'
  cam.rotation.y = Math.PI
  cam.updateMatrixWorld(true)
  const fwd = new THREE.Vector3()
  cam.getWorldDirection(fwd)
  fwd.y = 0
  fwd.normalize()
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0))
  const basis = planarBasis(cam, FALLBACK_BASIS)
  assert(fwd.z > 0.9 && Math.abs(fwd.x) < 0.05, `yaw π should look +Z, got ${fwd.x.toFixed(2)},${fwd.z.toFixed(2)}`)
  assert(right.x < -0.9, `camera right when looking +Z should be -X, got ${right.x.toFixed(2)}`)
  assert(Math.abs(basis.forwardZ - fwd.z) < 1e-4 && Math.abs(basis.rightX - right.x) < 1e-4, 'planarBasis diverges from the camera')

  const floor: Solid = {
    minX: -30, maxX: 30, minY: -1, maxY: 0, minZ: -10, maxZ: 40, mat: 'white', mantle: true,
  }
  const world = new CollisionWorld([floor])
  const player = new PlayerController(world)
  player.reset(0, 0, 0)
  const hold = (code: Partial<MoveInput>): MoveInput => ({
    forward: 0, strafe: 0, sprint: true, jumpHeld: false, jumpPressed: false, slide: false, vaultPressed: false, ...code,
  })
  stepHold(player, 0.6, hold({ forward: 1 }), Math.PI)
  assert(player.z > 2, `W should move +Z when looking +Z, z=${player.z.toFixed(2)}`)
  const zAfterW = player.z
  stepHold(player, 0.45, hold({ strafe: 1 }), Math.PI)
  assert(player.x < -0.8, `D is camera-right, which is -X when facing +Z, x=${player.x.toFixed(2)}`)
  assert(player.z > zAfterW - 0.2, 'strafe should not reverse forward progress')

  player.reset(0, 0, 0)
  // Apex is ~0.34s, so the peak has to be sampled across the whole arc.
  let peak = 0
  for (let i = 0; i < 160; i++) {
    player.update(DT, hold({ forward: 1, jumpHeld: true, jumpPressed: i === 0 }), basisOf(Math.PI))
    peak = Math.max(peak, player.y)
  }
  assert(peak > 1.2 && peak < 1.9, `jump height ${peak.toFixed(2)} outside 1.2–1.9`)
  console.log('control frame ok', { peak: peak.toFixed(2) })
}

function slideAndWall() {
  const solids: Solid[] = [
    { minX: -4, maxX: 4, minY: -1, maxY: 0, minZ: -2, maxZ: 30, mat: 'white', mantle: true },
    { minX: -4, maxX: 4, minY: 1.02, maxY: 1.7, minZ: 6, maxZ: 9.2, mat: 'metal', ceiling: true },
  ]
  const world = new CollisionWorld(solids)
  const runner = new PlayerController(world)
  runner.reset(0, 0, 0)
  const input = (slide: boolean): MoveInput => ({
    forward: 1, strafe: 0, sprint: true, jumpHeld: false, jumpPressed: false, slide, vaultPressed: false,
  })
  for (let i = 0; i < 400; i++) {
    const ahead = world.raycast(runner.x, runner.y + 1.2, runner.z, 0, 0, 1, 4, (s) => !!s.ceiling)
    runner.update(DT, input(!!ahead || runner.mode === 'slide'), basisOf(Math.PI))
  }
  assert(runner.z > 12, `slide should pass the duct, z=${runner.z.toFixed(2)} mode=${runner.mode}`)

  const blocked = new PlayerController(world)
  blocked.reset(0, 0, 0)
  for (let i = 0; i < 400; i++) blocked.update(DT, input(false), basisOf(Math.PI))
  assert(blocked.z < 6.2, `standing should stop at the duct, z=${blocked.z.toFixed(2)}`)
  console.log('slide gate ok', { passed: runner.z.toFixed(2), blocked: blocked.z.toFixed(2) })
}

function runCourse(course: Course) {
  const world = new CollisionWorld(course.solids)
  const player = new PlayerController(world)
  player.reset(course.spawn.x, course.spawn.y, course.spawn.z)
  let yaw = course.spawn.yaw
  let lastZ = player.z
  let stuckFor = 0
  let jumpHold = 0
  let armJump = false
  const maxTime = 140
  const steps = Math.round(maxTime / DT)
  for (let i = 0; i < steps; i++) {
    const aimZ = player.z + 6.5
    const aimX = preferredX(course, aimZ)
    const dx = aimX - player.x
    const dz = Math.max(2, aimZ - player.z)
    const len = Math.hypot(dx, dz)
    let delta = Math.atan2(-dx / len, -dz / len) - Math.PI
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    delta = Math.max(-0.7, Math.min(0.7, delta))
    yaw = Math.PI + delta
    const basis = basisOf(yaw)

    const plat = platformAt(course, player.z)
    let jumpPressed = false
    const busy = player.mode === 'wall' || player.mode === 'vault' || player.mode === 'mantle'
    if (!busy && player.grounded && jumpHold === 0 && (armJump || (plat && player.speed > 5 && player.z > plat.z1 - 1.05))) {
      const onEdge = !plat?.hug
        || (plat.hug === 'right' ? player.x > plat.x1 - 0.85 : player.x < plat.x0 + 0.85)
      if (armJump || onEdge) {
        jumpPressed = true
        jumpHold = 52
        armJump = false
      }
    }
    const jumpHeld = jumpHold > 0
    if (jumpHold > 0) jumpHold -= 1
    const ceil = world.raycast(player.x, player.y + 1.15, player.z, 0, 0, 1, 5.2, (s) => !!s.ceiling)
    const slide = !!ceil || (player.mode === 'slide' && !player.physics.headroom(PHYS.standHeight))
    const vault = player.canVault && player.mode !== 'vault'
    const input: MoveInput = {
      forward: 1,
      strafe: 0,
      sprint: true,
      jumpHeld,
      jumpPressed,
      slide,
      vaultPressed: vault,
    }
    player.update(DT, input, basis)

    if (player.y < PHYS.fallY) {
      fail(`fell at x=${player.x.toFixed(2)} z=${player.z.toFixed(2)} mode=${player.mode} speed=${player.speed.toFixed(2)}`)
    }
    const finish = course.finish
    if (player.z > finish.minZ && player.z < finish.maxZ && player.x > finish.minX && player.x < finish.maxX && player.y >= finish.minY) {
      const time = (i * DT)
      console.log(`finished in ${time.toFixed(1)}s at z=${player.z.toFixed(1)}`)
      assert(time >= 60, `run is under the 60s target (${time.toFixed(1)}s)`)
      assert(time < 120, `scripted run exceeded 120s (${time.toFixed(1)}s)`)
      return
    }
    if (i % 120 === 0) {
      if (player.z < lastZ + 0.35 && player.mode !== 'wall') stuckFor += 1
      else stuckFor = 0
      lastZ = player.z
      if (stuckFor === 2) armJump = true
      if (stuckFor > 5) {
        fail(`stuck at x=${player.x.toFixed(2)} z=${player.z.toFixed(2)} mode=${player.mode} speed=${player.speed.toFixed(2)}`)
      }
    }
  }
  fail(`did not finish, ended x=${player.x.toFixed(1)} z=${player.z.toFixed(1)} mode=${player.mode}`)
}

function straightCannotCrossWall(course: Course) {
  const take = course.platforms.find((p) => p.id === 'wall-take-1')
  const land = course.platforms.find((p) => p.id === 'wall-land-1')
  if (!take || !land) fail('missing wall platforms')
  const world = new CollisionWorld(course.solids)
  const player = new PlayerController(world)
  const x = (take.x0 + take.x1) * 0.5
  player.reset(x, take.y, take.z1 - 6)
  // Give a full sprint and jump at the lip, but never steer onto the wall.
  for (let i = 0; i < 30; i++) {
    player.physics.vx = 0
    player.physics.vz = PHYS.sprintSpeed
  }
  const input: MoveInput = {
    forward: 1, strafe: 0, sprint: true, jumpHeld: true, jumpPressed: true, slide: false, vaultPressed: false,
  }
  let jumped = false
  for (let i = 0; i < 360; i++) {
    if (!jumped && player.z > take.z1 - 0.4) {
      player.update(DT, input, basisOf(Math.PI))
      jumped = true
    } else {
      player.update(DT, { ...input, jumpPressed: false, jumpHeld: jumped }, basisOf(Math.PI))
    }
    if (player.y < PHYS.fallY - 1) break
    if (player.z > land.z0 + 1 && player.y >= land.y - 0.2) {
      fail(`straight jump reached the wall landing at z=${player.z.toFixed(1)}`)
    }
  }
  console.log('wall gap is not a straight jump', { z: player.z.toFixed(1), y: player.y.toFixed(2) })
}

function main() {
  const course = buildCourse()
  console.log(
    `course ${course.length.toFixed(0)}m, ${course.platforms.length} roofs, ${course.checkpoints.length} checkpoints, ${course.walls.length} wall-runs`,
  )
  controlFrame()
  slideAndWall()
  straightCannotCrossWall(course)
  runCourse(course)
  console.log('self-test passed')
}

main()
