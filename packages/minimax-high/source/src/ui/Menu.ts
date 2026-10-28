import { formatTime } from '../core/MathUtil';

export interface Settings {
  sensitivity: number;
  cameraMotion: boolean;
  volume: number;
}

export interface MenuHandlers {
  onStart: () => void;
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onRestartRun: () => void;
  onMainMenu: () => void;
  onSettingsChanged: (settings: Settings) => void;
}

const STORAGE_KEY = 'rooftop-flow-settings';
const BEST_KEY = 'rooftop-flow-best';

/**
 * All of the menu / overlay screens. Keeps the DOM logic in one place so the
 * game loop only has to care about state changes.
 */
export class Menu {
  readonly settings: Settings = { sensitivity: 1, cameraMotion: true, volume: 0.7 };
  bestTime: number | null = null;

  private readonly menu = document.getElementById('menu') as HTMLDivElement;
  private readonly controls = document.getElementById('controls-panel') as HTMLDivElement;
  private readonly pause = document.getElementById('pause') as HTMLDivElement;
  private readonly finish = document.getElementById('finish') as HTMLDivElement;
  private readonly loading = document.getElementById('loading') as HTMLDivElement;

  private readonly sensInput = document.getElementById('opt-sens') as HTMLInputElement;
  private readonly motionInput = document.getElementById('opt-motion') as HTMLInputElement;
  private readonly volumeInput = document.getElementById('opt-volume') as HTMLInputElement;
  private readonly sensOut = document.getElementById('out-sens') as HTMLOutputElement;
  private readonly motionOut = document.getElementById('out-motion') as HTMLOutputElement;
  private readonly volumeOut = document.getElementById('out-volume') as HTMLOutputElement;

  private readonly menuBest = document.getElementById('menu-best') as HTMLElement;
  private readonly pauseTime = document.getElementById('pause-time') as HTMLElement;
  private readonly pauseBest = document.getElementById('pause-best') as HTMLElement;
  private readonly finishTime = document.getElementById('finish-time') as HTMLElement;
  private readonly finishBest = document.getElementById('finish-best') as HTMLElement;
  private readonly finishNote = document.getElementById('finish-note') as HTMLElement;

  constructor(private readonly handlers: MenuHandlers) {
    this.load();

    this.sensInput.addEventListener('input', () => {
      this.settings.sensitivity = parseFloat(this.sensInput.value);
      this.sensOut.textContent = this.settings.sensitivity.toFixed(2);
      this.persist();
    });
    this.motionInput.addEventListener('change', () => {
      this.settings.cameraMotion = this.motionInput.checked;
      this.motionOut.textContent = this.settings.cameraMotion ? 'ON' : 'OFF';
      this.persist();
    });
    this.volumeInput.addEventListener('input', () => {
      this.settings.volume = parseFloat(this.volumeInput.value);
      this.volumeOut.textContent = `${Math.round(this.settings.volume * 100)}%`;
      this.persist();
    });

    (document.getElementById('btn-start') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onStart()
    );
    (document.getElementById('btn-controls') as HTMLButtonElement).addEventListener('click', () =>
      this.showControls()
    );
    (document.getElementById('btn-controls-back') as HTMLButtonElement).addEventListener('click', () =>
      this.hideControls()
    );
    (document.getElementById('btn-resume') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onResume()
    );
    (document.getElementById('btn-checkpoint') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onRestartCheckpoint()
    );
    (document.getElementById('btn-restart-run') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onRestartRun()
    );
    (document.getElementById('btn-quit') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onMainMenu()
    );
    (document.getElementById('btn-again') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onRestartRun()
    );
    (document.getElementById('btn-finish-menu') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onMainMenu()
    );

    this.applySettingsToUI();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        if (typeof parsed.sensitivity === 'number') this.settings.sensitivity = parsed.sensitivity;
        if (typeof parsed.cameraMotion === 'boolean') this.settings.cameraMotion = parsed.cameraMotion;
        if (typeof parsed.volume === 'number') this.settings.volume = parsed.volume;
      }
      const best = localStorage.getItem(BEST_KEY);
      if (best) this.bestTime = parseFloat(best);
    } catch {
      /* storage unavailable - ignore */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.handlers.onSettingsChanged(this.settings);
  }

  private applySettingsToUI(): void {
    this.sensInput.value = String(this.settings.sensitivity);
    this.sensOut.textContent = this.settings.sensitivity.toFixed(2);
    this.motionInput.checked = this.settings.cameraMotion;
    this.motionOut.textContent = this.settings.cameraMotion ? 'ON' : 'OFF';
    this.volumeInput.value = String(this.settings.volume);
    this.volumeOut.textContent = `${Math.round(this.settings.volume * 100)}%`;
    this.refreshBest();
  }

  private refreshBest(): void {
    const text = this.bestTime !== null ? formatTime(this.bestTime) : '--:--.--';
    this.menuBest.textContent = text;
    this.pauseBest.textContent = text;
    this.finishBest.textContent = text;
  }

  setBestTime(time: number): boolean {
    if (this.bestTime !== null && this.bestTime <= time) return false;
    this.bestTime = time;
    try {
      localStorage.setItem(BEST_KEY, String(time));
    } catch {
      /* ignore */
    }
    this.refreshBest();
    return true;
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  hideAll(): void {
    this.menu.classList.add('hidden');
    this.controls.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
  }

  showMain(): void {
    this.hideAll();
    this.refreshBest();
    this.menu.classList.remove('hidden');
  }

  showControls(): void {
    this.menu.classList.add('hidden');
    this.controls.classList.remove('hidden');
  }

  hideControls(): void {
    this.controls.classList.add('hidden');
    this.menu.classList.remove('hidden');
  }

  showPause(time: number): void {
    this.hideAll();
    this.pauseTime.textContent = formatTime(time);
    this.refreshBest();
    this.pause.classList.remove('hidden');
  }

  showFinish(time: number, isNewBest: boolean): void {
    this.hideAll();
    this.finishTime.textContent = formatTime(time);
    this.refreshBest();
    this.finishNote.textContent = isNewBest
      ? 'New personal best.'
      : 'Try to shave a few seconds off your best run.';
    this.finish.classList.remove('hidden');
  }
}
