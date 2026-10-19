import { byId } from './dom';

/** Formats seconds as MM:SS.hh */
export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}

/** In-run overlay: crosshair, timer, transient notices and contextual hints. */
export class HUD {
  private readonly root = byId('hud');
  private readonly timer = byId('timer');
  private readonly toast = byId('toast');
  private readonly hint = byId('hint');
  private toastTimeout = 0;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setTime(seconds: number): void {
    this.timer.textContent = formatTime(seconds);
  }

  setHint(text: string): void {
    if (this.hint.textContent !== text) this.hint.textContent = text;
  }

  flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => this.toast.classList.remove('show'), 1800);
  }
}
