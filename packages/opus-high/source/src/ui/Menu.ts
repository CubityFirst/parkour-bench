import { formatTime, type Settings } from '../game/GameState';

export interface MenuCallbacks {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartLevel(): void;
  onQuitToMenu(): void;
  onSettingsChanged(s: Settings): void;
  onClick(): void;
}

type Screen = 'menu' | 'controls' | 'pause' | 'finish' | 'none';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Main menu, controls, pause and finish screens plus the shared settings widgets. */
export class Menu {
  private screens: Record<Exclude<Screen, 'none'>, HTMLElement> = {
    menu: $('menu'),
    controls: $('controls'),
    pause: $('pause'),
    finish: $('finish'),
  };
  private controlsReturn: Screen = 'menu';
  current: Screen = 'menu';

  constructor(private settings: Settings, cb: MenuCallbacks) {
    const click = (id: string, fn: () => void) =>
      $(id).addEventListener('click', (e) => {
        e.preventDefault();
        cb.onClick();
        fn();
      });

    click('btn-start', () => cb.onStart());
    click('btn-controls', () => this.openControls('menu'));
    click('btn-pause-controls', () => this.openControls('pause'));
    click('btn-controls-back', () => this.show(this.controlsReturn));
    click('btn-resume', () => cb.onResume());
    click('btn-restart-cp', () => cb.onRestartCheckpoint());
    click('btn-restart', () => cb.onRestartLevel());
    click('btn-quit', () => cb.onQuitToMenu());
    click('btn-finish-restart', () => cb.onRestartLevel());
    click('btn-finish-menu', () => cb.onQuitToMenu());

    // Settings widgets exist in both the main and pause menus; keep them in sync.
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((el) => {
      const key = el.dataset.setting as keyof Settings;
      el.addEventListener('input', () => {
        const s = { ...this.settings };
        if (key === 'motion') s.motion = el.value as Settings['motion'];
        else s[key] = Number(el.value) as never;
        this.settings = s;
        this.syncSettings();
        cb.onSettingsChanged(s);
      });
    });
    this.syncSettings();
  }

  private openControls(from: Screen): void {
    this.controlsReturn = from;
    this.show('controls');
  }

  private syncSettings(): void {
    const s = this.settings;
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((el) => {
      const key = el.dataset.setting as keyof Settings;
      const v = String(s[key]);
      if (el.value !== v) el.value = v;
    });
    document.querySelectorAll<HTMLOutputElement>('[data-out]').forEach((el) => {
      if (el.dataset.out === 'sensitivity') el.textContent = s.sensitivity.toFixed(2);
      if (el.dataset.out === 'volume') el.textContent = `${Math.round(s.volume * 100)}%`;
    });
  }

  show(screen: Screen): void {
    this.current = screen;
    for (const [name, el] of Object.entries(this.screens)) el.classList.toggle('hidden', name !== screen);
  }

  setBest(best: number | null): void {
    $('menu-best').textContent = best === null ? '--:--.--' : formatTime(best);
  }

  showFinish(time: number, best: number | null, record: boolean, respawns: number): void {
    $('finish-time').textContent = formatTime(time);
    $('finish-best').textContent = best === null ? '--:--.--' : formatTime(best);
    $('finish-respawns').textContent = String(respawns);
    $('finish-record').classList.toggle('hidden', !record);
    this.show('finish');
  }

  hideLoading(): void {
    $('loading').classList.add('hidden');
  }
}
