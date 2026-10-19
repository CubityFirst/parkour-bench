export type UIScreen = 'menu' | 'playing' | 'paused' | 'finished';

export interface GameSettings {
  sensitivity: number;
  reducedMotion: boolean;
  sound: boolean;
}

interface HUDCallbacks {
  start: () => void;
  resume: () => void;
  restart: () => void;
  settings: (settings: GameSettings) => void;
}

interface HUDData {
  time: number;
  best: number | null;
  speed: number;
  section: number;
  sectionTitle: string;
  hint: string;
  progress: number;
  state: string;
}

const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" stroke-width="1.6"/></svg>';
const soundIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 5 5 9H2v6h3l5 4V5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path class="sound-waves" d="M14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path class="sound-mute" d="m15 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.4"/></svg>';
const settingsIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v6m8 4v6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v4m8 6v4" stroke="var(--paper)" stroke-width="4"/><path d="M8 4v6m8 4v6" stroke="currentColor" stroke-width="1.5"/></svg>';
const logo = '<svg class="brand-mark" viewBox="0 0 42 42" fill="none" aria-hidden="true"><path d="M16 5h11L12 37H1L16 5ZM31 5h10L26 37H16L31 5Z" fill="currentColor"/></svg><span class="brand-name">STRIDE<span class="brand-period">.</span></span>';

const courseMap = `<svg class="course-map" viewBox="0 0 248 100" fill="none" aria-label="Six checkpoint rooftop route">
  <path d="M0 25h248M0 50h248M0 75h248M24 0v100M74 0v100M124 0v100M174 0v100M224 0v100" stroke="currentColor" stroke-opacity=".08"/>
  <path d="M8 72h33V49h36V28h42v28h39V34h39V15h43" stroke="currentColor" stroke-opacity=".18" stroke-width="9"/>
  <path d="M8 72h33V49h36V28h42v28h39V34h39V15h43" stroke="var(--red)" stroke-width="2"/>
  <g fill="var(--paper)" stroke="var(--red)" stroke-width="1.5"><circle cx="8" cy="72" r="3.5"/><circle cx="41" cy="49" r="3.5"/><circle cx="77" cy="28" r="3.5"/><circle cx="119" cy="56" r="3.5"/><circle cx="158" cy="34" r="3.5"/><circle cx="197" cy="15" r="3.5"/></g>
  <path d="M233 10v15m0-15h10l-3 4 3 4h-10" stroke="var(--red)" stroke-width="1.5"/>
  <text x="2" y="92" font-size="7" fill="currentColor" opacity=".5" font-family="monospace">START</text><text x="215" y="42" font-size="7" fill="currentColor" opacity=".5" font-family="monospace">FINISH</text>
</svg>`;

const settingsFields = () => `<div class="settings-fields">
  <label class="setting-range"><span><span>Mouse sensitivity</span><output data-sensitivity-value>1.00</output></span><input data-setting="sensitivity" type="range" min="0.25" max="2.5" step="0.05" aria-label="Mouse sensitivity"/><span class="range-labels"><span>PRECISE</span><span>RESPONSIVE</span></span></label>
  <label class="setting-switch"><span><strong>Reduced camera motion</strong><small>Less head bob and camera tilt</small></span><input type="checkbox" data-setting="reducedMotion"/><span class="switch-track" aria-hidden="true"></span></label>
  <label class="setting-switch"><span><strong>Game audio</strong><small>Footsteps, wind, and the city</small></span><input type="checkbox" data-setting="sound"/><span class="switch-track" aria-hidden="true"></span></label>
</div>`;

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds * 100));
  const minutes = Math.floor(total / 6000).toString().padStart(2, '0');
  const secs = Math.floor((total % 6000) / 100).toString().padStart(2, '0');
  const hundredths = (total % 100).toString().padStart(2, '0');
  return `${minutes}:${secs}<span class="timer-fraction">.${hundredths}</span>`;
};

export class HUD {
  private root: HTMLDivElement;
  private callbacks: HUDCallbacks;
  private screen: UIScreen = 'menu';
  private settings: GameSettings = { sensitivity: 1, reducedMotion: false, sound: true };
  private toastTimeout: ReturnType<typeof setTimeout> | undefined;
  private modalReturnFocus: HTMLElement | null = null;
  private last: Partial<HUDData> = {};

