export interface HUDCallbacks {
  start: () => void;
  resume: () => void;
  restart: () => void;
  playAgain: () => void;
  backToMenu: () => void;
  settingsChanged: (sensitivity: number, reducedMotion: boolean) => void;
}

export interface HUDFrame {
  elapsed: number;
  section: string;
  progress: number;
  checkpoint: string;
  action: string;
  speed: number;
  grounded: boolean;
  nearVault: boolean;
}

const required = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error("Missing interface element: " + id);
  return element as T;
};

export class HUD {
  private readonly menu = required<HTMLElement>("menu-screen");
  private readonly pause = required<HTMLElement>("pause-screen");
  private readonly complete = required<HTMLElement>("complete-screen");
  private readonly hud = required<HTMLElement>("hud");
  private readonly checkpointToast = required<HTMLElement>("checkpoint-toast");
  private readonly actionToast = required<HTMLElement>("action-toast");
  private readonly controls = required<HTMLElement>("controls-panel");
  private readonly time = required<HTMLElement>("run-time");
  private readonly section = required<HTMLElement>("section-name");
  private readonly fill = required<HTMLElement>("progress-fill");
  private readonly progressValue = required<HTMLElement>("progress-value");
  private readonly checkpointName = required<HTMLElement>("checkpoint-name");
  private readonly hint = required<HTMLElement>("context-hint");
  private readonly sensitivityInput = required<HTMLInputElement>("sensitivity");
  private readonly reducedInput = required<HTMLInputElement>("reduced-motion");
  private checkpointTimeout = 0;
  private actionTimeout = 0;

  constructor(callbacks: HUDCallbacks) {
    required<HTMLButtonElement>("start-button").addEventListener("click", callbacks.start);
    required<HTMLButtonElement>("resume-button").addEventListener("click", callbacks.resume);
    required<HTMLButtonElement>("restart-button").addEventListener("click", callbacks.restart);
    required<HTMLButtonElement>("play-again-button").addEventListener("click", callbacks.playAgain);
    required<HTMLButtonElement>("menu-button").addEventListener("click", callbacks.backToMenu);
    required<HTMLButtonElement>("controls-button").addEventListener("click", () => this.controls.classList.remove("hidden"));
    required<HTMLButtonElement>("close-controls").addEventListener("click", () => this.controls.classList.add("hidden"));
    this.sensitivityInput.value = localStorage.getItem("rooftop-flow-sensitivity") ?? "1";
    this.reducedInput.checked = localStorage.getItem("rooftop-flow-reduced-motion") === "true";
    const notifySettings = (): void => {
      const sensitivity = Number(this.sensitivityInput.value);
      const reducedMotion = this.reducedInput.checked;
      localStorage.setItem("rooftop-flow-sensitivity", String(sensitivity));
      localStorage.setItem("rooftop-flow-reduced-motion", String(reducedMotion));
      callbacks.settingsChanged(sensitivity, reducedMotion);
    };
    this.sensitivityInput.addEventListener("input", notifySettings);
    this.reducedInput.addEventListener("change", notifySettings);
    notifySettings();
  }

  showMenu(bestTime?: number): void {
    this.menu.classList.remove("hidden");
    this.pause.classList.add("hidden");
    this.complete.classList.add("hidden");
    this.hud.classList.add("hidden");
    this.controls.classList.add("hidden");
    required<HTMLElement>("menu-best-time").textContent = bestTime === undefined ? "--:--.--" : HUD.formatTime(bestTime);
  }

  showRunning(): void {
    this.menu.classList.add("hidden");
    this.pause.classList.add("hidden");
    this.complete.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.controls.classList.add("hidden");
  }

  showPause(): void {
    this.pause.classList.remove("hidden");
    this.menu.classList.add("hidden");
    this.complete.classList.add("hidden");
    this.hud.classList.add("hidden");
  }

  showComplete(time: number, best: number): void {
    this.complete.classList.remove("hidden");
    this.menu.classList.add("hidden");
    this.pause.classList.add("hidden");
    this.hud.classList.add("hidden");
    required<HTMLElement>("finish-time").textContent = HUD.formatTime(time);
    required<HTMLElement>("finish-best").textContent = HUD.formatTime(best);
  }

  setMenuBest(bestTime?: number): void {
    required<HTMLElement>("menu-best-time").textContent = bestTime === undefined ? "--:--.--" : HUD.formatTime(bestTime);
  }

  update(frame: HUDFrame): void {
    this.time.textContent = HUD.formatTime(frame.elapsed);
    this.section.textContent = frame.section;
    this.fill.style.width = Math.round(frame.progress * 100) + "%";
    this.progressValue.textContent = Math.round(frame.progress * 100) + "%";
    this.checkpointName.textContent = frame.checkpoint;
    this.hint.innerHTML = this.getHint(frame);
  }

  private getHint(frame: HUDFrame): string {
    if (frame.action === "WALL RUN") return "<kbd>SPACE</kbd> WALL JUMP <em>·</em> KEEP MOVING";
    if (frame.action === "SLIDE" || frame.section === "SLIDE LOW") return "<kbd>CTRL</kbd> SLIDE LOW <em>·</em> <kbd>SPACE</kbd> EXIT";
    if (frame.action === "VAULT" || frame.nearVault) return "<kbd>E</kbd> VAULT <em>·</em> KEEP YOUR MOMENTUM";
    if (frame.section === "WALL RUN") return "<kbd>SHIFT</kbd> SPRINT <em>·</em> RUN BESIDE THE RED WALL";
    if (!frame.grounded) return "<kbd>W A S D</kbd> AIR STEER <em>·</em> KEEP THE LINE";
    if (frame.speed < 5) return "<kbd>W</kbd> BUILD SPEED <em>·</em> <kbd>SHIFT</kbd> SPRINT";
    return "<kbd>SPACE</kbd> JUMP GAPS <em>·</em> <kbd>SHIFT</kbd> SPRINT";
  }

  showCheckpoint(name: string, number: number): void {
    this.checkpointToast.textContent = "CHECKPOINT " + String(number).padStart(2, "0") + "  /  " + name;
    this.checkpointToast.classList.add("show");
    window.clearTimeout(this.checkpointTimeout);
    this.checkpointTimeout = window.setTimeout(() => this.checkpointToast.classList.remove("show"), 2300);
  }

  showAction(message: string): void {
    if (message === "JUMP" || message === "SLIDE") return;
    this.actionToast.textContent = message;
    this.actionToast.classList.add("show");
    window.clearTimeout(this.actionTimeout);
    this.actionTimeout = window.setTimeout(() => this.actionToast.classList.remove("show"), 900);
  }

  setPointerUnlocked(unlocked: boolean): void {
    document.getElementById("app")?.classList.toggle("pointer-unlocked", unlocked);
  }

  static formatTime(seconds: number): string {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const wholeSeconds = Math.floor(safe % 60);
    const centiseconds = Math.floor((safe % 1) * 100);
    return String(minutes).padStart(2, "0") + ":" + String(wholeSeconds).padStart(2, "0") + "." + String(centiseconds).padStart(2, "0");
  }
}

