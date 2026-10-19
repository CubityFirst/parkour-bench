import type { Settings } from '../game/types';
import { formatTime } from './format';

export class Menu {
  private root: HTMLElement;
  private main: HTMLElement;
  private controls: HTMLElement;
  private bestEl: HTMLElement;
  private sens: HTMLInputElement;
  private motion: HTMLInputElement;

  onStart: (() => void) | null = null;
  onChange: ((settings: Settings) => void) | null = null;

  constructor(overlay: HTMLElement, settings: Settings) {
    overlay.innerHTML = `
      <section class="card menu-card" id="menu-main">
        <p class="eyebrow">First-person parkour</p>
        <h1>ROOFTOP<br />FLOW</h1>
        <p class="lede">Sprint the white roofs. Red means go.</p>
        <p class="best" id="menu-best"></p>
        <div class="actions">
          <button type="button" id="btn-start" class="primary">Start run</button>
          <button type="button" id="btn-controls">Controls</button>
        </div>
        <label class="slider">Mouse sensitivity
          <input id="sens" type="range" min="0.4" max="2" step="0.05" />
        </label>
        <label class="slider">Camera motion
          <input id="motion" type="range" min="0" max="1" step="0.05" />
        </label>
      </section>
      <section class="card menu-card hidden" id="menu-controls">
        <p class="eyebrow">Controls</p>
        <h2>HOW TO RUN</h2>
        <ul class="keys">
          <li><span>WASD</span> Move</li>
          <li><span>Mouse</span> Look</li>
          <li><span>Shift</span> Sprint</li>
          <li><span>Space</span> Jump</li>
          <li><span>Ctrl / C</span> Slide</li>
          <li><span>E</span> Vault</li>
          <li><span>R</span> Restart checkpoint</li>
          <li><span>Esc</span> Pause</li>
        </ul>
        <p class="note">Jump at a red wall to run it. Jump off, or stay on until the next roof catches you. Fall and you return to the last checkpoint.</p>
        <button type="button" id="btn-back" class="primary">Back</button>
      </section>
    `;
    this.root = overlay;
    this.main = overlay.querySelector('#menu-main') as HTMLElement;
    this.controls = overlay.querySelector('#menu-controls') as HTMLElement;
    this.bestEl = overlay.querySelector('#menu-best') as HTMLElement;
    this.sens = overlay.querySelector('#sens') as HTMLInputElement;
    this.motion = overlay.querySelector('#motion') as HTMLInputElement;
    this.sens.value = String(settings.sensitivity);
    this.motion.value = String(settings.motion);

    overlay.querySelector('#btn-start')?.addEventListener('click', () => this.onStart?.());
    overlay.querySelector('#btn-controls')?.addEventListener('click', () => {
      this.main.classList.add('hidden');
      this.controls.classList.remove('hidden');
    });
    overlay.querySelector('#btn-back')?.addEventListener('click', () => {
      this.controls.classList.add('hidden');
      this.main.classList.remove('hidden');
    });
    const emit = () => {
      this.onChange?.({
        sensitivity: Number(this.sens.value),
        motion: Number(this.motion.value),
      });
    };
    this.sens.addEventListener('input', emit);
    this.motion.addEventListener('input', emit);
  }

  show(best: number | null): void {
    this.root.classList.remove('hidden');
    this.main.classList.remove('hidden');
    this.controls.classList.add('hidden');
    this.bestEl.textContent = best !== null ? `Best  ${formatTime(best)}` : 'No best time yet';
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  settings(): Settings {
    return { sensitivity: Number(this.sens.value), motion: Number(this.motion.value) };
  }
}
