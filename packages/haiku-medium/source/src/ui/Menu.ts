import { Settings } from '../game/GameState';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onPauseRestart: () => void;
  onPauseMenu: () => void;
  onFinishRestart: () => void;
  onFinishMenu: () => void;
  onSettingsChange: (settings: Settings) => void;
}

/**
 * Menu, pause, and finish overlays, plus the controls and settings sub-panels.
 * Each overlay is a plain DOM node from index.html that is shown or hidden here.
 */
export class Menu {
  private readonly main = el<HTMLDivElement>('menu');
  private readonly controls = el<HTMLDivElement>('controls-panel');
  private readonly settings = el<HTMLDivElement>('settings-panel');
  private readonly buttons = el<HTMLDivElement>('menu').querySelector('.menu-buttons') as HTMLDivElement;
  private readonly pause = el<HTMLDivElement>('pause');
  private readonly finish = el<HTMLDivElement>('finish');
  private readonly clickPrompt = el<HTMLDivElement>('click-prompt');
  private readonly sensSlider = el<HTMLInputElement>('sens-slider');
  private readonly sensValue = el<HTMLElement>('sens-value');
  private readonly reduceMotion = el<HTMLInputElement>('reduce-motion');

  private current: Settings;

  constructor(initial: Settings, private readonly cb: MenuCallbacks) {
    this.current = { ...initial };
    this.sensSlider.value = String(initial.sensitivity);
    this.reduceMotion.checked = initial.reduceMotion;
    this.refreshSensLabel();

    el<HTMLButtonElement>('btn-start').addEventListener('click', () => cb.onStart());
    el<HTMLButtonElement>('btn-controls').addEventListener('click', () => this.showSub('controls'));
    el<HTMLButtonElement>('btn-settings').addEventListener('click', () => this.showSub('settings'));
    el<HTMLButtonElement>('btn-controls-back').addEventListener('click', () => this.showSub(null));
    el<HTMLButtonElement>('btn-settings-back').addEventListener('click', () => this.showSub(null));

    this.sensSlider.addEventListener('input', () => {
      this.current.sensitivity = Number(this.sensSlider.value);
      this.refreshSensLabel();
      this.emitSettings();
    });
    this.reduceMotion.addEventListener('change', () => {
      this.current.reduceMotion = this.reduceMotion.checked;
      this.emitSettings();
    });

    el<HTMLButtonElement>('btn-resume').addEventListener('click', () => cb.onResume());
    el<HTMLButtonElement>('btn-pause-restart').addEventListener('click', () => cb.onPauseRestart());
    el<HTMLButtonElement>('btn-pause-menu').addEventListener('click', () => cb.onPauseMenu());
    el<HTMLButtonElement>('btn-restart').addEventListener('click', () => cb.onFinishRestart());
    el<HTMLButtonElement>('btn-finish-menu').addEventListener('click', () => cb.onFinishMenu());
  }

  get settingsValue(): Settings {
    return { ...this.current };
  }

  showMain(): void {
    this.hideOverlays();
    this.main.classList.remove('hidden');
    this.showSub(null);
  }

  showPause(): void {
    this.pause.classList.remove('hidden');
  }

  showFinish(): void {
    this.finish.classList.remove('hidden');
  }

  showClickPrompt(visible: boolean): void {
    this.clickPrompt.classList.toggle('hidden', !visible);
  }

  /** Hides every menu overlay. The HUD is shown separately. */
  hideOverlays(): void {
    this.main.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
    this.clickPrompt.classList.add('hidden');
  }

  private showSub(which: 'controls' | 'settings' | null): void {
    this.buttons.classList.toggle('hidden', which !== null);
    this.controls.classList.toggle('hidden', which !== 'controls');
    this.settings.classList.toggle('hidden', which !== 'settings');
  }

  private refreshSensLabel(): void {
    this.sensValue.textContent = `(${this.current.sensitivity.toFixed(2)}x)`;
  }

  private emitSettings(): void {
    this.cb.onSettingsChange({ ...this.current });
  }
}
