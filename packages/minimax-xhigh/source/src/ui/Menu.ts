import { formatTime } from '../game/GameState';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onRestartLevel: () => void;
  onMainMenu: () => void;
  onSensitivity: (value: number) => void;
  onMotion: (reduced: boolean) => void;
  onSound: (enabled: boolean) => void;
}

const STORAGE_KEY = 'rooftop-flow.settings.v1';

export interface Settings {
  sensitivity: number;
  reducedMotion: boolean;
  sound: boolean;
}

/** Loads / saves the player settings. */
export function loadSettings(): Settings {
  const fallback: Settings = { sensitivity: 1, reducedMotion: false, sound: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      sensitivity: typeof parsed.sensitivity === 'number' ? parsed.sensitivity : fallback.sensitivity,
      reducedMotion: !!parsed.reducedMotion,
      sound: parsed.sound !== undefined ? !!parsed.sound : fallback.sound,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings simply will not persist */
  }
}

const BEST_KEY = 'rooftop-flow.best.v1';

export function loadBestTime(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const v = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function saveBestTime(time: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(time));
  } catch {
    /* ignore */
  }
}

/** Main menu, pause menu and finish screen. */
export class Menu {
  private menuEl = must('menu');
  private pauseEl = must('pause');
  private finishEl = must('finish');
  private menuPanel = must('menu-panel');
  private settingsEl = must('menu-settings');
  private loadingEl = must('loading');

  private menuBest = must('menu-best');
  private finishTime = must('finish-time');
  private finishBest = must('finish-best');
  private finishRank = must('finish-rank');

  private settings: Settings;
  private activePanel: 'none' | 'controls' | 'settings' = 'none';

  constructor(
    private cb: MenuCallbacks,
    settings: Settings,
  ) {
    this.settings = settings;

    must('btn-start').addEventListener('click', () => this.cb.onStart());
    must('btn-controls').addEventListener('click', () => this.togglePanel('controls'));
    must('btn-resume').addEventListener('click', () => this.cb.onResume());
    must('btn-pause-restart').addEventListener('click', () => this.cb.onRestartCheckpoint());
    must('btn-pause-full').addEventListener('click', () => this.cb.onRestartLevel());
    must('btn-pause-menu').addEventListener('click', () => this.cb.onMainMenu());
    must('btn-finish-restart').addEventListener('click', () => this.cb.onRestartLevel());
    must('btn-finish-menu').addEventListener('click', () => this.cb.onMainMenu());

    this.renderSettingsPanel();
    this.setBest(loadBestTime());
  }

  // ------------------------------------------------------------------
  // Visibility
  // ------------------------------------------------------------------

  hideLoading(): void {
    this.loadingEl.classList.add('hidden');
  }

  showMainMenu(): void {
    this.menuEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.finishEl.classList.add('hidden');
    this.setActivePanel('none', this.menuPanel);
  }

  hideAll(): void {
    this.menuEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.finishEl.classList.add('hidden');
  }

  showPause(): void {
    this.pauseEl.classList.remove('hidden');
  }

  hidePause(): void {
    this.pauseEl.classList.add('hidden');
  }

  showFinish(time: number, best: number): void {
    this.finishEl.classList.remove('hidden');
    this.finishTime.textContent = formatTime(time);
    this.finishBest.textContent = best > 0 ? formatTime(best) : '—';
    this.finishRank.textContent = rankFor(time);
    this.setBest(best);
  }

  setBest(best: number): void {
    this.menuBest.textContent = best > 0 ? `BEST ${formatTime(best)}` : 'BEST —';
  }

  // ------------------------------------------------------------------
  // Panels
  // ------------------------------------------------------------------

  private togglePanel(which: 'controls' | 'settings'): void {
    this.setActivePanel(this.activePanel === which ? 'none' : which, this.menuPanel);
  }

  private setActivePanel(which: 'none' | 'controls' | 'settings', host: HTMLElement): void {
    this.activePanel = which;
    if (which === 'none') {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }
    host.classList.remove('hidden');
    host.innerHTML = which === 'controls' ? CONTROLS_HTML : this.settingsHtml();
    if (which === 'settings') this.bindSettings(host);
  }

  private settingsHtml(): string {
    const s = this.settings;
    return `
      <div class="setting">
        <span class="setting-label">Mouse sensitivity</span>
        <input id="opt-sens" type="range" min="0.2" max="2.5" step="0.05" value="${s.sensitivity}" />
        <span id="opt-sens-val" class="setting-value">${s.sensitivity.toFixed(2)}</span>
      </div>
      <div class="setting">
        <span class="setting-label">Reduced camera motion</span>
        <div id="opt-motion" class="toggle ${s.reducedMotion ? 'on' : ''}"></div>
      </div>
      <div class="setting">
        <span class="setting-label">Sound</span>
        <div id="opt-sound" class="toggle ${s.sound ? 'on' : ''}"></div>
      </div>
    `;
  }

  private bindSettings(host: HTMLElement): void {
    const sens = host.querySelector<HTMLInputElement>('#opt-sens');
    const sensVal = host.querySelector<HTMLElement>('#opt-sens-val');
    sens?.addEventListener('input', () => {
      this.settings.sensitivity = parseFloat(sens.value);
      if (sensVal) sensVal.textContent = this.settings.sensitivity.toFixed(2);
      saveSettings(this.settings);
      this.cb.onSensitivity(this.settings.sensitivity);
    });

    const motion = host.querySelector<HTMLElement>('#opt-motion');
    motion?.addEventListener('click', () => {
      this.settings.reducedMotion = !this.settings.reducedMotion;
      motion.classList.toggle('on', this.settings.reducedMotion);
      saveSettings(this.settings);
      this.cb.onMotion(this.settings.reducedMotion);
    });

    const sound = host.querySelector<HTMLElement>('#opt-sound');
    sound?.addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      sound.classList.toggle('on', this.settings.sound);
      saveSettings(this.settings);
      this.cb.onSound(this.settings.sound);
    });
  }

  /** The settings live directly on the main menu. */
  private renderSettingsPanel(): void {
    this.settingsEl.innerHTML = this.settingsHtml();
    this.bindSettings(this.settingsEl);
  }
}

const CONTROLS_HTML = `
  <dl class="key-table">
    <dt>W A S D</dt><dd>Move</dd>
    <dt>MOUSE</dt><dd>Look around</dd>
    <dt>SHIFT</dt><dd>Sprint</dd>
    <dt>SPACE</dt><dd>Jump (hold for height)</dd>
    <dt>CTRL / C</dt><dd>Slide</dd>
    <dt>E</dt><dd>Vault</dd>
    <dt>R</dt><dd>Restart from checkpoint</dd>
    <dt>ESC</dt><dd>Pause</dd>
  </dl>
`;

function rankFor(time: number): string {
  if (time <= 60) return 'RANK · S — FLOW MASTER';
  if (time <= 85) return 'RANK · A — FAST';
  if (time <= 120) return 'RANK · B — CLEAN';
  return 'RANK · C — FINISHED';
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
