import type { PlayerInput } from '../player/PlayerController.ts';

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
  'Tab',
]);

/**
 * Keyboard + mouse input. Pointer Lock drives mouse look; if the browser refuses the lock (embedded
 * frames, automation) mouse look falls back to click-and-drag so the game stays fully playable.
 */
export class Input {
  private readonly keys = new Set<string>();
  private pressed = {
    jump: false,
    slide: false,
    vault: false,
    restart: false,
  };
  private lookX = 0;
  private lookY = 0;
  /** Not-yet-applied part of the mouse movement (very light smoothing, rotation is never lost). */
  private pendingX = 0;
  private pendingY = 0;
  private dragging = false;
  private readonly target: HTMLElement;

  /** Game input is ignored (and keys swallowed only) while this is false. */
  enabled = false;
  locked = false;
  /** True once pointer lock has been granted at least once during this session. */
  everLocked = false;
  /** True if the last lock request failed. */
  lockFailed = false;

  onLockChange: ((locked: boolean) => void) | null = null;
  onRestartPressed: (() => void) | null = null;
  onEscape: (() => void) | null = null;
  onAnyGameKey: (() => void) | null = null;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChanged);
    document.addEventListener('pointerlockerror', this.onLockError);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChanged);
    document.removeEventListener('pointerlockerror', this.onLockError);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
  }

  // ----------------------------------------------------------------------------------------
  // Pointer lock
  // ----------------------------------------------------------------------------------------

  requestLock(): void {
    const el = this.target as HTMLElement & { requestPointerLock: (opts?: unknown) => Promise<void> | void };
    if (document.pointerLockElement === el) return;
    this.lockFailed = false;
    try {
      // Raw (unaccelerated) mouse movement where supported.
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          try {
            const q = el.requestPointerLock();
            if (q && typeof (q as Promise<void>).catch === 'function') (q as Promise<void>).catch(() => this.markLockFailed());
          } catch {
            this.markLockFailed();
          }
        });
      }
    } catch {
      try {
        el.requestPointerLock();
      } catch {
        this.markLockFailed();
      }
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private markLockFailed(): void {
    this.lockFailed = true;
    this.locked = false;
    this.onLockChange?.(false);
  }

  private onLockChanged = (): void => {
    this.locked = document.pointerLockElement === this.target;
    if (this.locked) {
      this.everLocked = true;
      this.lockFailed = false;
      this.lookX = 0;
      this.lookY = 0;
    }
    this.onLockChange?.(this.locked);
  };

  private onLockError = (): void => {
    this.markLockFailed();
  };

  // ----------------------------------------------------------------------------------------
  // Keyboard
  // ----------------------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      this.onEscape?.();
      return;
    }
    if (!this.enabled) return;
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault();
      this.onAnyGameKey?.();
    }
    // Repeats still (re)register the key so a key held across a pause keeps working; only edges are gated.
    this.keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        this.pressed.jump = true;
        break;
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyC':
        this.pressed.slide = true;
        break;
      case 'KeyE':
        this.pressed.vault = true;
        break;
      case 'KeyR':
        this.pressed.restart = true;
        this.onRestartPressed?.();
        break;
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (GAME_KEYS.has(e.code) && this.enabled) e.preventDefault();
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  /** Drop all held keys (called when the game pauses so nothing sticks). */
  releaseAll(): void {
    this.keys.clear();
    this.pressed.jump = this.pressed.slide = this.pressed.vault = this.pressed.restart = false;
    this.lookX = this.lookY = 0;
    this.pendingX = this.pendingY = 0;
  }

  // ----------------------------------------------------------------------------------------
  // Mouse
  // ----------------------------------------------------------------------------------------

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (!(this.locked || this.dragging)) return;
    // Chromium occasionally reports a huge bogus delta right after the lock starts.
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (e.button === 0) {
      this.dragging = true;
      // A click is a user gesture: always (re)try the lock when we do not have it.
      if (!this.locked) this.requestLock();
    }
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onContextMenu = (e: Event): void => {
    if (this.enabled) e.preventDefault();
  };

  /**
   * Mouse movement (pixels) to apply this frame. A tiny exponential filter (~9 ms) evens out the
   * irregular event delivery of high-polling-rate mice while conserving the total rotation.
   */
  consumeLook(out: { dx: number; dy: number }, dt = 1 / 60): void {
    this.pendingX += this.lookX;
    this.pendingY += this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    const k = 1 - Math.exp(-dt / 0.009);
    out.dx = this.pendingX * k;
    out.dy = this.pendingY * k;
    this.pendingX -= out.dx;
    this.pendingY -= out.dy;
    // Never carry a sub-pixel remainder forever.
    if (Math.abs(this.pendingX) < 0.01) this.pendingX = 0;
    if (Math.abs(this.pendingY) < 0.01) this.pendingY = 0;
  }

  // ----------------------------------------------------------------------------------------
  // Player intent
  // ----------------------------------------------------------------------------------------

  /** Fill the continuous parts (axes + held keys) of a PlayerInput. Edge flags are handled separately. */
  readHeld(input: PlayerInput): void {
    const k = this.keys;
    input.moveY = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    input.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    input.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    input.jumpHeld = k.has('Space');
    input.slideHeld = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
  }

  /** Take (and clear) the edge-triggered presses accumulated since the last call. */
  consumePresses(input: PlayerInput): void {
    input.jumpPressed = this.pressed.jump;
    input.slidePressed = this.pressed.slide;
    input.vaultPressed = this.pressed.vault;
    this.pressed.jump = false;
    this.pressed.slide = false;
    this.pressed.vault = false;
    this.pressed.restart = false;
  }

  /** True if any movement key is currently held (used to start the run timer). */
  anyMovementHeld(): boolean {
    const k = this.keys;
    return (
      k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD') || k.has('ArrowUp') || k.has('ArrowDown') ||
      k.has('ArrowLeft') || k.has('ArrowRight') || k.has('Space')
    );
  }
}
