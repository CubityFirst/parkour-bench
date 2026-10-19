/** Top-level screen/phase of the game. */
export enum Phase {
  Menu = 'menu',
  Playing = 'playing',
  Paused = 'paused',
  Finished = 'finished',
}

/** User-adjustable settings, persisted in localStorage. */
export interface Settings {
  /** Multiplier applied to raw mouse movement. */
  sensitivity: number;
  /** When true, head bob, roll, FOV kicks and impact shakes are scaled down. */
  reduceMotion: boolean;
}

export const SETTINGS_KEY = 'rooftopflow.settings';
export const BEST_TIME_KEY = 'rooftopflow.bestTime';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  reduceMotion: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadBestTime(): number | null {
  const raw = localStorage.getItem(BEST_TIME_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function saveBestTime(seconds: number): void {
  localStorage.setItem(BEST_TIME_KEY, String(seconds));
}

/** Formats seconds as M:SS.cc (or SS.cc under a minute). */
export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  const secText = secs.toFixed(2).padStart(5, '0');
  return minutes > 0 ? `${minutes}:${secText}` : secText;
}
