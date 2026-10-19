/** What the player wants to do during one fixed physics step. */
export interface MoveInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jumpHeld: boolean;
  /** True only on the first step after the jump key goes down. */
  jumpPressed: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
}

/** Keys that are edge-triggered. Held state is tracked separately for everything else. */
const EDGE_KEYS = new Set(['Space', 'ControlLeft', 'ControlRight', 'KeyC', 'KeyE', 'KeyR', 'Escape', 'KeyM']);

/** Keys the game uses. Their default browser action is suppressed while playing (e.g. Space scrolling). */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'Space',
  'ControlLeft',
  'ControlRight',
  'KeyC',
  'KeyE',
  'KeyR',
]);

/**
 * Collects keyboard and mouse state. Held keys are polled each physics step. One-shot presses
 * are queued and consumed exactly once, so they can be buffered by the controller.
 */
export class InputManager {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private locked = false;
  /** Fallback look when pointer lock is unavailable: hold the left button and drag. */
  private dragging = false;

  constructor() {
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.held.delete(event.code));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('mousedown', (event) => {
      if (event.button === 0 && !this.locked) this.dragging = true;
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    window.addEventListener('mousemove', (event) => {
      if (!this.locked && !this.dragging) return;
      this.lookX += event.movementX;
      this.lookY += event.movementY;
    });
  }

  /** Mouse look only accumulates while the pointer is locked to the game. */
  setLocked(locked: boolean): void {
    this.locked = locked;
    if (!locked) this.reset();
  }

  /** Snapshot of held keys plus this step's edge-triggered presses. */
  sample(): MoveInput {
    return {
      forward: this.isHeld('KeyW', 'ArrowUp'),
      back: this.isHeld('KeyS', 'ArrowDown'),
      left: this.isHeld('KeyA', 'ArrowLeft'),
      right: this.isHeld('KeyD', 'ArrowRight'),
      sprint: this.isHeld('ShiftLeft', 'ShiftRight'),
      jumpHeld: this.isHeld('Space'),
      jumpPressed: this.takePress('Space'),
      slidePressed: this.takePress('ControlLeft', 'ControlRight', 'KeyC'),
      vaultPressed: this.takePress('KeyE'),
    };
  }

  isHeld(...codes: string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }

  /** Returns true once if any of the given keys was pressed since it was last taken. */
  takePress(...codes: string[]): boolean {
    let taken = false;
    for (const code of codes) {
      if (this.pressed.delete(code)) taken = true;
    }
    return taken;
  }

  /** Drops queued one-shot presses, e.g. ones made on a menu before the run starts. */
  clearPresses(): void {
    this.pressed.clear();
  }

  /** Mouse movement since the last call, in pixels. */
  takeLook(): { x: number; y: number } {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.locked && GAME_KEYS.has(event.code)) event.preventDefault();
    this.held.add(event.code);
    if (!event.repeat && EDGE_KEYS.has(event.code)) this.pressed.add(event.code);
  }

  private reset(): void {
    this.held.clear();
    this.pressed.clear();
  }
}
