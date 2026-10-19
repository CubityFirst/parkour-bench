/** In-game HUD: crosshair, timer, checkpoint toast, contextual hints, speed vignette. */

import { formatTime } from '../game/Settings';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** Converts "[KEY]" markers into keycap elements (text is trusted, authored in the level). */
function renderHint(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
}

export class HUD {
  private readonly root = el<HTMLDivElement>('hud');
  private readonly timer = el<HTMLDivElement>('timer');
  private readonly progress = el<HTMLDivElement>('progress');
  private readonly toast = el<HTMLDivElement>('toast');
  private readonly hint = el<HTMLDivElement>('hint');
  private readonly speedfx = el<HTMLDivElement>('speedfx');
  private readonly flashEl = el<HTMLDivElement>('flash');
  private readonly debug = el<HTMLPreElement>('debug');

  private lastTimerText = '';
  private hintText = '';
  private hintHideAt = 0;
  private speedFx = 0;

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /** Builds the checkpoint progress ticks (one per checkpoint after the start). */
  setProgress(total: number, reached: number): void {
    if (this.progress.childElementCount !== total) {
      this.progress.innerHTML = '';
      for (let i = 0; i < total; i++) this.progress.appendChild(document.createElement('i'));
    }
    Array.from(this.progress.children).forEach((c, i) => c.classList.toggle('done', i < reached));
  }

  setTime(seconds: number): void {
    const text = formatTime(seconds);
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      this.timer.textContent = text;
    }
  }

  showCheckpoint(label: string, timeSeconds: number): void {
    this.toast.innerHTML = `${label}<small>${formatTime(timeSeconds)}</small>`;
    this.toast.classList.remove('show');
    // restart the CSS animation
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }

  showMessage(text: string): void {
    this.toast.innerHTML = text;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }

  /** Shows a contextual hint; hints linger briefly after their trigger zone is left. */
  setHint(text: string | null, now: number): void {
    if (text) {
      if (text !== this.hintText) {
        this.hintText = text;
        this.hint.innerHTML = renderHint(text);
      }
      this.hintHideAt = now + 2.4;
      this.hint.classList.add('show');
    } else if (now > this.hintHideAt) {
      this.hint.classList.remove('show');
    }
  }

  clearHint(): void {
    this.hintText = '';
    this.hintHideAt = 0;
    this.hint.classList.remove('show');
  }

  /** 0..1 speed intensity for the edge vignette. */
  setSpeedFx(v: number): void {
    const next = Math.round(Math.max(0, Math.min(1, v)) * 50) / 50;
    if (next !== this.speedFx) {
      this.speedFx = next;
      this.speedfx.style.setProperty('--speed', String(next));
    }
  }

  flash(): void {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  setDebug(text: string | null): void {
    if (text === null) {
      this.debug.classList.add('hidden');
    } else {
      this.debug.classList.remove('hidden');
      this.debug.textContent = text;
    }
  }
}
