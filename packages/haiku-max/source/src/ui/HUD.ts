import { formatTime } from '../game/GameState';

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

/** In-run overlay: timer, speed readout, checkpoint toast, contextual hints and respawn fade. */
export class HUD {
  private readonly root = element('hud');
  private readonly timer = element('timer');
  private readonly bestLabel = element('best-label');
  private readonly toastEl = element('toast');
  private readonly hintEl = element('hint');
  private readonly speedEl = element('speed');
  private readonly modeEl = element('mode');
  private readonly fadeEl = element('fade');
  private toastTime = 0;
  private hint = '';

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setTime(seconds: number): void {
    this.timer.textContent = formatTime(seconds);
  }

  setBest(seconds: number | null): void {
    this.bestLabel.textContent = seconds === null ? '' : `BEST ${formatTime(seconds)}`;
  }

  setReadout(speed: number, mode: string): void {
    this.speedEl.textContent = speed.toFixed(1);
    this.modeEl.textContent = mode;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    this.toastTime = 2.4;
  }

  /** Contextual control hint. Pass null to clear it. */
  setHint(text: string | null): void {
    const next = text ?? '';
    if (next === this.hint) return;
    this.hint = next;
    this.hintEl.textContent = next;
    this.hintEl.classList.toggle('visible', next !== '');
  }

  setFade(alpha: number): void {
    this.fadeEl.style.opacity = String(Math.min(1, Math.max(0, alpha)));
  }

  update(dt: number): void {
    if (this.toastTime <= 0) return;
    this.toastTime -= dt;
    if (this.toastTime <= 0) this.toastEl.classList.remove('visible');
  }
}
