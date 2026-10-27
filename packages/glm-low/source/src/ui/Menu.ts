/** Menu/pause/finish overlays and settings persistence. */
export interface Settings {
  sensitivity: number;
  cameraMotion: boolean; // true = full motion
}

const BEST_KEY = 'rooftop-flow-best';
const SETTINGS_KEY = 'rooftop-flow-settings';

export class Menu {
  on: ((state: GameState, action?: MenuAction) => void) | null = null;

  els = {
    menu: document.getElementById('menu')!,
    controlsPanel: document.getElementById('controls-panel')!,
    pause: document.getElementById('pause')!,
    finish: document.getElementById('finish')!,
    menuBest: document.getElementById('menu-best')!,
    finishTime: document.getElementById('finish-time')!,
    finishBest: document.getElementById('finish-best')!,
    finishNote: document.getElementById('finish-note')!,
    btnStart: document.getElementById('btn-start')!,
    btnControls: document.getElementById('btn-controls')!,
    btnControlsClose: document.getElementById('btn-controls-close')!,
    btnResetBest: document.getElementById('btn-reset-best')!,
    btnResume: document.getElementById('btn-resume')!,
    btnRestart: document.getElementById('btn-restart')!,
    btnAgain: document.getElementById('btn-again')!,
    sens: document.getElementById('opt-sensitivity')! as HTMLInputElement,
    sensVal: document.getElementById('sensitivity-value')!,
    sensPause: document.getElementById('opt-sensitivity-pause')! as HTMLInputElement,
    sensPauseVal: document.getElementById('sensitivity-value-pause')!,
    cam: document.getElementById('opt-camera-motion')! as HTMLInputElement,
    camVal: document.getElementById('camera-motion-value')!,
    camPause: document.getElementById('opt-camera-motion-pause')! as HTMLInputElement,
    camPauseVal: document.getElementById('camera-motion-value-pause')!,
  };

  settings: Settings;
  onSettings: ((s: Settings) => void) | null = null;

  constructor() {
    this.settings = this.loadSettings();
    this.applySettings(this.settings, false);
    this.bindButtons();
    this.updateMenuBest();
  }

  private loadSettings(): Settings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw) as Settings;
    } catch {
      /* ignore */
    }
    return { sensitivity: 1.0, cameraMotion: true };
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  private applySettings(s: Settings, trigger = true): void {
    this.settings = s;
    this.els.sens.value = String(s.sensitivity);
    this.els.sensVal.textContent = s.sensitivity.toFixed(1);
    this.els.sensPause.value = String(s.sensitivity);
    this.els.sensPauseVal.textContent = s.sensitivity.toFixed(1);
    this.els.cam.checked = s.cameraMotion;
    this.els.camPause.checked = s.cameraMotion;
    this.els.camVal.textContent = s.cameraMotion ? 'Full' : 'Reduced';
    this.els.camPauseVal.textContent = s.cameraMotion ? 'Full' : 'Reduced';
    if (trigger && this.onSettings) this.onSettings(s);
    this.saveSettings();
  }

  private bindButtons(): void {
    const sensHandler = (v: number) => this.applySettings({ ...this.settings, sensitivity: v });
    this.els.sens.addEventListener('input', () => sensHandler(parseFloat(this.els.sens.value)));
    this.els.sensPause.addEventListener('input', () => sensHandler(parseFloat(this.els.sensPause.value)));
    const camHandler = (v: boolean) => this.applySettings({ ...this.settings, cameraMotion: v });
    this.els.cam.addEventListener('change', () => camHandler(this.els.cam.checked));
    this.els.camPause.addEventListener('change', () => camHandler(this.els.camPause.checked));

    this.els.btnStart.addEventListener('click', () => this.on?.('playing', 'start'));
    this.els.btnResume.addEventListener('click', () => this.on?.('playing', 'resume'));
    this.els.btnRestart.addEventListener('click', () => this.on?.('playing', 'restart'));
    this.els.btnAgain.addEventListener('click', () => this.on?.('playing', 'restart'));
    this.els.btnControls.addEventListener('click', () => {
      this.els.menu.classList.add('hidden');
      this.els.controlsPanel.classList.remove('hidden');
    });
    this.els.btnControlsClose.addEventListener('click', () => {
      this.els.controlsPanel.classList.add('hidden');
      this.els.menu.classList.remove('hidden');
    });
    this.els.btnResetBest.addEventListener('click', () => {
      try {
        localStorage.removeItem(BEST_KEY);
      } catch {
        /* ignore */
      }
      this.updateMenuBest();
    });
  }

  getBest(): number | null {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (raw) return parseFloat(raw);
    } catch {
      /* ignore */
    }
    return null;
  }

  submitTime(t: number): { best: number | null; newRecord: boolean } {
    const prev = this.getBest();
    const newRecord = prev === null || t < prev;
    if (newRecord) {
      try {
        localStorage.setItem(BEST_KEY, String(t));
      } catch {
        /* ignore */
      }
    }
    return { best: newRecord ? t : prev, newRecord };
  }

  updateMenuBest(): void {
    const b = this.getBest();
    this.els.menuBest.textContent = b === null ? '—' : formatBest(b);
  }

  showMenu(): void {
    this.hideAll();
    this.updateMenuBest();
    this.els.menu.classList.remove('hidden');
  }

  showPause(): void {
    this.hideAll();
    this.els.pause.classList.remove('hidden');
  }

  showFinish(time: number): void {
    this.hideAll();
    const { best, newRecord } = this.submitTime(time);
    this.els.finishTime.textContent = formatBest(time);
    this.els.finishBest.textContent = best === null ? '—' : formatBest(best);
    this.els.finishNote.textContent = newRecord ? 'New personal best!' : prevNote(best, time);
    this.els.finish.classList.remove('hidden');
    this.updateMenuBest();
  }

  hideAll(): void {
    for (const el of [this.els.menu, this.els.controlsPanel, this.els.pause, this.els.finish]) {
      el.classList.add('hidden');
    }
  }
}

function prevNote(best: number | null, time: number): string {
  if (best === null) return '';
  return `${(time - best).toFixed(2)}s off your best`;
}

export function formatBest(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

export type GameState =
  | 'menu'
  | 'playing'
  | 'paused'
  | 'finish'
  | 'controls';

export type MenuAction = 'start' | 'resume' | 'restart';
