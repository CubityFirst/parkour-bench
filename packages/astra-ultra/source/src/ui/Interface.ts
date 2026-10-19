export interface Settings { sensitivity: number; reducedMotion: boolean; volume: number }

export const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const rest = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${rest}`;
};

const mark = `<svg viewBox="0 0 36 40" aria-hidden="true"><path d="M2 34 14 6h10L12 34zm17 0 5-12h10l-5 12z" fill="currentColor"/></svg>`;
const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>`;
const gear = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 3-.5 3-2.5 1-2.5-1.5-2 3L4 11v3l-2 2 2 3 3-1 2 1 .5 3h4l.5-3 2-1 3 1 2-3-2-2v-3l2-2-2-3L16 7l-2-1-.5-3z" transform="translate(1 -1) scale(.9)"/><circle cx="12" cy="11.5" r="3"/></svg>`;

export class Interface {
  readonly settings: Settings;
  onStart = () => {};
  onResume = () => {};
  onRestart = () => {};
  onMenu = () => {};
  onSettings = (_settings: Settings) => {};
  private root: HTMLElement;
  private toastTimeout = 0;
  private previousMode = 'menu';

  constructor(root: HTMLElement) {
    this.root = root;
    let saved: Partial<Settings> = {};
    try { saved = JSON.parse(localStorage.getItem('redline.settings') || '{}'); } catch { /* Storage is optional. */ }
    this.settings = {
      sensitivity: typeof saved.sensitivity === 'number' ? Math.max(.2, Math.min(2, saved.sensitivity)) : 1,
      reducedMotion: saved.reducedMotion === true,
      volume: typeof saved.volume === 'number' ? Math.max(0, Math.min(1, saved.volume)) : .45,
    };
    root.innerHTML = `
      <div class="menu-wash" id="menu-wash"></div>
      <header class="brand-header" id="brand-header">
        <a class="wordmark" href="#" aria-label="Redline home">${mark}<span>REDLINE</span></a>
        <span class="brand-caption">ROOFTOP<br>PARKOUR</span>
        <div class="header-right"><span class="live-dot"></span><span>THE UPPER DISTRICT</span><span class="header-coordinate">35° 41′ N / 139° 41′ E</span></div>
      </header>
      <main class="main-menu" id="main-menu">
        <div class="hero-copy">
          <div class="eyebrow"><span></span> A DIFFERENT WAY THROUGH</div>
          <h1>ABOVE<br>THE NOISE<span>.</span></h1>
          <p>The city is your playground.<br>Find your flow. Leave the streets behind.</p>
          <div class="hero-actions"><button id="start" class="button primary"><span>START RUN</span>${arrow}</button><button id="controls" class="controls-button"><span class="key-icon">⌘</span> HOW TO PLAY</button></div>
          <div class="play-note"><span class="mini-dot"></span> FIRST-PERSON PARKOUR <span class="note-separator">/</span> PLAY AT YOUR PACE</div>
        </div>
        <div class="scene-label"><span class="scene-cross">+</span><div><span class="scene-number">01 / 06</span><strong>THE ROOFTOPS</strong><span>YOUR RUN STARTS HERE</span></div><span class="scene-rule"></span></div>
        <section class="route-card" aria-label="Course overview">
          <div class="route-title"><span class="eyebrow-small">FEATURED ROUTE</span><h2>The upper district <span>↗</span></h2><p>640 meters above the everyday.</p></div>
          <div class="route-path"><div class="route-stations"><span class="route-stop active"><i></i><b>01</b></span><span class="route-stop"><i></i><b>02</b></span><span class="route-stop"><i></i><b>03</b></span><span class="route-stop"><i></i><b>04</b></span><span class="route-stop"><i></i><b>05</b></span><span class="route-stop finish-stop"><i></i><b>06</b></span></div><div class="route-meta"><span>6 SECTORS</span><span>~ 90 SECONDS</span><span>ONE CLEAN LINE</span></div></div>
          <div class="personal-best"><span class="eyebrow-small">YOUR PERSONAL BEST</span><strong id="menu-best">— — : — —</strong><span id="best-caption">MAKE YOUR FIRST MARK</span></div>
        </section>
        <footer class="menu-footer"><button id="settings-button">${gear} SETTINGS</button><span><i></i> FOLLOW THE RED. TRUST YOUR MOMENTUM.</span><span class="edition">VOL. 01 <b>/</b> FREE TO FLOW</span></footer>
      </main>
      <div class="hud hidden" id="hud">
        <div class="hud-top-left"><div class="hud-brand">${mark} REDLINE</div><div class="sector-label"><span id="sector-number">01</span><div><small>THE UPPER DISTRICT</small><strong id="sector-name">Learn the line</strong></div></div></div>
        <div class="hud-top-right"><div class="run-label"><i></i> RUN IN PROGRESS <button id="pause-button" aria-label="Pause game">Ⅱ</button></div><strong class="timer" id="timer">00:00<span>.00</span></strong><div class="progress-segments">${Array.from({length:6},(_,i)=>`<i data-segment="${i}"></i>`).join('')}</div><span class="distance"><b id="distance">640</b> M TO FINISH</span></div>
        <div class="crosshair"></div>
        <div class="hud-bottom-left"><div class="action-label" id="action-label">READY TO FLOW</div><div class="speed-readout"><strong id="speed">0</strong><span>KM/H</span><div class="speed-bars">${'<i></i>'.repeat(15)}</div></div><span class="checkpoint-label" id="checkpoint-label">CHECKPOINT 01 / 06</span></div>
        <div class="hint" id="hint"><kbd>W A S D</kbd><span>Move</span><kbd>SHIFT</kbd><span>Sprint</span><kbd>SPACE</kbd><span>Jump</span></div>
        <div class="hud-bottom-right"><span><kbd>R</kbd> RETRY CHECKPOINT</span><span><kbd>ESC</kbd> PAUSE</span></div>
      </div>
      <div class="toast" id="toast"><span class="toast-mark">✓</span><div><small id="toast-label">PROGRESS SAVED</small><strong id="toast-text">Checkpoint reached</strong></div></div>
      <div id="respawn-flash"></div>
      <div class="modal-backdrop hidden" id="pause-modal"><section class="modal pause-card"><div class="eyebrow"><span></span> TAKE A BREATH</div><h2>Still above<br>the noise<span>.</span></h2><p>Your line will be here when you’re ready.</p><button class="button primary" id="resume"><span>KEEP RUNNING</span>${arrow}</button><button class="button secondary" id="retry">RESTART RUN</button><div class="pause-links"><button id="pause-settings">SETTINGS</button><button id="main-menu-button">BACK TO MENU</button></div></section></div>
      <div class="modal-backdrop hidden" id="help-modal"><section class="modal help-card"><button class="close-modal" id="close-help" aria-label="Close controls and settings">×</button><div class="eyebrow"><span></span> FIND YOUR FLOW</div><h2 id="help-title">Make your move<span>.</span></h2><div class="help-tabs"><button id="controls-tab" class="selected">CONTROLS</button><button id="settings-tab">SETTINGS</button></div><div id="controls-content"><div class="controls-grid"><div><kbd>W A S D</kbd><span>Move</span></div><div><kbd>MOUSE</kbd><span>Look around</span></div><div><kbd>SHIFT</kbd><span>Sprint</span></div><div><kbd>SPACE</kbd><span>Jump / wall jump</span></div><div><kbd>C / CTRL</kbd><span>Slide under obstacles</span></div><div><kbd>E</kbd><span>Vault over obstacles</span></div><div><kbd>R</kbd><span>Retry checkpoint</span></div><div><kbd>ESC</kbd><span>Pause</span></div></div><div class="tip"><span>↗</span><p><strong>Follow the red.</strong> Sprint and jump beside red walls to wall-run automatically. Hold jump for more height; approach a ledge to pull yourself up.</p></div></div><div id="settings-content" class="hidden"><label class="setting-row"><span><strong>Mouse sensitivity</strong><small>Make every turn your own.</small></span><input id="sensitivity" type="range" min="0.2" max="2" step="0.05" value="${this.settings.sensitivity}" aria-label="Mouse sensitivity"><output id="sensitivity-value">${this.settings.sensitivity.toFixed(2)}</output></label><label class="setting-row"><span><strong>Sound volume</strong><small>The rhythm of the rooftops.</small></span><input id="volume" type="range" min="0" max="1" step="0.05" value="${this.settings.volume}" aria-label="Sound volume"><output id="volume-value">${Math.round(this.settings.volume*100)}%</output></label><label class="setting-row"><span><strong>Reduced camera motion</strong><small>Less head bob, tilt, and field-of-view motion.</small></span><input id="reduced-motion" type="checkbox" ${this.settings.reducedMotion?'checked':''}><span class="switch"></span></label><div class="settings-note">Settings are saved automatically on this device.</div></div><button class="button dark" id="help-done">GOT IT ${arrow}</button></section></div>
      <div class="modal-backdrop hidden" id="finish-modal"><section class="modal finish-card"><div class="eyebrow"><span></span> LEVEL COMPLETE</div><div class="finish-emblem">${mark}</div><h2>You found<br>your flow<span>.</span></h2><p>Six sectors. One unforgettable line.</p><div class="finish-stats"><div><small>YOUR TIME</small><strong id="finish-time">00:00.00</strong></div><div><small>PERSONAL BEST</small><strong id="finish-best">00:00.00</strong></div></div><div id="finish-caption" class="finish-caption">A new line. A new beginning.</div><button class="button primary" id="run-again"><span>RUN IT AGAIN</span>${arrow}</button><button id="finish-menu" class="text-button">BACK TO THE ROOFTOPS</button></section></div>
    `;
    this.el('start').onclick = () => this.onStart();
    this.el('resume').onclick = () => this.onResume();
    this.el('retry').onclick = this.el('run-again').onclick = () => this.onRestart();
    this.el('main-menu-button').onclick = this.el('finish-menu').onclick = () => this.onMenu();
    this.el('controls').onclick = () => this.openHelp('controls');
    this.el('settings-button').onclick = this.el('pause-settings').onclick = () => this.openHelp('settings');
    this.el('controls-tab').onclick = () => this.helpTab('controls');
    this.el('settings-tab').onclick = () => this.helpTab('settings');
    this.el('close-help').onclick = this.el('help-done').onclick = () => this.closeHelp();
    this.root.querySelector<HTMLAnchorElement>('.wordmark')!.onclick = (event) => { event.preventDefault(); this.onMenu(); };
    for (const id of ['sensitivity', 'volume', 'reduced-motion']) this.el(id).addEventListener('input', () => this.saveSettings());
    document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.el('help-modal').classList.contains('hidden')) { e.stopImmediatePropagation(); this.closeHelp(); } });
  }

  el(id: string) { return document.getElementById(id)!; }

  mode(mode: 'menu' | 'playing' | 'paused' | 'finished') {
    this.previousMode = mode;
    this.el('main-menu').classList.toggle('hidden', mode !== 'menu');
    this.el('menu-wash').classList.toggle('hidden', mode !== 'menu');
    this.el('brand-header').classList.toggle('hidden', mode !== 'menu');
    this.el('hud').classList.toggle('hidden', mode !== 'playing');
    this.el('pause-modal').classList.toggle('hidden', mode !== 'paused');
    this.el('finish-modal').classList.toggle('hidden', mode !== 'finished');
    this.el('help-modal').classList.add('hidden');
    document.body.dataset.mode = mode;
  }

  setBest(best: number | null) {
    this.el('menu-best').textContent = best === null ? '— — : — —' : formatTime(best);
    this.el('best-caption').textContent = best === null ? 'MAKE YOUR FIRST MARK' : 'THERE’S ALWAYS A FASTER LINE';
  }

  openHelp(tab: string) {
    this.el('help-modal').classList.remove('hidden');
    this.el('pause-modal').classList.add('hidden');
    this.helpTab(tab);
  }

  private closeHelp() {
    this.el('help-modal').classList.add('hidden');
    if (this.previousMode === 'paused') this.el('pause-modal').classList.remove('hidden');
  }

  private helpTab(tab: string) {
    this.el('controls-content').classList.toggle('hidden', tab !== 'controls');
    this.el('settings-content').classList.toggle('hidden', tab !== 'settings');
    this.el('controls-tab').classList.toggle('selected', tab === 'controls');
    this.el('settings-tab').classList.toggle('selected', tab === 'settings');
  }

  private saveSettings() {
    this.settings.sensitivity = Number((this.el('sensitivity') as HTMLInputElement).value);
    this.settings.volume = Number((this.el('volume') as HTMLInputElement).value);
    this.settings.reducedMotion = (this.el('reduced-motion') as HTMLInputElement).checked;
    this.el('sensitivity-value').textContent = this.settings.sensitivity.toFixed(2);
    this.el('volume-value').textContent = `${Math.round(this.settings.volume * 100)}%`;
    try { localStorage.setItem('redline.settings', JSON.stringify(this.settings)); } catch { /* Private browser storage can be unavailable. */ }
    this.onSettings(this.settings);
  }

  update(time: number, speed: number, action: string, distance: number) {
    const formatted = formatTime(time).split('.');
    this.el('timer').innerHTML = `${formatted[0]}<span>.${formatted[1]}</span>`;
    this.el('speed').textContent = Math.round(speed * 3.6).toString();
    this.el('action-label').textContent = speed < .3 && action !== 'falling' ? 'READY TO FLOW' : action.replace(/[-_]/g, ' ').toUpperCase();
    this.el('distance').textContent = Math.max(0, Math.round(distance)).toString();
    this.root.querySelectorAll('.speed-bars i').forEach((el, i) => el.classList.toggle('lit', i < speed / 12 * 15));
  }

  section(index: number, name: string, hint: string) {
    this.el('sector-number').textContent = String(index + 1).padStart(2, '0');
    this.el('sector-name').textContent = name;
    this.el('checkpoint-label').textContent = `CHECKPOINT ${String(index + 1).padStart(2, '0')} / 06`;
    this.root.querySelectorAll('[data-segment]').forEach((el, i) => { el.classList.toggle('complete', i < index); el.classList.toggle('current', i === index); });
    this.hint(hint);
  }

  hint(message: string) { this.el('hint').innerHTML = message.replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>'); }

  toast(message: string, label = 'PROGRESS SAVED') {
    clearTimeout(this.toastTimeout);
    this.el('toast-text').textContent = message;
    this.el('toast-label').textContent = label;
    this.el('toast').classList.add('visible');
    this.toastTimeout = window.setTimeout(() => this.el('toast').classList.remove('visible'), 2800);
  }

  respawn() {
    this.el('respawn-flash').classList.remove('flash');
    void this.el('respawn-flash').offsetWidth;
    this.el('respawn-flash').classList.add('flash');
  }

  finish(time: number, best: number, newBest: boolean, falls: number) {
    this.mode('finished');
    this.el('finish-time').textContent = formatTime(time);
    this.el('finish-best').textContent = formatTime(best);
    this.el('finish-caption').textContent = `${newBest ? 'NEW PERSONAL BEST' : 'LINE COMPLETE'}  /  ${falls === 0 ? 'A CLEAN RUN' : `${falls} RECOVER${falls === 1 ? 'Y' : 'IES'}`}`;
    this.setBest(best);
  }
}
