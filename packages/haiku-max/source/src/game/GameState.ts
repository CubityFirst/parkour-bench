/** Top-level screen state. Only Playing advances the simulation and timer. */
export enum GamePhase {
  Menu = 'menu',
  Playing = 'playing',
  Paused = 'paused',
  Finished = 'finished',
}

const BEST_KEY = 'rooftop-flow:best-time';

/** Best completion time in seconds, or null when no run has been completed yet. */
export function loadBestTime(): number | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveBestTime(seconds: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(seconds));
  } catch {
    // Ignored: the best time simply will not persist.
  }
}

/** The current run's clock. It counts simulated time, so pauses and menus never add to it. */
export class RunState {
  /** Seconds since the run started, across checkpoint respawns. */
  time = 0;

  reset(): void {
    this.time = 0;
  }
}

/** Formats seconds as mm:ss.cc. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const wholeSeconds = Math.floor(total % 60);
  const hundredths = Math.floor((total * 100) % 100);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(minutes)}:${pad(wholeSeconds)}.${pad(hundredths)}`;
}
