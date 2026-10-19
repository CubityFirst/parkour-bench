import { formatTime, Settings } from '../game/GameState';

export interface MenuCallbacks {
  onStart(): void;
  onResume(): void;
  onRestartCheckpoint(): void;
  onRestartLevel(): void;
  onSettings(s: Partial<Settings>): void;
}

/** Main menu, pause menu and finish screen (plain DOM). */
export class Menu {
  private menu = document.getElementById('menu')!;
  private pause = document.getElementById('pause')!;
  private finish = document.getElementById('finish')!;
  private controls = document.getElementById('controls-panel')!;
  private mainButtons = document.getElementById('menu-main')!;
  private bestLine = document.getElementById('best-line')!;

  constructor(cb: MenuCallbacks, settings: Settings) {
    const $ = (id: string) => document.getElementById(id)!;
    $('btn-start').onclick = () => cb.onStart();
    $('btn-controls').onclick = () => { this.controls.classList.remove('hidden'); this.mainButtons.classList.add('hidden'); };
    $('btn-controls-back').onclick = () => { this.controls.classList.add('hidden'); this.mainButtons.classList.remove('hidden'); };
    $('btn-resume').onclick = () => cb.onResume();
    $('btn-restart-cp').onclick = () => cb.onRestartCheckpoint();
    $('btn-restart-all').onclick = () => cb.onRestartLevel();
    $('btn-finish-restart').onclick = () => cb.onRestartLevel();

    const sliders = Array.from(document.querySelectorAll<HTMLInputElement>('input.sens'));
    const vals = Array.from(document.querySelectorAll<HTMLElement>('.sens-val'));
    const checks = Array.from(document.querySelectorAll<HTMLInputElement>('input.motion'));
    const sync = (s: Settings) => {
      sliders.forEach((e) => { e.value = String(s.sensitivity); });
      vals.forEach((e) => { e.textContent = s.sensitivity.toFixed(2); });
      checks.forEach((e) => { e.checked = s.reduceMotion; });
    };
    sync(settings);
    sliders.forEach((e) => e.addEventListener('input', () => {
      const v = parseFloat(e.value);
      cb.onSettings({ sensitivity: v });
      sync({ ...settings, sensitivity: v, reduceMotion: checks[0].checked });
    }));
    checks.forEach((e) => e.addEventListener('change', () => {
      cb.onSettings({ reduceMotion: e.checked });
      sync({ ...settings, sensitivity: parseFloat(sliders[0].value), reduceMotion: e.checked });
    }));
  }

  showMenu(best: number | null): void {
    this.menu.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
    this.bestLine.innerHTML = best !== null ? `Best time <b>${formatTime(best)}</b>` : '';
  }

  showPause(): void { this.pause.classList.remove('hidden'); }

  showFinish(time: number, best: number, record: boolean): void {
    document.getElementById('fin-time')!.textContent = formatTime(time);
    document.getElementById('fin-best')!.textContent = formatTime(best);
    document.getElementById('fin-record')!.classList.toggle('hidden', !record);
    this.finish.classList.remove('hidden');
  }

  hideAll(): void {
    this.menu.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
  }
}
