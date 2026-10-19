import * as THREE from 'three'
import type { MoveBasis } from '../game/types'

const UP = new THREE.Vector3(0, 1, 0)
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _scratchCam = new THREE.PerspectiveCamera()
_scratchCam.rotation.order = 'YXZ'

export const FALLBACK_BASIS: MoveBasis = {
  forwardX: 0,
  forwardZ: 1,
  rightX: -1,
  rightZ: 0,
}

/**
 * Planar move frame read from a camera matrix.
 * Three.js cameras look down local −Z. `forward × up` is camera-right.
 * Yaw π looks toward world +Z, and camera-right is then world −X.
 */
export function planarBasis(camera: THREE.Object3D, fallback: MoveBasis): MoveBasis {
  camera.updateWorldMatrix(true, false)
  camera.getWorldDirection(_fwd)
  _fwd.y = 0
  if (_fwd.lengthSq() < 1e-8) return fallback
  _fwd.normalize()
  _right.crossVectors(_fwd, UP)
  if (_right.lengthSq() < 1e-8) return fallback
  _right.normalize()
  return {
    forwardX: _fwd.x,
    forwardZ: _fwd.z,
    rightX: _right.x,
    rightZ: _right.z,
  }
}

/** Test/sim helper. The rendered game reads the real camera via `planarBasis`. */
export function basisFromAngles(yaw: number, pitch: number, fallback: MoveBasis = FALLBACK_BASIS): MoveBasis {
  _scratchCam.rotation.order = 'YXZ'
  _scratchCam.rotation.set(pitch, yaw, 0)
  _scratchCam.updateMatrixWorld(true)
  return planarBasis(_scratchCam, fallback)
}
