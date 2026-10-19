export type GameMode = 'menu' | 'playing' | 'paused' | 'finished';

const BEST_KEY = 'rooftop-flow-best';
const SETTINGS_KEY = 'rooftop-flow-settings';

export interface Settings {
  sensitivity: number;
  reducedMotion: boolean;
}

export function motionScale(settings: Settings): number {
  return settings.reducedMotion ? 0.15 : 1;
}

export function clampSensitivity(value: number): number {
  return Math.min(1.8, Math.max(0.4, value));
}

/** m:ss.hh from milliseconds. */
export function formatTime(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const hundredths = Math.floor(safe / 10) % 100;
  const seconds = Math.floor(safe / 1000) % 60;
  const minutes = Math.floor(safe / 60000);
  const ss = seconds.toString().padStart(2, '0');
  const hh = hundredths.toString().padStart(2, '0');
  return `${minutes}:${ss}.${hh}`;
}

export function loadBest(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveBest(ms: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(ms)));
  } catch {
    /* storage unavailable */
  }
}

export function loadSettings(): Settings {
  const fallback: Settings = {
    sensitivity: 1,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const sensitivity = Number(parsed.sensitivity);
    return {
      sensitivity: Number.isFinite(sensitivity) ? clampSensitivity(sensitivity) : fallback.sensitivity,
      reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : fallback.reducedMotion,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

export class GameState {
  mode: GameMode = 'menu';
  elapsed = 0;
  best: number | null = loadBest();
  settings: Settings = loadSettings();
  debug = false;
}
