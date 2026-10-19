import { PlayerController } from '../player/PlayerController';
import type { Layout, PlayerInput } from '../player/types';
import { buildLayout } from '../world/levelLayout';
import { CollisionWorld } from '../world/CollisionWorld';
import { freshFlags, respawn, updateCourse, type RunFlags } from '../world/Checkpoints';

/** Headless run: physics, checkpoints, respawns. No rendering. */
export class Simulation {
  readonly layout: Layout;
  readonly world: CollisionWorld;
  readonly player: PlayerController;
  flags: RunFlags;
  onCheckpoint?: () => void;
  onFinish?: () => void;

  constructor(layout: Layout = buildLayout()) {
    this.layout = layout;
    this.world = new CollisionWorld(layout.solids);
    this.player = new PlayerController(this.world);
    this.flags = freshFlags();
    this.player.reset(layout.checkpoints[0]);
  }

  reset(): void {
    this.flags = freshFlags();
    this.player.reset(this.layout.checkpoints[0]);
  }

  restartAtCheckpoint(): void {
    respawn(this.flags, this.player, this.layout, false);
  }

  step(dt: number, input: PlayerInput, fwdX: number, fwdZ: number, rightX: number, rightZ: number): void {
    if (this.flags.finished) return;
    if (input.restart) this.restartAtCheckpoint();
    this.player.update(dt, input, fwdX, fwdZ, rightX, rightZ);
    updateCourse(
      this.flags,
      this.player,
      this.layout,
      dt,
      () => this.onCheckpoint?.(),
      () => this.onFinish?.(),
    );
  }
}
