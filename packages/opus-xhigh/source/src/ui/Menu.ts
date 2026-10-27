import { formatTime } from '../game/GameState';
import type { CameraMotion, Settings } from '../game/Settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface MenuCallbacks {
  start(): void;
  resume(): void;
  restartCheckpoint(): void;
  restartLevel(): void;
  quit(): void;
  settingsChanged(settings: Settings): void;
  click(): void;
}

type ScreenId = 'loading' | 'menu' | 'pause' | 'finish' | 'error';

/**
 * Menu screens (main, pause, finish) plus the shared Controls and Settings
 * overlays. Pure DOM — the game talks to it through callbacks.
 */
export class Menu {
  private readonly screens: Record<ScreenId, HTMLElement> = {
    loading: $('loading'),
    menu: $('menu'),
    pause: $('pause'),
    finish: $('finish'),
    error: $('error'),
  };
  private readonly controls = $('controls');
  private readonly settingsPanel = $('settings');
  private current: ScreenId = 'loading';

  constructor(
    private readonly settings: Settings,
    private readonly cb: MenuCallbacks,
  ) {
    document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.click();
        this.handleAction(btn.dataset.action ?? '');
      });
    });
    this.bindSettings();
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'start':
        this.cb.start();
        break;
      case 'resume':
        this.cb.resume();
        break;
      case 'restart-checkpoint':
        this.cb.restartCheckpoint();
        break;
      case 'restart-level':
        this.cb.restartLevel();
        break;
      case 'quit':
        this.cb.quit();
        break;
      case 'controls':
        this.controls.classList.remove('hidden');
        break;
      case 'settings':
        this.syncSettings();
        this.settingsPanel.classList.remove('hidden');
        break;
      case 'back':
        this.controls.classList.add('hidden');
        this.settingsPanel.classList.add('hidden');
        break;
    }
  }

  get overlayOpen(): boolean {
    return !this.controls.classList.contains('hidden') || !this.settingsPanel.classList.contains('hidden');
  }

  closeOverlays(): void {
    this.controls.classList.add('hidden');
    this.settingsPanel.classList.add('hidden');
  }

  show(screen: ScreenId | null): void {
    for (const [id, el] of Object.entries(this.screens)) el.classList.toggle('hidden', id !== screen);
    if (screen === null) this.closeOverlays();
    this.current = screen ?? this.current;
  }

  get screen(): ScreenId {
    return this.current;
  }

  setBestTime(best: number | null): void {
    $('menu-best').textContent = best === null ? '—' : formatTime(best);
  }

  setPauseStatus(text: string): void {
    $('pause-status').textContent = text;
  }

  showError(text: string): void {
    $('error-text').textContent = text;
    this.show('error');
  }

  showFinish(opts: { time: number; best: number | null; isBest: boolean; respawns: number; splits: { name: string; time: number; delta?: number }[] }): void {
    $('finish-time').textContent = formatTime(opts.time);
    $('finish-best').textContent = opts.best === null ? '—' : formatTime(opts.best);
    $('finish-respawns').textContent = String(opts.respawns);
    $('finish-badge').classList.toggle('hidden', !opts.isBest);
    const list = $('finish-splits');
    list.innerHTML = '';
    for (const s of opts.splits) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = s.name;
      const value = document.createElement('span');
      value.textContent = formatTime(s.time);
      if (s.delta !== undefined) {
        const d = document.createElement('span');
        d.className = `delta ${s.delta <= 0 ? 'faster' : 'slower'}`;
        d.textContent = `  ${s.delta <= 0 ? '−' : '+'}${Math.abs(s.delta).toFixed(2)}`;
        value.appendChild(d);
      }
      li.append(name, value);
      list.appendChild(li);
    }
    this.show('finish');
  }

  // ------------------------------------------------------------------ settings

  private bindSettings(): void {
    // The settings panel and the main menu's quick settings share the same values.
    for (const id of ['set-sensitivity', 'menu-sensitivity']) {
      const el = $<HTMLInputElement>(id);
      el.addEventListener('input', () => {
        this.settings.sensitivity = Number(el.value);
        this.changed();
      });
    }
    const fov = $<HTMLInputElement>('set-fov');
    const vol = $<HTMLInputElement>('set-volume');
    const invert = $<HTMLInputElement>('set-invert');
    fov.addEventListener('input', () => {
      this.settings.fov = Number(fov.value);
      this.changed();
    });
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value);
      this.changed();
    });
    invert.addEventListener('change', () => {
      this.settings.invertY = invert.checked;
      this.changed();
    });
    for (const id of ['set-motion', 'menu-motion']) {
      $(id)
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((b) =>
          b.addEventListener('click', () => {
            this.settings.cameraMotion = (b.dataset.value as CameraMotion) ?? 'full';
            this.cb.click();
            this.changed();
          }),
        );
    }
    this.syncSettings();
  }

  private changed(): void {
    this.syncSettings();
    this.cb.settingsChanged(this.settings);
  }

  private syncSettings(): void {
    const s = this.settings;
    for (const [input, out] of [
      ['set-sensitivity', 'out-sensitivity'],
      ['menu-sensitivity', 'menu-out-sensitivity'],
    ]) {
      $<HTMLInputElement>(input).value = String(s.sensitivity);
      $(out).textContent = s.sensitivity.toFixed(2);
    }
    $<HTMLInputElement>('set-fov').value = String(s.fov);
    $('out-fov').textContent = `${s.fov}°`;
    $<HTMLInputElement>('set-volume').value = String(s.volume);
    $('out-volume').textContent = `${Math.round(s.volume * 100)}%`;
    $<HTMLInputElement>('set-invert').checked = s.invertY;
    for (const id of ['set-motion', 'menu-motion']) {
      $(id)
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((b) => b.classList.toggle('active', b.dataset.value === s.cameraMotion));
    }
  }
}
