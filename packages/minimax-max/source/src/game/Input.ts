/**
 * Keyboard / mouse input with pointer lock.
 *
 * The class keeps the *state* of every key so the simulation can read it
 * every physics step, and exposes "pressed this frame" helpers for actions
 * that must happen exactly once (jump, slide, vault, ...).
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private locked = false;
  /** True while the browser reports a locked pointer. */
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code;
    if (!this.down.has(code)) this.pressedThisFrame.add(code);
    this.down.add(code);
    // Stop the browser from scrolling / opening quick-find while playing.
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      event.preventDefault();
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  private onBlur = (): void => {
    this.down.clear();
    this.pressedThisFrame.clear();
  };

  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) {
      this.down.clear();
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    this.onLockChange?.(this.locked);
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDX += event.movementX;
    this.mouseDY += event.movementY;
  };

  /** Requests pointer lock (must be called from a user gesture). */
  requestLock(): void {
    const element = this.element as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    if (document.pointerLockElement === element) return;
    try {
      const result = element.requestPointerLock?.();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* browser refused the lock - the game stays paused */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isLocked(): boolean {
    return this.locked;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True only on the frame the key transitioned to pressed. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** Returns and clears the accumulated mouse movement. */
  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

  /** Call at the end of every rendered frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
