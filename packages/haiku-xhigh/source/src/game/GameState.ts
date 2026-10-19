/** Top-level screen the UI is showing. */
export type Screen = 'menu' | 'playing' | 'paused' | 'finished';

export interface Settings {
  /** Mouse look multiplier, 0.2 to 3. */
  sensitivity: number;
  reduceMotion: boolean;
}

const BEST_KEY = 'rooftop-flow.best-time-ms';
const SETTINGS_KEY = 'rooftop-flow.settings';

/**
 * Run bookkeeping: the screen, the run timer, and the best time saved in localStorage.
 * The timer keeps running through checkpoint respawns, so resets cost time.
 */
export class GameState {
  screen: Screen = 'menu';
  /** Seconds since the run began. */
  runTime = 0;
  bestTimeMs: number | null = loadBestTime();
  private running = false;

  startRun(): void {
    this.runTime = 0;
    this.running = true;
    this.screen = 'playing';
  }

  tick(dt: number): void {
    if (this.running) this.runTime += dt;
  }

  pauseTimer(): void {
    this.running = false;
  }

  resumeTimer(): void {
    this.running = true;
  }

  /** Stops the run and records the time. Returns true if it is a new best. */
  finishRun(): boolean {
    this.running = false;
    this.screen = 'finished';
    const ms = Math.round(this.runTime * 1000);
    if (this.bestTimeMs === null || ms < this.bestTimeMs) {
      this.bestTimeMs = ms;
      saveBestTime(ms);
      return true;
    }
    return false;
  }
}

/** Formats seconds as m:ss.mmm. */
export function formatTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function formatBest(ms: number | null): string {
  return ms === null ? '--' : formatTime(ms / 1000);
}

export function loadSettings(): Settings {
  const fallback: Settings = { sensitivity: 1, reduceMotion: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity: typeof parsed.sensitivity === 'number' ? parsed.sensitivity : fallback.sensitivity,
      reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : fallback.reduceMotion,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode). Settings then last only for this session.
  }
}

function loadBestTime(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveBestTime(ms: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(ms));
  } catch {
    // Ignore: the best time still applies for this session.
  }
}
