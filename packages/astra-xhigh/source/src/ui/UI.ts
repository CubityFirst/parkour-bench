export type Screen = "menu" | "playing" | "paused" | "finish";
const arrow =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" stroke-width="1.7"/></svg>';
const soundIcon =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const logo =
  '<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M7 32V10h30v7H15v15H7Zm15 0V22h15v7h-8v3h-7Z" fill="currentColor"/></svg>';
export function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60),
    s = Math.floor(seconds % 60),
    ms = Math.floor((seconds % 1) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(s).padStart(2, "0")}<span>.${String(ms).padStart(2, "0")}</span>`;
}
export class UI {
  onStart = () => {};
  onResume = () => {};
  onRestart = () => {};
  onMenu = () => {};
  onAudio = (enabled: boolean) => {};
  sensitivity = 1;
  reducedMotion = false;
  sound = true;
  private root: HTMLElement;
  private notificationTimeout = 0;
  constructor() {
    this.root = document.getElementById("app")!;
    this.root.innerHTML = `
      <div id="world" aria-label="3D rooftop parkour game"></div>
      <div class="screen-grain"></div>
      <header class="topbar">
        <a class="brand" href="#" aria-label="Rooftop Flow home">${logo}<span>ROOFTOP<span class="brand-light">FLOW</span></span><span class="edition">VOL. 01</span></a>
        <div class="header-right"><span class="city-label"><i></i> NEW EDEN <span class="slash">/</span> 08:42 AM</span><button id="sound-toggle" class="icon-button" aria-label="Mute sound" title="Toggle sound">${soundIcon}</button></div>
      </header>
      <main id="menu" class="menu-view">
        <div class="menu-wash"></div>
        <section class="hero">
          <div class="eyebrow"><span class="red-dash"></span> ABOVE THE NOISE.</div>
          <h1>FIND YOUR<br><em>FLOW.</em></h1>
          <p class="hero-copy">No roads. No rules. Just you and the skyline.<br>Find your own rhythm above the city.</p>
          <div class="hero-actions"><button id="start" class="primary-button"><span>BEGIN RUN</span>${arrow}</button><button id="controls" class="text-button">How to play <span>↗</span></button></div>
          <div class="route-info"><span class="route-number">01</span><div><span class="micro">THE HIGHLINE</span><p>Six sectors. One way forward.</p></div><span class="route-badge">FREE RUN</span></div>
          <div class="route-stats"><div><strong>800<span>M</span></strong><span>ROUTE LENGTH</span></div><div><strong>06</strong><span>SECTORS</span></div><div><strong>90<span>SEC</span></strong><span>TARGET TIME</span></div></div>
        </section>
        <div class="world-caption"><span class="caption-pin"></span><div><span>YOUR NEXT HORIZON</span><strong>THE HIGHLINE <span>↗</span></strong></div></div>
        <aside class="route-preview"><div class="route-preview-top"><span>ROUTE / 01</span><span class="live-dot">READY TO RUN</span></div><svg class="route-line" viewBox="0 0 286 65" fill="none" aria-label="Route through six sectors"><path d="M10 48H63L93 20h58l27 27h42l30-30h25" stroke="#bac5c8" stroke-width="2" stroke-dasharray="3 4"/><path d="M10 48H63L93 20" stroke="#e94331" stroke-width="2"/><circle cx="10" cy="48" r="4" fill="#e94331"/><circle cx="63" cy="48" r="3" fill="#e94331"/><circle cx="116" cy="20" r="3" fill="#8b9ba1"/><circle cx="178" cy="47" r="3" fill="#8b9ba1"/><circle cx="220" cy="47" r="3" fill="#8b9ba1"/><path d="M270 11h10v10h-10z" fill="#243e49"/></svg><div class="route-preview-bottom"><span>START · SECTOR 01</span><span>42 M ABOVE IT ALL</span></div></aside>
        <footer class="menu-footer"><div class="key-guide"><span><kbd>W A S D</kbd> Move</span><span><kbd>SHIFT</kbd> Sprint</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>C</kbd> Slide</span></div><button id="settings" class="footer-button"><svg viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14M7 3v4m6 1v4m-6 1v4" stroke="currentColor" stroke-width="1.3"/></svg>RUNNER SETTINGS</button><span class="desktop-note">DESIGNED FOR DESKTOP <span>↗</span></span></footer>
      </main>
      <section id="hud" class="hidden" aria-label="Game HUD">
        <div class="hud-top"><div class="sector-label"><span id="sector-number">01 / 06</span><strong id="sector-title">FIRST LIGHT</strong></div><div class="timer"><span class="micro">RUN TIME</span><strong id="timer-value">00:00<span>.00</span></strong><span id="best-hud">PERSONAL BEST —</span></div></div>
        <div class="crosshair"></div><div id="notification" class="notification"><span>CHECKPOINT REACHED</span><strong></strong></div>
        <div class="hud-bottom"><div class="speed"><strong id="speed-value">0</strong><span>KM/H</span><div class="speed-track"><i id="speed-bar"></i></div><span id="movement">READY</span></div><div class="hint"><span id="hint-label">FIND YOUR FEET</span><p id="hint-text">WASD to move · SHIFT to sprint · SPACE to jump</p></div><button id="pause-button" class="pause-button"><kbd>ESC</kbd> PAUSE</button></div>
        <div class="progress-line"><i id="progress"></i></div><div id="fall-flash"></div>
      </section>
      <div id="pause" class="modal-layer hidden"><section class="modal pause-card"><span class="eyebrow">TAKE A BREATH.</span><h2>STAY IN<br><em>THE FLOW.</em></h2><p>The city will still be here.</p><button id="resume" class="primary-button">RESUME RUN ${arrow}</button><button id="restart-checkpoint" class="secondary-button">Restart from checkpoint <kbd>R</kbd></button><div class="pause-links"><button id="pause-settings">Settings</button><button id="back-menu">Back to skyline</button></div></section></div>
      <div id="finish" class="modal-layer hidden"><section class="modal finish-card"><span class="eyebrow">LEVEL COMPLETE / THE HIGHLINE</span><h2>YOU FOUND<br><em>YOUR FLOW.</em></h2><p>Above the noise. Ahead of yourself.</p><div class="finish-stats"><div><span>YOUR TIME</span><strong id="final-time"></strong></div><div><span>PERSONAL BEST</span><strong id="final-best"></strong></div></div><div id="record" class="record">LEVEL COMPLETE</div><button id="run-again" class="primary-button">RUN IT BACK ${arrow}</button><button id="finish-menu" class="text-button">Back to skyline ↗</button></section></div>
      <div id="dialog" class="modal-layer hidden"><section class="modal dialog-card"><button id="close-dialog" class="close-button" aria-label="Close dialog">×</button><span class="eyebrow">RUNNER ESSENTIALS</span><h2 id="dialog-title">MAKE YOUR MOVE.</h2><div id="controls-content"><p class="dialog-intro">Follow the red. Keep your momentum. Trust the jump.</p><div class="controls-grid"><span>Move</span><kbd>W A S D</kbd><span>Look around</span><kbd>MOUSE</kbd><span>Sprint</span><kbd>SHIFT</kbd><span>Jump / wall jump</span><kbd>SPACE</kbd><span>Slide / crouch</span><kbd>C / CTRL</kbd><span>Vault an obstacle</span><kbd>E</kbd><span>Restart checkpoint</span><kbd>R</kbd><span>Pause</span><kbd>ESC</kbd></div><p class="tip"><strong>A little runner wisdom.</strong> Hold jump for more height. Sprint and jump alongside a red wall to run across it. Reach a ledge and you’ll pull yourself up.</p></div><div id="settings-content" class="hidden"><p class="dialog-intro">A little less friction. A little more you.</p><label class="setting-row" for="sensitivity"><span>Mouse sensitivity<small>Find your perfect turning speed.</small></span><output id="sensitivity-value">1.0</output></label><input id="sensitivity" type="range" min="0.3" max="2.5" step="0.1" value="1"><label class="setting-row" for="motion"><span>Reduced camera motion<small>Less head bob, tilt, and field-of-view change.</small></span><input type="checkbox" id="motion" role="switch"></label><label class="setting-row" for="audio-setting"><span>Sound effects<small>Footsteps, wind, and a little encouragement.</small></span><input type="checkbox" id="audio-setting" role="switch" checked></label></div><button id="dialog-done" class="primary-button">GOT IT ${arrow}</button></section></div>
      <div id="toast" role="status"></div>
    `;
    const click = (id: string, fn: () => void) =>
      document.getElementById(id)!.addEventListener("click", fn);
    click("start", () => this.onStart());
    click("resume", () => this.onResume());
    click("run-again", () => this.onStart());
    click("restart-checkpoint", () => this.onRestart());
    click("back-menu", () => this.onMenu());
    click("finish-menu", () => this.onMenu());
    document.querySelector(".brand")!.addEventListener("click", (e) => {
      e.preventDefault();
      this.onMenu();
    });
    click("controls", () => this.dialog("controls"));
    click("settings", () => this.dialog("settings"));
    click("pause-settings", () => this.dialog("settings"));
    click("close-dialog", () => this.closeDialog());
    click("dialog-done", () => this.closeDialog());
    document.getElementById("dialog")!.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) this.closeDialog();
    });
    click("sound-toggle", () => this.toggleSound(!this.sound));
    document.getElementById("sensitivity")!.addEventListener("input", (e) => {
      this.sensitivity = Number((e.target as HTMLInputElement).value);
      document.getElementById("sensitivity-value")!.textContent =
        this.sensitivity.toFixed(1);
      this.saveSettings();
    });
    document.getElementById("motion")!.addEventListener("change", (e) => {
      this.reducedMotion = (e.target as HTMLInputElement).checked;
      this.saveSettings();
    });
    document
      .getElementById("audio-setting")!
      .addEventListener("change", (e) =>
        this.toggleSound((e.target as HTMLInputElement).checked),
      );
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape") this.closeDialog();
    });
    try {
      const settings = JSON.parse(
        localStorage.getItem("parkour-bench:astra-xhigh:rooftop-flow:settings:v1") || "{}",
      );
      this.sensitivity = settings.sensitivity ?? 1;
      this.reducedMotion = settings.reducedMotion ?? false;
      this.sound = settings.sound ?? true;
    } catch {}
    (document.getElementById("sensitivity") as HTMLInputElement).value = String(
      this.sensitivity,
    );
    document.getElementById("sensitivity-value")!.textContent =
      this.sensitivity.toFixed(1);
    (document.getElementById("motion") as HTMLInputElement).checked =
      this.reducedMotion;
    this.toggleSound(this.sound);
  }
  private saveSettings() {
    try {
      localStorage.setItem(
        "parkour-bench:astra-xhigh:rooftop-flow:settings:v1",
        JSON.stringify({
          sensitivity: this.sensitivity,
          reducedMotion: this.reducedMotion,
          sound: this.sound,
        }),
      );
    } catch {}
  }
  private toggleSound(enabled: boolean) {
    this.sound = enabled;
    this.onAudio(enabled);
    document
      .getElementById("sound-toggle")!
      .classList.toggle("muted", !enabled);
    document
      .getElementById("sound-toggle")!
      .setAttribute("aria-label", enabled ? "Mute sound" : "Enable sound");
    (document.getElementById("audio-setting") as HTMLInputElement).checked =
      enabled;
    this.saveSettings();
  }
  dialog(type: "controls" | "settings") {
    document.getElementById("dialog-title")!.textContent =
      type === "controls" ? "MAKE YOUR MOVE." : "YOUR KIND OF FLOW.";
    document
      .getElementById("controls-content")!
      .classList.toggle("hidden", type !== "controls");
    document
      .getElementById("settings-content")!
      .classList.toggle("hidden", type !== "settings");
    document.getElementById("dialog")!.classList.remove("hidden");
    document.getElementById("close-dialog")!.focus();
  }
  closeDialog() {
    document.getElementById("dialog")!.classList.add("hidden");
  }
  screen(screen: Screen) {
    this.closeDialog();
    for (const [id, show] of Object.entries({
      menu: screen === "menu",
      hud: screen === "playing" || screen === "paused",
      pause: screen === "paused",
      finish: screen === "finish",
    }))
      document.getElementById(id)!.classList.toggle("hidden", !show);
    document.body.dataset.screen = screen;
  }
  update(time: number, speed: number, state: string, progress: number) {
    document.getElementById("timer-value")!.innerHTML = formatTime(time);
    document.getElementById("speed-value")!.textContent = String(
      Math.round(speed * 3.6),
    );
    document.getElementById("speed-bar")!.style.width =
      `${Math.min(100, (speed / 13.5) * 100)}%`;
    document.getElementById("movement")!.textContent = state;
    document.getElementById("progress")!.style.width = `${progress * 100}%`;
  }
  sector(
    index: number,
    title: string,
    subtitle: string,
    hint: string,
    notify = true,
  ) {
    document.getElementById("sector-number")!.textContent =
      `0${index + 1} / 06`;
    document.getElementById("sector-title")!.textContent = title;
    document.getElementById("hint-label")!.textContent = subtitle;
    document.getElementById("hint-text")!.textContent = hint;
    if (notify) {
      const el = document.getElementById("notification")!;
      el.querySelector("strong")!.textContent = `0${index + 1} — ${title}`;
      el.classList.add("visible");
      clearTimeout(this.notificationTimeout);
      this.notificationTimeout = window.setTimeout(
        () => el.classList.remove("visible"),
        2600,
      );
    }
  }
  hint(title: string, text: string) {
    document.getElementById("hint-label")!.textContent = title;
    document.getElementById("hint-text")!.textContent = text;
  }
  best(time: number | null) {
    document.getElementById("best-hud")!.innerHTML = time
      ? `PERSONAL BEST ${formatTime(time)}`
      : "PERSONAL BEST —";
  }
  finish(time: number, best: number, record: boolean) {
    this.screen("finish");
    document.getElementById("final-time")!.innerHTML = formatTime(time);
    document.getElementById("final-best")!.innerHTML = formatTime(best);
    document.getElementById("record")!.textContent = record
      ? "↗ NEW PERSONAL BEST"
      : "LEVEL COMPLETE";
  }
  toast(message: string) {
    const el = document.getElementById("toast")!;
    el.textContent = message;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 4000);
  }
  flash() {
    const el = document.getElementById("fall-flash")!;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
}
