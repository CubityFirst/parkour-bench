import { formatTime } from '../game/GameState';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/**
 * Minimal in-game HUD: crosshair, run timer, speed, checkpoint toast, and contextual control hints.
 * Everything is driven by setters, so the HUD never reads game state itself.
 */
export class HUD {
  private readonly root = requireEl<HTMLDivElement>('hud');
  private readonly timerEl = requireEl<HTMLDivElement>('timer');
  private readonly speedEl = requireEl<HTMLDivElement>('speed');
  private readonly toastEl = requireEl<HTMLDivElement>('checkpoint-msg');
  private readonly hintEl = requireEl<HTMLDivElement>('hint');

  private toastTime = 0;
  private hintText = '';

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setTime(seconds: number): void {
    this.timerEl.textContent = formatTime(seconds);
  }

  setSpeed(metresPerSecond: number): void {
    this.speedEl.textContent = `SPD ${Math.round(metresPerSecond * 3.6)}`;
  }

  /** Shows a short message near the top of the screen, such as a checkpoint notice. */
  toast(text: string, seconds = 2.2): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    this.toastTime = seconds;
  }

  /** Shows a contextual hint, or hides it when `text` is empty. */
  setHint(text: string): void {
    if (text === this.hintText) return;
    this.hintText = text;
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('visible', text.length > 0);
  }

  update(dt: number): void {
    if (this.toastTime > 0) {
      this.toastTime -= dt;
      if (this.toastTime <= 0) this.toastEl.classList.remove('visible');
    }
  }

  /** Clears transient messages, e.g. when a run restarts. */
  reset(): void {
    this.toastTime = 0;
    this.toastEl.classList.remove('visible');
    this.setHint('');
  }
}
