import { formatTime } from '../game/GameState.ts';

const KEY_LABELS: Record<string, string> = {
  SHIFT: 'Shift',
  SPACE: 'Space',
  CTRL: 'Ctrl',
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

/** Minimal in-game overlay: crosshair, run timer, checkpoint toast, contextual hint, speed bar. */
export class HUD {
  private readonly root = el<HTMLElement>('hud');
  private readonly timerValue = el<HTMLElement>('timer-value');
  private readonly section = el<HTMLElement>('section-label');
  private readonly toastEl = el<HTMLElement>('toast');
  private readonly toastTitle = el<HTMLElement>('toast-title');
  private readonly toastSub = el<HTMLElement>('toast-sub');
  private readonly hintEl = el<HTMLElement>('hint');
  private readonly hintKeys = el<HTMLElement>('hint-keys');
  private readonly hintText = el<HTMLElement>('hint-text');
  private readonly crosshair = el<HTMLElement>('crosshair');
  private readonly speedFill = el<HTMLElement>('speed-fill');
  private readonly speedText = el<HTMLElement>('speed-text');
  private readonly lockHint = el<HTMLElement>('lock-hint');
  private readonly fadeEl = el<HTMLElement>('fade');
  private readonly speedFx = el<HTMLElement>('speedfx');
  private lastFx = -1;

  private toastTimer = 0;
  private sectionTimer = 0;
  private lastTimerText = '';
  private lastHintKey = '';
  private lastSpeedText = '';

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setTimer(seconds: number): void {
    const t = formatTime(seconds);
    if (t !== this.lastTimerText) {
      this.timerValue.textContent = t;
      this.lastTimerText = t;
    }
  }

  setSection(index: number, name: string): void {
    this.section.textContent = `${String(index).padStart(2, '0')}  /  ${name}`;
    this.section.style.opacity = '1';
    // Restart the entrance animation.
    this.section.classList.remove('pulse');
    void this.section.offsetWidth;
    this.section.classList.add('pulse');
    window.clearTimeout(this.sectionTimer);
    this.sectionTimer = window.setTimeout(() => {
      this.section.style.opacity = '0.55';
    }, 3500);
  }

  clearSection(): void {
    this.section.textContent = '';
  }

  toast(title: string, sub = '', ms = 2300): void {
    this.toastTitle.textContent = title;
    this.toastSub.textContent = sub;
    this.toastSub.style.display = sub ? '' : 'none';
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** Show a hint such as [E] VAULT. Pass null to hide. */
  setHint(keys: readonly string[] | null, text: string | null, action = false): void {
    if (text === null) {
      if (this.lastHintKey !== '') {
        this.hintEl.classList.remove('show');
        this.lastHintKey = '';
      }
      return;
    }
    const key = `${keys?.join('+') ?? ''}|${text}|${action}`;
    if (key === this.lastHintKey) return;
    this.lastHintKey = key;
    this.hintKeys.innerHTML = '';
    for (const k of keys ?? []) {
      const kbd = document.createElement('kbd');
      kbd.textContent = KEY_LABELS[k] ?? k;
      this.hintKeys.appendChild(kbd);
    }
    this.hintText.textContent = text;
    this.hintEl.classList.toggle('action', action);
    this.hintEl.classList.add('show');
  }

  setSpeed(speed: number, flow: number): void {
    const pct = Math.min(1, speed / 11.5);
    this.speedFill.style.width = `${(pct * 100).toFixed(1)}%`;
    this.speedFill.classList.toggle('flow', flow > 0.55);
    const t = `${speed.toFixed(1)} M/S`;
    if (t !== this.lastSpeedText) {
      this.speedText.textContent = t;
      this.lastSpeedText = t;
    }
  }

  /** 0..1 strength of the speed vignette. */
  setSpeedFx(k: number): void {
    const v = Math.round(k * 100) / 100;
    if (v === this.lastFx) return;
    this.lastFx = v;
    this.speedFx.style.opacity = String(v);
  }

  setCrosshairActive(active: boolean): void {
    this.crosshair.classList.toggle('active', active);
  }

  setLockHint(visible: boolean): void {
    this.lockHint.classList.toggle('show', visible);
  }

  /** Full-screen white flash used for respawns. */
  fade(opacity: number, ms: number): void {
    this.fadeEl.style.transition = `opacity ${ms}ms ease`;
    this.fadeEl.style.opacity = String(opacity);
  }

  resetTransient(): void {
    this.toastEl.classList.remove('show');
    this.setHint(null, null);
    this.clearSection();
    this.setCrosshairActive(false);
  }
}
