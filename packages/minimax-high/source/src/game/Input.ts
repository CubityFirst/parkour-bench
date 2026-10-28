/**
 * Keyboard / mouse input with pointer-lock support.
 *
 * `down` holds the currently pressed keys, `pressed` holds keys that went
 * down since the last call to `endFrame()` (single-shot actions).
 */
export class Input {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();

  mouseDX = 0;
  mouseDY = 0;
  locked = false;

  /** Sensitivity multiplier applied by the camera rig. */
  sensitivity = 1;

  private readonly canvas: HTMLCanvasElement;
  private readonly onLockChange: (locked: boolean) => void;

  constructor(canvas: HTMLCanvasElement, onLockChange: (locked: boolean) => void) {
    this.canvas = canvas;
    this.onLockChange = onLockChange;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    canvas.addEventListener('mousedown', this.handleCanvasMouseDown);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const code = event.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Tab'
    ) {
      event.preventDefault();
    }
    this.down.add(code);
    this.pressed.add(code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  private handleBlur = (): void => {
    this.down.clear();
  };

  private handleLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.down.clear();
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    this.onLockChange(this.locked);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDX += event.movementX || 0;
    this.mouseDY += event.movementY || 0;
  };

  private handleCanvasMouseDown = (): void => {
    if (!this.locked) this.requestLock();
  };

  requestLock(): void {
    const el = this.canvas as HTMLCanvasElement & { requestPointerLock?: () => Promise<void> };
    if (el.requestPointerLock) {
      const result = el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Called at the end of every rendered frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handleLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleCanvasMouseDown);
  }
}
