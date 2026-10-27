export type Phase = 'menu' | 'playing' | 'paused' | 'finished';

export interface Settings {
  sensitivity: number;
  reducedMotion: boolean;
  volume: number;
}

const SETTINGS_KEY = 'rooftop-flow.settings';
const BEST_KEY = 'rooftop-flow.best';

/** Run state, timer, persisted settings and best time. */
export class GameState {
  phase: Phase = 'menu';
  /** Elapsed run time in seconds (advanced by the fixed simulation step). */
  time = 0;
  settings: Settings = { sensitivity: 1, reducedMotion: false, volume: 0.8 };
  best: number | null = null;

  constructor() {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) this.settings = { ...this.settings, ...JSON.parse(s) };
      const b = localStorage.getItem(BEST_KEY);
      if (b) this.best = Number(b) || null;
    } catch { /* storage unavailable */ }
  }

  saveSettings(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  /** Records a finished run; returns true if it's a new best. */
  submitTime(t: number): boolean {
    if (this.best === null || t < this.best) {
      this.best = t;
      try { localStorage.setItem(BEST_KEY, String(t)); } catch { /* ignore */ }
      return true;
    }
    return false;
  }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
