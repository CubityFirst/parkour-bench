import { KILL_Y } from '../player/constants';
import type { PlayerController } from '../player/PlayerController';
import type { Layout } from '../player/types';

export interface RunFlags {
  checkpoint: number;
  finished: boolean;
  hint: string;
  toast: string;
  toastTime: number;
  respawnSerial: number;
  falls: number;
}

export function freshFlags(): RunFlags {
  return {
    checkpoint: 0,
    finished: false,
    hint: '',
    toast: '',
    toastTime: 0,
    respawnSerial: 0,
    falls: 0,
  };
}

function overlaps(p: PlayerController, t: Layout['triggers'][number]): boolean {
  return (
    p.x + p.radius > t.minX &&
    p.x - p.radius < t.maxX &&
    p.y + p.height > t.minY &&
    p.y < t.maxY &&
    p.z + p.radius > t.minZ &&
    p.z - p.radius < t.maxZ
  );
}

export function respawn(flags: RunFlags, player: PlayerController, layout: Layout, fell: boolean): void {
  const spawn = layout.checkpoints[flags.checkpoint] ?? layout.checkpoints[0];
  player.reset(spawn);
  flags.respawnSerial += 1;
  if (fell) flags.falls += 1;
  flags.toast = 'RESPAWN';
  flags.toastTime = 1.1;
}

/** Checkpoint volumes, finish line, hints, and the kill plane. */
export function updateCourse(
  flags: RunFlags,
  player: PlayerController,
  layout: Layout,
  dt: number,
  onCheckpoint: () => void,
  onFinish: () => void,
): void {
  if (flags.toastTime > 0) flags.toastTime = Math.max(0, flags.toastTime - dt);
  if (flags.finished) return;

  if (player.y < KILL_Y) {
    respawn(flags, player, layout, true);
    return;
  }

  let hint = '';
  for (const trigger of layout.triggers) {
    if (!overlaps(player, trigger)) continue;
    if (trigger.type === 'hint' && trigger.hint) hint = trigger.hint;
    if (trigger.type === 'checkpoint' && trigger.index !== undefined && trigger.index > flags.checkpoint) {
      flags.checkpoint = trigger.index;
      flags.toast = 'CHECKPOINT';
      flags.toastTime = 1.5;
      onCheckpoint();
    }
    if (trigger.type === 'finish') {
      flags.finished = true;
      flags.toast = '';
      onFinish();
    }
  }

  if (player.state === 'wallrun') hint = 'SPACE  ·  LEAP OFF THE WALL';
  else if (player.state === 'slide') hint = 'SPACE  ·  JUMP OUT OF THE SLIDE';
  else if (player.state === 'vault') hint = '';
  else if (player.state === 'mantle') hint = '';
  flags.hint = hint;
}
