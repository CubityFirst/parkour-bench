export type Phase = 'menu' | 'playing' | 'paused' | 'finished';

const BEST_KEY = 'rooftopflow.best';
const SETTINGS_KEY = 'rooftopflow.settings';

export interface Settings {
  sensitivity: number;
  reduceMotion: boolean;
}

/** Run state: phase, timer, active checkpoint, plus localStorage persistence. */
export class GameState {
  phase: Phase = 'menu';
  /** Seconds on the clock. */
  time = 0;
  timerRunning = false;
  checkpointIndex = 0;
  deaths = 0;
  settings: Settings = { sensitivity: 1, reduceMotion: false };

  constructor() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
    } catch { /* storage unavailable */ }
  }

  saveSettings(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  get best(): number | null {
    try {
      const v = localStorage.getItem(BEST_KEY);
      return v ? parseFloat(v) : null;
    } catch { return null; }
  }

  /** Stores the time if it is a new record. Returns true when it was. */
  submit(time: number): boolean {
    const best = this.best;
    if (best === null || time < best) {
      try { localStorage.setItem(BEST_KEY, time.toFixed(3)); } catch { /* ignore */ }
      return true;
    }
    return false;
  }

  resetRun(): void {
    this.time = 0;
    this.timerRunning = false;
    this.checkpointIndex = 0;
    this.deaths = 0;
  }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
