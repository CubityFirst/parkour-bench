import { formatTime } from '../game/GameState';

/** Minimal in-game overlay: crosshair, timer, toasts, hints, action prompts. */
export class HUD {
  readonly root: HTMLDivElement;
  private timer: HTMLDivElement;
  private best: HTMLDivElement;
  private toast: HTMLDivElement;
  private hint: HTMLDivElement;
  private action: HTMLDivElement;
  private speed: HTMLDivElement;
  private speedFill: HTMLDivElement;
  private fade: HTMLDivElement;
  private toastTimer = 0;
  private lastHint = '';
  private lastAction = '';
  private hintIdle = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden');
    const cross = el('div', 'crosshair');
    const tl = el('div', 'hud-timer-wrap');
    this.timer = el('div', 'hud-timer');
    this.timer.textContent = '0:00.00';
    this.best = el('div', 'hud-best');
    tl.append(this.timer, this.best);
    this.toast = el('div', 'hud-toast');
    this.hint = el('div', 'hud-hint');
    this.action = el('div', 'hud-action');
    this.speed = el('div', 'hud-speed');
    this.speedFill = el('div', 'hud-speed-fill');
    this.speed.append(this.speedFill);
    this.fade = el('div', 'hud-fade');
    this.root.append(cross, tl, this.toast, this.hint, this.action, this.speed);
    parent.append(this.root, this.fade);
  }

  show(v: boolean): void { this.root.classList.toggle('hidden', !v); }

  setTime(t: number, best: number | null): void {
    this.timer.textContent = formatTime(t);
    this.best.textContent = best !== null ? `BEST ${formatTime(best)}` : '';
  }

  showToast(text: string, sub = ''): void {
    this.toast.innerHTML = `<span class="toast-main">${text}</span>${sub ? `<span class="toast-sub">${sub}</span>` : ''}`;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth; // restart animation
    this.toast.classList.add('show');
    this.toastTimer = 2.2;
  }

  setHint(text: string | null, dt: number): void {
    const t = text ?? '';
    if (t !== this.lastHint) {
      this.lastHint = t;
      this.hintIdle = 0;
      this.hint.textContent = t;
      this.hint.classList.toggle('show', !!t);
    } else if (t) {
      // Fade hints out after a while so they don't nag.
      this.hintIdle += dt;
      this.hint.classList.toggle('show', this.hintIdle < 9);
    }
  }

  setAction(text: string | null): void {
    const t = text ?? '';
    if (t === this.lastAction) return;
    this.lastAction = t;
    this.action.innerHTML = t;
    this.action.classList.toggle('show', !!t);
  }

  setSpeed(k: number): void {
    this.speedFill.style.transform = `scaleX(${Math.max(0, Math.min(1, k)).toFixed(3)})`;
  }

  flash(): void {
    this.fade.classList.remove('flash');
    void this.fade.offsetWidth;
    this.fade.classList.add('flash');
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
