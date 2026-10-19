import { Settings, formatBest, loadSettings, saveSettings } from '../game/GameState';

export interface MenuHandlers {
  onStart: () => void;
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onMainMenu: () => void;
  onFinishRestart: () => void;
  onSettings: (settings: Settings) => void;
}

type Panel = 'menu' | 'controls' | 'pause' | 'finish';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/**
 * Overlay screens: main menu, controls, pause, and finish. Settings persist to localStorage
 * and are pushed to the game through `onSettings` whenever they change.
 */
export class Menu {
  readonly settings: Settings = loadSettings();

  private readonly panels: Record<Panel, HTMLElement> = {
    menu: requireEl('menu'),
    controls: requireEl('controls'),
    pause: requireEl('pause'),
    finish: requireEl('finish'),
  };
  private readonly bestMenu = requireEl<HTMLSpanElement>('best-menu');
  private readonly sens = requireEl<HTMLInputElement>('sens');
  private readonly sensValue = requireEl<HTMLSpanElement>('sens-value');
  private readonly reduceMotion = requireEl<HTMLInputElement>('reduce-motion');
  private readonly finishTime = requireEl<HTMLSpanElement>('finish-time');
  private readonly finishBest = requireEl<HTMLSpanElement>('finish-best');
  private readonly finishNote = requireEl<HTMLParagraphElement>('finish-note');

  constructor(
    private readonly handlers: MenuHandlers,
    bestTimeMs: number | null,
  ) {
    this.sens.value = String(this.settings.sensitivity);
    this.sensValue.textContent = this.settings.sensitivity.toFixed(2);
    this.reduceMotion.checked = this.settings.reduceMotion;
    this.setBest(bestTimeMs);

    requireEl<HTMLButtonElement>('btn-start').addEventListener('click', () => handlers.onStart());
    requireEl<HTMLButtonElement>('btn-controls').addEventListener('click', () => this.show('controls'));
    requireEl<HTMLButtonElement>('btn-controls-back').addEventListener('click', () => this.show('menu'));
    requireEl<HTMLButtonElement>('btn-resume').addEventListener('click', () => handlers.onResume());
    requireEl<HTMLButtonElement>('btn-pause-restart').addEventListener('click', () => handlers.onRestartCheckpoint());
    requireEl<HTMLButtonElement>('btn-pause-menu').addEventListener('click', () => handlers.onMainMenu());
    requireEl<HTMLButtonElement>('btn-finish-restart').addEventListener('click', () => handlers.onFinishRestart());
    requireEl<HTMLButtonElement>('btn-finish-menu').addEventListener('click', () => handlers.onMainMenu());

    this.sens.addEventListener('input', () => {
      this.settings.sensitivity = Number(this.sens.value);
      this.sensValue.textContent = this.settings.sensitivity.toFixed(2);
      this.commit();
    });
    this.reduceMotion.addEventListener('change', () => {
      this.settings.reduceMotion = this.reduceMotion.checked;
      this.commit();
    });

    handlers.onSettings(this.settings);
  }

  /** Shows one panel and hides the rest. Pass 'none' to hide all overlays (during play). */
  show(panel: Panel | 'none'): void {
    for (const key of Object.keys(this.panels) as Panel[]) {
      this.panels[key].classList.toggle('hidden', key !== panel);
    }
  }

  setBest(ms: number | null): void {
    this.bestMenu.textContent = formatBest(ms);
  }

  showFinish(time: string, best: string, isNewBest: boolean): void {
    this.finishTime.textContent = time;
    this.finishBest.textContent = best;
    this.finishNote.textContent = isNewBest ? 'New personal best' : '';
    this.show('finish');
  }

  private commit(): void {
    saveSettings(this.settings);
    this.handlers.onSettings(this.settings);
  }
}
