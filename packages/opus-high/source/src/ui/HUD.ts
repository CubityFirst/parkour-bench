import { formatTime } from '../game/GameState';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Minimal in-game overlay: timer, section, hints, checkpoint toasts, speed. */
export class HUD {
  private root = $('hud');
  private timer = $('timer');
  private sectionNum = $('section-num');
  private sectionTitle = $('section-title');
  private progress = $('progress-fill');
  private toast = $('toast');
  private hint = $('hint');
  private speed = $('speed-value');
  private speedLines = $('speedlines');
  private flash = $('flash');
  private toastTimer = 0;
  private lastHint = '';
  private lastTimerText = '';
  private lastSpeed = -1;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setTime(seconds: number): void {
    const t = formatTime(seconds);
    if (t !== this.lastTimerText) {
      this.timer.textContent = t;
      this.lastTimerText = t;
    }
  }

  setSection(index: number, title: string): void {
    this.sectionNum.textContent = String(index).padStart(2, '0');
    this.sectionTitle.textContent = title;
  }

  setProgress(f: number): void {
    this.progress.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  }

  setSpeed(mps: number, intensity: number): void {
    const v = Math.round(mps);
    if (v !== this.lastSpeed) {
      this.speed.textContent = String(v);
      this.lastSpeed = v;
    }
    this.speedLines.style.opacity = intensity.toFixed(2);
  }

  setHint(text: string | null): void {
    const t = text ?? '';
    if (t === this.lastHint) return;
    this.lastHint = t;
    if (t) {
      this.hint.textContent = t;
      this.hint.classList.add('show');
    } else {
      this.hint.classList.remove('show');
    }
  }

  showToast(title: string, sub = '', duration = 2.2): void {
    this.toast.innerHTML = sub ? `${title}<small>${sub}</small>` : title;
    this.toast.classList.add('show');
    this.toastTimer = duration;
  }

  flashWhite(): void {
    this.flash.classList.add('on');
    window.setTimeout(() => this.flash.classList.remove('on'), 90);
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  reset(): void {
    this.toastTimer = 0;
    this.toast.classList.remove('show');
    this.setHint(null);
    this.setTime(0);
    this.setProgress(0);
  }
}
