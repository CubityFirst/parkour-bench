import { formatTime } from '../game/GameState.ts';
import type { Settings } from '../game/Settings.ts';
import type { Quality } from '../render/RenderPipeline.ts';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export interface MenuHandlers {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartLevel(): void;
  onQuitToMenu(): void;
  onUiClick(): void;
}

type Screen = 'menu' | 'controls' | 'pause' | 'finish' | null;

/** Menu, controls, pause and finish screens plus the shared settings panel. */
export class Menu {
  private readonly screens: Record<Exclude<Screen, null>, HTMLElement> = {
    menu: el('menu'),
    controls: el('controls'),
    pause: el('pause'),
    finish: el('finish'),
  };
  private current: Screen = null;
  private controlsReturn: Screen = 'menu';
  private readonly settings: Settings;
  private readonly handlers: MenuHandlers;
  private readonly rebuilders: Array<() => void> = [];

  constructor(settings: Settings, handlers: MenuHandlers) {
    this.settings = settings;
    this.handlers = handlers;

    this.bind('btn-start', () => handlers.onStart());
    this.bind('btn-controls', () => this.openControls('menu'));
    this.bind('btn-controls-back', () => this.show(this.controlsReturn ?? 'menu'));
    this.bind('btn-resume', () => handlers.onResume());
    this.bind('btn-checkpoint', () => handlers.onRestartCheckpoint());
    this.bind('btn-pause-restart', () => handlers.onRestartLevel());
    this.bind('btn-pause-controls', () => this.openControls('pause'));
    this.bind('btn-pause-menu', () => handlers.onQuitToMenu());
    this.bind('btn-restart', () => handlers.onRestartLevel());
    this.bind('btn-finish-menu', () => handlers.onQuitToMenu());

    this.mountSettings(el('menu-settings'));
    this.mountSettings(el('pause-settings'));
    settings.onChange(() => this.rebuilders.forEach((r) => r()));
  }

  private bind(id: string, fn: () => void): void {
    el(id).addEventListener('click', () => {
      this.handlers.onUiClick();
      fn();
    });
  }

  get visible(): Screen {
    return this.current;
  }

  show(screen: Exclude<Screen, null>): void {
    for (const [k, node] of Object.entries(this.screens)) node.classList.toggle('hidden', k !== screen);
    this.current = screen;
  }

  hideAll(): void {
    for (const node of Object.values(this.screens)) node.classList.add('hidden');
    this.current = null;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }

  openControls(from: Screen): void {
    this.controlsReturn = from === 'pause' ? 'pause' : 'menu';
    this.show('controls');
  }

  setBest(best: number | null): void {
    el('menu-best').textContent = best === null ? '--:--.--' : formatTime(best);
  }

  showFinish(time: number, best: number, falls: number, isBest: boolean): void {
    el('finish-time').textContent = formatTime(time);
    el('finish-best').textContent = formatTime(best);
    el('finish-falls').textContent = String(falls);
    el('finish-new').classList.toggle('hidden', !isBest);
    this.show('finish');
  }

  // ------------------------------------------------------------------------------------------
  // Settings panel
  // ------------------------------------------------------------------------------------------

  private mountSettings(container: HTMLElement): void {
    const build = () => {
      container.innerHTML = '';
      const d = this.settings.data;
      container.appendChild(this.slider('Mouse sensitivity', d.sensitivity, 0.2, 3, 0.05, (v) => `${v.toFixed(2)}x`, (v) => this.settings.set('sensitivity', v)));
      container.appendChild(this.slider('Field of view', d.fov, 70, 110, 1, (v) => `${Math.round(v)}${String.fromCharCode(176)}`, (v) => this.settings.set('fov', v)));
      container.appendChild(
        this.segmented<number>(
          'Camera motion',
          [
            ['Full', 1],
            ['Reduced', 0.35],
            ['Off', 0],
          ],
          d.motion,
          (v) => this.settings.set('motion', v),
        ),
      );
      container.appendChild(this.slider('Volume', d.volume, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => this.settings.set('volume', v)));
      container.appendChild(
        this.segmented<Quality>(
          'Graphics',
          [
            ['High', 'high'],
            ['Medium', 'medium'],
            ['Low', 'low'],
          ],
          d.quality,
          (v) => this.settings.set('quality', v),
        ),
      );
    };
    build();
    this.rebuilders.push(() => {
      // Do not rebuild while the user is dragging a slider inside this container (would drop focus).
      if (container.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
      build();
    });
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    onInput: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('output');
    const paint = () => {
      const v = Number(input.value);
      out.textContent = format(v);
      input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    };
    input.addEventListener('input', () => {
      paint();
      onInput(Number(input.value));
    });
    paint();
    row.append(name, input, out);
    return row;
  }

  private segmented<T extends string | number>(
    label: string,
    options: ReadonlyArray<readonly [string, T]>,
    current: T,
    onPick: (v: T) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting';
    const name = document.createElement('span');
    name.textContent = label;
    const seg = document.createElement('div');
    seg.className = 'seg';
    // Highlight the closest option for numeric values.
    let activeIndex = 0;
    if (typeof current === 'number') {
      let best = Infinity;
      options.forEach(([, v], i) => {
        const dv = Math.abs((v as number) - current);
        if (dv < best) {
          best = dv;
          activeIndex = i;
        }
      });
    } else {
      activeIndex = Math.max(0, options.findIndex(([, v]) => v === current));
    }
    options.forEach(([text, value], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (i === activeIndex) b.classList.add('on');
      b.addEventListener('click', () => {
        this.handlers.onUiClick();
        onPick(value);
      });
      seg.appendChild(b);
    });
    row.append(name, seg);
    return row;
  }
}

