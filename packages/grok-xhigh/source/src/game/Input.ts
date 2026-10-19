import type { MoveInput } from './types'

export class Input {
  private readonly keys = new Set<string>()
  private jumpEdge = false
  private vaultEdge = false
  private respawnEdge = false

  constructor(target: Window) {
    target.addEventListener('keydown', (event) => {
      if (event.repeat) return
      this.keys.add(event.code)
      if (event.code === 'Space') this.jumpEdge = true
      if (event.code === 'KeyE') this.vaultEdge = true
      if (event.code === 'KeyR') this.respawnEdge = true
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
    })
    target.addEventListener('keyup', (event) => {
      this.keys.delete(event.code)
    })
    target.addEventListener('blur', () => {
      this.keys.clear()
    })
  }

  held(): MoveInput {
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
    return {
      forward,
      strafe,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      jumpHeld: this.keys.has('Space'),
      jumpPressed: false,
      slide: this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'),
      vaultPressed: false,
    }
  }

  consumeEdges() {
    const edges = {
      jumpPressed: this.jumpEdge,
      vaultPressed: this.vaultEdge,
      respawn: this.respawnEdge,
    }
    this.jumpEdge = false
    this.vaultEdge = false
    this.respawnEdge = false
    return edges
  }
}
