export type GamePhase = 'menu' | 'playing' | 'paused' | 'finished';

export interface Settings {
  sensitivity: number;
  cameraMotion: number;
}

/** Holds the high-level game phase plus run timing and persisted best time. */
export class GameState {
  phase: GamePhase = 'menu';
  runTime = 0;
  bestTime: number | null = null;
  settings: Settings = { sensitivity: 1.0, cameraMotion: 1.0 };

  private readonly storageKey = 'rooftop_flow_best';

  constructor() {
    this.loadBest();
  }

  loadBest(): void {
    try {
      const v = localStorage.getItem(this.storageKey);
      if (v !== null) {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0) this.bestTime = n;
      }
    } catch {
      this.bestTime = null;
    }
  }

  /** Record a completed run; returns true if it is a new best time. */
  submitRun(t: number): boolean {
    this.runTime = t;
    if (this.bestTime === null || t < this.bestTime) {
      this.bestTime = t;
      try {
        localStorage.setItem(this.storageKey, String(t));
      } catch {
        /* storage unavailable */
      }
      return true;
    }
    return false;
  }
}
