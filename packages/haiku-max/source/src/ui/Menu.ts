import { formatTime } from '../game/GameState';
import type { Settings } from '../game/Settings';

export type ScreenName = 'menu' | 'pause' | 'finish' | 'controls' | 'settings';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onCheckpoint: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettings: (settings: Settings) => void;
}

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

/** Title, pause, finish, controls and settings screens. */
export class Menu {
  private readonly screens: Record<ScreenName, HTMLElement> = {
    menu: element('menu'),
    pause: element('pause'),
    finish: element('finish'),
    controls: element('controls'),
    settings: element('settings'),
  };
  private readonly sensitivity = element('sens') as HTMLInputElement;
  private readonly sensitivityValue = element('sens-value');
  private readonly motionButton = element('motion');
  private readonly soundButton = element('sound');
  private settings: Settings;
  /** Screen to return to from Controls or Settings. */
  private returnTo: ScreenName = 'menu';

  constructor(
    private readonly callbacks: MenuCallbacks,
    settings: Settings,
  ) {
    this.settings = { ...settings };

    element('btn-start').addEventListener('click', () => this.callbacks.onStart());
    element('btn-resume').addEventListener('click', () => this.callbacks.onResume());
    element('btn-checkpoint').addEventListener('click', () => this.callbacks.onCheckpoint());
    element('btn-restart').addEventListener('click', () => this.callbacks.onRestart());
    element('btn-finish-menu').addEventListener('click', () => this.callbacks.onQuit());
    element('btn-quit').addEventListener('click', () => this.callbacks.onQuit());

    document.querySelectorAll<HTMLElement>('[data-open]').forEach((button) => {
      button.addEventListener('click', () => {
        this.returnTo = (button.dataset.from as ScreenName | undefined) ?? 'menu';
        this.show(button.dataset.open as ScreenName);
      });
    });
    document.querySelectorAll<HTMLElement>('[data-back]').forEach((button) => {
      button.addEventListener('click', () => this.show(this.returnTo));
    });

    this.sensitivity.addEventListener('input', () => {
      this.settings = { ...this.settings, sensitivity: Number(this.sensitivity.value) };
      this.emitSettings();
    });
    this.motionButton.addEventListener('click', () => {
      this.settings = { ...this.settings, reducedMotion: !this.settings.reducedMotion };
      this.emitSettings();
    });
    this.soundButton.addEventListener('click', () => {
      this.settings = { ...this.settings, soundOn: !this.settings.soundOn };
      this.emitSettings();
    });

    this.refreshSettings();
  }

  show(name: ScreenName | null): void {
    for (const [key, node] of Object.entries(this.screens) as [ScreenName, HTMLElement][]) {
      node.classList.toggle('hidden', key !== name);
    }
  }

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
    this.refreshSettings();
  }

  setBestTime(seconds: number | null): void {
    element('menu-best').textContent =
      seconds === null ? 'No completed run yet. Six sections, roughly 60 to 120 seconds.' : `Best time ${formatTime(seconds)}`;
  }

  setFinish(time: number, best: number | null, isNewBest: boolean): void {
    element('finish-time').textContent = formatTime(time);
    element('finish-best').textContent = best === null ? '--:--.--' : formatTime(best);
    element('finish-note').textContent = isNewBest ? 'New personal best, saved on this device.' : '';
  }

  private emitSettings(): void {
    this.refreshSettings();
    this.callbacks.onSettings({ ...this.settings });
  }

  private refreshSettings(): void {
    this.sensitivity.value = String(this.settings.sensitivity);
    this.sensitivityValue.textContent = this.settings.sensitivity.toFixed(2);
    this.motionButton.textContent = this.settings.reducedMotion ? 'Reduced' : 'Full';
    this.soundButton.textContent = this.settings.soundOn ? 'On' : 'Off';
  }
}
