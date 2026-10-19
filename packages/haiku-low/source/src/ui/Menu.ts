import { byId } from './dom';

export interface MenuHandlers {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartRun(): void;
  onFinishRestart(): void;
  onSensitivity(value: number): void;
  onReduceMotion(enabled: boolean): void;
}

/** Main menu, pause menu and finish screen. Wires their buttons to the game. */
export class Menu {
  private readonly mainOverlay = byId('overlay-menu');
  private readonly menuMain = byId('menu-main');
  private readonly menuControls = byId('menu-controls');
  private readonly pauseOverlay = byId('overlay-pause');
  private readonly finishOverlay = byId('overlay-finish');
  private readonly finishTime = byId('finish-time');
  private readonly finishBest = byId('finish-best');
  private readonly sensitivity = byId<HTMLInputElement>('sens');
  private readonly sensitivityValue = byId('sens-value');
  private readonly reduceMotion = byId<HTMLInputElement>('reduce-motion');

  constructor(handlers: MenuHandlers) {
    byId('btn-start').addEventListener('click', () => handlers.onStart());
    byId('btn-controls').addEventListener('click', () => this.showControls(true));
    byId('btn-controls-back').addEventListener('click', () => this.showControls(false));
    byId('btn-resume').addEventListener('click', () => handlers.onResume());
    byId('btn-restart-checkpoint').addEventListener('click', () => handlers.onRestartCheckpoint());
    byId('btn-restart-run').addEventListener('click', () => handlers.onRestartRun());
    byId('btn-finish-restart').addEventListener('click', () => handlers.onFinishRestart());

    this.sensitivity.addEventListener('input', () => {
      const value = Number(this.sensitivity.value);
      this.sensitivityValue.textContent = value.toFixed(1);
      handlers.onSensitivity(value);
    });
    this.reduceMotion.addEventListener('change', () => handlers.onReduceMotion(this.reduceMotion.checked));

    this.sensitivityValue.textContent = Number(this.sensitivity.value).toFixed(1);
    handlers.onSensitivity(Number(this.sensitivity.value));
    handlers.onReduceMotion(this.reduceMotion.checked);
  }

  showMain(): void {
    this.hideAll();
    this.mainOverlay.classList.remove('hidden');
  }

  showPause(): void {
    this.hideAll();
    this.pauseOverlay.classList.remove('hidden');
  }

  showFinish(time: string, best: string): void {
    this.hideAll();
    this.finishTime.textContent = time;
    this.finishBest.textContent = best;
    this.finishOverlay.classList.remove('hidden');
  }

  hideAll(): void {
    this.mainOverlay.classList.add('hidden');
    this.pauseOverlay.classList.add('hidden');
    this.finishOverlay.classList.add('hidden');
    this.showControls(false);
  }

  private showControls(open: boolean): void {
    this.menuMain.classList.toggle('hidden', open);
    this.menuControls.classList.toggle('hidden', !open);
  }
}
