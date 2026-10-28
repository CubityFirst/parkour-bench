import { formatTime, type GameState } from '../game/GameState';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onRestartLevel: () => void;
  onQuitToMenu: () => void;
  onSettingsChange: () => void;
}

/** Handles every full screen overlay of the game. */
export class Menu {
  private readonly menu: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly complete: HTMLElement;
  private readonly loading: HTMLElement;

  private readonly sensSlider: HTMLInputElement;
  private readonly motionSlider: HTMLInputElement;
  private readonly sensSliderPause: HTMLInputElement;
  private readonly motionSliderPause: HTMLInputElement;
  private readonly bloomToggle: HTMLInputElement;
  private readonly soundToggle: HTMLInputElement;

  constructor(
    private readonly state: GameState,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.menu = must('menu');
    this.controls = must('controls');
    this.pause = must('pause');
    this.complete = must('complete');
    this.loading = must('loading');

    this.sensSlider = must('sensSlider') as HTMLInputElement;
    this.motionSlider = must('motionSlider') as HTMLInputElement;
    this.sensSliderPause = must('sensSliderPause') as HTMLInputElement;
    this.motionSliderPause = must('motionSliderPause') as HTMLInputElement;
    this.bloomToggle = must('bloomToggle') as HTMLInputElement;
    this.soundToggle = must('soundToggle') as HTMLInputElement;

    this.bindControls();
    this.syncSettings();
    this.updateBest();
  }

  private bindControls(): void {
    must('btnStart').addEventListener('click', () => this.callbacks.onStart());
    must('btnControls').addEventListener('click', () => this.showControls());
    must('btnControlsBack').addEventListener('click', () => this.hideControls());
    must('btnResume').addEventListener('click', () => this.callbacks.onResume());
    must('btnCheckpoint').addEventListener('click', () => this.callbacks.onRestartCheckpoint());
    must('btnRestart').addEventListener('click', () => this.callbacks.onRestartLevel());
    must('btnQuit').addEventListener('click', () => this.callbacks.onQuitToMenu());
    must('btnAgain').addEventListener('click', () => this.callbacks.onRestartLevel());
    must('btnMenu').addEventListener('click', () => this.callbacks.onQuitToMenu());

    const applySensitivity = (value: number): void => {
      this.state.settings.sensitivity = value;
      this.syncSettings();
      this.state.saveSettings();
      this.callbacks.onSettingsChange();
    };
    const applyMotion = (value: number): void => {
      this.state.settings.cameraMotion = value;
      this.syncSettings();
      this.state.saveSettings();
      this.callbacks.onSettingsChange();
    };

    this.sensSlider.addEventListener('input', () => applySensitivity(Number(this.sensSlider.value)));
    this.sensSliderPause.addEventListener('input', () =>
      applySensitivity(Number(this.sensSliderPause.value)),
    );
    this.motionSlider.addEventListener('input', () => applyMotion(Number(this.motionSlider.value)));
    this.motionSliderPause.addEventListener('input', () =>
      applyMotion(Number(this.motionSliderPause.value)),
    );

    this.bloomToggle.addEventListener('change', () => {
      this.state.settings.bloom = this.bloomToggle.checked;
      this.state.saveSettings();
      this.callbacks.onSettingsChange();
    });
    this.soundToggle.addEventListener('change', () => {
      this.state.settings.sound = this.soundToggle.checked;
      this.state.saveSettings();
      this.callbacks.onSettingsChange();
    });
  }

  /** Pushes the current settings into every control. */
  syncSettings(): void {
    const { sensitivity, cameraMotion, bloom, sound } = this.state.settings;
    this.sensSlider.value = String(sensitivity);
    this.sensSliderPause.value = String(sensitivity);
    this.motionSlider.value = String(cameraMotion);
    this.motionSliderPause.value = String(cameraMotion);
    this.bloomToggle.checked = bloom;
    this.soundToggle.checked = sound;
    must('sensValue').textContent = sensitivity.toFixed(2);
    must('sensValuePause').textContent = sensitivity.toFixed(2);
    must('motionValue').textContent = `${Math.round(cameraMotion * 100)}%`;
    must('motionValuePause').textContent = `${Math.round(cameraMotion * 100)}%`;
  }

  updateBest(): void {
    const element = must('bestTime');
    element.textContent = this.state.bestTime === null ? '--:--.--' : formatTime(this.state.bestTime);
  }

  hideLoading(): void {
    this.loading.classList.add('is-hidden');
  }

  showMenu(): void {
    this.menu.classList.remove('is-hidden');
    this.hideControls();
    this.pause.classList.add('is-hidden');
    this.complete.classList.add('is-hidden');
    this.updateBest();
  }

  hideMenu(): void {
    this.menu.classList.add('is-hidden');
    this.hideControls();
  }

  showControls(): void {
    this.controls.classList.remove('is-hidden');
  }

  hideControls(): void {
    this.controls.classList.add('is-hidden');
  }

  showPause(): void {
    this.pause.classList.remove('is-hidden');
  }

  hidePause(): void {
    this.pause.classList.add('is-hidden');
  }

  showComplete(time: number, best: number, falls: number, isRecord: boolean): void {
    must('finalTime').textContent = formatTime(time);
    must('finalBest').textContent = formatTime(best);
    must('finalFalls').textContent = String(falls);
    const title = document.querySelector('.panel-title-red');
    if (title) title.textContent = isRecord ? 'NEW RECORD' : 'LEVEL COMPLETE';
    this.complete.classList.remove('is-hidden');
  }

  hideComplete(): void {
    this.complete.classList.add('is-hidden');
  }
}

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: #${id}`);
  return element;
}
