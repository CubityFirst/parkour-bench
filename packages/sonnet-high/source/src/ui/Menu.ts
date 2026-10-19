import { formatTime, saveSettings } from '../game/GameState.ts';
import type { Settings } from '../game/GameState.ts';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

export interface MenuHandlers {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartRun(): void;
  onSettingsChanged(settings: Settings): void;
}

type Screen = 'main' | 'pause' | 'controls' | 'finish';

/** Main menu, pause menu, controls panel, settings and the finish screen (all plain DOM). */
export class Menu {
  private readonly root = el<HTMLElement>('menu');
  private readonly screens: Record<Screen, HTMLElement> = {
    main: el('screen-main'),
    pause: el('screen-pause'),
    controls: el('screen-controls'),
    finish: el('screen-finish'),
  };
  private readonly settings: Settings;
  private readonly handlers: MenuHandlers;
  private controlsReturn: Screen = 'main';

  constructor(settings: Settings, handlers: MenuHandlers) {
    this.settings = settings;
    this.handlers = handlers;

    el('btn-start').addEventListener('click', () => handlers.onStart());
    el('btn-resume').addEventListener('click', () => handlers.onResume());
    el('btn-checkpoint').addEventListener('click', () => handlers.onRestartCheckpoint());
    el('btn-restart-run').addEventListener('click', () => handlers.onRestartRun());
    el('btn-restart').addEventListener('click', () => handlers.onRestartRun());
    el('btn-controls').addEventListener('click', () => this.openControls('main'));
    el('btn-pause-controls').addEventListener('click', () => this.openControls('pause'));
    el('btn-controls-back').addEventListener('click', () => this.show(this.controlsReturn));

    this.bindSettings();
  }

  private openControls(from: Screen): void {
    this.controlsReturn = from;
    this.show('controls');
  }

  private bindSettings(): void {
    const panels = document.querySelectorAll<HTMLElement>('[data-settings]');
    const sync = (): void => {
      panels.forEach((panel) => {
        panel.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((input) => {
          const key = input.dataset.setting as keyof Settings;
          if (input.type === 'checkbox') input.checked = Boolean(this.settings[key]);
          else input.value = String(this.settings[key]);
        });
        panel.querySelectorAll<HTMLElement>('[data-out]').forEach((out) => {
          const key = out.dataset.out as 'sensitivity' | 'volume';
          out.textContent = key === 'volume' ? `${Math.round(this.settings.volume * 100)}%` : this.settings.sensitivity.toFixed(2);
        });
      });
    };
    panels.forEach((panel) => {
      panel.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((input) => {
        input.addEventListener('input', () => {
          const key = input.dataset.setting as keyof Settings;
          const store = this.settings as unknown as Record<string, number | boolean>;
          store[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
          saveSettings(this.settings);
          this.handlers.onSettingsChanged(this.settings);
          sync();
        });
        // Keep keyboard focus out of sliders so Space / WASD never nudge them in game.
        input.addEventListener('change', () => input.blur());
      });
    });
    sync();
  }

  private show(screen: Screen): void {
    this.root.classList.remove('hidden');
    (Object.keys(this.screens) as Screen[]).forEach((k) => this.screens[k].classList.toggle('hidden', k !== screen));
  }

  showMain(best: number | null): void {
    el('main-best').innerHTML = best !== null ? `BEST TIME &nbsp;<b>${formatTime(best)}</b>` : '';
    this.show('main');
  }

  showPause(): void {
    this.show('pause');
  }

  showFinish(time: number, best: number, falls: number, isBest: boolean): void {
    el('finish-time').textContent = formatTime(time);
    el('finish-best').textContent = formatTime(best);
    el('finish-falls').textContent = String(falls);
    el('finish-new-best').classList.toggle('hidden', !isBest);
    this.show('finish');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
