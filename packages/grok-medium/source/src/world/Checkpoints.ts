import type { SpawnPoint } from '../game/types';
import type { Trigger } from './course';

export interface ScanResult {
  hint: string;
  checkpointIndex: number | null;
  checkpointName: string | null;
  checkpointId: string | null;
  finish: boolean;
}

/** Ordered respawn points. Index 0 is the start line. */
export class CheckpointSystem {
  readonly spawns: SpawnPoint[];
  index = 0;

  constructor(spawn: SpawnPoint, triggers: Trigger[]) {
    this.spawns = [{ ...spawn }];
    for (const t of triggers) {
      if (t.kind !== 'checkpoint') continue;
      this.spawns.push({ x: t.spawnX, y: t.spawnY, z: t.spawnZ, yaw: 0 });
    }
  }

  current(): SpawnPoint {
    return this.spawns[this.index] ?? this.spawns[0];
  }

  reset(): void {
    this.index = 0;
  }

  scan(
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    triggers: Trigger[],
  ): ScanResult {
    const out: ScanResult = {
      hint: '',
      checkpointIndex: null,
      checkpointName: null,
      checkpointId: null,
      finish: false,
    };
    const feet = y;
    const head = y + h;
    for (const t of triggers) {
      if (!overlapTrigger(x, z, r, feet, head, t)) continue;
      if (t.kind === 'hint' && t.message) out.hint = t.message;
      if (t.kind === 'finish') out.finish = true;
      if (t.kind === 'checkpoint') {
        const idx = this.spawns.findIndex(
          (s) => s.x === t.spawnX && s.y === t.spawnY && s.z === t.spawnZ,
        );
        if (idx > this.index) {
          this.index = idx;
          out.checkpointIndex = idx;
          out.checkpointId = t.id;
          out.checkpointName = t.message ?? 'CHECKPOINT';
        }
      }
    }
    return out;
  }
}

function overlapTrigger(
  x: number,
  z: number,
  r: number,
  feet: number,
  head: number,
  t: Trigger,
): boolean {
  return (
    x + r > t.x - t.w / 2 &&
    x - r < t.x + t.w / 2 &&
    head > t.y - t.h / 2 &&
    feet < t.y + t.h / 2 &&
    z + r > t.z - t.d / 2 &&
    z - r < t.z + t.d / 2
  );
}
