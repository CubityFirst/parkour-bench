import { formatTime } from '../game/GameState';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

/**
 * In-game HUD: timer, speed, checkpoint flash, contextual hint, and the finish
 * screen. Only text and visibility are touched per frame, so this is cheap.
 */
export class HUD {
  private readonly root = el<HTMLDivElement>('hud');
  private readonly timer = el<HTMLDivElement>('timer');
  private readonly best = el<HTMLDivElement>('best-hud');
  private readonly checkpoint = el<HTMLDivElement>('checkpoint-msg');
  private readonly hint = el<HTMLDivElement>('hint');
  private readonly speed = el<HTMLDivElement>('speed-meter');
  private readonly finish = el<HTMLDivElement>('finish');
  private readonly finishTime = el<HTMLParagraphElement>('finish-time');
  private readonly finishBest = el<HTMLParagraphElement>('finish-best');
  private checkpointTimeout: number | null = null;
  private lastHint = '';
  private lastTimerText = '';
  private lastSpeedText = '';

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setTimer(seconds: number): void {
    const text = formatTime(seconds);
    if (text !== this.lastTimerText) {
      this.timer.textContent = text;
      this.lastTimerText = text;
    }
  }

  setSpeed(metersPerSecond: number): void {
    const text = `${Math.round(metersPerSecond * 3.6)} km/h`;
    if (text !== this.lastSpeedText) {
      this.speed.textContent = text;
      this.lastSpeedText = text;
    }
  }

  setBest(seconds: number | null): void {
    this.best.textContent = seconds === null ? '' : `BEST ${formatTime(seconds)}`;
  }

  /** Brief flash when a checkpoint activates. */
  flashCheckpoint(): void {
    this.checkpoint.classList.remove('hidden');
    this.checkpoint.style.opacity = '1';
    if (this.checkpointTimeout !== null) window.clearTimeout(this.checkpointTimeout);
    this.checkpointTimeout = window.setTimeout(() => {
      this.checkpoint.style.opacity = '0';
      window.setTimeout(() => this.checkpoint.classList.add('hidden'), 400);
    }, 1400);
  }

  /** Contextual control hint. Pass '' to hide it. */
  setHint(text: string): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.hint.textContent = text;
    this.hint.style.opacity = text ? '1' : '0';
  }

  showFinish(time: number, best: number, isNewBest: boolean): void {
    this.finishTime.textContent = `Time: ${formatTime(time)}`;
    this.finishBest.textContent = isNewBest ? `New best: ${formatTime(best)}` : `Best: ${formatTime(best)}`;
    this.finish.classList.remove('hidden');
  }

  hideFinish(): void {
    this.finish.classList.add('hidden');
  }
}
