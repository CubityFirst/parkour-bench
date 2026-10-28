/** Minimal in-game HUD: crosshair, run timer, best time, checkpoint toast, hints. */
export class HUD {
  private root: HTMLElement;
  private timerEl: HTMLElement;
  private bestEl: HTMLElement;
  private toastEl: HTMLElement;
  private hintEl: HTMLElement;
  private toastTimeout: number | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.classList.add('hidden');

    this.root.innerHTML = `
      <div id="crosshair"></div>
      <div id="timer">0:00.00</div>
      <div id="best-time"></div>
      <div id="checkpoint-toast">CHECKPOINT</div>
      <div id="hint"></div>
    `;

    this.timerEl = this.root.querySelector('#timer') as HTMLElement;
    this.bestEl = this.root.querySelector('#best-time') as HTMLElement;
    this.toastEl = this.root.querySelector('#checkpoint-toast') as HTMLElement;
    this.hintEl = this.root.querySelector('#hint') as HTMLElement;

    container.appendChild(this.root);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setTime(t: number): void {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t * 100) % 100);
    this.timerEl.textContent = `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  setBest(best: number | null): void {
    if (best === null) {
      this.bestEl.textContent = '';
      return;
    }
    const m = Math.floor(best / 60);
    const s = Math.floor(best % 60);
    const cs = Math.floor((best * 100) % 100);
    this.bestEl.textContent = `BEST  ${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  checkpoint(): void {
    this.toastEl.classList.add('show');
    if (this.toastTimeout !== null) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }

  setHint(text: string | null): void {
    if (!text) {
      this.hintEl.classList.remove('show');
      this.hintEl.innerHTML = '';
      return;
    }
    this.hintEl.classList.add('show');
    this.hintEl.innerHTML = text;
  }
}
