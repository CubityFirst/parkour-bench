import { formatTime } from '../game/GameState.ts';
import type { CameraMotion, Settings } from '../game/Settings.ts';

export interface MenuCallbacks {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartRun(): void;
  onQuitToMenu(): void;
  onSettingsChange(settings: Settings): void;
  onClick(): void;
}

export interface FinishInfo {
  time: number;
  best: number | null;
  newBest: boolean;
  splits: { name: string; time: number; delta: number | null }[];
  respawns: number;
}

type ScreenName = 'main' | 'controls' | 'settings' | 'pause' | 'finish';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look around'],
  ['Shift', 'Sprint (hold)'],
  ['Space', 'Jump (hold for higher) / vault while running at an obstacle'],
  ['C / Ctrl', 'Slide while running, crouch when slow'],
  ['E', 'Vault / grab the zipline'],
  ['R', 'Restart from the last checkpoint'],
  ['Esc', 'Pause and release the mouse'],
];

/** All full-screen menus. Built once; screens are shown and hidden by class. */
export class Menu {
  private readonly root: HTMLElement;
  private readonly screens = new Map<ScreenName, HTMLElement>();
  private readonly cb: MenuCallbacks;
  private settings: Settings;
  private current: ScreenName | null = null;
  private returnTo: ScreenName = 'main';
  private shownAt = 0;
  /** Re-sync every settings control (the main menu and settings screen share values). */
  private readonly refreshers: (() => void)[] = [];

  constructor(parent: HTMLElement, settings: Settings, callbacks: MenuCallbacks) {
    this.settings = { ...settings };
    this.cb = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);

