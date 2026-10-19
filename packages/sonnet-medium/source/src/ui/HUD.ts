import { formatTime } from '../game/GameState';

/** In-game overlay: timer, speed, checkpoint toast, contextual hints. */
export class HUD {
  private root = document.getElementById('hud')!;
  private timer = document.getElementById('timer')!;
  private speed = document.getElementById('speed-val')!;
  private notify = document.getElementById('notify')!;
  private hint = document.getElementById('hint')!;
  private vault = document.getElementById('vault-hint')!;
  private fade = document.getElementById('fade')!;
  private notifyTimer = 0;
  private lastHint = '';
  private lastTime = '';
  private lastSpeed = '';

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  setTime(t: number): void {
    const s = formatTime(t);
    if (s !== this.lastTime) { this.timer.textContent = s; this.lastTime = s; }
  }

  setSpeed(v: number): void {
    const s = v.toFixed(0);
    if (s !== this.lastSpeed) { this.speed.textContent = s; this.lastSpeed = s; }
  }

  toast(text: string, ms = 1800): void {
    this.notify.textContent = text;
    this.notify.classList.add('show');
    clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => this.notify.classList.remove('show'), ms);
  }

  setHint(text: string | null): void {
    const t = text ?? '';
    if (t === this.lastHint) return;
    this.lastHint = t;
    if (text) this.hint.textContent = text;
    this.hint.classList.toggle('show', !!text);
  }

  setVaultHint(on: boolean): void {
    this.vault.classList.toggle('show', on);
  }

  /** Quick white flash used when respawning. */
  flash(): void {
    this.fade.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.fade.classList.remove('on')));
  }
}
