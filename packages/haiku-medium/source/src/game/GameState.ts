/** High-level phase of the application. The game loop only simulates while `Playing`. */
export enum Phase {
  Menu = 'menu',
  Playing = 'playing',
  Paused = 'paused',
  Finished = 'finished',
}

export interface Settings {
  /** Multiplier on raw mouse movement. 1 is the default feel. */
  sensitivity: number;
  /** When true, head bob, roll, and landing camera impulses are reduced. */
  reduceMotion: boolean;
}

const SETTINGS_KEY = 'rooftop-flow.settings';
const BEST_TIME_KEY = 'rooftop-flow.bestTime';

const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  reduceMotion: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode). Settings then last only for this session.
  }
}

/** Best completion time in seconds, or null if no run has been finished yet. */
export function loadBestTime(): number | null {
  try {
    const raw = localStorage.getItem(BEST_TIME_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Saves `time` if it beats the stored best. Returns the best time after the update. */
export function recordBestTime(time: number): number {
  const best = loadBestTime();
  if (best !== null && best <= time) return best;
  try {
    localStorage.setItem(BEST_TIME_KEY, time.toFixed(3));
  } catch {
    // Ignore storage failures. The run still counts for this session.
  }
  return time;
}

/** Formats seconds as M:SS.cc (or SS.cc under a minute). */
export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  const secStr = secs.toFixed(2).padStart(5, '0');
  return minutes > 0 ? `${minutes}:${secStr}` : secStr;
}
