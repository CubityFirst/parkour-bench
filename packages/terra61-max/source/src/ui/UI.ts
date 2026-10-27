import { routeZ, sectionFor } from '../world/Level';

export interface Settings {
  sensitivity: number;
  reducedMotion: boolean;
  sound: boolean;
}

export interface UIActions {
  start: () => void;
  resume: () => void;
  restart: () => void;
  settingsChanged: (settings: Settings) => void;
}

export function formatTime(seconds: number): string {
  const totalHundredths = Math.floor(Math.max(0, seconds) * 100 + 0.000001);
  const minutes = Math.floor(totalHundredths / 6000).toString().padStart(2, '0');
  const wholeSeconds = Math.floor(totalHundredths / 100 % 60).toString().padStart(2, '0');
  const hundredths = (totalHundredths % 100).toString().padStart(2, '0');
  return `${minutes}:${wholeSeconds}.${hundredths}`;
}

export class UI {
  readonly settings: Settings = { sensitivity: 1, reducedMotion: false, sound: true };
  private previousScreen: 'intro' | 'pause' = 'intro';
  private toastTimer = 0;
  private lastSection = '';
  private readonly root: HTMLElement;

  constructor(actions: UIActions) {
    this.root = document.createElement('div');
    this.root.id = 'interface';
    this.root.innerHTML = `
      <div id="menu" class="menu-screen">
        <header class="menu-header">
          <div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><span>ROOFTOP<span class="brand-light">FLOW</span><small>AN URBAN TIME TRIAL</small></span></div>
          <div class="header-right"><span>INDEPENDENT RUNNER NETWORK</span><b>RF / 01</b></div>
        </header>
        <main id="intro" class="intro-panel">
          <div class="eyebrow"><span class="red-dash"></span> YOUR CITY. YOUR LINE. <span class="eyebrow-index">/ 01</span></div>
          <h1>FIND YOUR<br><span>FLOW<span class="period">.</span></span></h1>
          <p class="intro-copy">The city is yours to move through.<br>Find the line, trust your momentum, and <strong>keep going.</strong></p>
          <div class="menu-actions"><button id="start" class="primary-button"><span>START RUN</span><span class="button-arrow">↗</span></button><button id="open-controls" class="text-button">CONTROLS <span>↗</span></button></div>
          <div class="intro-meta"><span class="meta-line"></span><span>01 / THE ASCENT</span><span class="meta-dot">●</span><span>TIME TRIAL</span></div>
        </main>
        <div id="intro-side" class="intro-side"><div class="side-rule"></div><span>THE ROUTE</span><strong>UP HERE,<br>YOU'RE FREE.</strong><small>FOLLOW THE RED<br>TO FIND YOUR WAY.</small><div class="side-number">01<span> / 06</span></div></div>
        <div id="settings-panel" class="dialog-panel hidden">
          <div class="eyebrow"><span class="red-dash"></span> FIELD GUIDE / SETTINGS</div>
          <h2>KNOW THE<br><span>MOVE<span class="period">.</span></span></h2>
          <div class="control-grid">
            <div><kbd>W A S D</kbd><span>MOVE</span></div><div><kbd>MOUSE</kbd><span>LOOK</span></div>
            <div><kbd>SHIFT</kbd><span>SPRINT</span></div><div><kbd>SPACE</kbd><span>JUMP / MANTLE</span></div>
            <div><kbd>CTRL / C</kbd><span>SLIDE</span></div><div><kbd>E</kbd><span>VAULT / MANTLE</span></div>
            <div><kbd>R</kbd><span>CHECKPOINT</span></div><div><kbd>ESC</kbd><span>PAUSE</span></div>
          </div>
          <div class="setting-row"><label for="sensitivity">MOUSE SENSITIVITY</label><input id="sensitivity" type="range" min="0.4" max="2" step="0.1" value="1"><output id="sensitivity-value">1.0×</output></div>
          <label class="toggle-row"><span>REDUCE CAMERA MOTION</span><input id="motion" type="checkbox"><span class="switch"></span></label>
          <label class="toggle-row"><span>SOUND EFFECTS</span><input id="sound" type="checkbox" checked><span class="switch"></span></label>
          <button id="settings-back" class="text-button back-button">← &nbsp; BACK</button>
        </div>
        <div id="pause-panel" class="dialog-panel hidden">
          <div class="eyebrow"><span class="red-dash"></span> TAKE A BREATH</div><h2>RUN<br><span>PAUSED<span class="period">.</span></span></h2>
          <p class="dialog-copy">The skyline can wait. Your momentum is right where you left it.</p>
          <div class="stacked-actions"><button id="resume" class="primary-button"><span>RESUME RUN</span><span class="button-arrow">↗</span></button><button id="pause-controls" class="text-button">CONTROLS & SETTINGS &nbsp; ↗</button><button id="pause-restart" class="text-button">RESTART RUN &nbsp; ↗</button></div>
        </div>
        <div id="finish-panel" class="dialog-panel hidden">
          <div class="eyebrow"><span class="red-dash"></span> THE ASCENT / COMPLETE</div><h2>LINE<br><span>COMPLETE<span class="period">.</span></span></h2>
          <p class="dialog-copy">You found your way across. Now make it yours.</p>
          <div class="result-grid"><div><small>YOUR TIME</small><strong id="final-time">00:00.00</strong></div><div><small>PERSONAL BEST</small><strong id="best-time">00:00.00</strong></div></div>
          <button id="restart" class="primary-button"><span>RUN IT AGAIN</span><span class="button-arrow">↗</span></button>
        </div>
        <footer class="menu-footer"><span>DESIGNED FOR MOMENTUM</span><span>© ROOFTOP FLOW &nbsp; / &nbsp; EST. ABOVE THE CITY</span><span>SCROLL THE SKYLINE <b>↗</b></span></footer>
      </div>
      <div id="hud" class="hud hidden">
        <div class="hud-header"><div class="hud-brand"><span class="brand-mark small"><i></i><i></i><i></i></span><span>ROOFTOP<b>FLOW</b></span></div><div class="timer"><small>YOUR TIME</small><strong id="timer">00:00.00</strong></div><div class="hud-chapter"><small>CURRENT SECTION</small><strong><span id="section-number">01</span> / <span id="section-name">THE WARM UP</span></strong></div></div>
        <div class="crosshair"><i></i><i></i></div>
        <div id="toast" class="toast"><span class="toast-icon">✓</span><span><small>CHECKPOINT REACHED</small><strong id="toast-name">THE LEAP</strong></span></div>
        <div class="hud-bottom"><div class="hud-instruction"><span class="instruction-index">↗</span><div><small>RUNNER VISION</small><strong id="hint">HOLD SHIFT TO SPRINT / SPACE TO JUMP</strong></div></div><div class="speed"><span><small>FLOW SPEED</small><strong id="speed">00</strong><em>KM/H</em></span><div class="speed-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div>
        <div class="progress-track"><div id="progress"></div></div><div class="hud-bottom-line"><span>THE ASCENT &nbsp; / &nbsp; 01—06</span><span>ESC TO PAUSE &nbsp; · &nbsp; R TO RESET</span></div>
      </div>`;
    document.body.append(this.root);
    this.element<HTMLButtonElement>('start').addEventListener('click', actions.start);
    this.element<HTMLButtonElement>('resume').addEventListener('click', actions.resume);
    this.element<HTMLButtonElement>('restart').addEventListener('click', actions.restart);
    this.element<HTMLButtonElement>('pause-restart').addEventListener('click', actions.restart);
    this.element<HTMLButtonElement>('open-controls').addEventListener('click', () => this.showSettings('intro'));
    this.element<HTMLButtonElement>('pause-controls').addEventListener('click', () => this.showSettings('pause'));
    this.element<HTMLButtonElement>('settings-back').addEventListener('click', () => this.show(this.previousScreen));
    const sensitivity = this.element<HTMLInputElement>('sensitivity');
    const motion = this.element<HTMLInputElement>('motion');
    const sound = this.element<HTMLInputElement>('sound');
    const updateSettings = () => {
      this.settings.sensitivity = Number(sensitivity.value);
      this.settings.reducedMotion = motion.checked;
      this.settings.sound = sound.checked;
      this.element<HTMLOutputElement>('sensitivity-value').value = `${this.settings.sensitivity.toFixed(1)}×`;
      actions.settingsChanged(this.settings);
    };
    sensitivity.addEventListener('input', updateSettings);
    motion.addEventListener('change', updateSettings);
    sound.addEventListener('change', updateSettings);
  }

