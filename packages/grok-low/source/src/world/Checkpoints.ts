import { type Checkpoint, type HintVol, type LevelSpec } from "./levelSpec";

export interface TriggerHit {
  checkpoint: Checkpoint | null;
  finish: boolean;
  hint: string | null;
}

export function sampleTriggers(spec: LevelSpec, x: number, y: number, z: number, current: number): TriggerHit {
  let checkpoint: Checkpoint | null = null;
  for (const c of spec.checkpoints) {
    if (c.index <= current) continue;
    if (contains(c, x, y, z)) checkpoint = c;
  }
  const f = spec.finish;
  const finish =
    x >= f.minX && x <= f.maxX && y >= f.minY && y <= f.maxY && z >= f.minZ && z <= f.maxZ;
  let hint: string | null = null;
  for (const h of spec.hints) {
    if (contains(h, x, y, z)) hint = h.text;
  }
  return { checkpoint, finish, hint };
}

function contains(b: Checkpoint | HintVol, x: number, y: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}