    this.screens.set('main', this.buildMain());
    this.screens.set('controls', this.buildControls());
    this.screens.set('settings', this.buildSettings());
    this.screens.set('pause', this.buildPause());
    this.screens.set('finish', this.buildFinish());
    for (const el of this.screens.values()) {
      el.classList.add('hidden');
      this.root.appendChild(el);
    }
    window.addEventListener('keydown', this.onKey);
  }

  /** Updates the controls after the game changed a setting itself (e.g. auto quality). */
  syncSettings(settings: Settings): void {
    Object.assign(this.settings, settings);
    for (const r of this.refreshers) r();
  }

  get visible(): boolean {
    return this.current !== null;
  }

  showMain(best: number | null): void {
    const el = this.screens.get('main')!;
    const line = el.querySelector<HTMLElement>('[data-best]')!;
    line.innerHTML = best !== null ? `Best run <b>${formatTime(best)}</b>` : 'No best time yet';
    this.show('main');
  }

  showPause(): void {
    this.show('pause');
  }

  showFinish(info: FinishInfo): void {
    const el = this.screens.get('finish')!;
    el.querySelector<HTMLElement>('[data-time]')!.textContent = formatTime(info.time);
    const best = el.querySelector<HTMLElement>('[data-best]')!;
    best.innerHTML = info.newBest
      ? `New best time<span class="badge">RECORD</span>`
      : `Best ${info.best !== null ? formatTime(info.best) : '--:--.--'}`;
    const rows = info.splits
      .map((s) => {
        let delta = '';
        if (s.delta !== null) {
          const sign = s.delta <= 0 ? '-' : '+';
          delta = `<span class="${s.delta <= 0 ? 'faster' : 'slower'}">${sign}${Math.abs(s.delta).toFixed(2)}</span>`;
        } else {
          delta = '<span></span>';
        }
        return `<div><span>${s.name}</span><span>${formatTime(s.time)}</span>${delta}</div>`;
      })
      .join('');
    el.querySelector<HTMLElement>('[data-splits]')!.innerHTML = rows;
    el.querySelector<HTMLElement>('[data-respawns]')!.textContent =
      info.respawns === 0 ? 'Clean run: no respawns' : `${info.respawns} respawn${info.respawns === 1 ? '' : 's'}`;
    this.show('finish');
  }

  hide(): void {
    for (const el of this.screens.values()) el.classList.add('hidden');
    this.current = null;
  }

  private show(name: ScreenName): void {
    for (const r of this.refreshers) r();
    for (const [n, el] of this.screens) el.classList.toggle('hidden', n !== name);
    this.current = name;
    this.shownAt = performance.now();
    const first = this.screens.get(name)!.querySelector<HTMLButtonElement>('button.primary, button');
    // Focus the main action for keyboard users (without scrolling or showing a ring on mouse use).
    first?.focus({ preventScroll: true });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || !this.current) return;
    // The Esc that released the pointer lock can arrive right after the pause screen opens.
    if (performance.now() - this.shownAt < 350) return;
    if (this.current === 'pause') this.cb.onResume();
    else if (this.current === 'controls' || this.current === 'settings') this.back();
  };

  private back(): void {
    this.cb.onClick();
    this.show(this.returnTo);
  }

  private button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn primary' : 'btn';
    b.textContent = label;
    b.addEventListener('click', () => {
      this.cb.onClick();
      onClick();
    });
    return b;
  }

  private screen(kind: 'menu-screen' | 'dim'): [HTMLElement, HTMLElement] {
    const el = document.createElement('div');
    el.className = `screen ${kind}`;
    const panel = document.createElement('div');
    panel.className = 'panel';
    el.appendChild(panel);
    return [el, panel];
  }

  private buildMain(): HTMLElement {
    const [el, panel] = this.screen('menu-screen');
    panel.insertAdjacentHTML(
      'beforeend',
      `<h1 class="title">ROOF<span class="accent">LINE</span></h1>
       <div class="title-bar"></div>
       <p class="subtitle">Rooftop parkour run</p>`,
    );
    panel.append(
      this.button('Start Run', () => this.cb.onStart(), true),
      this.button('Controls', () => this.openSub('controls', 'main')),
      this.button('Settings', () => this.openSub('settings', 'main')),
    );
    // Quick access to the two settings players most often need before a run.
    const quick = document.createElement('div');
    quick.className = 'quick-settings';
    const s = this.settings;
    this.slider(quick, 'Mouse sensitivity', 0.1, 4, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v), (v) => v.toFixed(2));
    this.segmented<CameraMotion>(quick, 'Camera motion', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']], () => s.cameraMotion, (v) => (s.cameraMotion = v));
    panel.appendChild(quick);
    panel.insertAdjacentHTML(
      'beforeend',
      `<div class="best-line" data-best></div>
       <div class="menu-foot">Sprint, vault, slide and wall-run across the rooftops.
       Follow the red. Reach the finish gate as fast as you can.</div>`,
    );
    return el;
  }

  private buildControls(): HTMLElement {
    const [el, panel] = this.screen('dim');
    const rows = CONTROLS.map(([k, d]) => {
      const keys = k
        .split(' / ')
        .map((part) => `<span class="key">${part}</span>`)
        .join(' ');
      return `<div>${keys}</div><div class="desc">${d}</div>`;
    }).join('');
    panel.insertAdjacentHTML(
      'beforeend',
      `<h2 class="heading">Controls</h2>
       <div class="controls">${rows}</div>
       <p class="tip">Wall run: jump at a wall at a shallow angle while sprinting and keep holding W.
       Ledges: if a jump comes up short, hold W into the ledge to climb.
       Keep moving: landing into a slide (hold C) keeps all your speed.</p>`,
    );
    panel.append(this.button('Back', () => this.back(), true));
    return el;
  }

  private buildSettings(): HTMLElement {
    const [el, panel] = this.screen('dim');
    panel.insertAdjacentHTML('beforeend', `<h2 class="heading">Settings</h2>`);
    const s = this.settings;
    this.slider(panel, 'Sensitivity', 0.1, 4, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v), (v) => v.toFixed(2));
    this.slider(panel, 'Field of view', 70, 120, 1, () => s.fov, (v) => (s.fov = v), (v) => `${v}`);
    this.slider(panel, 'Volume', 0, 1, 0.05, () => s.volume, (v) => (s.volume = v), (v) => `${Math.round(v * 100)}`);
    this.segmented<CameraMotion>(panel, 'Camera motion', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']], () => s.cameraMotion, (v) => (s.cameraMotion = v));
    this.segmented<'on' | 'off'>(panel, 'Invert Y', [['off', 'Off'], ['on', 'On']], () => (s.invertY ? 'on' : 'off'), (v) => (s.invertY = v === 'on'));
    this.segmented<'on' | 'off'>(panel, 'Auto sprint', [['off', 'Off'], ['on', 'On']], () => (s.autoSprint ? 'on' : 'off'), (v) => (s.autoSprint = v === 'on'));
    this.segmented<'on' | 'off'>(panel, 'Hints', [['on', 'On'], ['off', 'Off']], () => (s.hints ? 'on' : 'off'), (v) => (s.hints = v === 'on'));
    this.segmented<'high' | 'low'>(panel, 'Graphics', [['high', 'High'], ['low', 'Low']], () => s.quality, (v) => (s.quality = v));

    const back = this.button('Back', () => this.back(), true);
    back.style.marginTop = '14px';
    panel.appendChild(back);
    return el;
  }

  /** A labelled range input bound to a setting. */
  private slider(parent: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): void {
    const row = document.createElement('label');
    row.className = 'setting';
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    const refresh = () => {
      input.value = String(get());
      out.textContent = fmt(get());
    };
    refresh();
    this.refreshers.push(refresh);
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = fmt(Number(input.value));
      this.cb.onSettingsChange({ ...this.settings });
    });
    parent.appendChild(row);
  }

  /** A labelled row of toggle buttons bound to a setting. */
  private segmented<T extends string>(parent: HTMLElement, label: string, options: [T, string][], get: () => T, set: (v: T) => void): void {
    const row = document.createElement('div');
    row.className = 'setting';
    row.innerHTML = `<span>${label}</span>`;
    const seg = document.createElement('div');
    seg.className = 'seg';
    const buttons = options.map(([value, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', () => {
        set(value);
        refresh();
        this.cb.onClick();
        this.cb.onSettingsChange({ ...this.settings });
      });
      return b;
    });
    const refresh = () => buttons.forEach((x, i) => x.classList.toggle('on', options[i][0] === get()));
    refresh();
    this.refreshers.push(refresh);
    seg.append(...buttons);
    row.appendChild(seg);
    parent.appendChild(row);
  }

  private buildPause(): HTMLElement {
    const [el, panel] = this.screen('dim');
    panel.insertAdjacentHTML('beforeend', `<h2 class="heading">Paused</h2>`);
    panel.append(
      this.button('Resume', () => this.cb.onResume(), true),
      this.button('Restart from checkpoint', () => this.cb.onRestartCheckpoint()),
      this.button('Restart level', () => this.cb.onRestartRun()),
      this.button('Settings', () => this.openSub('settings', 'pause')),
      this.button('Controls', () => this.openSub('controls', 'pause')),
      this.button('Main menu', () => this.cb.onQuitToMenu()),
    );
    return el;
  }

  private buildFinish(): HTMLElement {
    const [el, panel] = this.screen('dim');
    panel.insertAdjacentHTML(
      'beforeend',
      `<h2 class="heading" style="color: var(--red)">Level complete</h2>
       <div class="finish-time" data-time></div>
       <div class="finish-best" data-best></div>
       <div class="splits" data-splits></div>
       <div class="tip" data-respawns></div>`,
    );
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.append(this.button('Restart', () => this.cb.onRestartRun(), true), this.button('Menu', () => this.cb.onQuitToMenu()));
    panel.appendChild(row);
    return el;
  }

  private openSub(name: 'controls' | 'settings', from: ScreenName): void {
    this.returnTo = from;
    this.show(name);
  }
}
