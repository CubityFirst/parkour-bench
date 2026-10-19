function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element as T;
}

function formatTime(totalSeconds: number): string {
  const milliseconds = Math.floor((totalSeconds % 1) * 1000);
  const wholeSeconds = Math.floor(totalSeconds);
  const seconds = wholeSeconds % 60;
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export class HUD {
  private readonly menu = byId<HTMLElement>('menu');
  private readonly hud = byId<HTMLElement>('hud');
  private readonly pause = byId<HTMLElement>('pauseMenu');
  private readonly finish = byId<HTMLElement>('finishScreen');
  private readonly timer = byId<HTMLElement>('timer');
  private readonly hint = byId<HTMLElement>('contextHint');
  private readonly toast = byId<HTMLElement>('checkpointToast');
  private readonly progress = byId<HTMLElement>('progressFill');
  private readonly finishTime = byId<HTMLElement>('finishTime');
  private readonly bestTime = byId<HTMLElement>('bestTime');
  private readonly controls = byId<HTMLElement>('controlsPanel');
  private readonly sensitivity = byId<HTMLInputElement>('sensitivity');
  private readonly sensitivityValue = byId<HTMLOutputElement>('sensitivityValue');
  private readonly reduceMotion = byId<HTMLInputElement>('reduceMotion');
  private toastTimer = 0;

  constructor() {
    const controlsButton = byId<HTMLButtonElement>('controlsButton');
    controlsButton.addEventListener('click', () => {
      this.controls.classList.toggle('is-collapsed');
      controlsButton.querySelector('span')!.textContent = this.controls.classList.contains('is-collapsed') ? '+' : '−';
    });
    this.sensitivity.addEventListener('input', () => {
      this.sensitivityValue.value = Number(this.sensitivity.value).toFixed(2);
      this.sensitivityValue.textContent = this.sensitivityValue.value;
    });
  }

  onStart(handler: () => void): void {
    byId<HTMLButtonElement>('startButton').addEventListener('click', handler);
  }

  onResume(handler: () => void): void {
    byId<HTMLButtonElement>('resumeButton').addEventListener('click', handler);
  }

  onRunAgain(handler: () => void): void {
    byId<HTMLButtonElement>('restartButton').addEventListener('click', handler);
  }

  onCheckpointRestart(handler: () => void): void {
    byId<HTMLButtonElement>('pauseRestartButton').addEventListener('click', handler);
  }

  showMenu(): void {
    this.menu.classList.remove('is-hidden');
    this.hud.classList.add('is-hidden');
    this.pause.classList.add('is-hidden');
    this.finish.classList.add('is-hidden');
  }

  showGame(): void {
    this.menu.classList.add('is-hidden');
    this.pause.classList.add('is-hidden');
    this.finish.classList.add('is-hidden');
    this.hud.classList.remove('is-hidden');
  }

  showPause(): void {
    this.pause.classList.remove('is-hidden');
  }

  hidePause(): void {
    this.pause.classList.add('is-hidden');
  }

  showFinish(time: number, best: number): void {
    this.hud.classList.add('is-hidden');
    this.finishTime.textContent = formatTime(time);
    this.bestTime.textContent = formatTime(best);
    this.finish.classList.remove('is-hidden');
  }

  setTimer(time: number): void {
    this.timer.textContent = formatTime(time);
  }

  setHint(text: string): void {
    if (this.hint.textContent !== text) {
      this.hint.textContent = text;
      this.hint.parentElement?.classList.remove('pulse');
      void this.hint.parentElement?.getBoundingClientRect();
      this.hint.parentElement?.classList.add('pulse');
    }
  }

  setProgress(progress: number): void {
    this.progress.style.transform = `scaleX(${Math.max(0.015, Math.min(1, progress))})`;
  }

  notify(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-visible'), 1800);
  }

  getSensitivity(): number {
    return Number(this.sensitivity.value);
  }

  useReducedMotion(): boolean {
    return this.reduceMotion.checked;
  }
}
