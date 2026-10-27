import { formatTime } from '../game/GameState';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Converts "[KEY] text" markup into keycap elements (text is escaped). */
export function renderKeys(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
}

/** Minimal in-game HUD: crosshair, timer, checkpoint toasts and control hints. */
export class HUD {
  private readonly root = $('hud');
  private readonly timer = $('timer');
  private readonly split = $('split');
  private readonly toast = $('toast');
  private readonly hint = $('hint');
  private readonly crosshair = $('crosshair');
  private readonly progress = $('checkpoint-progress');
  private readonly fade = $('fade');
  private readonly speedlines = $('speedlines');
  private readonly debug = $('debug');
  private toastTimer = 0;
  private hintTimer = 0;
  private splitTimer = 0;
  private lastTimerText = '';

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.speedlines.style.opacity = '0';
  }

  setCheckpointCount(n: number): void {
    this.progress.innerHTML = '';
    for (let i = 1; i < n; i++) this.progress.appendChild(document.createElement('i'));
    this.progress.appendChild(document.createElement('i')); // finish
  }

  setCheckpointProgress(reached: number, finished = false): void {
    const items = this.progress.querySelectorAll('i');
    items.forEach((el, i) => el.classList.toggle('done', i < reached || (finished && i === items.length - 1)));
  }

  setTime(t: number): void {
    const text = formatTime(t);
    if (text !== this.lastTimerText) {
      this.timer.textContent = text;
      this.lastTimerText = text;
    }
  }

  /** Shows a checkpoint split, coloured against the best run's split if there is one. */
  showSplit(time: number, best: number | undefined): void {
    this.split.classList.remove('faster', 'slower');
    if (best !== undefined) {
      const d = time - best;
      this.split.textContent = `${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
      this.split.classList.add(d <= 0 ? 'faster' : 'slower');
    } else {
      this.split.textContent = formatTime(time);
    }
    this.split.classList.add('show');
    this.splitTimer = 3;
  }

  showToast(title: string, subtitle = '', seconds = 2.4): void {
    this.toast.innerHTML = `${renderKeys(title)}${subtitle ? `<small>${renderKeys(subtitle)}</small>` : ''}`;
    this.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  showHint(text: string, seconds = 5.5): void {
    this.hint.innerHTML = renderKeys(text);
    this.hint.classList.add('show');
    this.hintTimer = seconds;
  }

  clearHint(): void {
    this.hint.classList.remove('show');
    this.hintTimer = 0;
  }

  setActionCue(active: boolean): void {
    this.crosshair.classList.toggle('action', active);
  }

  setFade(on: boolean): void {
    this.fade.classList.toggle('on', on);
  }

  setSpeedEffect(k: number): void {
    this.speedlines.style.opacity = k.toFixed(3);
  }

  setDebug(text: string | null): void {
    if (text === null) {
      this.debug.classList.add('hidden');
      return;
    }
    this.debug.classList.remove('hidden');
    this.debug.textContent = text;
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.remove('show');
    }
    if (this.splitTimer > 0) {
      this.splitTimer -= dt;
      if (this.splitTimer <= 0) this.split.classList.remove('show');
    }
  }

  reset(): void {
    this.toast.classList.remove('show');
    this.hint.classList.remove('show');
    this.split.classList.remove('show');
    this.toastTimer = 0;
    this.hintTimer = 0;
    this.splitTimer = 0;
    this.setCheckpointProgress(0);
    this.setTime(0);
  }
}
