import { formatTime } from '../game/GameState.ts';

/** In-game overlay: timer, checkpoint progress, notifications, hints and prompts. */
export class HUD {
  private readonly el: HTMLElement;
  private readonly time: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly notify: HTMLElement;
  private readonly notifyLabel: HTMLElement;
  private readonly notifyDetail: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly fade: HTMLElement;
  private notifyTimer = 0;
  private noticeTimer = 0;
  private fadeValue = 0;
  private fadeTarget = 0;
  private fadeSpeed = 4;
  private lastTimeText = '';
  private lastHint = '';
  private lastPrompt = '';
  private pips: HTMLElement[] = [];

  constructor(parent: HTMLElement, checkpointCount: number) {
    this.el = document.createElement('div');
    this.el.className = 'hud hidden';
    this.el.innerHTML = `
      <div class="vignette"></div>
      <div class="crosshair"></div>
      <div class="progress"></div>
      <div class="timer"><div class="time">00:00.00</div><div class="sub"></div></div>
      <div class="notify"><div class="label"></div><div class="detail"></div></div>
      <div class="prompt"><span class="key">E</span><span class="prompt-text"></span></div>
      <div class="hint"></div>
      <div class="speed"><div class="fill"></div></div>
      <div class="notice"></div>`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.time = q('.time');
    this.sub = q('.timer .sub');
    this.progress = q('.progress');
    this.notify = q('.notify');
    this.notifyLabel = q('.notify .label');
    this.notifyDetail = q('.notify .detail');
    this.hint = q('.hint');
    this.prompt = q('.prompt');
    this.promptText = q('.prompt-text');
    this.speedFill = q('.speed .fill');
    this.notice = q('.notice');
    this.vignette = q('.vignette');

    for (let i = 0; i < checkpointCount; i++) {
      const pip = document.createElement('i');
      this.progress.appendChild(pip);
      this.pips.push(pip);
    }
    this.progressLabel = document.createElement('span');
    this.progress.appendChild(this.progressLabel);

    // The fade sits above everything (menus included) for respawn / start transitions.
    this.fade = document.createElement('div');
    this.fade.className = 'fade';
    parent.appendChild(this.fade);
  }

  set visible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
  }

  setTime(t: number, best: number | null, started: boolean): void {
    const text = formatTime(t);
    if (text !== this.lastTimeText) {
      this.time.textContent = text;
      this.lastTimeText = text;
    }
    const sub = !started ? 'Clock starts when you move' : best !== null ? `Best ${formatTime(best)}` : '';
    if (this.sub.textContent !== sub) this.sub.textContent = sub;
  }

  setProgress(reached: number, total: number): void {
    this.pips.forEach((p, i) => p.classList.toggle('done', i < reached));
    this.progressLabel.textContent = `Checkpoint ${reached}/${total}`;
  }

  showCheckpoint(index: number, total: number, split: number, delta: number | null): void {
    this.notifyLabel.textContent = `Checkpoint ${index + 1} / ${total}`;
    let detail = formatTime(split);
    if (delta !== null) {
      const sign = delta <= 0 ? '-' : '+';
      detail += `<small style="color:${delta <= 0 ? '#7dffb0' : '#ffb3ad'}">${sign}${Math.abs(delta).toFixed(2)}</small>`;
    }
    this.notifyDetail.innerHTML = detail;
    this.notify.classList.add('show');
    this.notifyTimer = 2.6;
  }

  showMessage(label: string, detail = ''): void {
    this.notifyLabel.textContent = label;
    this.notifyDetail.textContent = detail;
    this.notify.classList.add('show');
    this.notifyTimer = 2.2;
  }

  setHint(text: string | null): void {
    const t = text ?? '';
    if (t === this.lastHint) return;
    this.lastHint = t;
    if (t) this.hint.textContent = t;
    this.hint.classList.toggle('show', !!t);
  }

  setPrompt(kind: 'vault' | 'zipline' | null): void {
    const text = kind === 'vault' ? 'Vault' : kind === 'zipline' ? 'Grab zipline' : '';
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    if (text) this.promptText.textContent = text;
    this.prompt.classList.toggle('show', !!text);
  }

  setSpeed(speed: number, max: number): void {
    const k = Math.min(1, speed / max);
    this.speedFill.style.width = `${(k * 100).toFixed(1)}%`;
    this.speedFill.classList.toggle('fast', k > 0.92);
  }

  /** Speed vignette strength 0..1. */
  setVignette(v: number): void {
    this.vignette.style.opacity = v.toFixed(3);
  }

  showNotice(text: string, seconds = 4): void {
    this.notice.textContent = text;
    this.notice.classList.add('show');
    this.noticeTimer = seconds;
  }

  /** Fades the white overlay to `target` opacity at `speed` per second. */
  fadeTo(target: number, speed = 4, from?: number): void {
    if (from !== undefined) this.fadeValue = from;
    this.fadeTarget = target;
    this.fadeSpeed = speed;
  }

  get fadeOpacity(): number {
    return this.fadeValue;
  }

  update(dt: number): void {
    if (this.notifyTimer > 0) {
      this.notifyTimer -= dt;
      if (this.notifyTimer <= 0) this.notify.classList.remove('show');
    }
    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0) this.notice.classList.remove('show');
    }
    if (this.fadeValue !== this.fadeTarget) {
      const step = this.fadeSpeed * dt;
      this.fadeValue = this.fadeValue < this.fadeTarget ? Math.min(this.fadeTarget, this.fadeValue + step) : Math.max(this.fadeTarget, this.fadeValue - step);
      this.fade.style.opacity = this.fadeValue.toFixed(3);
    }
  }

  clearTransient(): void {
    this.notify.classList.remove('show');
    this.notifyTimer = 0;
    this.setHint(null);
    this.setPrompt(null);
  }
}
