import type { Settings } from '../game/types';
import { formatTime } from './format';

export class HUD {
  private root: HTMLElement;
  private timerEl: HTMLElement;
  private hintEl: HTMLElement;
  private promptEl: HTMLElement;
  private toastEl: HTMLElement;
  private cross: HTMLElement;
  private pause: HTMLElement;
  private finish: HTMLElement;
  private finishTime: HTMLElement;
  private finishBest: HTMLElement;
  private sens: HTMLInputElement;
  private motion: HTMLInputElement;
  private hintText = '';
  private hintUntil = 0;
  private toastUntil = 0;

  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  onFinishRestart: (() => void) | null = null;
  onChange: ((settings: Settings) => void) | null = null;

  constructor(root: HTMLElement, settings: Settings) {
    root.innerHTML = `
      <div class="crosshair" id="cross"></div>
      <div class="timer"><span>TIME</span><strong id="timer">0:00.00</strong></div>
      <div class="prompt" id="prompt"></div>
      <div class="hint" id="hint"></div>
      <div class="toast" id="toast"></div>
      <section class="card pause-card hidden" id="pause">
        <p class="eyebrow">Paused</p>
        <h2>HOLDING</h2>
        <div class="actions">
          <button type="button" id="btn-resume" class="primary">Resume</button>
          <button type="button" id="btn-restart">Restart run</button>
          <button type="button" id="btn-menu">Main menu</button>
        </div>
        <label class="slider">Mouse sensitivity
          <input id="p-sens" type="range" min="0.4" max="2" step="0.05" />
        </label>
        <label class="slider">Camera motion
          <input id="p-motion" type="range" min="0" max="1" step="0.05" />
        </label>
      </section>
      <section class="card finish-card hidden" id="finish">
        <p class="eyebrow">Rooftop Flow</p>
        <h2>LEVEL COMPLETE</h2>
        <p class="finish-time" id="finish-time">0:00.00</p>
        <p class="best" id="finish-best"></p>
        <div class="actions">
          <button type="button" id="btn-again" class="primary">Run again</button>
          <button type="button" id="btn-finish-menu">Main menu</button>
        </div>
      </section>
    `;
    this.root = root;
    this.timerEl = root.querySelector('#timer') as HTMLElement;
    this.hintEl = root.querySelector('#hint') as HTMLElement;
    this.promptEl = root.querySelector('#prompt') as HTMLElement;
    this.toastEl = root.querySelector('#toast') as HTMLElement;
    this.cross = root.querySelector('#cross') as HTMLElement;
    this.pause = root.querySelector('#pause') as HTMLElement;
    this.finish = root.querySelector('#finish') as HTMLElement;
    this.finishTime = root.querySelector('#finish-time') as HTMLElement;
    this.finishBest = root.querySelector('#finish-best') as HTMLElement;
    this.sens = root.querySelector('#p-sens') as HTMLInputElement;
    this.motion = root.querySelector('#p-motion') as HTMLInputElement;
    this.sens.value = String(settings.sensitivity);
    this.motion.value = String(settings.motion);

    root.querySelector('#btn-resume')?.addEventListener('click', () => this.onResume?.());
    root.querySelector('#btn-restart')?.addEventListener('click', () => this.onRestart?.());
    root.querySelector('#btn-menu')?.addEventListener('click', () => this.onMenu?.());
    root.querySelector('#btn-again')?.addEventListener('click', () => this.onFinishRestart?.());
    root.querySelector('#btn-finish-menu')?.addEventListener('click', () => this.onMenu?.());
    const emit = () => this.onChange?.({ sensitivity: Number(this.sens.value), motion: Number(this.motion.value) });
    this.sens.addEventListener('input', emit);
    this.motion.addEventListener('input', emit);
  }

  setPlaying(): void {
    this.root.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.finish.classList.add('hidden');
    this.cross.classList.remove('hidden');
  }

  setPaused(settings: Settings): void {
    this.sens.value = String(settings.sensitivity);
    this.motion.value = String(settings.motion);
    this.pause.classList.remove('hidden');
    this.finish.classList.add('hidden');
  }

  setFinished(time: number, best: number, isNew: boolean): void {
    this.pause.classList.add('hidden');
    this.finish.classList.remove('hidden');
    this.cross.classList.add('hidden');
    this.finishTime.textContent = formatTime(time);
    this.finishBest.textContent = isNew ? `New best  ${formatTime(best)}` : `Best  ${formatTime(best)}`;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setTime(seconds: number): void {
    this.timerEl.textContent = formatTime(seconds);
  }

  setHint(text: string, prompt: string): void {
    const now = performance.now();
    if (text && text !== this.hintText) {
      this.hintText = text;
      this.hintUntil = now + 4200;
    }
    const showHint = now < this.hintUntil ? this.hintText : '';
    this.hintEl.textContent = prompt ? '' : showHint;
    this.hintEl.classList.toggle('show', !prompt && !!showHint);
    this.promptEl.textContent = prompt;
    this.promptEl.classList.toggle('show', !!prompt);
    this.cross.classList.toggle('hot', !!prompt);
    this.toastEl.classList.toggle('show', now < this.toastUntil);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastUntil = performance.now() + 1700;
    this.toastEl.classList.add('show');
  }

  syncSliders(settings: Settings): void {
    this.sens.value = String(settings.sensitivity);
    this.motion.value = String(settings.motion);
  }
}
