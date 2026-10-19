/** Run / session state that is independent of rendering and physics. */

export type GamePhase = 'loading' | 'menu' | 'playing' | 'paused' | 'finished';

export class GameState {
  phase: GamePhase = 'loading';
  /** Seconds on the run clock. */
  runTime = 0;
  /** The clock starts with the first movement of a run. */
  timerRunning = false;
  /** Times the player fell off and respawned in this run. */
  deaths = 0;
  /** Number of checkpoints (after the start) activated in this run. */
  checkpointsReached = 0;

  resetRun(): void {
    this.runTime = 0;
    this.timerRunning = false;
    this.deaths = 0;
    this.checkpointsReached = 0;
  }

  tick(dt: number): void {
    if (this.phase === 'playing' && this.timerRunning) this.runTime += dt;
  }
}
