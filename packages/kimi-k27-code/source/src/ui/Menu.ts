import { GameState } from '../game/GameState.js';

export class Menu {
  root: HTMLElement;
  mainScreen: HTMLElement;
  controlsScreen: HTMLElement;
  finishScreen: HTMLElement;

  constructor(
    private gameState: GameState,
    private onStart: () => void,
    private onResume: () => void,
    private onRestart: () => void,
    private onSensitivityChange?: (value: number) => void,
    private onMotionChange?: (value: 'normal' | 'low') => void
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen';
    document.getElementById('ui-layer')!.appendChild(this.root);

    this.mainScreen = document.createElement('div');
    this.mainScreen.className = 'menu-screen';
    this.mainScreen.innerHTML = `
      <div class="menu-title">ROOFTOP FLOW</div>
      <div class="menu-subtitle">First-Person Parkour</div>
      <div class="menu-panel" style="text-align:center">
        <button class="menu-button primary" id="btn-start">START GAME</button>
        <button class="menu-button" id="btn-controls">CONTROLS</button>
        <div class="menu-row" style="justify-content:center; margin-top:1.2rem">
          <label>Sensitivity</label>
          <input type="range" id="sens-slider" min="0.3" max="3" step="0.1" value="1" />
        </div>
        <div class="menu-row" style="justify-content:center">
          <label>Camera Motion</label>
          <select id="motion-select">
            <option value="normal">Normal</option>
            <option value="low">Reduced</option>
          </select>
        </div>
      </div>
    `;

    this.controlsScreen = document.createElement('div');
    this.controlsScreen.className = 'menu-screen hidden';
    this.controlsScreen.innerHTML = `
      <div class="menu-title" style="font-size:2.4rem">CONTROLS</div>
      <div class="menu-panel">
        <div class="controls-list">
          <div class="key">W A S D</div><div>Move</div>
          <div class="key">MOUSE</div><div>Look around</div>
          <div class="key">SHIFT</div><div>Sprint</div>
          <div class="key">SPACE</div><div>Jump</div>
          <div class="key">CTRL / C</div><div>Slide</div>
          <div class="key">E</div><div>Vault / climb</div>
          <div class="key">R</div><div>Restart from checkpoint</div>
          <div class="key">ESC</div><div>Pause / unlock mouse</div>
        </div>
        <div style="text-align:center">
          <button class="menu-button primary" id="btn-back">BACK</button>
        </div>
      </div>
    `;

    this.finishScreen = document.createElement('div');
    this.finishScreen.className = 'finish-screen hidden';
    this.finishScreen.innerHTML = `
      <div class="finish-title">LEVEL COMPLETE</div>
      <div class="finish-time" id="finish-time">Time: 0:00.00</div>
      <div class="finish-best" id="finish-best">Best: --</div>
      <button class="menu-button primary" id="btn-finish-restart">RESTART</button>
      <button class="menu-button" id="btn-finish-menu">MAIN MENU</button>
    `;

    this.root.appendChild(this.mainScreen);
    this.root.appendChild(this.controlsScreen);
    document.getElementById('ui-layer')!.appendChild(this.finishScreen);

    // Events
    this.mainScreen.querySelector('#btn-start')!.addEventListener('click', () => this.onStart());
    this.mainScreen.querySelector('#btn-controls')!.addEventListener('click', () => this.showControls());
    this.controlsScreen.querySelector('#btn-back')!.addEventListener('click', () => this.showMain());
    this.finishScreen.querySelector('#btn-finish-restart')!.addEventListener('click', () => this.onRestart());
    this.finishScreen.querySelector('#btn-finish-menu')!.addEventListener('click', () => this.onMenuFromFinish());

    const sensSlider = this.mainScreen.querySelector('#sens-slider') as HTMLInputElement;
    sensSlider.addEventListener('input', () => {
      const value = parseFloat(sensSlider.value) * 0.002;
      this.gameState.mouseSensitivity = value;
      this.onSensitivityChange?.(value);
    });

    const motionSelect = this.mainScreen.querySelector('#motion-select') as HTMLSelectElement;
    motionSelect.addEventListener('change', () => {
      const value = motionSelect.value as 'normal' | 'low';
      this.gameState.cameraMotion = value;
      this.onMotionChange?.(value);
    });

    gameState.onFinish((time) => this.showFinish(time));
  }

  showMain() {
    this.mainScreen.classList.remove('hidden');
    this.controlsScreen.classList.add('hidden');
    this.finishScreen.classList.add('hidden');
    this.root.classList.remove('hidden');
  }

  showControls() {
    this.mainScreen.classList.add('hidden');
    this.controlsScreen.classList.remove('hidden');
  }

  hideAll() {
    this.root.classList.add('hidden');
    this.finishScreen.classList.add('hidden');
  }

  private showFinish(time: number) {
    const timeStr = this.formatTime(time);
    const bestStr = this.gameState.bestTime === Number.POSITIVE_INFINITY ? '--' : this.formatTime(this.gameState.bestTime);
    this.finishScreen.querySelector('#finish-time')!.textContent = `Time: ${timeStr}`;
    this.finishScreen.querySelector('#finish-best')!.textContent = `Best: ${bestStr}`;
    this.mainScreen.classList.add('hidden');
    this.controlsScreen.classList.add('hidden');
    this.finishScreen.classList.remove('hidden');
    this.root.classList.remove('hidden');
  }

  private onMenuFromFinish() {
    this.finishScreen.classList.add('hidden');
    this.showMain();
  }

  private formatTime(ms: number): string {
    const total = Math.max(0, ms);
    const min = Math.floor(total / 60000);
    const sec = Math.floor((total % 60000) / 1000);
    const cs = Math.floor((total % 1000) / 10);
    return `${min}:${sec.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  }
}
