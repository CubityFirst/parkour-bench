/**
 * Keyboard and mouse state. Held keys are polled each frame; presses (edges) are
 * latched until `endFrame`, so a tap between two frames is never lost.
 */
export class Input {
  /** True while the pointer is captured, i.e. mouse deltas are gameplay look input. */
  locked = false;

  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;

  constructor() {
    window.addEventListener('keydown', (event) => {
      if (this.locked && event.code === 'Space') event.preventDefault();
      if (!event.repeat) this.pressed.add(event.code);
      this.held.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.held.delete(event.code));
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.mouseX += event.movementX;
      this.mouseY += event.movementY;
    });
  }

  isHeld(...codes: string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((code) => this.pressed.has(code));
  }

  consumeMouse(): { x: number; y: number } {
    const delta = { x: this.mouseX, y: this.mouseY };
    this.mouseX = 0;
    this.mouseY = 0;
    return delta;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
