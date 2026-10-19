export const Phase = {
  Menu: 'menu',
  Playing: 'playing',
  Paused: 'paused',
  Finished: 'finished',
} as const;
export type PhaseName = (typeof Phase)[keyof typeof Phase];

export interface Settings {
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  /** Strongly damps head bob, roll, FOV kick and landing impact. */
  reduceMotion: boolean;
  /** Master volume 0..1. */
  volume: number;
}

const SETTINGS_KEY = 'rooftopflow.settings.v1';
const BEST_KEY = 'rooftopflow.bestTime.v1';

const DEFAULT_SETTINGS: Settings = { sensitivity: 1, reduceMotion: false, volume: 0.7 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity: clamp(Number(parsed.sensitivity ?? 1), 0.2, 3),
      reduceMotion: Boolean(parsed.reduceMotion),
      volume: clamp(Number(parsed.volume ?? 0.7), 0, 1),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) - ignore */
  }
}

export function loadBestTime(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveBestTime(seconds: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(seconds));
  } catch {
    /* ignore */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

/** mm:ss.cc */
export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Per-run bookkeeping: clock, deaths, best time. */
export class RunState {
  time = 0;
  /** The clock starts on the player's first input so reading the menu is free. */
  running = false;
  falls = 0;
  best: number | null = loadBestTime();

  reset(): void {
    this.time = 0;
    this.running = false;
    this.falls = 0;
  }

  /** Records a finished run. Returns true when it is a new best. */
  finish(): boolean {
    this.running = false;
    const isBest = this.best === null || this.time < this.best;
    if (isBest) {
      this.best = this.time;
      saveBestTime(this.time);
    }
    return isBest;
  }
}
