// Keyboard + pointer-lock mouse input. State is read by the player controller
// each frame; `endFrame()` resets transient (edge-triggered / per-frame) values.

export interface MoveAxis {
  x: number; // -1 (left) .. 1 (right)
  z: number; // -1 (back) .. 1 (forward)
}

export class Input {
  private keys = new Set<string>();

  /** Accumulated mouse deltas (raw pixels) since the last frame. */
  lookDX = 0;
  lookDY = 0;

  /** Edge-triggered jump request (set on keydown, cleared at end of frame). */
  jumpPressed = false;
  jumpHeld = false;

  /** Edge-triggered vault request. */
  vaultPressed = false;

  /** Edge-triggered restart request. */
  restartPressed = false;

  /** True while a movement key is held. */
  get moving(): boolean {
    return (
      this.keys.has('KeyW') ||
      this.keys.has('KeyA') ||
      this.keys.has('KeyS') ||
      this.keys.has('KeyD')
    );
  }

  get sprintHeld(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  get slideHeld(): boolean {
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC');
  }

  get pausePressed(): boolean {
    return this.keys.has('Escape') || this.keys.has('KeyP');
  }

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      if (!this.keys.has('Space')) this.jumpPressed = true;
      this.jumpHeld = true;
    }
    if (e.code === 'KeyE') {
      if (!this.keys.has('KeyE')) this.vaultPressed = true;
    }
    if (e.code === 'KeyR') {
      if (!this.keys.has('KeyR')) this.restartPressed = true;
    }
    this.keys.add(e.code);
    // prevent default browser scrolling / page actions for gameplay keys
    if (
      e.code === 'Space' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight'
    ) {
      e.preventDefault();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.code === 'Space') this.jumpHeld = false;
  }

  private onMouseMove(e: MouseEvent): void {
    if (document.pointerLockElement) {
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    }
  }

  /** Normalized movement axis from WASD. */
  getMoveAxis(): MoveAxis {
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;

    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  /** Clear per-frame / edge-triggered values. Call once at the end of each frame. */
  endFrame(): void {
    this.lookDX = 0;
    this.lookDY = 0;
    this.jumpPressed = false;
    this.vaultPressed = false;
    this.restartPressed = false;
  }

  clearAll(): void {
    this.keys.clear();
    this.jumpHeld = false;
  }
}
