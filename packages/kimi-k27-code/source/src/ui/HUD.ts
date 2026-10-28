import { GameState } from '../game/GameState.js';

export class HUD {
  root: HTMLElement;
  timerEl: HTMLElement;
  hintEl: HTMLElement;
  crosshairEl: HTMLElement;
  checkpointEl: HTMLElement;
  pauseEl: HTMLElement;
  private visible = false;

  constructor(private gameState: GameState, private onResume: () => void, private onRestart: () => void, private onMenu: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.style.display = 'none';

    this.crosshairEl = document.createElement('div');
    this.crosshairEl.className = 'crosshair';

    this.timerEl = document.createElement('div');
    this.timerEl.className = 'timer';
    this.timerEl.textContent = '0:00.00';

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';

    this.checkpointEl = document.createElement('div');
    this.checkpointEl.className = 'checkpoint-toast';
    this.checkpointEl.textContent = 'CHECKPOINT';

    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'pause-menu hidden';
    this.pauseEl.innerHTML = `
      <div class="menu-panel" style="text-align:center">
        <h2 style="margin-bottom:1.5rem; letter-spacing:0.15em">PAUSED</h2>
        <button class="menu-button primary" id="btn-resume">RESUME</button>
        <button class="menu-button" id="btn-restart">RESTART</button>
        <button class="menu-button" id="btn-menu">MAIN MENU</button>
      </div>
    `;

    this.root.appendChild(this.crosshairEl);
    this.root.appendChild(this.timerEl);
    this.root.appendChild(this.hintEl);
    this.root.appendChild(this.checkpointEl);
    this.root.appendChild(this.pauseEl);
    document.getElementById('ui-layer')!.appendChild(this.root);

    this.pauseEl.querySelector('#btn-resume')!.addEventListener('click', () => this.onResume());
    this.pauseEl.querySelector('#btn-restart')!.addEventListener('click', () => this.onRestart());
    this.pauseEl.querySelector('#btn-menu')!.addEventListener('click', () => this.onMenu());

    gameState.onCheckpoint(() => this.showCheckpoint());
  }

  show() {
    this.visible = true;
    this.root.style.display = 'block';
  }

  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }

  update() {
    if (!this.visible) return;
    this.timerEl.textContent = this.gameState.formattedTime;
  }

  setPause(paused: boolean) {
    this.pauseEl.classList.toggle('hidden', !paused);
  }

  setHint(text: string) {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('visible', !!text);
  }

  private checkpointTimeout: any;
  showCheckpoint() {
    this.checkpointEl.classList.add('visible');
    clearTimeout(this.checkpointTimeout);
    this.checkpointTimeout = setTimeout(() => this.checkpointEl.classList.remove('visible'), 1500);
  }
}
