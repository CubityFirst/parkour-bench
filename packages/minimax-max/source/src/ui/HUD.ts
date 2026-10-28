import { formatTime } from '../game/GameState';

/** Thin wrapper around the in-game HUD elements. */
export class HUD {
  private readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly sectionIndex: HTMLElement;
  private readonly sectionName: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly keyHints: HTMLElement;

  private toastTimer = 0;
  private hintTimer = 0;

  constructor() {
    this.root = must('hud');
    this.timer = must('timer');
    this.toast = must('toast');
    this.hint = must('hint');
    this.sectionIndex = must('sectionIndex');
    this.sectionName = must('sectionName');
    this.speedFill = must('speedFill');
    this.speedValue = must('speedValue');
    this.keyHints = must('hudKeys');
  }

  show(): void {
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  setTimer(seconds: number): void {
    this.timer.textContent = formatTime(seconds);
  }

  setSection(index: number, name: string): void {
    this.sectionIndex.textContent = String(index).padStart(2, '0');
    this.sectionName.textContent = name;
  }

  setSpeed(speed: number, maxSpeed: number): void {
    const percent = Math.min(100, (speed / maxSpeed) * 100);
    this.speedFill.style.width = `${percent.toFixed(1)}%`;
    this.speedValue.textContent = speed.toFixed(1);
  }

  showToast(text: string, duration = 2.2): void {
    this.toast.textContent = text;
    this.toast.classList.add('is-visible');
    this.toastTimer = duration;
  }

  showHint(text: string, duration = 4.5): void {
    this.hint.innerHTML = text;
    this.hint.classList.add('is-visible');
    this.hintTimer = duration;
  }

  hideHint(): void {
    this.hint.classList.remove('is-visible');
    this.hintTimer = 0;
  }

  fadeKeyHints(): void {
    this.keyHints.classList.add('is-faded');
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('is-visible');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.remove('is-visible');
    }
  }
}

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: #${id}`);
  return element;
}
