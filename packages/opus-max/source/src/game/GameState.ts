/** High-level game phase and the state of the current run. */

export type Phase = 'menu' | 'playing' | 'paused' | 'finished';

const BEST_KEY = 'roofline-best-time';
const BEST_SPLITS_KEY = 'roofline-best-splits';

export class RunState {
  phase: Phase = 'menu';
  /** Run time in seconds. The clock starts on the first movement input. */
  time = 0;
  timerRunning = false;
  /** Split time at each checkpoint (index = checkpoint index). */
  splits: number[] = [];
  respawns = 0;
  /** Set when the run finishes. */
  finalTime = 0;
  newBest = false;

  reset(): void {
    this.time = 0;
    this.timerRunning = false;
    this.splits = [];
    this.respawns = 0;
    this.finalTime = 0;
    this.newBest = false;
  }

  startTimer(): void {
    if (!this.timerRunning && this.time === 0) this.timerRunning = true;
  }
}

export function loadBestTime(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function loadBestSplits(): number[] {
  try {
    const raw = localStorage.getItem(BEST_SPLITS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

/** Stores the time if it beats the saved best. Returns true for a new record. */
export function submitTime(time: number, splits: number[]): boolean {
  const best = loadBestTime();
  if (best !== null && time >= best) return false;
  try {
    localStorage.setItem(BEST_KEY, time.toFixed(3));
    localStorage.setItem(BEST_SPLITS_KEY, JSON.stringify(splits.map((s) => Math.round(s * 1000) / 1000)));
  } catch {
    // Not fatal: the record just isn't persisted.
  }
  return true;
}

/** mm:ss.cc */
export function formatTime(t: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
