import { GameState } from '../game/GameState';

/**
 * Menu — main menu, pause screen, finish screen and settings sync.
 */
export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestartRun: () => void;
  onQuit: () => void;
  onFinishRestart: () => void;
  onFinishQuit: () => void;
}

export class Menu {
  private menuEl = document.getElementById('menu')!;
  private pauseEl = document.getElementById('pause')!;
  private finishEl = document.getElementById('finish')!;

  private btnStart = document.getElementById('btn-start')!;
  private btnControls = document.getElementById('btn-controls')!;
  private controlsPanel = document.getElementById('controls-panel')!;
  private btnResume = document.getElementById('btn-resume')!;
  private btnRestartRun = document.getElementById('btn-restart-run')!;
  private btnQuit = document.getElementById('btn-quit')!;
  private btnFinishRestart = document.getElementById('btn-finish-restart')!;
  private btnFinishMenu = document.getElementById('btn-finish-menu')!;
  private bestMenuEl = document.getElementById('best-time-menu')!;
  private finishTimeEl = document.getElementById('finish-time')!;
  private finishBestEl = document.getElementById('finish-best')!;

  private sensInputs = [document.getElementById('sens') as HTMLInputElement, document.getElementById('p-sens') as HTMLInputElement];
  private sensValues = [document.getElementById('sens-value')!, document.getElementById('p-sens-value')!];
  private motionInputs = [document.getElementById('motion') as HTMLInputElement, document.getElementById('p-motion') as HTMLInputElement];

  constructor(private gameState: GameState, private callbacks: MenuCallbacks) {
    this.btnStart.addEventListener('click', () => callbacks.onStart());
    this.btnControls.addEventListener('click', () => this.controlsPanel.classList.toggle('hidden'));
    this.btnResume.addEventListener('click', () => callbacks.onResume());
    this.btnRestartRun.addEventListener('click', () => callbacks.onRestartRun());
    this.btnQuit.addEventListener('click', () => callbacks.onQuit());
    this.btnFinishRestart.addEventListener('click', () => callbacks.onFinishRestart());
    this.btnFinishMenu.addEventListener('click', () => callbacks.onFinishQuit());

    // settings sync (menu + pause)
    for (let i = 0; i < this.sensInputs.length; i++) {
      const input = this.sensInputs[i];
      input.addEventListener('input', () => {
        this.gameState.settings.sensitivity = parseFloat(input.value);
        this.syncSettings();
      });
      this.motionInputs[i]!.addEventListener('change', () => {
        this.gameState.settings.reduceMotion = this.motionInputs[i]!.checked;
        this.syncSettings();
      });
    }
    this.syncSettings();
    this.refreshBest();
  }

  syncSettings(): void {
    for (let i = 0; i < this.sensInputs.length; i++) {
      this.sensInputs[i].value = String(this.gameState.settings.sensitivity);
      this.sensValues[i].textContent = this.gameState.settings.sensitivity.toFixed(2);
      this.motionInputs[i].checked = this.gameState.settings.reduceMotion;
    }
    this.gameState.saveSettings();
  }

  refreshBest(): void {
    const best = this.gameState.bestTime;
    if (best === null) {
      this.bestMenuEl.innerHTML = 'NO RECORD YET — SET YOUR FIRST TIME';
    } else {
      this.bestMenuEl.innerHTML = `BEST TIME&nbsp; <b>${GameState.formatTime(best)}</b>`;
    }
  }

  showMenu(): void {
    this.refreshBest();
    this.menuEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.finishEl.classList.add('hidden');
  }

  showGame(): void {
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

  showFinish(time: number, best: number | null, isNewRecord: boolean): void {
    this.finishTimeEl.textContent = GameState.formatTime(time);
    if (isNewRecord) {
      this.finishBestEl.innerHTML = `NEW RECORD! (previous: ${best === null ? '—' : GameState.formatTime(best)})`;
    } else {
      this.finishBestEl.innerHTML = best !== null ? `BEST: ${GameState.formatTime(best)}` : '';
    }
    this.finishEl.classList.remove('hidden');
  }
}
