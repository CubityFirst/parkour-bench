const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function formatTime(t: number): string {
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export interface Settings { sensitivity: number; motion: 'full' | 'reduced'; }

/** Menus, HUD and overlays (plain DOM). */
export class UI {
  private hud = $('hud');
  private menu = $('menu');
  private pause = $('pause');
  private finish = $('finish');
  private timer = $('timer');
  private toast = $('toast');
  private hint = $('hint');
  private toastTimeout = 0;
  private currentHint = '';
  settings: Settings;

  constructor(handlers: { start: () => void; resume: () => void; restart: () => void; menu: () => void; settings: (s: Settings) => void }) {
    const saved = JSON.parse(localStorage.getItem('rooftopflow.settings') || '{}');
    this.settings = { sensitivity: saved.sensitivity ?? 1, motion: saved.motion ?? 'full' };
    const sens = $<HTMLInputElement>('sens'), sensVal = $('sens-val'), motion = $<HTMLSelectElement>('motion');
    sens.value = String(this.settings.sensitivity);
    sensVal.textContent = this.settings.sensitivity.toFixed(2);
    motion.value = this.settings.motion;
    const save = () => {
      this.settings = { sensitivity: parseFloat(sens.value), motion: motion.value as Settings['motion'] };
      sensVal.textContent = this.settings.sensitivity.toFixed(2);
      localStorage.setItem('rooftopflow.settings', JSON.stringify(this.settings));
      handlers.settings(this.settings);
    };
    sens.addEventListener('input', save);
    motion.addEventListener('change', save);

    $('btn-start').addEventListener('click', handlers.start);
    $('btn-controls').addEventListener('click', () => $('controls').classList.toggle('hidden'));
    $('btn-resume').addEventListener('click', handlers.resume);
    $('btn-restart-p').addEventListener('click', handlers.restart);
    $('btn-restart-f').addEventListener('click', handlers.restart);
    $('btn-menu').addEventListener('click', handlers.menu);
    $('btn-menu-f').addEventListener('click', handlers.menu);
    this.updateBest();
  }

  get best(): number | null {
    const v = localStorage.getItem('rooftopflow.best');
    return v ? parseFloat(v) : null;
  }

  private updateBest() {
    const b = this.best;
    $('menu-best').textContent = b !== null ? `BEST TIME  ${formatTime(b)}` : '';
  }

  show(screen: 'menu' | 'playing' | 'paused' | 'finished') {
    this.menu.classList.toggle('hidden', screen !== 'menu');
    this.pause.classList.toggle('hidden', screen !== 'paused');
    this.finish.classList.toggle('hidden', screen !== 'finished');
    this.hud.classList.toggle('hidden', screen === 'menu');
    if (screen === 'menu') this.updateBest();
  }

  setTime(t: number) { this.timer.textContent = formatTime(t); }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => this.toast.classList.remove('show'), 1800);
  }

  setHint(text: string) {
    if (text === this.currentHint) return;
    this.currentHint = text;
    if (text) this.hint.textContent = text;
    this.hint.classList.toggle('show', !!text);
  }

  /** Shows the finish screen and stores the best time. */
  showFinish(time: number) {
    const prev = this.best;
    const isBest = prev === null || time < prev;
    if (isBest) localStorage.setItem('rooftopflow.best', String(time));
    $('finish-time').textContent = formatTime(time);
    $('finish-best').textContent = isBest ? 'NEW BEST TIME!' : `BEST  ${formatTime(prev!)}`;
    this.show('finished');
  }
}
