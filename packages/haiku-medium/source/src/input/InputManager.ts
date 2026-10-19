/**
 * Keyboard and mouse input. Keys are tracked as "held" flags plus one-shot
 * "pressed this frame" flags that are cleared by `endFrame()`.
 */
export class InputManager {
  private held = new Set<string>();
  private pressed = new Set<string>();
  /** Accumulated mouse movement since the last `endFrame()`, in pixels. */
  mouseDX = 0;
  mouseDY = 0;
  /** Set when pointer lock is active, so the game knows whether to read mouse deltas. */
  locked = false;

  /** Keys we listen for that the game also uses; prevents the browser scrolling on Space. */
  private static readonly PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (InputManager.PREVENT.has(e.code)) e.preventDefault();
      if (!this.held.has(e.code)) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Convenience: left/right/forward/back as -1..1 (x = strafe, y = forward). */
  moveAxes(): { x: number; y: number } {
    const x = (this.isDown('KeyD') ? 1 : 0) - (this.isDown('KeyA') ? 1 : 0);
    const y = (this.isDown('KeyW') ? 1 : 0) - (this.isDown('KeyS') ? 1 : 0);
    return { x, y };
  }

  /** Call once per rendered frame after the game has read input. */
  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Clears all held keys (used when the game is paused or menus open). */
  releaseAll(): void {
    this.held.clear();
    this.pressed.clear();
  }
}
