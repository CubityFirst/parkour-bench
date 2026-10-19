export const icon = {
  arrow: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" stroke-width="1.7"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 12H2v7h4v-7H4Zm16 0h2v7h-4v-7h2Z" stroke="currentColor" stroke-width="1.5"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 9h2m2 0h2m2 0h2m2 0h2M5 12h2m2 0h2m2 0h2m2 0h2M7 15h10" stroke="currentColor" stroke-width="1.4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none"><path d="m9 3-.7 2.3-2 .9-2.2-.4-2 3.4 1.5 1.8v2L2.1 15l2 3.4 2.2-.4 2 .9L9 21h4l.7-2.1 2-.9 2.2.4 2-3.4-1.5-2v-2l1.5-1.8-2-3.4-2.2.4-2-.9L13 3H9Z" stroke="currentColor" stroke-width="1.4"/><circle cx="11" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>',
};
export const logo = '<span class="brand-symbol"><i></i><i></i><i></i></span><span class="brand-word">UPSHIFT<span class="trademark">®</span></span>';
export const sectorNames = ['First steps', 'Open air', 'Stay low', 'Against the wall', 'Find your flow', 'The home stretch'];
export function formatTime(time: number, milliseconds = false) {
  const min = Math.floor(time / 60).toString().padStart(2, '0');
  const sec = Math.floor(time % 60).toString().padStart(2, '0');
  return `${min}:${sec}${milliseconds ? '.' + Math.floor((time % 1) * 1000).toString().padStart(3, '0') : ''}`;
}
export class UI {
  readonly menu: HTMLElement;
  readonly hud: HTMLElement;
  readonly pause: HTMLElement;
  readonly finish: HTMLElement;
  private toastTimeout = 0;
  constructor() {
    document.querySelector('#app')!.innerHTML = `
      <section id="menu" class="menu">
        <div class="menu-wash"></div>
        <header class="menu-header"><a class="brand" href="#" aria-label="UPSHIFT home">${logo}</a><div class="header-right"><span class="live-dot"></span> ASTER DISTRICT <span class="separator">/</span> 07 <span class="weather">18° &nbsp; SUNNY</span></div></header>
        <main class="intro">
          <div class="eyebrow"><span class="red-line"></span> ABOVE THE EVERYDAY</div>
          <h1>THE CITY.<br>YOUR LINE<span class="red">.</span></h1>
          <p class="intro-copy">No roads. No rules. Just a way forward.<br>Find your flow above the city.</p>
          <div class="intro-actions"><button id="start" class="button primary">Start running ${icon.arrow}</button><button id="controls" class="button secondary">${icon.keyboard} Controls</button></div>
          <div class="intro-note">${icon.sound}<span>Headphones on. World off.</span><span class="note-divider"></span><span>60–120 SEC RUN</span></div>
        </main>
        <div class="scene-label"><span class="scene-diamond"></span><div><span class="micro">YOUR NEXT MOVE</span><strong>Higher is a state of mind.</strong></div><span class="scene-line"></span></div>
        <div class="scene-coordinate">35° 41′ N &nbsp; 139° 41′ E <span>ALT. 32 M</span></div>
        <footer class="menu-footer">
          <div class="route-heading"><span class="eyebrow">ONE CITY. SIX SECTORS.</span><span class="micro">650 M <span class="small-dot">·</span> FOLLOW THE RED</span></div>
          <div class="route-track">${sectorNames.map((n, i) => `<div class="route-sector ${i === 0 ? 'selected' : ''}"><div class="sector-line"><span class="sector-dot"></span><span class="sector-index">0${i + 1}</span></div><span class="sector-name">${n}</span></div>`).join('')}<div class="local-best"><span class="micro">PERSONAL BEST</span><strong id="menu-best">— — : — —</strong></div></div>
          <div class="footer-bottom"><span>BUILT FOR MOMENTUM.</span><div><button id="settings">${icon.gear} Settings</button><span class="footer-sep">/</span><span>DESKTOP EXPERIENCE</span><span class="version">V.01</span></div></div>
        </footer>
      </section>
      <section id="hud" class="hud hidden">
        <div class="hud-top"><div class="hud-brand">${logo}<div class="run-meta">ASTER DISTRICT <span>FREE RUN</span></div></div><div class="timer-block"><span class="micro">RUN TIME</span><strong id="timer">00:00<span>.000</span></strong><span id="best-hud">BEST — — : — —</span></div></div>
        <div class="crosshair"></div><div id="toast" class="toast"><span class="toast-symbol">✓</span><div><span class="micro">CHECKPOINT SAVED</span><strong id="toast-text"></strong></div></div>
        <div id="move-flash" class="move-flash"></div>
        <div class="hud-bottom"><div class="objective"><div class="eyebrow"><span id="sector-number">01 / 06</span><span class="red-line"></span><span id="sector-title">FIRST STEPS</span></div><p id="hint">Find your pace. Follow the red.</p><div id="action" class="control-hint">W A S D &nbsp; Move &nbsp; SHIFT &nbsp; Sprint</div></div><div class="speed-block"><span id="movement-mode" class="micro">READY</span><div><strong id="speed">00</strong><span>KM/H</span></div><div class="speed-bars">${'<i></i>'.repeat(20)}</div></div></div>
        <div class="run-progress"><div id="progress-bar"></div></div><button id="pause-button" title="Pause game">II <span>ESC</span></button>
        <div class="navigation-tip">FOLLOW THE <span>RED</span> <i></i></div>
      </section>
      <section id="pause" class="overlay hidden"><div class="dialog pause-dialog"><div class="eyebrow"><span class="red-line"></span> TAKE A BREATH</div><h2>Find your<br>next move.</h2><p>Your run is paused. The rooftops can wait.</p><button id="resume" class="button primary">Keep running ${icon.arrow}</button><button id="checkpoint-restart" class="button secondary">Restart checkpoint <span>R</span></button><div class="dialog-links"><button id="pause-settings">Settings</button><button id="quit">Back to title</button></div></div></section>
      <section id="finish" class="overlay hidden"><div class="dialog finish-dialog"><div class="eyebrow"><span class="red-line"></span> LEVEL COMPLETE</div><h2>YOU FOUND<br>YOUR FLOW<span class="red">.</span></h2><p>Six sectors. One uninterrupted possibility.</p><div class="finish-times"><div><span class="micro">YOUR TIME</span><strong id="finish-time"></strong></div><div><span class="micro">PERSONAL BEST</span><strong id="finish-best"></strong></div></div><div id="record" class="record">A new line in the record books.</div><button id="again" class="button primary">Run it back ${icon.arrow}</button><button id="finish-quit" class="text-button">Back to title</button></div></section>
      <section id="modal" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="dialog controls-dialog"><button id="close-modal" class="close-button" aria-label="Close dialog">×</button><div id="modal-content"></div></div></section>
      <div id="respawn-flash"></div>
      <div id="loading"><span class="brand">${logo}</span><span>FINDING YOUR LINE…</span><i></i></div>
    `;
    this.menu = document.querySelector('#menu')!;
    this.hud = document.querySelector('#hud')!;
    this.pause = document.querySelector('#pause')!;
    this.finish = document.querySelector('#finish')!;
    this.refreshBest();
    document.querySelector('#controls')!.addEventListener('click', () => this.showControls());
    document.querySelector('#close-modal')!.addEventListener('click', () => this.closeModal());
    document.querySelector('#modal')!.addEventListener('click', e => { if ((e.target as HTMLElement).id === 'modal') this.closeModal(); });
    document.addEventListener('keydown', e => { if (e.code === 'Escape') this.closeModal(); });
  }
  on(id: string, callback: () => void) { document.getElementById(id)!.addEventListener('click', callback); }
  refreshBest() {
    const best = Number(localStorage.getItem('upshift-best') || 0);
    document.querySelector('#menu-best')!.textContent = best ? formatTime(best, true) : '— — : — —';
    document.querySelector('#best-hud')!.textContent = best ? `BEST ${formatTime(best, true)}` : 'BEST — — : — —';
  }
  showControls() {
    this.modal(`<div class="eyebrow"><span class="red-line"></span> THE BASICS</div><h2>Make your move.</h2><p>Red marks your route. Momentum is your friend.</p><div class="controls-grid">${[
      ['W A S D', 'Move'], ['MOUSE', 'Look around'], ['SHIFT', 'Sprint'], ['SPACE', 'Jump / wall jump'], ['C / CTRL', 'Slide'], ['E', 'Vault an obstacle'], ['R', 'Restart checkpoint'], ['ESC', 'Pause'],
    ].map(([key, action]) => `<div><kbd>${key}</kbd><span>${action}</span></div>`).join('')}</div><div class="control-notes"><p><b>Wall run</b> Sprint and jump beside a red wall. Keep moving forward to run along it.</p><p><b>Ledge recovery</b> Hold jump as you approach a rooftop edge to pull yourself up.</p><p><b>Longer jumps</b> Keep Space held. Sprint before takeoff for maximum distance.</p></div>`);
  }
  modal(content: string) { document.querySelector('#modal-content')!.innerHTML = content; document.querySelector('#modal')!.classList.remove('hidden'); (document.querySelector('#close-modal') as HTMLButtonElement).focus(); }
  closeModal() { document.querySelector('#modal')!.classList.add('hidden'); }
  showState(state: 'menu' | 'playing' | 'paused' | 'finished') {
    this.menu.classList.toggle('hidden', state !== 'menu');
    this.hud.classList.toggle('hidden', state !== 'playing' && state !== 'paused');
    this.pause.classList.toggle('hidden', state !== 'paused');
    this.finish.classList.toggle('hidden', state !== 'finished');
    this.closeModal();
  }
  sector(index: number, title: string, hint: string, action: string) {
    document.querySelector('#sector-number')!.textContent = `0${index + 1} / 06`;
    document.querySelector('#sector-title')!.textContent = title.toUpperCase();
    document.querySelector('#hint')!.textContent = hint;
    document.querySelector('#action')!.textContent = action;
  }
  toast(message: string) {
    clearTimeout(this.toastTimeout);
    document.querySelector('#toast-text')!.textContent = message;
    document.querySelector('#toast')!.classList.add('visible');
    this.toastTimeout = window.setTimeout(() => document.querySelector('#toast')!.classList.remove('visible'), 3200);
  }
  flashRespawn() {
    const el = document.querySelector('#respawn-flash')!;
    el.classList.remove('flash'); void (el as HTMLElement).offsetWidth; el.classList.add('flash');
  }
  update(time: number, speed: number, mode: string, progress: number) {
    const t = formatTime(time, true).split('.');
    document.querySelector('#timer')!.innerHTML = `${t[0]}<span>.${t[1]}</span>`;
    document.querySelector('#speed')!.textContent = Math.round(speed * 3.6).toString().padStart(2, '0');
    document.querySelector('#movement-mode')!.textContent = mode;
    document.querySelector('#progress-bar')!.setAttribute('style', `width:${Math.max(0, Math.min(100, progress / 650 * 100))}%`);
    document.querySelectorAll('.speed-bars i').forEach((el, i) => el.classList.toggle('active', i < speed / 14 * 20));
    const flash = document.querySelector('#move-flash')!;
    const special = ['WALL RUN', 'VAULT', 'SLIDING'].includes(mode);
    flash.textContent = special ? mode : ''; flash.classList.toggle('visible', special);
  }
  complete(time: number, best: number, newRecord: boolean) {
    document.querySelector('#finish-time')!.textContent = formatTime(time, true);
    document.querySelector('#finish-best')!.textContent = formatTime(best, true);
    document.querySelector('#record')!.textContent = newRecord ? '↗  NEW PERSONAL BEST' : 'There’s always a faster line. Find yours.';
    this.refreshBest();
  }
}
