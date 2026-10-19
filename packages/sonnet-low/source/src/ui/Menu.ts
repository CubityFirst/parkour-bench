import { GameState, formatTime } from '../game/GameState';

export interface MenuHandlers {
  onStart(): void;
  onResume(): void;
  onRestart(): void;
}

const CONTROLS = `
<table>
  <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Move</td></tr>
  <tr><td>Mouse</td><td>Look around</td></tr>
  <tr><td><kbd>Shift</kbd></td><td>Sprint (hold)</td></tr>
  <tr><td><kbd>Space</kbd></td><td>Jump (hold = higher) / wall-jump</td></tr>
  <tr><td><kbd>Ctrl</kbd> / <kbd>C</kbd></td><td>Slide while sprinting</td></tr>
  <tr><td><kbd>E</kbd></td><td>Vault low obstacles</td></tr>
  <tr><td>Wall-run</td><td>Jump beside a red wall, hold <kbd>W</kbd></td></tr>
  <tr><td><kbd>R</kbd></td><td>Restart from checkpoint</td></tr>
  <tr><td><kbd>Esc</kbd></td><td>Pause / release mouse</td></tr>
</table>`;

/** Builds and drives the main menu, pause menu and finish screen. */
export class Menu {
  private overlay = document.getElementById('overlay')!;

  constructor(private state: GameState, private h: MenuHandlers) {}

  private settingsHtml(): string {
    const s = this.state.settings;
    return `
      <div class="setting"><label>Mouse sensitivity</label>
        <input class="sens" type="range" min="0.3" max="3" step="0.05" value="${s.sensitivity}"></div>
      <div class="setting"><label>Reduce camera motion</label>
        <input class="reduce" type="checkbox" ${s.reduceMotion ? 'checked' : ''}></div>`;
  }

  private bindSettings(): void {
    const sens = this.overlay.querySelector<HTMLInputElement>('.sens');
    const red = this.overlay.querySelector<HTMLInputElement>('.reduce');
    sens?.addEventListener('input', () => { this.state.settings.sensitivity = parseFloat(sens.value); this.state.saveSettings(); });
    red?.addEventListener('change', () => { this.state.settings.reduceMotion = red.checked; this.state.saveSettings(); });
  }

  private render(html: string, binds: Record<string, () => void>): void {
    this.overlay.innerHTML = `<div class="panel">${html}</div>`;
    this.overlay.classList.remove('hidden');
    for (const [id, fn] of Object.entries(binds)) {
      this.overlay.querySelector<HTMLElement>(`[data-act="${id}"]`)?.addEventListener('click', fn);
    }
    this.bindSettings();
  }

  hide(): void { this.overlay.classList.add('hidden'); }

  showMain(): void {
    this.render(`
      <h1>ROOFTOP <em>FLOW</em></h1>
      <div class="sub">A rooftop parkour run</div>
      <button data-act="start">Start Game</button>
      <button class="secondary" data-act="controls">Controls</button>
      ${this.settingsHtml()}
      ${this.state.best !== null ? `<div class="sub" style="margin:14px 0 0">Best time ${formatTime(this.state.best)}</div>` : ''}`,
    { start: () => this.h.onStart(), controls: () => this.showControls(() => this.showMain()) });
  }

  showControls(back: () => void): void {
    this.render(`<h2>CONTROLS</h2><div class="controls">${CONTROLS}</div><button data-act="back">Back</button>`, { back });
  }

  showPause(): void {
    this.render(`
      <h2>PAUSED</h2>
      <div class="sub">Mouse released</div>
      <button data-act="resume">Resume</button>
      <button class="secondary" data-act="restart">Restart level</button>
      <button class="secondary" data-act="controls">Controls</button>
      ${this.settingsHtml()}`,
    { resume: () => this.h.onResume(), restart: () => this.h.onRestart(), controls: () => this.showControls(() => this.showPause()) });
  }

  showFinish(time: number, best: number, isNew: boolean): void {
    this.render(`
      <h2>LEVEL COMPLETE</h2>
      <div class="sub">Rooftop Flow</div>
      <div class="stat">Your time<b>${formatTime(time)}</b>${isNew ? '<span class="new">NEW BEST</span>' : ''}</div>
      <div class="stat">Best time<b>${formatTime(best)}</b></div>
      <button data-act="restart" style="margin-top:20px">Restart</button>`,
    { restart: () => this.h.onRestart() });
  }
}
