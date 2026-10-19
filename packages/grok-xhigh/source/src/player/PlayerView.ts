import * as THREE from 'three'
import type { PlayerController } from './PlayerController'

/** Low-poly sleeves and gloves. They stay in the lower corners of the view. */
export class PlayerView {
  readonly group = new THREE.Group()
  private readonly left: THREE.Group
  private readonly right: THREE.Group
  private readonly feet: THREE.Group

  constructor() {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.7 })
    const glove = new THREE.MeshStandardMaterial({ color: 0xff2a32, roughness: 0.45, emissive: 0x4a000c, emissiveIntensity: 0.2 })
    const shoe = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.6 })
    this.left = makeArm(-1, sleeve, glove)
    this.right = makeArm(1, sleeve, glove)
    this.feet = new THREE.Group()
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), shoe)
      foot.position.set(side * 0.12, 0, 0)
      this.feet.add(foot)
    }
    this.feet.position.set(0, -1.42, -0.42)
    this.group.add(this.left, this.right, this.feet)
  }

  mount(camera: THREE.Camera) {
    camera.add(this.group)
  }

  update(player: PlayerController, pitch: number, motion: number) {
    const sprint = Math.min(1, player.speed / 12)
    const swing = player.grounded && player.mode !== 'slide' ? Math.sin(player.bob) * 0.08 * sprint * motion : 0
    const vault = player.vaultT
    this.left.position.set(-0.24, -0.32 - swing - vault * 0.05, -0.42 - vault * 0.28)
    this.right.position.set(0.26, -0.34 + swing - vault * 0.05, -0.4 - vault * 0.28)
    const wall = player.wallSide
    if (wall !== 0) {
      const arm = wall > 0 ? this.right : this.left
      arm.position.x += wall * 0.12
      arm.position.y += 0.08
      arm.position.z -= 0.08
    }
    if (player.mode === 'slide') {
      this.left.position.y -= 0.06
      this.right.position.y -= 0.06
      this.left.position.z -= 0.08
      this.right.position.z -= 0.08
    }
    // Feet only enter the frame on a steep look down.
    const showFeet = pitch < -0.95
    this.feet.visible = showFeet
    this.feet.position.y = -1.42
  }
}

function makeArm(side: number, sleeve: THREE.Material, glove: THREE.Material) {
  const group = new THREE.Group()
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 3, 6), sleeve)
  upper.rotation.z = side * 0.35
  upper.rotation.x = 0.5
  upper.position.set(0, -0.02, 0)
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.1), glove)
  hand.position.set(side * 0.04, -0.16, -0.08)
  group.add(upper, hand)
  return group
}
