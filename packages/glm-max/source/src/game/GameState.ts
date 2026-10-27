/**
 * GameState — run state, timer, saved best time and player settings.
 */
export type RunState = 'menu' | 'running' | 'paused' | 'finished';

const BEST_KEY = 'rooftopflow.best';
const SETTINGS_KEY = 'rooftopflow.settings';

export interface GameSettings {
  sensitivity: number;
  reduceMotion: boolean;
}

function formatTime(t: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  const cc = cs.toString().padStart(2, '0');
  return `${mm}:${ss}.${cc}`;
}

export class GameState {
  runState: RunState = 'menu';
  /** Elapsed run time in seconds. */
  runTime = 0;
  checkpointIndex = 0;
  checkpointCount = 0;
  bestTime: number | null = null;
  settings: GameSettings = { sensitivity: 1, reduceMotion: false };

  constructor() {
    const best = localStorage.getItem(BEST_KEY);
    if (best !== null) {
      const n = parseFloat(best);
      if (Number.isFinite(n) && n > 0) this.bestTime = n;
    }
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<GameSettings>;
        if (typeof s.sensitivity === 'number' && s.sensitivity >= 0.25 && s.sensitivity <= 2.5) {
          this.settings.sensitivity = s.sensitivity;
        }
        if (typeof s.reduceMotion === 'boolean') this.settings.reduceMotion = s.reduceMotion;
      }
    } catch {
      // ignore malformed settings
    }
  }

  saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // storage may be unavailable (private mode) — settings just won't persist
    }
  }

  resetRun(): void {
    this.runTime = 0;
    this.checkpointIndex = 0;
  }

  /** Saves best time; returns true if this run set a new record. */
  finishRun(time: number): boolean {
    if (this.bestTime === null || time < this.bestTime) {
      this.bestTime = time;
      try {
        localStorage.setItem(BEST_KEY, String(time));
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  }

  static formatTime = formatTime;
}
