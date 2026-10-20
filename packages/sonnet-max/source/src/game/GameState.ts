export type GamePhase = 'loading' | 'menu' | 'playing' | 'paused' | 'finished';

const BEST_KEY = 'rooftop-flow-best-time';

/** Formats seconds as MM:SS.cc */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const cs = Math.floor((rest - whole) * 100);
  return `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function loadBestTime(): number | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveBestTime(seconds: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(seconds));
  } catch {
    /* ignore */
  }
}

/** Mutable state of the current run (timer, falls, checkpoint progress). */
export class RunState {
  /** Seconds on the run clock. */
  elapsed = 0;
  /** The clock only starts on the first movement input. */
  started = false;
  falls = 0;
  finished = false;
  best: number | null = loadBestTime();

  reset(): void {
    this.elapsed = 0;
    this.started = false;
    this.falls = 0;
    this.finished = false;
  }

  /** Stores a finished time; returns true when it is a new personal best. */
  complete(): boolean {
    this.finished = true;
    const isBest = this.best === null || this.elapsed < this.best;
    if (isBest) {
      this.best = this.elapsed;
      saveBestTime(this.elapsed);
    }
    return isBest;
  }
}
