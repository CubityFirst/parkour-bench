import { formatTime } from '../game/GameState';
import { TIMING } from '../game/Config';

const HINT_MS = TIMING.hintDisplay * 1000;
const TOAST_MS = TIMING.checkpointToast * 1000;

/** Minimal heads-up display: crosshair, timer, route progress, hints. */
export class HUD {
  private root: HTMLElement;
  private timerEl: HTMLElement;
  private speedFill: HTMLElement;
  private speedText: HTMLElement;
  private progressFill: HTMLElement;
  private progressLabel: HTMLElement;
  private hintEl: HTMLElement;
  private toastEl: HTMLElement;

  private hintTimer = 0;
  private toastTimer = 0;

  constructor() {
    this.root = must('hud');
    this.timerEl = must('timer');
    this.speedFill = must('speed-fill');
    this.speedText = must('speed-text');
    this.progressFill = must('progress-fill');
    this.progressLabel = must('progress-label');
    this.hintEl = must('hint');
    this.toastEl = must('toast');
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
  }

  setTimer(seconds: number): void {
    this.timerEl.textContent = formatTime(seconds);
  }

  setSpeed(speed: number, maxSpeed: number): void {
    const ratio = Math.min(1, speed / Math.max(maxSpeed, 0.001));
    this.speedFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.speedFill.classList.toggle('fast', ratio > 0.82);
    this.speedText.textContent = speed.toFixed(1);
  }

  setProgress(ratio: number, label: string): void {
    this.progressFill.style.width = `${Math.max(0, Math.min(1, ratio) * 100).toFixed(1)}%`;
    this.progressLabel.textContent = label;
  }

  /** Show a contextual hint for a few seconds. */
  showHint(text: string): void {
    if (this.hintEl.textContent === text && this.hintTimer > 0) return;
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    this.hintTimer = HINT_MS;
  }

  showToast(text: string): void {
    this.toastEl.innerHTML = text;
    this.toastEl.classList.add('show');
    this.toastTimer = TOAST_MS;
  }

  update(dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt * 1000;
      if (this.hintTimer <= 0) this.hintEl.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt * 1000;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  clearMessages(): void {
    this.hintTimer = 0;
    this.toastTimer = 0;
    this.hintEl.classList.remove('show');
    this.toastEl.classList.remove('show');
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