  constructor(callbacks: HUDCallbacks) {
    this.callbacks = callbacks;
    try {
      const saved = JSON.parse(localStorage.getItem('stride-settings') || 'null');
      if (saved && typeof saved === 'object') {
        if (typeof saved.sensitivity === 'number') this.settings.sensitivity = Math.max(0.25, Math.min(2.5, saved.sensitivity));
        if (typeof saved.reducedMotion === 'boolean') this.settings.reducedMotion = saved.reducedMotion;
        if (typeof saved.sound === 'boolean') this.settings.sound = saved.sound;
      }
    } catch { /* Settings remain available when browser storage is restricted. */ }
    this.root = document.createElement('div');
    this.root.className = 'stride-ui';
    this.root.dataset.screen = 'menu';
    this.root.innerHTML = `
      <div class="menu-wash" aria-hidden="true"></div>
      <header class="main-header">
        <div class="brand" aria-label="Stride rooftop runner">${logo}<span class="brand-descriptor">ROOFTOP RUNNER</span></div>
        <div class="header-actions"><span class="system-status"><i></i>SYSTEM ONLINE</span><span class="header-divider"></span><button class="icon-button sound-button" data-action="sound" aria-label="Mute sound" title="Toggle sound">${soundIcon}</button><button class="icon-button" data-action="settings" aria-label="Open settings" title="Settings">${settingsIcon}</button></div>
      </header>
      <main class="menu-screen screen is-active" data-view="menu">
        <div class="intro-copy">
          <div class="eyebrow"><span class="red-dash"></span>ABOVE THE EVERYDAY</div>
          <h1>FIND YOUR<br/><em>FLOW.</em></h1>
          <p class="intro-description">The city is your playground.<br/>Run the rooftops. Trust your momentum.</p>
          <div class="start-actions"><button class="primary-button start-button" data-action="start"><span>START RUN</span>${arrow}</button><button class="text-button how-button" data-action="controls" aria-label="How to play"><span class="small-circle" aria-hidden="true">?</span>How to play<span class="link-line"></span></button></div>
          <div class="intro-route"><span class="route-number">01</span><span class="route-rule"></span><span>SKYLINE DISTRICT<span class="route-subtitle">706 M &nbsp;/&nbsp; 6 CHECKPOINTS</span></span></div>
        </div>
        <div class="scene-caption"><span class="caption-cross">+</span><span>FREEDOM IS A<br/>CHANGE OF PERSPECTIVE.</span><span class="caption-coordinate">52° 31′ N<br/>13° 24′ E</span></div>
        <aside class="course-card"><div class="course-card-heading"><span class="micro-label">YOUR NEXT RUN</span><span class="north-indicator">N ↑</span></div>${courseMap}<div class="course-card-title">THE ROOFTOP CIRCUIT${arrow}</div><div class="course-card-meta"><span>EST. 01:30</span><span class="difficulty"><i></i><i></i><i></i><i></i><i></i><span>INTERMEDIATE</span></span></div></aside>
        <footer class="menu-footer"><div class="controls-rail"><div class="control-item"><span class="keys-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>MOVE</span></div><div class="control-item"><svg class="mouse-icon" viewBox="0 0 18 24" fill="none" aria-hidden="true"><rect x="3" y="2" width="12" height="19" rx="6" stroke="currentColor"/><path d="M9 2v7" stroke="currentColor"/></svg><span>LOOK</span></div><div class="control-item"><kbd class="wide-key">SHIFT</kbd><span>SPRINT</span></div><div class="control-item"><kbd class="space-key">SPACE</kbd><span>JUMP</span></div><div class="control-item"><kbd>C</kbd><span>SLIDE</span></div><div class="control-item"><kbd>E</kbd><span>VAULT</span></div><button class="rail-all-controls" data-action="controls" aria-label="Show all controls">ALL CONTROLS ${arrow}</button></div><div class="footer-baseline"><span>BUILT FOR MOMENTUM<span class="red-text">.</span></span><span class="footer-tip"><i></i>FOLLOW THE RED. FIND YOUR WAY.</span><span>DESKTOP EXPERIENCE &nbsp; <span class="version">V.1.0</span></span></div></footer>
      </main>
      <div class="play-screen screen" data-view="playing" aria-label="Game information">
        <div class="run-course-label"><span class="red-dash"></span>SKYLINE DISTRICT <span>/ 01</span></div>
        <div class="run-progress"><span class="micro-label">THE ROOFTOP CIRCUIT</span><div class="progress-segments">${Array.from({length:6}, (_, i) => `<i data-segment="${i}"></i>`).join('')}</div></div>
        <div class="run-clock"><span class="micro-label">RUN TIME</span><strong id="run-time">00:00<span class="timer-fraction">.00</span></strong><span class="run-best">BEST <b id="run-best">—</b></span></div>
        <div class="crosshair" aria-hidden="true"><i></i><i></i></div>
        <div class="speed-panel"><span class="micro-label">VELOCITY <span id="movement-state">READY</span></span><div class="speed-value"><strong id="speed-value">00</strong><span>KM/H</span></div><div class="speed-bars">${Array.from({length:22}, () => '<i></i>').join('')}</div></div>
        <div class="objective-panel"><span class="objective-section" id="section-title">FIND YOUR FEET</span><div class="objective-hint"><kbd id="hint-key">W</kbd><span id="contextual-hint">Follow the red route markers.</span></div><div class="pause-hint"><kbd>ESC</kbd> PAUSE <span>·</span> <kbd>R</kbd> CHECKPOINT</div></div>
        <div class="checkpoint-panel"><span class="micro-label">CHECKPOINT</span><div><strong id="checkpoint-number">01</strong><span>/ 06</span></div><span class="checkpoint-caption">KEEP MOVING FORWARD ${arrow}</span></div>
        <div class="edge-vignette" aria-hidden="true"></div>
      </div>
      <div class="pause-screen screen" data-view="paused"><section class="pause-card"><div class="eyebrow"><span class="red-dash"></span>RUN PAUSED</div><h2>TAKE A<br/><em>BREATH.</em></h2><p>Your next rooftop is waiting.</p><button class="primary-button" data-action="resume"><span>RESUME RUN</span>${arrow}</button><div class="pause-settings-label micro-label">MAKE IT YOURS</div>${settingsFields()}<div class="pause-secondary"><button class="text-button" data-action="restart">RESTART RUN ${arrow}</button><button class="text-button" data-action="controls">CONTROLS <span class="small-circle" aria-hidden="true">?</span></button></div><div class="pause-footer">SKYLINE DISTRICT <span>01 / THE ROOFTOP CIRCUIT</span></div></section></div>
      <div class="finish-screen screen" data-view="finished"><section class="finish-card"><div class="eyebrow"><span class="red-dash"></span>ALL SIX CHECKPOINTS CLEARED</div><h2>LEVEL<br/><em>COMPLETE.</em></h2><p>You found your flow. Now find a faster line.</p><div class="finish-stat"><span class="micro-label">YOUR TIME</span><strong id="finish-time">00:00.00</strong><span class="new-best" id="new-best">NEW PERSONAL BEST ${arrow}</span></div><div class="finish-record"><span>PERSONAL BEST</span><strong id="finish-best">—</strong><span>706 M / SKYLINE DISTRICT</span></div><button class="primary-button" data-action="restart"><span>RUN IT AGAIN</span>${arrow}</button><button class="text-button finish-controls" data-action="controls">REFINE YOUR TECHNIQUE <span class="small-circle" aria-hidden="true">?</span></button></section></div>
      <div class="checkpoint-toast" role="status" aria-live="polite"><span class="toast-symbol"><svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L20 5" stroke="currentColor" stroke-width="2"/></svg></span><div><strong id="toast-title"></strong><span id="toast-subtitle"></span></div><span class="toast-tag">STRIDE / RUNNER VISION</span></div>
      <div class="utility-modal" hidden><section class="utility-card" role="dialog" aria-modal="true" aria-labelledby="utility-title"><button class="icon-button modal-close" data-action="close-modal" aria-label="Close dialog"><svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.5"/></svg></button><div id="utility-content"></div></section></div>`;
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('input', (event) => this.onSetting(event));
    document.addEventListener('keydown', (event) => {
      if (!this.modal.hidden) {
        if (event.code === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.closeModal();
        }
        if (event.code === 'Tab') this.trapFocus(event);
      }
    }, true);
    this.syncSettings();
    this.callbacks.settings({ ...this.settings });
  }

