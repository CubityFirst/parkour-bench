export type GamePhase = 'menu' | 'playing' | 'paused' | 'finished';

const BEST_KEY = 'rooftop-flow.best.v1';
const BEST_SPLITS_KEY = 'rooftop-flow.bestSplits.v1';

/** Run bookkeeping: phase, timer, checkpoint splits and the saved best time. */
export class GameState {
  phase: GamePhase = 'menu';
  /** Elapsed run time in seconds (only advances while playing and started). */
  time = 0;
  /** The timer starts on the player's first movement input. */
  started = false;
  splits: number[] = [];
  respawns = 0;
  bestTime: number | null = null;
  bestSplits: number[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      const v = raw === null ? NaN : Number(raw);
      this.bestTime = Number.isFinite(v) && v > 0 ? v : null;
      const s = JSON.parse(localStorage.getItem(BEST_SPLITS_KEY) ?? '[]');
      this.bestSplits = Array.isArray(s) ? s.filter((x) => typeof x === 'number') : [];
    } catch {
      this.bestTime = null;
    }
  }

  resetRun(): void {
    this.time = 0;
    this.started = false;
    this.splits = [];
    this.respawns = 0;
  }

  /** Records a finished run. Returns true if it is a new best. */
  finish(): boolean {
    const isBest = this.bestTime === null || this.time < this.bestTime;
    if (isBest) {
      this.bestTime = this.time;
      this.bestSplits = [...this.splits];
      try {
        localStorage.setItem(BEST_KEY, String(this.time));
        localStorage.setItem(BEST_SPLITS_KEY, JSON.stringify(this.bestSplits));
      } catch {
        /* ignore */
      }
    }
    return isBest;
  }
}

/** Formats seconds as m:ss.cc */
export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
