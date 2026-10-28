export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestartRun: () => void;
  onToMenu: () => void;
  onSensitivity: (v: number) => void;
  onCameraMotion: (v: number) => void;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Builds and manages all DOM overlays: main menu, controls, pause and finish. */
export class Menu {
  private main: HTMLElement;
  private controls: HTMLElement;
  private pause: HTMLElement;
  private finish: HTMLElement;

  private finishTimeEl: HTMLElement;
  private finishBestEl: HTMLElement;
  private sensValue: HTMLElement;
  private motionValue: HTMLElement;

  constructor(
    private container: HTMLElement,
    private cb: MenuCallbacks,
    sensitivity: number,
    cameraMotion: number,
  ) {
    // ---- main ----
    this.main = el('div', 'overlay');
    this.main.innerHTML = `
      <div class="backdrop"></div>
      <div class="content">
        <div class="title">ROOFTOP<span class="accent">FLOW</span></div>
        <div class="subtitle">First-person parkour</div>
        <div class="btn-group">
          <button class="btn primary" data-action="start">Start Game</button>
          <button class="btn" data-action="controls">Controls</button>
        </div>
        <div class="setting-row">
          <span>Mouse sensitivity</span>
          <input type="range" min="0.3" max="2.5" step="0.05" data-setting="sens" value="${sensitivity}" />
          <span class="value" data-value="sens">${sensitivity.toFixed(2)}</span>
        </div>
        <div class="setting-row">
          <span>Camera motion</span>
          <input type="range" min="0" max="1" step="0.1" data-setting="motion" value="${cameraMotion}" />
          <span class="value" data-value="motion">${(cameraMotion * 100).toFixed(0)}%</span>
        </div>
      </div>`;

    // ---- controls ----
    this.controls = el('div', 'overlay hidden');
    this.controls.innerHTML = `
      <div class="backdrop"></div>
      <div class="content">
        <div class="title" style="font-size:44px">Controls</div>
        <div class="controls-grid">
          <span class="key">W A S D</span><span class="action">Move</span>
          <span class="key">Mouse</span><span class="action">Look</span>
          <span class="key">Shift</span><span class="action">Sprint</span>
          <span class="key">Space</span><span class="action">Jump (hold for height)</span>
          <span class="key">Ctrl / C</span><span class="action">Slide</span>
          <span class="key">E</span><span class="action">Vault / mantle</span>
          <span class="key">R</span><span class="action">Restart checkpoint</span>
          <span class="key">Esc</span><span class="action">Pause</span>
        </div>
        <div class="panel-note">Wall-run: sprint-jump at a red wall and keep looking along it.</div>
        <div class="btn-group"><button class="btn" data-action="back">Back</button></div>
      </div>`;

    // ---- pause ----
    this.pause = el('div', 'overlay hidden');
    this.pause.innerHTML = `
      <div class="backdrop"></div>
      <div class="content">
        <div class="title" style="font-size:48px">Paused</div>
        <div class="btn-group">
          <button class="btn primary" data-action="resume">Resume</button>
          <button class="btn" data-action="restart">Restart Run</button>
          <button class="btn" data-action="menu">Main Menu</button>
        </div>
      </div>`;

    // ---- finish ----
    this.finish = el('div', 'overlay hidden');
    this.finish.innerHTML = `
      <div class="backdrop"></div>
      <div class="content">
        <div class="badge">Level Complete</div>
        <div class="title" style="font-size:52px">LEVEL COMPLETE</div>
        <div id="finish-time">0:00.00</div>
        <div id="finish-best"></div>
        <div class="btn-group">
          <button class="btn primary" data-action="restart">Run Again</button>
          <button class="btn" data-action="menu">Main Menu</button>
        </div>
      </div>`;

    this.finishTimeEl = this.finish.querySelector('#finish-time') as HTMLElement;
    this.finishBestEl = this.finish.querySelector('#finish-best') as HTMLElement;
    this.sensValue = this.main.querySelector('[data-value="sens"]') as HTMLElement;
    this.motionValue = this.main.querySelector('[data-value="motion"]') as HTMLElement;

    container.append(this.main, this.controls, this.pause, this.finish);
    this.bind();
  }

  private bind(): void {
    this.container.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'start') this.cb.onStart();
      else if (action === 'controls') {
        this.main.classList.add('hidden');
        this.controls.classList.remove('hidden');
      } else if (action === 'back') {
        this.controls.classList.add('hidden');
        this.main.classList.remove('hidden');
      } else if (action === 'resume') this.cb.onResume();
      else if (action === 'restart') this.cb.onRestartRun();
      else if (action === 'menu') this.cb.onToMenu();
    });

    this.container.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const setting = input.dataset.setting;
      if (setting === 'sens') {
        const v = parseFloat(input.value);
        this.sensValue.textContent = v.toFixed(2);
        this.cb.onSensitivity(v);
      } else if (setting === 'motion') {
        const v = parseFloat(input.value);
        this.motionValue.textContent = `${(v * 100).toFixed(0)}%`;
        this.cb.onCameraMotion(v);
      }
    });
  }

  showMain(): void {
    this.hideAll();
    this.main.classList.remove('hidden');
  }

  showPause(): void {
    this.hideAll();
    this.pause.classList.remove('hidden');
  }

  showFinish(time: number, best: number, isNewBest: boolean): void {
    this.hideAll();
    this.finishTimeEl.textContent = this.fmt(time);
    this.finishBestEl.innerHTML = isNewBest
      ? '<b>NEW BEST TIME!</b>'
      : `Best time&nbsp;&nbsp;<b>${this.fmt(best)}</b>`;
    this.finish.classList.remove('hidden');
  }

  hideAll(): void {
    this.main.classList.add('hidden');
    this.controls.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
  }

  private fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t * 100) % 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
}
