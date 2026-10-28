/**
 * Keyboard + pointer-lock mouse input.
 *
 * Edge-triggered state (`justPressed` / `justReleased`) is cleared once per
 * rendered frame by the game loop, so a single key press can never be consumed
 * twice by the fixed-timestep physics.
 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  mouseDX = 0;
  mouseDY = 0;
  locked = false;

  private domElement: HTMLElement;
  private lockListeners: Array<(locked: boolean) => void> = [];

  constructor(domElement: HTMLElement) {
    this.domElement = domElement;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Stop the browser from scrolling / activating buttons with the game keys.
      if (
        e.code === 'Space' ||
        e.code === 'Tab' ||
        e.code.startsWith('Arrow') ||
        (e.code === 'KeyR' && this.locked)
      ) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.domElement;
      if (!this.locked) this.keys.clear();
      for (const fn of this.lockListeners) fn(this.locked);
    });

    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
    });
  }

  onLockChange(fn: (locked: boolean) => void): void {
    this.lockListeners.push(fn);
  }

  requestLock(): void {
    const el = this.domElement as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    const result = el.requestPointerLock?.();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => undefined);
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  justReleased(code: string): boolean {
    return this.released.has(code);
  }

  /** Movement axes in local space: x = strafe (+right), y = forward (+forward). */
  moveAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    return { x, y };
  }

  get crouchHeld(): boolean {
    return this.isDown('ControlLeft') || this.isDown('ControlRight') || this.isDown('KeyC');
  }

  get sprintHeld(): boolean {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
