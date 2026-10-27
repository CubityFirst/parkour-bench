import { GameState } from '../game/GameState';

/**
 * HUD — crosshair, run timer, checkpoint counter, contextual hints and toasts.
 * All DOM is defined in index.html; this class just drives it.
 */
export class HUD {
  private hud = document.getElementById('hud')!;
  private timerEl = document.getElementById('timer')!;
  private cpHud = document.getElementById('cp-hud')!;
  private hintEl = document.getElementById('hint')!;
  private toastEl = document.getElementById('toast')!;
  private fadeEl = document.getElementById('fade')!;

  private hintShown = '';
  private visibleHint: string | null = null;
  private toastTimer = 0;

  constructor() {
    this.setTimer(0);
  }

  show(): void {
    this.hud.classList.remove('hidden');
  }

  hide(): void {
    this.hud.classList.add('hidden');
  }

  setTimer(t: number): void {
    this.timerEl.textContent = GameState.formatTime(t);
  }

  setCheckpoints(current: number, total: number): void {
    this.cpHud.textContent = `CHECKPOINT ${current} / ${total}`;
    this.cpHud.classList.remove('hidden');
  }

  showToast(html: string, duration = 1.6): void {
    this.toastEl.innerHTML = html;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = duration;
  }

  setHint(text: string | null): void {
    const key = text ?? '';
    if (key === this.hintShown) return;
    this.hintShown = key;
    if (text === null) {
      this.visibleHint = null;
      this.hintEl.classList.add('hidden');
    } else {
      this.visibleHint = text;
      this.hintEl.innerHTML = text;
      this.hintEl.classList.remove('hidden');
    }
  }

  update(dt: number, runTime: number): void {
    this.setTimer(runTime);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      this.toastEl.style.opacity = String(Math.max(0, Math.min(1, this.toastTimer * 2)));
      if (this.toastTimer <= 0) this.toastEl.classList.add('hidden');
    }
  }

  flashFade(dark = false): void {
    this.fadeEl.style.background = dark ? '#101418' : '#dfeaf2';
    this.fadeEl.classList.add('active');
    window.setTimeout(() => this.fadeEl.classList.remove('active'), 300);
  }
}
