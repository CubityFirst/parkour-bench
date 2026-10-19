import { formatTime } from '../game/GameState';

export class HUD {
  private root = document.getElementById('hud')!;
  private timer = document.getElementById('timer')!;
  private speed = document.getElementById('speed')!;
  private toastEl = document.getElementById('toast')!;
  private hintEl = document.getElementById('hint')!;
  private flashEl = document.getElementById('flash')!;
  private toastTimer = 0;
  private hintText = '';
  private lastTimeText = '';

  show(v: boolean): void { this.root.classList.toggle('hidden', !v); }

  setTime(t: number): void {
    const s = formatTime(t);
    if (s !== this.lastTimeText) { this.lastTimeText = s; this.timer.textContent = s; }
  }

  setSpeed(v: number): void { this.speed.textContent = `${v.toFixed(1)} M/S`; }

  toast(text: string): void {
    this.toastEl.innerHTML = `<span>${text}</span>`;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }

  setHint(text: string): void {
    if (text === this.hintText) return;
    this.hintText = text;
    if (text) { this.hintEl.textContent = text; this.hintEl.classList.add('show'); }
    else this.hintEl.classList.remove('show');
  }

  flash(): void {
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove('on')));
  }
}
