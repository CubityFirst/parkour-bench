export type GamePhase = 'loading' | 'menu' | 'playing' | 'paused' | 'finished';

/**
 * Holds the state of a run: the phase of the game and the run timer.
 */
export class GameState {
  phase: GamePhase = 'loading';
  elapsed = 0;
  /** Section of the route the player is currently in. */
  section = 0;

  start(): void {
    this.phase = 'playing';
    this.elapsed = 0;
  }

  pause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume(): void {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  finish(): void {
    this.phase = 'finished';
  }

  reset(): void {
    this.elapsed = 0;
    this.section = 0;
  }
}
