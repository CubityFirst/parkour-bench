import { formatTime, Settings } from '../game/GameState';
import { requireElement } from './HUD';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onFinishRestart: () => void;
  onSettingsChanged: (settings: Settings) => void;
}

/**
 * Main menu, pause menu and finish screen. All three are plain HTML overlays in index.html.
 * This class only shows and hides them and wires their buttons.
 */
export class Menu {
  private readonly menu = requireElement('menu');
  private readonly mainPanel = requireElement('menu-main');
  private readonly controlsPanel = requireElement('menu-controls');
  private readonly settingsPanel = requireElement('menu-settings');
  private readonly pause = requireElement('pause');
  private readonly finish = requireElement('finish');
  private readonly finishTime = requireElement('finish-time');
  private readonly finishBest = requireElement('finish-best');
  private readonly clickPrompt = requireElement('click-prompt');
  private readonly sensSlider = requireElement<HTMLInputElement>('sens-slider');
  private readonly sensValue = requireElement('sens-value');
  private readonly reduceMotion = requireElement<HTMLInputElement>('reduce-motion');

  constructor(
    callbacks: MenuCallbacks,
    private settings: Settings,
  ) {
    requireElement('btn-start').addEventListener('click', () => callbacks.onStart());
    requireElement('btn-controls').addEventListener('click', () => this.showPanel('controls'));
    requireElement('btn-settings').addEventListener('click', () => this.showPanel('settings'));
    requireElement('btn-controls-back').addEventListener('click', () => this.showPanel('main'));
    requireElement('btn-settings-back').addEventListener('click', () => this.showPanel('main'));

    requireElement('btn-resume').addEventListener('click', () => callbacks.onResume());
    requireElement('btn-pause-restart').addEventListener('click', () => callbacks.onRestart());
    requireElement('btn-pause-menu').addEventListener('click', () => callbacks.onMainMenu());
    requireElement('btn-finish-restart').addEventListener('click', () => callbacks.onFinishRestart());
    requireElement('btn-finish-menu').addEventListener('click', () => callbacks.onMainMenu());

    this.sensSlider.value = String(settings.sensitivity);
    this.reduceMotion.checked = settings.reduceMotion;
    this.updateSensLabel();

    this.sensSlider.addEventListener('input', () => {
      this.settings = { ...this.settings, sensitivity: Number(this.sensSlider.value) };
      this.updateSensLabel();
      callbacks.onSettingsChanged(this.settings);
    });
    this.reduceMotion.addEventListener('change', () => {
      this.settings = { ...this.settings, reduceMotion: this.reduceMotion.checked };
      callbacks.onSettingsChanged(this.settings);
    });
  }

  getSettings(): Settings {
    return this.settings;
  }

  showMain(): void {
    this.hideOverlays();
    this.showPanel('main');
    this.menu.classList.remove('hidden');
  }

  showPause(): void {
    this.pause.classList.remove('hidden');
  }

  hidePause(): void {
    this.pause.classList.add('hidden');
  }

  showFinish(time: number, best: number | null, isNewBest: boolean): void {
    this.finishTime.textContent = formatTime(time);
    this.finishBest.textContent = best === null ? '--' : formatTime(best) + (isNewBest ? '  NEW' : '');
    this.finish.classList.remove('hidden');
  }

  hideFinish(): void {
    this.finish.classList.add('hidden');
  }

  /** Shown while the browser has released the mouse and the player is not paused. */
  setClickPromptVisible(visible: boolean): void {
    this.clickPrompt.classList.toggle('hidden', !visible);
  }

  /** Hides every menu overlay. */
  hideAll(): void {
    this.hideOverlays();
  }

  private hideOverlays(): void {
    this.menu.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
    this.clickPrompt.classList.add('hidden');
  }

  private showPanel(which: 'main' | 'controls' | 'settings'): void {
    this.mainPanel.classList.toggle('hidden', which !== 'main');
    this.controlsPanel.classList.toggle('hidden', which !== 'controls');
    this.settingsPanel.classList.toggle('hidden', which !== 'settings');
  }

  private updateSensLabel(): void {
    this.sensValue.textContent = `${this.settings.sensitivity.toFixed(2)}×`;
  }
}
