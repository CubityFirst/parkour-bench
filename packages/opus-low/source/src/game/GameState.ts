export type GameMode = 'menu' | 'playing' | 'paused' | 'finished';

/** Run-level state: current mode and elapsed time. */
export class GameState {
  mode: GameMode = 'menu';
  time = 0;

  reset() { this.time = 0; }
}
