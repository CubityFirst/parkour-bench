import { formatTime } from '../game/GameState';

/** In-game overlay: timer, crosshair, section name, checkpoint toast and contextual hints. */
export class HUD {
  private readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly section: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hint: HTMLElement;
  private lastHint: string | null = null;
  private lastSection = '';
  private lastTimerText = '';

  constructor() {
    this.root = requireElement('hud');
    this.timer = requireElement('timer');
    this.section = requireElement('section-label');
    this.toast = requireElement('checkpoint-msg');
    this.hint = requireElement('hint');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Updates the run timer. Only touches the DOM when the displayed text changes. */
  setTime(seconds: number): void {
    const text = formatTime(seconds);
    if (text !== this.lastTimerText) {
      this.timer.textContent = text;
      this.lastTimerText = text;
    }
  }

  setSection(name: string): void {
    if (name === this.lastSection) return;
    this.lastSection = name;
    this.section.textContent = name;
  }

  /** Shows a short hint, or hides the hint when `text` is null. */
  setHint(text: string | null): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    if (text) {
      this.hint.textContent = text;
      this.hint.classList.remove('hidden');
    } else {
      this.hint.classList.add('hidden');
    }
  }

  showCheckpoint(label: string): void {
    this.toast.textContent = `CHECKPOINT  ·  ${label.toUpperCase()}`;
    // Hide and re-show so the fade-in animation restarts even if a toast is already on screen.
    this.toast.classList.add('hidden');
    void this.toast.offsetWidth;
    this.toast.classList.remove('hidden');
    window.setTimeout(() => this.toast.classList.add('hidden'), 2300);
  }
}

export function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}
