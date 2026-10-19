/**
 * Menu - main menu, controls sheet, pause menu and finish screen.
 * Pure DOM; gameplay is driven through the callbacks the Game supplies.
 */

import { formatTime, type SettingsStore } from '../game/Settings';

export interface MenuCallbacks {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartLevel(): void;
  onQuitToMenu(): void;
  onFinishRestart(): void;
  onClick(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

type Screen = 'loading' | 'menu' | 'controls' | 'pause' | 'finish' | 'none';

export class Menu {
  private readonly screens: Record<Exclude<Screen, 'none'>, HTMLElement> = {
    loading: el('loading'),
    menu: el('menu'),
    controls: el('controls'),
    pause: el('pause'),
    finish: el('finish'),
  };
  private current: Screen = 'loading';
  /** Where "Back" in the controls sheet returns to. */
  private controlsReturn: Screen = 'menu';

  constructor(private readonly settings: SettingsStore, private readonly cb: MenuCallbacks) {
    this.mountSettings(el('menu-settings'));
    this.mountSettings(el('pause-settings'));

    const click = (id: string, fn: () => void): void => {
      el(id).addEventListener('click', () => {
        this.cb.onClick();
        fn();
      });
    };
    click('btn-start', () => this.cb.onStart());
    click('btn-controls', () => { this.controlsReturn = 'menu'; this.show('controls'); });
    click('btn-controls-back', () => this.show(this.controlsReturn));
    click('btn-resume', () => this.cb.onResume());
    click('btn-restart-cp', () => this.cb.onRestartCheckpoint());
    click('btn-restart-level', () => this.cb.onRestartLevel());
    click('btn-pause-controls', () => { this.controlsReturn = 'pause'; this.show('controls'); });
    click('btn-quit', () => this.cb.onQuitToMenu());
    click('btn-finish-restart', () => this.cb.onFinishRestart());
    click('btn-finish-menu', () => this.cb.onQuitToMenu());
  }

  show(screen: Screen): void {
    this.current = screen;
    for (const [name, node] of Object.entries(this.screens)) {
      node.classList.toggle('hidden', name !== screen);
    }
    // Keyboard users can press Enter straight away.
    if (screen === 'menu') el('btn-start').focus({ preventScroll: true });
    else if (screen === 'pause') el('btn-resume').focus({ preventScroll: true });
    // (no auto-focus on the finish screen: a player still mashing Space must not restart by accident)
  }

  get visible(): Screen {
    return this.current;
  }

  setBest(seconds: number | null): void {
    el('menu-best').textContent = seconds === null ? '--:--.--' : formatTime(seconds);
  }

  showFinish(time: number, best: number, newBest: boolean, deaths: number): void {
    el('finish-time').textContent = formatTime(time);
    el('finish-best').textContent = formatTime(best);
    el('finish-badge').classList.toggle('hidden', !newBest);
    el('finish-meta').textContent =
      deaths === 0 ? 'Flawless: no falls.' : `${deaths} ${deaths === 1 ? 'fall' : 'falls'} along the way.`;
    this.show('finish');
  }

  // ---------------------------------------------------------------- settings widgets

  private mountSettings(host: HTMLElement): void {
    const s = this.settings.get();
    host.className = 'settings';
    host.innerHTML = `
      <label class="setting">
        <span>Mouse sensitivity</span>
        <input type="range" data-key="sensitivity" min="0.2" max="3" step="0.05" value="${s.sensitivity}" />
        <output data-out="sensitivity">${s.sensitivity.toFixed(2)}</output>
      </label>
      <label class="setting">
        <span>Volume</span>
        <input type="range" data-key="volume" min="0" max="1" step="0.05" value="${s.volume}" />
        <output data-out="volume">${Math.round(s.volume * 100)}%</output>
      </label>
      <label class="setting toggle">
        <span>Reduce camera motion</span>
        <span class="switch"><input type="checkbox" data-key="reduceMotion" ${s.reduceMotion ? 'checked' : ''} /><span></span></span>
      </label>
    `;

    host.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key as 'sensitivity' | 'volume' | 'reduceMotion';
        if (key === 'reduceMotion') this.settings.update({ reduceMotion: input.checked });
        else this.settings.update({ [key]: Number(input.value) });
      });
      // Keep keyboard focus away from game keys (Space would otherwise toggle controls).
      input.addEventListener('keydown', (e) => e.stopPropagation());
    });

    // Keep every mounted copy in sync.
    this.settings.onChange((next) => {
      host.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
        const key = input.dataset.key as 'sensitivity' | 'volume' | 'reduceMotion';
        if (key === 'reduceMotion') input.checked = next.reduceMotion;
        else input.value = String(next[key]);
      });
      const sens = host.querySelector('[data-out="sensitivity"]');
      const vol = host.querySelector('[data-out="volume"]');
      if (sens) sens.textContent = next.sensitivity.toFixed(2);
      if (vol) vol.textContent = `${Math.round(next.volume * 100)}%`;
    });
  }
}
