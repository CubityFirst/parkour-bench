import type { Checkpoint } from '../game/types'
import type { Course } from './Course'

export class CheckpointSystem {
  index = 0

  constructor(private readonly course: Course) {}

  get current(): Checkpoint {
    return this.course.checkpoints[this.index]
  }

  reset() {
    this.index = 0
  }

  /** Returns the checkpoint just reached, if it is ahead of the saved one. */
  touch(x: number, y: number, z: number): Checkpoint | null {
    let found: Checkpoint | null = null
    for (const cp of this.course.checkpoints) {
      if (!cp.zone || cp.id <= this.index) continue
      const box = cp.zone
      if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY || z < box.minZ || z > box.maxZ) continue
      if (!found || cp.id > found.id) found = cp
    }
    if (!found) return null
    this.index = found.id
    return found
  }
}
