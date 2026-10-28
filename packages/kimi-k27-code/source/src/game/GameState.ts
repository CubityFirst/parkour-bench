export type GamePhase = 'menu' | 'playing' | 'paused' | 'finished';

export interface Checkpoint {
  position: { x: number; y: number; z: number };
  index: number;
}

export class GameState {
  phase: GamePhase = 'menu';
  startTime = 0;
  elapsed = 0;
  currentCheckpoint = 0;
  bestTime = Number.POSITIVE_INFINITY;
  mouseSensitivity = 0.002;
  cameraMotion = 'normal'; // 'low' | 'normal'
  finishTime = 0;

  private checkpointListeners: (() => void)[] = [];
  private finishListeners: ((time: number) => void)[] = [];

  constructor() {
    const saved = localStorage.getItem('rooftop-flow-best');
    if (saved) this.bestTime = parseFloat(saved);
  }

  startRun() {
    this.phase = 'playing';
    this.startTime = performance.now();
    this.elapsed = 0;
    this.currentCheckpoint = 0;
    this.finishTime = 0;
  }

  pause() {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume() {
    if (this.phase === 'paused') {
      this.phase = 'playing';
      this.startTime = performance.now() - this.elapsed;
    }
  }

  updateTimer() {
    if (this.phase === 'playing') {
      this.elapsed = performance.now() - this.startTime;
    }
  }

  get formattedTime(): string {
    const ms = this.phase === 'finished' ? this.finishTime : this.elapsed;
    const total = Math.max(0, ms);
    const min = Math.floor(total / 60000);
    const sec = Math.floor((total % 60000) / 1000);
    const cs = Math.floor((total % 1000) / 10);
    return `${min}:${sec.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  }

  setCheckpoint(index: number) {
    if (index > this.currentCheckpoint) {
      this.currentCheckpoint = index;
      this.checkpointListeners.forEach((cb) => cb());
    }
  }

  onCheckpoint(cb: () => void) {
    this.checkpointListeners.push(cb);
  }

  finish() {
    if (this.phase === 'finished') return;
    this.finishTime = this.elapsed;
    this.phase = 'finished';
    if (this.finishTime < this.bestTime) {
      this.bestTime = this.finishTime;
      localStorage.setItem('rooftop-flow-best', this.bestTime.toString());
    }
    this.finishListeners.forEach((cb) => cb(this.finishTime));
  }

  onFinish(cb: (time: number) => void) {
    this.finishListeners.push(cb);
  }
}
