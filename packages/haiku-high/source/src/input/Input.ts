/**
 * Keyboard and mouse state. Keys are tracked by `KeyboardEvent.code` so layouts
 * do not matter. "Pressed this frame" flags are cleared once per fixed step.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressedThisStep = new Set<string>();
  private readonly releasedThisStep = new Set<string>();
  /** Mouse movement accumulated since the last call to `consumeMouse`. */
  private mouseX = 0;
  private mouseY = 0;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedThisStep.add(e.code);
      // Stop Space/arrows from scrolling the page and Ctrl+key from triggering browser shortcuts.
      if (['Space', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedThisStep.add(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.target) {
        this.mouseX += e.movementX;
        this.mouseY += e.movementY;
      }
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True if the key went down since the last `endStep`. */
  wasPressed(code: string): boolean {
    return this.pressedThisStep.has(code);
  }

  /** True if the key was released since the last `endStep`. */
  wasReleased(code: string): boolean {
    return this.releasedThisStep.has(code);
  }

  /** Jump is held on either Space key (the only jump binding). */
  get jumpHeld(): boolean {
    return this.isDown('Space');
  }

  get slideDown(): boolean {
    return this.isDown('ControlLeft') || this.isDown('ControlRight') || this.isDown('KeyC');
  }

  /** Returns and clears accumulated mouse movement. */
  consumeMouse(): { x: number; y: number } {
    const out = { x: this.mouseX, y: this.mouseY };
    this.mouseX = 0;
    this.mouseY = 0;
    return out;
  }

  /** Clears one-shot flags. Call once after each fixed physics step. */
  endStep(): void {
    this.pressedThisStep.clear();
    this.releasedThisStep.clear();
  }

  /** Forgets held keys, e.g. when the window loses focus or the game pauses. */
  releaseAll(): void {
    this.down.clear();
    this.pressedThisStep.clear();
    this.releasedThisStep.clear();
    this.mouseX = 0;
    this.mouseY = 0;
  }
}
