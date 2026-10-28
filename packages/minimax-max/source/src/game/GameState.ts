/**
 * Global game state: which phase the game is in, user settings and the
 * locally stored best time.
 */

export type GamePhase = 'loading' | 'menu' | 'playing' | 'paused' | 'complete';

export interface Settings {
  /** Mouse look sensitivity multiplier. */
  sensitivity: number;
  /** 0 = no camera motion, 1 = full camera motion. */
  cameraMotion: number;
  bloom: boolean;
  sound: boolean;
}

const SETTINGS_KEY = 'rooftop-flow.settings';
const BEST_KEY = 'rooftop-flow.best-time';

const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  cameraMotion: 1,
  bloom: true,
  sound: true,
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export class GameState {
  phase: GamePhase = 'loading';
  settings: Settings = loadJson<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  /** Best completion time in seconds (null when there is none yet). */
  bestTime: number | null = null;

  constructor() {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (raw) {
      const value = Number.parseFloat(raw);
      if (Number.isFinite(value) && value > 0) this.bestTime = value;
    }
  }

  setPhase(phase: GamePhase): void {
    this.phase = phase;
  }

  saveSettings(): void {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable - settings simply do not persist */
    }
  }

  /** Stores a completion time and returns true when it is a new record. */
  recordTime(seconds: number): boolean {
    if (this.bestTime === null || seconds < this.bestTime) {
      this.bestTime = seconds;
      try {
        window.localStorage.setItem(BEST_KEY, seconds.toFixed(4));
      } catch {
        /* ignore */
      }
      return true;
    }
    return false;
  }
}

/** Formats a duration in seconds as mm:ss.cc */
export function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const rest = clamped - minutes * 60;
  const whole = Math.floor(rest);
  const hundredths = Math.floor((rest - whole) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(
    hundredths,
  ).padStart(2, '0')}`;
}
