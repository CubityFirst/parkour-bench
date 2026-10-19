/** Persisted user settings and best time (localStorage). */

export interface Settings {
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  /** Reduces bob, roll, FOV kick and landing impact. */
  reduceMotion: boolean;
  /** Master volume 0..1. */
  volume: number;
}

const SETTINGS_KEY = 'rooftop-flow.settings.v1';
const BEST_KEY = 'rooftop-flow.best-time.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  reduceMotion: false,
  volume: 0.7,
};

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class SettingsStore {
  private value: Settings = { ...DEFAULT_SETTINGS };
  private listeners: Array<(s: Settings) => void> = [];

  constructor() {
    const store = safeStorage();
    try {
      const raw = store?.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        this.value = {
          sensitivity: clamp(Number(parsed.sensitivity ?? 1), 0.1, 4),
          reduceMotion: Boolean(parsed.reduceMotion ?? false),
          volume: clamp(Number(parsed.volume ?? DEFAULT_SETTINGS.volume), 0, 1),
        };
      }
    } catch {
      this.value = { ...DEFAULT_SETTINGS };
    }
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    try {
      safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(this.value));
    } catch {
      /* storage unavailable: settings simply are not persisted */
    }
    for (const l of this.listeners) l(this.value);
  }

  onChange(fn: (s: Settings) => void): void {
    this.listeners.push(fn);
  }
}

export function loadBestTime(): number | null {
  try {
    const raw = safeStorage()?.getItem(BEST_KEY);
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Saves the time if it beats the stored best. Returns true for a new record. */
export function saveBestTime(seconds: number): boolean {
  const best = loadBestTime();
  if (best !== null && best <= seconds) return false;
  try {
    safeStorage()?.setItem(BEST_KEY, String(seconds));
  } catch {
    /* ignore */
  }
  return true;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}
