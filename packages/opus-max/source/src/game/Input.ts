/**
 * Keyboard and mouse input.
 *
 * Key presses are latched until the next physics step consumes them, so a tap that is
 * shorter than a frame is never lost. Mouse look uses Pointer Lock when available; if the
 * browser refuses the lock, dragging with the left button looks around instead.
 */

export type Action = 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'crouch' | 'interact' | 'restart' | 'pause';

const BINDINGS: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
  KeyE: 'interact',
  KeyF: 'interact',
  KeyR: 'restart',
  Escape: 'pause',
};

/** Keys whose default browser behaviour (scrolling, shortcuts) must not run during play. */
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight', 'Tab']);

export class Input {
  /** Physical keys currently down (several keys can map to one action). */
  private readonly heldCodes = new Set<string>();
  private readonly pressed = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private dragging = false;
  private lockedSince = 0;
  /** True while gameplay should receive input (not in menus). */
  enabled = false;
  pointerLocked = false;
  /** Fired when the pointer lock is lost after having been held for a moment (e.g. Esc). */
  onLockLost: (() => void) | null = null;
  onPausePressed: (() => void) | null = null;
  onRestartPressed: (() => void) | null = null;
  /** Fired for any gameplay key press (used to start the run timer). */
  onActivity: (() => void) | null = null;
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.clear);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isHeld(a: Action): boolean {
    for (const code of this.heldCodes) if (BINDINGS[code] === a) return true;
    return false;
  }

  /** Returns true once per press. */
  consume(a: Action): boolean {
    if (!this.pressed.has(a)) return false;
    this.pressed.delete(a);
    return true;
  }

  /** Accumulated mouse movement since the last call, in pixels. */
  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Movement axes from the held keys. */
  axes(): [number, number] {
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const z = (this.isHeld('forward') ? 1 : 0) - (this.isHeld('back') ? 1 : 0);
    return [x, z];
  }

  clearPresses(): void {
    this.pressed.clear();
  }

  readonly clear = (): void => {
    this.heldCodes.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.dragging = false;
  };

  requestPointerLock(): void {
    if (document.pointerLockElement === this.target) return;
    try {
      // Newer browsers return a promise that rejects when the lock is refused.
      const result = this.target.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => this.onLockError());
      }
    } catch {
      this.onLockError();
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const action = BINDINGS[e.code];
    if (!this.enabled) return;
    if (BLOCK_DEFAULT.has(e.code) || (e.ctrlKey && action)) e.preventDefault();
    if (!action) return;
    if (e.repeat) return;
    if (action === 'pause') {
      this.onPausePressed?.();
      return;
    }
    if (action === 'restart') {
      this.onRestartPressed?.();
      return;
    }
    this.heldCodes.add(e.code);
    this.pressed.add(action);
    this.onActivity?.();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.heldCodes.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (!this.pointerLocked && !this.dragging) return;
    // Some browsers report huge spikes when the lock engages; ignore them.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (!this.pointerLocked) {
      this.requestPointerLock();
      if (e.button === 0) this.dragging = true;
    }
  };

  private readonly onMouseUp = (): void => {
    this.dragging = false;
  };

  private readonly onLockChange = (): void => {
    const locked = document.pointerLockElement === this.target;
    if (locked) {
      this.pointerLocked = true;
      this.dragging = false;
      this.lockedSince = performance.now();
      return;
    }
    const heldFor = performance.now() - this.lockedSince;
    this.pointerLocked = false;
    this.clear();
    // Ignore a lock that drops immediately (some headless/embedded browsers do this).
    if (heldFor > 250) this.onLockLost?.();
  };

  private readonly onLockError = (): void => {
    this.pointerLocked = false;
  };
}
