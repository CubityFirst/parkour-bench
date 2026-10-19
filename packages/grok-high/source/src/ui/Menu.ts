import { clampSensitivity, saveSettings, type Settings } from '../game/GameState';

export interface MenuActions {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

/** Title, pause, and finish controls. Settings live on the shared object. */
export class Menu {
  constructor(
    private readonly root: ParentNode,
    private readonly settings: Settings,
    private readonly actions: MenuActions,
  ) {
    this.bind();
    this.reflect();
  }

  private bind(): void {
    this.click('#start', this.actions.onStart);
    this.click('#resume', this.actions.onResume);
    this.click('#restart', this.actions.onRestart);
    this.click('#quit', this.actions.onQuit);
    this.click('#finish-restart', this.actions.onRestart);
    this.click('#finish-quit', this.actions.onQuit);
    this.click('#controls-toggle', () => {
      const panel = this.root.querySelector('#controls');
      if (panel instanceof HTMLElement) panel.hidden = !panel.hidden;
    });

    const sens = this.root.querySelector('#sensitivity');
    sens?.addEventListener('input', () => {
      if (!(sens instanceof HTMLInputElement)) return;
      this.settings.sensitivity = clampSensitivity(Number(sens.value));
      saveSettings(this.settings);
      this.reflect();
    });

    const motion = this.root.querySelector('#motion');
    motion?.addEventListener('change', () => {
      if (!(motion instanceof HTMLInputElement)) return;
      this.settings.reducedMotion = motion.checked;
      saveSettings(this.settings);
    });
  }

  reflect(): void {
    const sens = this.root.querySelector('#sensitivity');
    const label = this.root.querySelector('#sensitivity-value');
    if (sens instanceof HTMLInputElement) sens.value = String(this.settings.sensitivity);
    if (label) label.textContent = this.settings.sensitivity.toFixed(2);
    const motion = this.root.querySelector('#motion');
    if (motion instanceof HTMLInputElement) motion.checked = this.settings.reducedMotion;
  }

  private click(selector: string, handler: () => void): void {
    this.root.querySelector(selector)?.addEventListener('click', (event) => {
      event.preventDefault();
      handler();
    });
  }
}