  private get modal() { return this.root.querySelector<HTMLDivElement>('.utility-modal')!; }

  private onClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target === this.modal) { this.closeModal(); return; }
    const button = target.closest<HTMLElement>('[data-action]');
    if (!button) return;
    event.preventDefault();
    switch (button.dataset.action) {
      case 'start': this.closeModal(); this.callbacks.start(); break;
      case 'resume': this.closeModal(); this.callbacks.resume(); break;
      case 'restart': this.closeModal(); this.callbacks.restart(); break;
      case 'controls': this.openControls(); break;
      case 'settings': this.openSettings(); break;
      case 'close-modal': this.closeModal(); break;
      case 'sound': this.settings.sound = !this.settings.sound; this.saveSettings(); break;
    }
  }

  private onSetting(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.dataset.setting) return;
    if (input.dataset.setting === 'sensitivity') this.settings.sensitivity = Number(input.value);
    if (input.dataset.setting === 'reducedMotion') this.settings.reducedMotion = input.checked;
    if (input.dataset.setting === 'sound') this.settings.sound = input.checked;
    this.saveSettings();
  }

  private saveSettings() {
    try { localStorage.setItem('stride-settings', JSON.stringify(this.settings)); } catch { /* Storage is optional. */ }
    this.syncSettings();
    this.callbacks.settings({ ...this.settings });
  }

  private syncSettings() {
    this.root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((input) => {
      if (input.dataset.setting === 'sensitivity') input.value = String(this.settings.sensitivity);
      if (input.dataset.setting === 'reducedMotion') input.checked = this.settings.reducedMotion;
      if (input.dataset.setting === 'sound') input.checked = this.settings.sound;
    });
    this.root.querySelectorAll('[data-sensitivity-value]').forEach((value) => { value.textContent = this.settings.sensitivity.toFixed(2); });
    this.root.querySelectorAll<HTMLButtonElement>('.sound-button').forEach((button) => {
      button.classList.toggle('is-muted', !this.settings.sound);
      button.setAttribute('aria-label', this.settings.sound ? 'Mute sound' : 'Enable sound');
      button.setAttribute('aria-pressed', String(this.settings.sound));
    });
    this.root.classList.toggle('reduced-motion', this.settings.reducedMotion);
  }

  private openSettings() {
    this.showModal(`<div class="eyebrow"><span class="red-dash"></span>YOUR RUN, YOUR RULES</div><h2 id="utility-title">DIAL IT IN<span class="red-text">.</span></h2><p class="modal-description">A few small adjustments. A better flow.</p>${settingsFields()}<button class="primary-button modal-done" data-action="close-modal"><span>READY TO GO</span>${arrow}</button>`);
    this.syncSettings();
  }

  private openControls() {
    const rows = [
      ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Move', 'Find your line across the rooftops.'],
      ['<span class="control-word">MOUSE</span>', 'Look around', 'Point toward your next landing.'],
      ['<kbd class="wide-key">SHIFT</kbd>', 'Sprint', 'Build speed for the big gaps.'],
      ['<kbd class="space-key">SPACE</kbd>', 'Jump / wall jump', 'Hold a little longer to jump higher.'],
      ['<kbd>C</kbd><span class="or-label">/</span><kbd class="wide-key">CTRL</kbd>', 'Slide', 'Keep your speed under low beams.'],
      ['<kbd>E</kbd>', 'Vault', 'Flow over the red obstacles.'],
      ['<kbd>R</kbd>', 'Return to checkpoint', 'A fresh start from your last checkpoint.'],
      ['<kbd class="wide-key">ESC</kbd>', 'Pause', 'Take a breath. Adjust your settings.'],
    ];
    this.showModal(`<div class="eyebrow"><span class="red-dash"></span>A LITTLE KNOW-HOW GOES A LONG WAY</div><h2 id="utility-title">MOVE WITH PURPOSE<span class="red-text">.</span></h2><div class="controls-table">${rows.map(([keys,title,description]) => `<div class="controls-row"><div class="control-keys">${keys}</div><div><strong>${title}</strong><span>${description}</span></div></div>`).join('')}</div><div class="technique-note"><span class="small-circle" aria-hidden="true">↗</span><p><strong>Follow the red.</strong> Jump alongside red walls at speed to wall run. Reach a ledge and your runner will pull up automatically.</p></div><button class="primary-button modal-done" data-action="${this.screen === 'menu' ? 'start' : 'close-modal'}"><span>${this.screen === 'menu' ? "LET’S RUN" : 'GOT IT'}</span>${arrow}</button>`);
  }

  private showModal(content: string) {
    if (this.modal.hidden) this.modalReturnFocus = document.activeElement as HTMLElement | null;
    this.root.querySelector('#utility-content')!.innerHTML = content;
    this.modal.hidden = false;
    this.modal.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private closeModal() {
    if (this.modal.hidden) return;
    this.modal.hidden = true;
    this.modalReturnFocus?.focus();
    this.modalReturnFocus = null;
  }

  private trapFocus(event: KeyboardEvent) {
    const elements = Array.from(this.modal.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'));
    if (!elements.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  setScreen(screen: UIScreen) {
    this.screen = screen;
    this.root.dataset.screen = screen;
    this.root.querySelectorAll<HTMLElement>('[data-view]').forEach((view) => {
      const active = view.dataset.view === screen;
      view.classList.toggle('is-active', active);
      view.setAttribute('aria-hidden', String(!active));
      view.inert = !active;
    });
    if (screen === 'playing') this.closeModal();
    document.body.classList.toggle('is-playing', screen === 'playing');
  }

  update(data: HUDData) {
    if (data.time !== this.last.time) this.root.querySelector('#run-time')!.innerHTML = formatTime(data.time);
    if (data.best !== this.last.best) this.root.querySelector('#run-best')!.innerHTML = data.best === null ? '—' : formatTime(data.best);
    const kmh = Math.round(data.speed * 3.6);
    if (kmh !== Math.round((this.last.speed ?? -1) * 3.6)) {
      this.root.querySelector('#speed-value')!.textContent = kmh.toString().padStart(2, '0');
      this.root.querySelectorAll('.speed-bars i').forEach((bar, index) => bar.classList.toggle('is-lit', index < Math.min(22, Math.ceil(kmh / 2.3))));
    }
    if (data.section !== this.last.section) {
      const section = Math.min(5, Math.max(0, data.section));
      this.root.querySelector('#checkpoint-number')!.textContent = (section + 1).toString().padStart(2, '0');
      this.root.querySelectorAll<HTMLElement>('[data-segment]').forEach((segment, index) => {
        segment.classList.toggle('is-complete', index < section);
        segment.classList.toggle('is-current', index === section);
      });
    }
    if (data.sectionTitle !== this.last.sectionTitle) this.root.querySelector('#section-title')!.textContent = data.sectionTitle;
    if (data.hint !== this.last.hint) {
      this.root.querySelector('#contextual-hint')!.textContent = data.hint;
      const hint = data.hint.toLowerCase();
      const key = hint.includes('slide') ? 'C' : hint.includes('vault') ? 'E' : hint.includes('jump') || hint.includes('wall') ? 'SPACE' : hint.includes('sprint') || hint.includes('shift') ? 'SHIFT' : 'W';
      this.root.querySelector('#hint-key')!.textContent = key;
    }
    if (data.state !== this.last.state) this.root.querySelector('#movement-state')!.textContent = data.state.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    this.root.style.setProperty('--run-progress', `${Math.max(0, Math.min(1, data.progress)) * 100}%`);
    this.last = { ...data };
  }

  notify(title: string, subtitle = '') {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.root.querySelector('#toast-title')!.textContent = title;
    this.root.querySelector('#toast-subtitle')!.textContent = subtitle;
    const toast = this.root.querySelector('.checkpoint-toast')!;
    toast.classList.remove('is-visible');
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    this.toastTimeout = setTimeout(() => toast.classList.remove('is-visible'), 3500);
  }

  complete(time: number, best: number) {
    this.root.querySelector('#finish-time')!.innerHTML = formatTime(time);
    this.root.querySelector('#finish-best')!.innerHTML = formatTime(best);
    (this.root.querySelector('#new-best') as HTMLElement).hidden = Math.abs(time - best) > 0.02;
    this.setScreen('finished');
  }
}
