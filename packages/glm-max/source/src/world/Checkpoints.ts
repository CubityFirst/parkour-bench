import * as THREE from 'three';
import { CollisionWorld, TriggerBox } from './CollisionWorld';

/**
 * Checkpoints — trigger volumes placed on the route; when crossed for the
 * first time in a run they update the player's respawn point.
 */
export interface CheckpointDef {
  pos: THREE.Vector3;   // respawn position (roof surface)
  yaw: number;          // respawn facing
  trigger: TriggerBox;
  index: number;
}

export interface CheckpointState {
  list: CheckpointDef[];
  activated: boolean[];   // [i] == whether activated this run
  current: number;        // last activated (spawn point counts as 0)
}

export class Checkpoints {
  state: CheckpointState;
  private triggerList: TriggerBox[] = [];

  constructor(
    private collision: CollisionWorld,
    spawn: { pos: THREE.Vector3; yaw: number },
    defs: { pos: THREE.Vector3; yaw: number }[],
    private onFinish: () => void,
    private finishTrigger: TriggerBox
  ) {
    // Checkpoint 0 is the spawn itself.
    const list: CheckpointDef[] = [
      { pos: spawn.pos.clone(), yaw: spawn.yaw, trigger: null as unknown as TriggerBox, index: 0 }
    ];
    defs.forEach((d, i) => {
      list.push({ pos: d.pos.clone(), yaw: d.yaw, trigger: null as unknown as TriggerBox, index: i + 1 });
    });
    this.state = {
      list,
      activated: list.map(() => false),
      current: 0
    };
  }

  /** Fakes an activation for the spawn at run start. */
  activateSpawn(): void {
    this.state.activated[0] = true;
    this.state.current = 0;
  }

  resetRun(): void {
    this.state.activated.fill(false);
    this.state.activated[0] = true;
    this.state.current = 0;
  }

  addTriggers(triggers: TriggerBox[]): void {
    // triggers[i] belongs to checkpoint i+1 (spawn has no physical trigger)
    for (let i = 0; i < triggers.length; i++) {
      const cpIndex = i + 1;
      this.state.list[cpIndex].trigger = triggers[i];
      this.triggerList.push(triggers[i]);
    }
    if (this.finishTrigger) this.triggerList.push(this.finishTrigger);
  }

  /**
   * Progress check — call once per frame with the player position.
   * Returns 'checkpoint' | 'finish' | null plus the checkpoint index touched.
   */
  update(pos: THREE.Vector3): { type: 'checkpoint'; index: number } | { type: 'finish' } | null {
    for (const t of this.triggerList) {
      if (this.collision.isPointInBox(pos.x, pos.y, pos.z, t)) {
        if (t === this.finishTrigger) {
          if (!this.finishFired) {
            this.finishFired = true;
            return { type: 'finish' };
          }
          continue;
        }
        const cpIndex = this.triggerIndexOf(t);
        if (cpIndex < 0) continue;
        if (!this.state.activated[cpIndex]) {
          this.state.activated[cpIndex] = true;
          if (cpIndex > this.state.current) this.state.current = cpIndex;
          return { type: 'checkpoint', index: cpIndex };
        }
      }
    }
    return null;
  }

  finishFired = false;

  resetFinish(): void {
    this.finishFired = false;
  }

  private triggerIndexOf(t: TriggerBox): number {
    for (let i = 1; i < this.state.list.length; i++) {
      if (this.state.list[i].trigger === t) return i;
    }
    return -1;
  }
}
