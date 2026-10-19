import { HW, STAND_H, sprintGapBudget } from "../core/constants";
import { type CollisionWorld } from "./CollisionWorld";
import { buildCollisionWorld, type LevelSpec } from "./levelSpec";

export function validateLevel(spec: LevelSpec, world: CollisionWorld = buildCollisionWorld(spec)): string[] {
  const errors: string[] = [];
  const plats = spec.platforms;

  for (let i = 0; i < plats.length - 1; i++) {
    const a = plats[i];
    const b = plats[i + 1];
    const gap = b.x0 - a.x1;
    const drop = a.y - b.y;
    if (a.toNext === "wall") {
      if (gap < 9) errors.push(`${a.id} wall gap ${gap.toFixed(2)} is jumpable — it must force a wall run`);
      if (a.wallFaceZ === undefined) errors.push(`${a.id} is missing wallFaceZ`);
      continue;
    }
    if (a.toNext === "end") continue;
    const budget = sprintGapBudget(drop);
    if (gap > budget) {
      errors.push(
        `${a.id} → ${b.id} gap ${gap.toFixed(2)} up/down ${(-drop).toFixed(2)} exceeds budget ${budget.toFixed(2)}`,
      );
    }
    const overlap = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
    if (overlap < 1.5) errors.push(`${a.id} → ${b.id} landing overlap ${overlap.toFixed(2)} is narrow`);
  }

  for (const c of spec.checkpoints) {
    const floor = world.surfaceBelow(c.x, c.z, c.y + 0.4, 0.8);
    if (floor === null) errors.push(`checkpoint ${c.index} has no floor`);
    if (world.overlaps(c.x, c.y + 0.05, c.z, HW, STAND_H)) {
      errors.push(`checkpoint ${c.index} overlaps a solid`);
    }
  }

  const s = spec.start;
  if (world.overlaps(s.x, s.y + 0.05, s.z, HW, STAND_H)) errors.push("start overlaps a solid");
  if (world.surfaceBelow(s.x, s.z, s.y + 0.4, 0.8) === null) errors.push("start has no floor");

  const runnable = world.boxes.filter((b) => b.flags & 2);
  if (runnable.length < 2) errors.push("expected two wall-run surfaces");

  return errors;
}
