import { formatTime, type Settings } from '../game/GameState';
import { el } from './HUD';

export interface MenuCallbacks {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartLevel(): void;
  onMainMenu(): void;
  onSettingsChanged(s: Settings): void;
  onClick(): void;
}

const CONTROLS: Array<[string, string]> = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Shift', 'Sprint (hold)'],
  ['Space', 'Jump - hold for full height'],
  ['Ctrl / C', 'Slide while running · crouch'],
  ['E', 'Vault low obstacles'],
  ['Hold W', 'Climb ledges / wall run'],
  ['Space on wall', 'Wall jump'],
  ['R', 'Restart from checkpoint'],
  ['Esc', 'Pause'],
];

/**
 * Main menu, controls panel, pause menu and finish screen (plain DOM).
 */
export class Menu {
  private main: HTMLDivElement;
  private controls: HTMLDivElement;
  private pause: HTMLDivElement;
  private finish: HTMLDivElement;
  private resumeHint: HTMLDivElement;
  private finishTime!: HTMLDivElement;
  private finishBest!: HTMLDivElement;
  private finishNew!: HTMLDivElement;
  private menuBest!: HTMLDivElement;
  private settingsEls: Array<{ sens: HTMLInputElement; sensVal: HTMLSpanElement; motion: HTMLButtonElement; vol: HTMLInputElement }> = [];
  private controlsReturn: HTMLDivElement | null = null;

  constructor(parent: HTMLElement, private settings: Settings, private cb: MenuCallbacks) {
    // ---- Main menu
    this.main = el('div', 'screen main-menu');
    const card = el('div', 'menu-card');
    card.append(
      el('div', 'title', 'ROOFTOP<span>FLOW</span>'),
      el('div', 'subtitle', 'A first-person rooftop run'),
    );
    const startBtn = this.button('START RUN', 'primary', () => cb.onStart());
    const ctrlBtn = this.button('CONTROLS', '', () => this.showControls(this.main));
    card.append(startBtn, ctrlBtn, this.settingsBlock());
    this.menuBest = el('div', 'menu-best');
    card.append(this.menuBest);
    this.main.append(card, el('div', 'menu-footer', 'Best experienced with a mouse · Click START to lock the pointer'));

    // ---- Controls
    this.controls = el('div', 'screen controls hidden');
    const cc = el('div', 'menu-card wide');
    cc.append(el('div', 'panel-title', 'CONTROLS'));
    const grid = el('div', 'controls-grid');
    for (const [k, v] of CONTROLS) grid.append(el('div', 'key', k), el('div', 'desc', v));
    cc.append(grid,
      el('div', 'controls-tip', 'Tip: momentum is everything. Sprint into slides, jump out of slides, and chain wall runs into jumps. Red marks the way.'),
      this.button('BACK', '', () => this.hideControls()));
    this.controls.append(cc);

    // ---- Pause
    this.pause = el('div', 'screen pause hidden');
    const pc = el('div', 'menu-card');
    pc.append(el('div', 'panel-title', 'PAUSED'),
      this.button('RESUME', 'primary', () => cb.onResume()),
      this.button('RESTART CHECKPOINT', '', () => cb.onRestartCheckpoint()),
      this.button('RESTART LEVEL', '', () => cb.onRestartLevel()),
      this.button('CONTROLS', '', () => this.showControls(this.pause)),
      this.settingsBlock(),
      this.button('MAIN MENU', 'ghost', () => cb.onMainMenu()));
    this.pause.append(pc);

    // ---- Finish
    this.finish = el('div', 'screen finish hidden');
    const fc = el('div', 'menu-card');
    this.finishTime = el('div', 'finish-time');
    this.finishBest = el('div', 'finish-best');
    this.finishNew = el('div', 'finish-new', 'NEW BEST');
    fc.append(el('div', 'panel-title big', 'LEVEL COMPLETE'), this.finishTime, this.finishNew, this.finishBest,
      this.button('RESTART', 'primary', () => cb.onRestartLevel()),
      this.button('MAIN MENU', 'ghost', () => cb.onMainMenu()));
    this.finish.append(fc);

    // ---- "Click to resume" when pointer lock could not be re-acquired
    this.resumeHint = el('div', 'screen resume-hint hidden', '<div class="resume-box">CLICK TO CONTINUE</div>');
    this.resumeHint.addEventListener('click', () => cb.onResume());

    parent.append(this.main, this.controls, this.pause, this.finish, this.resumeHint);
    this.syncSettings();
  }

  private button(label: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, label);
    b.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onClick(); fn(); });
    return b;
  }

  private settingsBlock(): HTMLDivElement {
    const wrap = el('div', 'settings');
    const sensRow = el('label', 'setting');
    const sensVal = el('span', 'setting-val');
    const sens = el('input');
    sens.type = 'range'; sens.min = '0.2'; sens.max = '3'; sens.step = '0.05';
    sensRow.append(el('span', 'setting-name', 'Mouse sensitivity'), sens, sensVal);
    sens.addEventListener('input', () => {
      this.settings.sensitivity = Number(sens.value);
      this.syncSettings(); this.cb.onSettingsChanged(this.settings);
    });

    const volRow = el('label', 'setting');
    const vol = el('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05';
    volRow.append(el('span', 'setting-name', 'Volume'), vol, el('span', 'setting-val', ''));
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value);
      this.syncSettings(); this.cb.onSettingsChanged(this.settings);
    });

    const motionRow = el('div', 'setting');
    const motion = el('button', 'toggle');
    motionRow.append(el('span', 'setting-name', 'Camera motion'), motion);
    motion.addEventListener('click', (e) => {
      e.preventDefault();
      this.settings.reducedMotion = !this.settings.reducedMotion;
      this.cb.onClick();
      this.syncSettings(); this.cb.onSettingsChanged(this.settings);
    });
    wrap.append(sensRow, motionRow, volRow);
    this.settingsEls.push({ sens, sensVal, motion, vol });
    return wrap;
  }

  private syncSettings(): void {
    for (const s of this.settingsEls) {
      s.sens.value = String(this.settings.sensitivity);
      s.sensVal.textContent = this.settings.sensitivity.toFixed(2);
      s.vol.value = String(this.settings.volume);
      s.motion.textContent = this.settings.reducedMotion ? 'REDUCED' : 'FULL';
      s.motion.classList.toggle('on', !this.settings.reducedMotion);
    }
  }

  private showControls(from: HTMLDivElement): void {
    this.controlsReturn = from;
    from.classList.add('hidden');
    this.controls.classList.remove('hidden');
  }

  private hideControls(): void {
    this.controls.classList.add('hidden');
    this.controlsReturn?.classList.remove('hidden');
  }

  private hideAll(): void {
    for (const s of [this.main, this.controls, this.pause, this.finish, this.resumeHint]) s.classList.add('hidden');
  }

  showMain(best: number | null): void {
    this.hideAll();
    this.menuBest.textContent = best !== null ? `BEST TIME  ${formatTime(best)}` : '';
    this.main.classList.remove('hidden');
  }

  showPause(): void { this.hideAll(); this.pause.classList.remove('hidden'); }

  showResumeHint(): void { this.hideAll(); this.resumeHint.classList.remove('hidden'); }

  showFinish(time: number, best: number | null, isNew: boolean): void {
    this.hideAll();
    this.finishTime.textContent = formatTime(time);
    this.finishBest.textContent = best !== null ? `BEST  ${formatTime(best)}` : '';
    this.finishNew.style.display = isNew ? 'block' : 'none';
    this.finish.classList.remove('hidden');
  }

  hide(): void { this.hideAll(); }
}
