import type { CameraMotion } from '../player/FirstPersonCamera';

export enum GamePhase {
  Menu = 'menu',
  Playing = 'playing',
  Paused = 'paused',
  Finished = 'finished',
}

export interface Settings {
  sensitivity: number;
  motion: CameraMotion;
  volume: number;
}

const SETTINGS_KEY = 'rooftop-flow.settings';
const BEST_KEY = 'rooftop-flow.best';

const DEFAULT_SETTINGS: Settings = { sensitivity: 1, motion: 'full', volume: 0.8 };

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = safeStorage()?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity: typeof parsed.sensitivity === 'number' ? parsed.sensitivity : DEFAULT_SETTINGS.sensitivity,
      motion: parsed.motion === 'reduced' || parsed.motion === 'minimal' ? parsed.motion : 'full',
      volume: typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_SETTINGS.volume,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadBestTime(): number | null {
  const raw = safeStorage()?.getItem(BEST_KEY);
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Stores the time if it beats the previous best. Returns true for a new record. */
export function submitTime(seconds: number): boolean {
  const best = loadBestTime();
  if (best === null || seconds < best) {
    safeStorage()?.setItem(BEST_KEY, String(seconds));
    return true;
  }
  return false;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Per-run bookkeeping: timer, deaths, active state. */
export class RunState {
  time = 0;
  started = false;
  finished = false;
  respawns = 0;

  reset(): void {
    this.time = 0;
    this.started = false;
    this.finished = false;
    this.respawns = 0;
  }
}
