import { formatTime } from '../game/GameState.ts';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

/** Minimal in-game HUD: crosshair, timer, speed, checkpoint toast, section titles and hints. */
export class HUD {
  private readonly root = el<HTMLElement>('hud');
  private readonly timer = el<HTMLElement>('timer');
  private readonly speed = el<HTMLElement>('speed-value');
  private readonly section = el<HTMLElement>('section');
  private readonly toastEl = el<HTMLElement>('toast');
  private readonly hint = el<HTMLElement>('hint');
  private readonly vaultPrompt = el<HTMLElement>('vault-prompt');
  private readonly notice = el<HTMLElement>('notice');
  private readonly fadeEl = el<HTMLElement>('fade');

  private toastTimer = 0;
  private sectionTimer = 0;
  private lastTime = '';
  private lastSpeed = -1;
  private hintHtml = '';

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setTime(seconds: number): void {
    const t = formatTime(seconds);
    if (t !== this.lastTime) {
      this.lastTime = t;
      this.timer.textContent = t;
    }
  }

  setSpeed(mps: number): void {
    const v = Math.round(mps * 10) / 10;
    if (v !== this.lastSpeed) {
      this.lastSpeed = v;
      this.speed.textContent = v.toFixed(1);
    }
  }

  toast(text: string, ms = 1900): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  showSection(index: number, title: string): void {
    this.section.innerHTML = `SECTION ${String(index).padStart(2, '0')}<b>${title.replace(/(\S+)$/, '<i>$1</i>')}</b>`;
    this.section.classList.add('show');
    window.clearTimeout(this.sectionTimer);
    this.sectionTimer = window.setTimeout(() => this.section.classList.remove('show'), 2600);
  }

  /** Contextual hint line (HTML allowed, e.g. <kbd> key caps). Pass null to hide. */
  setHint(html: string | null): void {
    const next = html ?? '';
    if (next === this.hintHtml) return;
    this.hintHtml = next;
    if (html) {
      this.hint.innerHTML = html;
      this.hint.classList.add('show');
    } else {
      this.hint.classList.remove('show');
    }
  }

  setVaultPrompt(on: boolean): void {
    this.vaultPrompt.classList.toggle('show', on);
  }

  setNotice(text: string): void {
    this.notice.textContent = text;
  }

  /** White flash used for respawns. */
  fade(on: boolean): void {
    this.fadeEl.classList.toggle('on', on);
  }
}
