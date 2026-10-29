/** Minimal in-game HUD: crosshair, timer, section label, toasts and hints. */
export class HUD {
  private readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly section: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly pips: HTMLElement[] = [];

  private toastTimer = 0;
  private hintTimer = 0;

  constructor(doc: Document = document) {
    this.root = doc.getElementById('hud') as HTMLElement;
    this.timer = doc.getElementById('timer') as HTMLElement;
    this.section = doc.getElementById('section-label') as HTMLElement;
    this.toast = doc.getElementById('toast') as HTMLElement;
    this.hint = doc.getElementById('hint') as HTMLElement;
    this.flash = doc.getElementById('checkpoint-flash') as HTMLElement;

    const pipRoot = doc.getElementById('speed-pips');
    if (pipRoot) {
      this.pips = Array.from(pipRoot.querySelectorAll('.pip')) as HTMLElement[];
    }
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setTimer(seconds: number): void {
    this.timer.textContent = formatTime(seconds);
  }

  setSection(name: string): void {
    if (this.section.textContent !== name) this.section.textContent = name;
  }

  setSpeed(ratio: number): void {
    const lit = Math.round(Math.min(1, Math.max(0, ratio)) * this.pips.length);
    this.pips.forEach((pip, i) => {
      pip.classList.toggle('on', i < lit);
      pip.classList.toggle('max', lit >= this.pips.length && i === this.pips.length - 1);
    });
  }

  showToast(text: string, duration = 1.8): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = duration;
  }

  showHint(text: string, duration = 5): void {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this.hintTimer = duration;
  }

  hideHint(): void {
    this.hint.classList.remove('show');
    this.hintTimer = 0;
  }

  flashCheckpoint(): void {
    this.flash.classList.add('show');
    window.setTimeout(() => this.flash.classList.remove('show'), 220);
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
  }
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs
    .toString()
    .padStart(2, '0')}`;
}