  private element<T extends HTMLElement>(id: string): T { return this.root.querySelector<T>(`#${id}`)!; }

  show(screen: 'intro' | 'pause' | 'finish' | 'playing'): void {
    const playing = screen === 'playing';
    this.element('menu').classList.toggle('hidden', playing);
    this.element('hud').classList.toggle('hidden', !playing);
    this.element('intro').classList.toggle('hidden', screen !== 'intro');
    this.element('intro-side').classList.toggle('hidden', screen !== 'intro');
    this.element('settings-panel').classList.add('hidden');
    this.element('pause-panel').classList.toggle('hidden', screen !== 'pause');
    this.element('finish-panel').classList.toggle('hidden', screen !== 'finish');
  }

  private showSettings(previous: 'intro' | 'pause'): void {
    this.previousScreen = previous;
    this.element('intro').classList.add('hidden');
    this.element('intro-side').classList.add('hidden');
    this.element('pause-panel').classList.add('hidden');
    this.element('settings-panel').classList.remove('hidden');
  }

  update(time: number, z: number, speed: number, dt: number, wallRunning: boolean, sliding: boolean): void {
    this.element('timer').textContent = formatTime(time);
    this.element('speed').textContent = Math.round(speed * 3.6).toString().padStart(2, '0');
    const section = sectionFor(z);
    if (this.lastSection !== section.number) {
      this.lastSection = section.number;
      this.element('section-number').textContent = section.number;
      this.element('section-name').textContent = section.name;
    }
    const contextualHint = z < routeZ(-10) && z > routeZ(-17) ? 'PRESS E TO VAULT THE RED BARRIER' :
      z < routeZ(-93) && z > routeZ(-103) ? 'MOVE RIGHT / JUMP BESIDE THE RED WALL' : section.hint;
    this.element('hint').textContent = wallRunning ? 'WALL RUNNING  /  SPACE TO JUMP AWAY' : sliding ? 'STAY LOW  /  SPACE TO JUMP OUT' : contextualHint;
    this.element('progress').style.width = `${Math.max(0, Math.min(100, (7 - z) / (7 - routeZ(-231)) * 100))}%`;
    const bars = this.root.querySelectorAll('.speed-bars i');
    bars.forEach((bar, index) => bar.classList.toggle('lit', index < Math.round(speed / 10.8 * bars.length)));
    this.toastTimer -= dt;
    this.element('toast').classList.toggle('visible', this.toastTimer > 0);
  }

  checkpoint(name: string): void {
    this.element('toast-name').textContent = name;
    this.toastTimer = 2.8;
  }

  finish(time: number, best: number): void {
    this.element('final-time').textContent = formatTime(time);
    this.element('best-time').textContent = formatTime(best);
    this.show('finish');
  }
}
