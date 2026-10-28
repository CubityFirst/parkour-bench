import { formatTime } from '../core/MathUtil';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/**
 * Minimal in-game HUD: timer, crosshair, notifications and hints.
 */
export class HUD {
  private readonly root = el<HTMLDivElement>('hud');
  private readonly timerNode = el<HTMLDivElement>('timer');
  private readonly sectionNode = el<HTMLDivElement>('section-name');
  private readonly checkpointToast = el<HTMLDivElement>('checkpoint-toast');
  private readonly sectionToast = el<HTMLDivElement>('section-toast');
  private readonly promptNode = el<HTMLDivElement>('prompt');
  private readonly promptText = el<HTMLSpanElement>('prompt-text');
  private readonly hintNode = el<HTMLDivElement>('hint');
  private readonly speedBar = el<HTMLElement>('speed-bar');

  private checkpointTimer = 0;
  private sectionTimer = 0;
  private hintTimer = 0;

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setTimer(seconds: number): void {
    const text = formatTime(seconds);
    const dot = text.indexOf('.');
    this.timerNode.innerHTML = `${text.slice(0, dot)}<small>${text.slice(dot)}</small>`;
  }

  setSection(name: string): void {
    this.sectionNode.textContent = name;
  }

  notifyCheckpoint(label: string): void {
    this.checkpointToast.innerHTML = `CHECKPOINT <b>${label}</b>`;
    this.checkpointToast.classList.add('show');
    this.checkpointTimer = 2.4;
  }

  announceSection(name: string): void {
    this.sectionToast.textContent = name;
    this.sectionToast.classList.add('show');
    this.sectionTimer = 2.2;
  }

  setHint(text: string | null): void {
    if (text) {
      this.hintNode.textContent = text;
      this.hintNode.classList.add('show');
      this.hintTimer = 5;
    } else {
      this.hintNode.classList.remove('show');
      this.hintTimer = 0;
    }
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.promptText.textContent = text;
      this.promptNode.classList.remove('hidden');
    } else {
      this.promptNode.classList.add('hidden');
    }
  }

  setSpeed(ratio: number): void {
    this.speedBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  update(dt: number): void {
    if (this.checkpointTimer > 0) {
      this.checkpointTimer -= dt;
      if (this.checkpointTimer <= 0) this.checkpointToast.classList.remove('show');
    }
    if (this.sectionTimer > 0) {
      this.sectionTimer -= dt;
      if (this.sectionTimer <= 0) this.sectionToast.classList.remove('show');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintNode.classList.remove('show');
    }
  }

  reset(): void {
    this.checkpointTimer = 0;
    this.sectionTimer = 0;
    this.hintTimer = 0;
    this.checkpointToast.classList.remove('show');
    this.sectionToast.classList.remove('show');
    this.hintNode.classList.remove('show');
    this.promptNode.classList.add('hidden');
  }
}
