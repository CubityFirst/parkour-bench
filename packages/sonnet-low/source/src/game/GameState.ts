export type Phase = 'menu' | 'playing' | 'paused' | 'finished';

export interface Settings {
  sensitivity: number; // 0.3 .. 3
  reduceMotion: boolean;
}

const SETTINGS_KEY = 'rooftopflow.settings';
const BEST_KEY = 'rooftopflow.best';

/** Run/session state shared between the game loop and the UI. */
export class GameState {
  phase: Phase = 'menu';
  time = 0;
  running = false;
  best: number | null = null;
  settings: Settings = { sensitivity: 1, reduceMotion: false };

  constructor() {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) Object.assign(this.settings, JSON.parse(s));
      const b = localStorage.getItem(BEST_KEY);
      if (b) this.best = parseFloat(b);
    } catch { /* storage unavailable */ }
  }

  saveSettings(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  /** Stores the time if it is a new best; returns true when it is. */
  recordFinish(t: number): boolean {
    const isBest = this.best === null || t < this.best;
    if (isBest) {
      this.best = t;
      try { localStorage.setItem(BEST_KEY, String(t)); } catch { /* ignore */ }
    }
    return isBest;
  }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
