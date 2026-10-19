import { SECTIONS } from "../world/Level";
import {
  MOTION_STORAGE_KEY,
  SENSITIVITY_STORAGE_KEY,
} from "../game/StorageKeys";

const arrow =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h15M12 5l7 7-7 7" stroke="currentColor" stroke-width="1.6"/></svg>';
const sound =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" stroke-width="1.4"/><path d="M16 8c2 2 2 6 0 8m3-11c4 4 4 10 0 14" stroke="currentColor" stroke-width="1.4"/></svg>';
const gear =
  '<svg viewBox="0 0 24 24" fill="none"><path d="m9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 3 3 3-2v-3l4-2-1-4-3-1-1-4Z" stroke="currentColor" stroke-width="1.3"/><circle cx="11.5" cy="11.5" r="3" stroke="currentColor" stroke-width="1.3"/></svg>';

export function formatTime(time: number): string {
  const minutes = Math.floor(time / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(time % 60)
    .toString()
    .padStart(2, "0");
  const milliseconds = Math.floor((time * 100) % 100)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}<span class="time-decimal">.${milliseconds}</span>`;
}

export class UI {
  readonly root = document.createElement("div");
  onStart: () => void = () => {};
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onMenu: () => void = () => {};
  onSound: () => boolean = () => true;
  onSensitivity: (value: number) => void = () => {};
  onMotion: (reduced: boolean) => void = () => {};
  private toastTimer = 0;
  private hintTimer = 0;
  private baseHint = SECTIONS[0].hint;
  private lastTimer = "";

  constructor() {
    this.root.id = "interface";
    this.root.innerHTML = `
      <div class="menu-wash"></div>
      <header class="topbar">
        <a class="brand" href="#" aria-label="Rooftop Flow home">
          <span class="brand-mark"><i></i><i></i><i></i></span>
          <span>ROOFTOP<span class="brand-second">FLOW<span class="brand-period">.</span></span></span>
        </a>
        <div class="top-caption">ABOVE THE ORDINARY<span class="small-cross">+</span></div>
        <div class="header-actions">
          <span class="live-weather"><span class="sun-icon">☼</span> 24° <span class="weather-divider">/</span> MERIDIAN CITY</span>
          <button class="icon-button sound-button" aria-label="Mute sound" title="Toggle sound">${sound}</button>
          <button class="icon-button settings-button" aria-label="Settings" title="Settings">${gear}</button>
        </div>
      </header>
      <main class="home-menu">
        <div class="eyebrow"><span class="red-dash"></span> A FIRST-PERSON PARKOUR EXPERIENCE</div>
        <h1>FIND YOUR<br><span>FLOW<span class="red-text">.</span></span></h1>
        <p class="intro">The city is your playground.<br>Keep moving. Look ahead. Trust the red.</p>
        <button id="start-button" class="primary-button"><span>START RUN</span>${arrow}<kbd>↵</kbd></button>
        <div class="menu-links"><button id="controls-button">HOW TO PLAY <span>↗</span></button><span class="link-divider"></span><button class="settings-button">SETTINGS <span>+</span></button></div>
        <div class="personal-best"><span class="outline-diamond">◇</span><span>PERSONAL BEST</span><strong id="menu-best">— — : — —</strong></div>
      </main>
      <aside class="route-card">
        <div class="route-overline"><span>THE RUN</span><span>01 — 06</span></div>
        <div class="route-title">The Meridian Run<span>↗</span></div>
        <div class="route-details">6 SECTORS <span>·</span> ~90 SECONDS <span>·</span> ONE WAY UP</div>
        <div class="route-segments"><i class="active"></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="route-bottom"><span class="route-dot"></span> FOLLOW THE RED.<span class="route-altitude">ALT. 142 M</span></div>
      </aside>
      <footer class="home-footer"><span><b>07</b> DISTRICT SEVEN <i>/</i> ROOFTOP ACCESS</span><span class="footer-middle">NO LIMITS. JUST MOMENTUM.</span><button id="fullscreen-button" title="Toggle fullscreen"><span>⛶</span> FULLSCREEN</button></footer>
      <div class="game-hud" hidden>
        <div class="run-clock"><span>RUN TIME</span><strong id="timer">00:00<span>.00</span></strong></div>
        <div class="crosshair"><i></i><i></i></div>
        <div class="speed-block"><div><strong id="speed">00</strong><span>KM/H</span></div><div class="speed-bar"><i id="speed-fill"></i></div><span id="movement-state">READY</span></div>
        <div class="sector-block"><span id="sector-number">01 / 06</span><strong id="sector-name">FIRST LIGHT</strong><div class="mini-segments"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
        <div id="context-hint" class="context-hint">${SECTIONS[0].hint}</div>
        <div class="hud-keyboard"><span><kbd>R</kbd> CHECKPOINT</span><span><kbd>ESC</kbd> PAUSE</span></div>
        <div id="waypoint" class="waypoint"><div>◇</div><span>60 M</span></div>
      </div>
      <div id="toast" class="toast"><span>CHECKPOINT REACHED</span><strong>OPEN AIR</strong></div>
      <section id="pause-menu" class="screen-overlay" hidden><div class="dialog pause-dialog">
        <div class="eyebrow"><span class="red-dash"></span> TAKE A BREATH</div><h2>STILL IN<br>THE FLOW<span class="red-text">.</span></h2>
        <p>Your next rooftop is waiting.</p>
        <button id="resume-button" class="primary-button"><span>KEEP RUNNING</span>${arrow}<kbd>ESC</kbd></button>
        <button class="text-button checkpoint-button">RESTART FROM CHECKPOINT <span>↗</span></button>
        <div class="pause-links"><button class="settings-button">SETTINGS</button><button id="quit-button">BACK TO MENU</button></div>
      </div></section>
      <section id="finish-menu" class="screen-overlay" hidden><div class="dialog finish-dialog">
        <div class="eyebrow"><span class="red-dash"></span> LEVEL COMPLETE</div><h2>THAT'S<br>YOUR FLOW<span class="red-text">.</span></h2>
        <p>The Meridian Run. All six sectors. Yours.</p><div class="finish-time"><span>YOUR TIME</span><strong id="finish-time"></strong></div>
        <div class="finish-best"><span id="record-label">PERSONAL BEST</span><strong id="finish-best"></strong></div>
        <button id="restart-button" class="primary-button"><span>RUN IT BACK</span>${arrow}<kbd>↵</kbd></button>
        <button class="text-button menu-button">BACK TO MENU <span>↗</span></button>
      </div></section>
      <section id="controls-panel" class="screen-overlay panel-overlay" hidden><div class="dialog info-dialog">
        <button class="close-button" aria-label="Close controls">×</button>
        <div class="eyebrow"><span class="red-dash"></span> RUNNER'S FIELD GUIDE</div><h2>KEEP<br>MOVING<span class="red-text">.</span></h2>
        <div class="control-list">
          <div><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move <small>Mouse to look around</small></span></div>
          <div><span><kbd>SHIFT</kbd> + <kbd>SPACE</kbd></span><span>Sprint & jump <small>Hold jump for more height</small></span></div>
          <div><span><kbd>C</kbd> / <kbd>CTRL</kbd></span><span>Slide <small>Get low without losing speed</small></span></div>
          <div><span><kbd>E</kbd></span><span>Vault <small>Clear low red barriers</small></span></div>
          <div><span><kbd>SPACE</kbd> near a wall</span><span>Wall run <small>Jump beside red walls; jump again to kick away</small></span></div>
          <div><span><kbd>R</kbd> / <kbd>ESC</kbd></span><span>Reset / pause <small>Fall? Your latest checkpoint has you.</small></span></div>
        </div><p class="guide-note"><span class="red-text">◇</span> Follow the red. Sprint into gaps. Ledges catch you if you come up just short.</p>
        <button class="primary-button close-panel"><span>GOT IT</span>${arrow}</button>
      </div></section>
      <section id="settings-panel" class="screen-overlay panel-overlay" hidden><div class="dialog settings-dialog">
        <button class="close-button" aria-label="Close settings">×</button>
        <div class="eyebrow"><span class="red-dash"></span> MAKE IT YOURS</div><h2>YOUR<br>RHYTHM<span class="red-text">.</span></h2>
        <label class="setting-label" for="sensitivity">MOUSE SENSITIVITY <output id="sensitivity-value">1.0×</output></label>
        <input type="range" id="sensitivity" min="0.25" max="2.5" step="0.05" value="1" />
        <div class="setting-toggle"><div><strong>REDUCED CAMERA MOTION</strong><p>Less head bob, tilt, and field of view change.</p></div><label class="switch"><input type="checkbox" id="reduced-motion"/><span></span></label></div>
        <div class="setting-toggle"><div><strong>SOUND EFFECTS</strong><p>Footsteps, wind, and movement feedback.</p></div><label class="switch"><input type="checkbox" id="sound-setting" checked/><span></span></label></div>
        <button class="primary-button close-panel"><span>ALL SET</span>${arrow}</button>
      </div></section>
      <div id="render-error" class="screen-overlay" hidden><div class="dialog"><h2>A LITTLE<br>TURBULENCE.</h2><p>WebGL could not start. Enable hardware acceleration in your desktop browser and reload.</p></div></div>`;
    document.querySelector("#app")!.appendChild(this.root);
    this.element("#start-button").addEventListener("click", () =>
      this.onStart(),
    );
    this.element("#resume-button").addEventListener("click", () =>
      this.onResume(),
    );
    this.element("#restart-button").addEventListener("click", () =>
      this.onRestart(),
    );
    this.element(".checkpoint-button").addEventListener("click", () => {
      this.onResume();
      this.root.dispatchEvent(new Event("checkpoint-reset"));
    });
    this.element("#quit-button").addEventListener("click", () => this.onMenu());
    this.element(".menu-button").addEventListener("click", () => this.onMenu());
    this.element(".brand").addEventListener("click", (e) => {
      e.preventDefault();
      this.onMenu();
    });
    this.element("#controls-button").addEventListener("click", () =>
      this.openPanel("controls"),
    );
    this.root.querySelectorAll(".settings-button").forEach((button) =>
      button.addEventListener("click", () => {
        this.root.dispatchEvent(new Event("settings-open"));
        this.openPanel("settings");
      }),
    );
    this.root
      .querySelectorAll(".close-button, .close-panel")
      .forEach((button) =>
        button.addEventListener("click", () => this.closePanels()),
      );
    this.root.querySelectorAll(".panel-overlay").forEach((overlay) =>
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.closePanels();
      }),
    );
    this.element(".sound-button").addEventListener("click", () =>
      this.updateSound(this.onSound()),
    );
    this.element<HTMLInputElement>("#sound-setting").addEventListener(
      "change",
      () => this.updateSound(this.onSound()),
    );
    this.element<HTMLInputElement>("#sensitivity").addEventListener(
      "input",
      (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        this.element("#sensitivity-value").textContent = `${value.toFixed(2)}×`;
        this.onSensitivity(value);
        try {
          localStorage.setItem(SENSITIVITY_STORAGE_KEY, JSON.stringify(value));
        } catch {
          /* Private browsing can disable storage. */
        }
      },
    );
    this.element<HTMLInputElement>("#reduced-motion").addEventListener(
      "change",
      (e) => {
        const value = (e.target as HTMLInputElement).checked;
        this.onMotion(value);
        try {
          localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify(value));
        } catch {
          /* Private browsing can disable storage. */
        }
      },
    );
    this.element("#fullscreen-button").addEventListener("click", () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
    });
  }

  element<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }
  applySettings(): void {
    try {
      const sensitivity = Number(
        localStorage.getItem(SENSITIVITY_STORAGE_KEY) ?? 1,
      );
      const reduced = localStorage.getItem(MOTION_STORAGE_KEY) === "true";
      this.element<HTMLInputElement>("#sensitivity").value =
        String(sensitivity);
      this.element("#sensitivity-value").textContent =
        `${sensitivity.toFixed(2)}×`;
      this.element<HTMLInputElement>("#reduced-motion").checked = reduced;
      this.onSensitivity(sensitivity);
      this.onMotion(reduced);
    } catch {
      /* Settings work for this session if storage is unavailable. */
    }
  }

  updateSound(enabled: boolean): void {
    this.element(".sound-button").classList.toggle("muted", !enabled);
    this.element(".sound-button").setAttribute(
      "aria-label",
      enabled ? "Mute sound" : "Enable sound",
    );
    this.element<HTMLInputElement>("#sound-setting").checked = enabled;
  }

  openPanel(panel: "controls" | "settings"): void {
    this.element(`#${panel}-panel`).hidden = false;
  }
  closePanels(): void {
    this.element("#controls-panel").hidden = true;
    this.element("#settings-panel").hidden = true;
  }

  setState(state: "menu" | "playing" | "paused" | "finished"): void {
    this.root.dataset.state = state;
    this.closePanels();
    this.element(".home-menu").hidden = state !== "menu";
    this.element(".home-footer").hidden = state !== "menu";
    this.element(".route-card").hidden = state !== "menu";
    this.element(".menu-wash").hidden = state !== "menu";
    this.element(".game-hud").hidden = state === "menu" || state === "finished";
    this.element("#pause-menu").hidden = state !== "paused";
    this.element("#finish-menu").hidden = state !== "finished";
  }

  setBest(best: number | null): void {
    this.element("#menu-best").innerHTML =
      best === null ? "— — : — —" : formatTime(best);
  }

  section(index: number, notify = false): void {
    this.element("#sector-number").textContent =
      `${String(index + 1).padStart(2, "0")} / 06`;
    this.element("#sector-name").textContent = SECTIONS[index].name;
    this.root
      .querySelectorAll(".mini-segments i")
      .forEach((segment, i) => segment.classList.toggle("active", i <= index));
    this.baseHint = SECTIONS[index].hint;
    this.hintTimer = 0;
    this.element("#context-hint").textContent = this.baseHint;
    if (notify) this.toast("CHECKPOINT REACHED", SECTIONS[index].name);
  }

  hint(message: string, duration = 3): void {
    this.element("#context-hint").textContent = message;
    this.hintTimer = duration;
  }

  toast(label: string, text: string): void {
    const toast = this.element("#toast");
    toast.querySelector("span")!.textContent = label;
    toast.querySelector("strong")!.textContent = text;
    toast.classList.add("visible");
    this.toastTimer = 3.3;
  }

  update(dt: number, time: number, speed: number, move: string): void {
    const formatted = formatTime(time);
    if (formatted !== this.lastTimer) {
      this.element("#timer").innerHTML = formatted;
      this.lastTimer = formatted;
    }
    this.element("#speed").textContent = String(
      Math.round(speed * 3.6),
    ).padStart(2, "0");
    this.element("#speed-fill").style.width =
      `${Math.min(100, (speed / 15) * 100)}%`;
    this.element("#movement-state").textContent = move;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0)
        this.element("#toast").classList.remove("visible");
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0)
        this.element("#context-hint").textContent = this.baseHint;
    }
  }

  finish(time: number, best: number, newBest: boolean): void {
    this.element("#finish-time").innerHTML = formatTime(time);
    this.element("#finish-best").innerHTML = formatTime(best);
    this.element("#record-label").textContent = newBest
      ? "↗ NEW PERSONAL BEST"
      : "PERSONAL BEST";
    this.setBest(best);
    this.setState("finished");
  }
}
