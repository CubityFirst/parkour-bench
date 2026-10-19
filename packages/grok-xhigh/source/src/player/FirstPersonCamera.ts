import * as THREE from 'three'
import { PHYS } from '../game/constants'
import type { MoveBasis } from '../game/types'
import { FALLBACK_BASIS, planarBasis } from './basis'
import type { PlayerController } from './PlayerController'

const _right = new THREE.Vector3()

export class FirstPersonCamera {
  yaw = Math.PI
  pitch = 0
  sensitivity = 1
  motion = 1
  private fov = 78
  private basis: MoveBasis = { ...FALLBACK_BASIS }
  private readonly camera: THREE.PerspectiveCamera

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    camera.rotation.order = 'YXZ'
    camera.fov = 78
    camera.near = 0.08
    camera.far = 900
    camera.updateProjectionMatrix()
  }

  look(dx: number, dy: number) {
    const scale = 0.00235 * this.sensitivity
    this.yaw -= dx * scale
    this.pitch -= dy * scale
    const limit = Math.PI / 2 - 0.04
    if (this.pitch > limit) this.pitch = limit
    if (this.pitch < -limit) this.pitch = -limit
  }

  /** Direction for movement, sampled with roll cleared so tilt cannot steer. */
  sampleBasis(): MoveBasis {
    const camera = this.camera
    camera.rotation.order = 'YXZ'
    camera.rotation.set(this.pitch, this.yaw, 0)
    camera.updateMatrixWorld(true)
    this.basis = planarBasis(camera, this.basis)
    return this.basis
  }

  apply(player: PlayerController, alpha: number, dt: number) {
    const camera = this.camera
    const motion = this.motion
    const x = lerp(player.prevX, player.x, alpha)
    const y = lerp(player.prevY, player.y, alpha)
    const z = lerp(player.prevZ, player.z, alpha)
    const speed = player.speed
    const targetFov = 78 + Math.min(1, speed / PHYS.sprintSpeed) * 13 * motion
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 6)
    if (Math.abs(camera.fov - this.fov) > 0.05) {
      camera.fov = this.fov
      camera.updateProjectionMatrix()
    }

    const vaultPitch = player.vaultT * -0.05 * motion
    camera.rotation.order = 'YXZ'
    camera.rotation.set(this.pitch + vaultPitch, this.yaw, player.roll * motion)
    camera.position.set(x, y + player.eye - player.landDip * motion, z)
    camera.updateMatrixWorld(true)
    _right.setFromMatrixColumn(camera.matrixWorld, 0)
    camera.position.x += _right.x * player.bobX * motion
    camera.position.y += player.bobY * motion
    camera.position.z += _right.z * player.bobX * motion
    camera.updateMatrixWorld(true)
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
