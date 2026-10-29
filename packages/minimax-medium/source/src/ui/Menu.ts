import { formatTime } from './HUD';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onRestartLevel: () => void;
  onQuit: () => void;
  onSensitivity: (value: number) => void;
  onMotion: (value: number) => void;
  onVolume: (value: number) => void;
}

export interface Settings {
  sensitivity: number;
  motion: number;
  volume: number;
}

const STORAGE_KEY = 'rooftop-flow-settings';
const BEST_KEY = 'rooftop-flow-best';

/** All of the overlay screens (main menu, controls, pause, finish). */
export class Menu {
  private readonly loading: HTMLElement;
  private readonly main: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly finish: HTMLElement;

  settings: Settings = { sensitivity: 1, motion: 1, volume: 0.7 };
  bestTime: number | null = null;

  private readonly sensInputs: HTMLInputElement[] = [];
  private readonly motionInputs: HTMLInputElement[] = [];
  private readonly volumeInputs: HTMLInputElement[] = [];

  constructor(private readonly cb: MenuCallbacks) {
    this.loading = document.getElementById('loading') as HTMLElement;
    this.main = document.getElementById('menu') as HTMLElement;
    this.controls = document.getElementById('controls') as HTMLElement;
    this.pause = document.getElementById('pause') as HTMLElement;
    this.finish = document.getElementById('finish') as HTMLElement;

    this.loadSettings();
    this.loadBest();
    this.wireButtons();
    this.wireSettings();
    this.refreshSettingsUi();
  }

  // ------------------------------------------------------------------
  // setup
  // ------------------------------------------------------------------
  private wireButtons(): void {
    const on = (id: string, fn: () => void) => {
      const el = document.getElementById(id);
      el?.addEventListener('click', fn);
    };

    on('btn-start', () => this.cb.onStart());
    on('btn-controls', () => this.showControls());
    on('btn-controls-back', () => {
      this.controls.classList.add('hidden');
      this.main.classList.remove('hidden');
    });
    on('btn-resume', () => this.cb.onResume());
    on('btn-checkpoint', () => this.cb.onRestartCheckpoint());
    on('btn-restart', () => this.cb.onRestartLevel());
    on('btn-quit', () => this.cb.onQuit());
    on('btn-again', () => this.cb.onRestartLevel());
    on('btn-menu', () => this.cb.onQuit());
  }

  private wireSettings(): void {
    const collect = (
      ids: string[],
      outIds: string[],
      out: HTMLInputElement[],
      apply: (v: number) => void,
      format: (v: number) => string
    ) => {
      ids.forEach((id, i) => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (!input) return;
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          apply(v);
          const outEl = document.getElementById(outIds[i]);
          if (outEl) outEl.textContent = format(v);
          this.saveSettings();
          this.syncSliders();
        });
        out.push(input);
      });
    };

    collect(
      ['opt-sens', 'opt-sens-2'],
      ['opt-sens-val', 'opt-sens-val-2'],
      this.sensInputs,
      (v) => {
        this.settings.sensitivity = v;
        this.cb.onSensitivity(v);
      },
      (v) => v.toFixed(2)
    );

    collect(
      ['opt-motion', 'opt-motion-2'],
      ['opt-motion-val', 'opt-motion-val-2'],
      this.motionInputs,
      (v) => {
        this.settings.motion = v;
        this.cb.onMotion(v);
      },
      (v) => `${Math.round(v * 100)}%`
    );

    collect(
      ['opt-volume', 'opt-volume-2'],
      ['opt-volume-val', 'opt-volume-val-2'],
      this.volumeInputs,
      (v) => {
        this.settings.volume = v;
        this.cb.onVolume(v);
      },
      (v) => `${Math.round(v * 100)}%`
    );
  }

  private syncSliders(): void {
    const set = (list: HTMLInputElement[], v: number) => list.forEach((i) => (i.value = `${v}`));
    set(this.sensInputs, this.settings.sensitivity);
    set(this.motionInputs, this.settings.motion);
    set(this.volumeInputs, this.settings.volume);
    this.refreshSettingsUi();
  }

  private refreshSettingsUi(): void {
    const setOut = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setOut('opt-sens-val', this.settings.sensitivity.toFixed(2));
    setOut('opt-sens-val-2', this.settings.sensitivity.toFixed(2));
    setOut('opt-motion-val', `${Math.round(this.settings.motion * 100)}%`);
    setOut('opt-motion-val-2', `${Math.round(this.settings.motion * 100)}%`);
    setOut('opt-volume-val', `${Math.round(this.settings.volume * 100)}%`);
    setOut('opt-volume-val-2', `${Math.round(this.settings.volume * 100)}%`);

    const best = document.getElementById('menu-best');
    if (best) best.textContent = this.bestTime === null ? '--:--.--' : formatTime(this.bestTime);
  }

  // ------------------------------------------------------------------
  // persistence
  // ------------------------------------------------------------------
  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        this.settings.sensitivity = parsed.sensitivity ?? 1;
        this.settings.motion = parsed.motion ?? 1;
        this.settings.volume = parsed.volume ?? 0.7;
      }
    } catch {
      /* storage unavailable - defaults are fine */
    }
  }

  saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  private loadBest(): void {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (raw) {
        const v = parseFloat(raw);
        if (isFinite(v) && v > 0) this.bestTime = v;
      }
    } catch {
      /* ignore */
    }
  }

  /** @returns true when a new personal best was stored. */
  storeBest(time: number): boolean {
    if (this.bestTime === null || time < this.bestTime) {
      this.bestTime = time;
      try {
        localStorage.setItem(BEST_KEY, `${time}`);
      } catch {
        /* ignore */
      }
      this.refreshSettingsUi();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // screens
  // ------------------------------------------------------------------
  hideAll(): void {
    this.main.classList.add('hidden');
    this.controls.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  showMain(): void {
    this.hideAll();
    this.refreshSettingsUi();
    this.main.classList.remove('hidden');
  }

  showControls(): void {
    this.main.classList.add('hidden');
    this.controls.classList.remove('hidden');
  }

  showPause(time: number, checkpoint: string): void {
    this.hideAll();
    (document.getElementById('pause-time') as HTMLElement).textContent = formatTime(time);
    (document.getElementById('pause-cp') as HTMLElement).textContent = checkpoint;
    (document.getElementById('pause-best') as HTMLElement).textContent =
      this.bestTime === null ? '--:--.--' : formatTime(this.bestTime);
    this.pause.classList.remove('hidden');
  }

  showFinish(time: number): void {
    this.hideAll();
    const isNew = this.storeBest(time);
    (document.getElementById('finish-time') as HTMLElement).textContent = formatTime(time);
    (document.getElementById('finish-best') as HTMLElement).textContent =
      this.bestTime === null ? '--:--.--' : formatTime(this.bestTime);
    document.getElementById('finish-newbest')?.classList.toggle('hidden', !isNew);
    this.finish.classList.remove('hidden');
  }
}
