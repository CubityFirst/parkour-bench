/**
 * Input - keyboard + mouse (Pointer Lock) handling.
 *
 * Keyboard state is sampled into a PlayerInput for each fixed physics step. "Pressed"
 * edges are latched until the game loop consumes them, so a key tap is never lost even
 * if a rendered frame runs zero physics steps.
 *
 * If the browser refuses pointer lock (iframes, some embedded browsers) the game falls
 * back to "drag to look" so it stays playable.
 */

import { type PlayerInput } from '../player/PlayerController';

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'ControlLeft', 'ControlRight', 'KeyC', 'KeyE', 'KeyR',
]);

export interface InputCallbacks {
  onLockChange(locked: boolean): void;
  onLockError(): void;
  onRestartCheckpoint(): void;
  onPauseKey(): void;
  onToggleDebug(): void;
}

export class Input {
  private readonly down = new Set<string>();
  private jumpEdge = false;
  private slideEdge = false;
  private interactEdge = false;
  /** Accumulated mouse movement since the last read. */
  private dx = 0;
  private dy = 0;
  private dragging = false;
  private lockTimer = 0;

  enabled = false;
  locked = false;
  /** True when pointer lock is unavailable and drag-to-look is used instead. */
  dragMode = false;

  constructor(private readonly element: HTMLElement, private readonly cb: InputCallbacks) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    window.clearTimeout(this.lockTimer);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    this.element.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('contextmenu', this.onContextMenu);
  }

  // ---------------------------------------------------------------- pointer lock

  requestLock(): void {
    this.dragMode = false;
    window.clearTimeout(this.lockTimer);
    try {
      const result = this.element.requestPointerLock() as unknown;
      // Newer browsers return a promise that rejects on failure.
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => this.cb.onLockError());
      }
    } catch {
      this.cb.onLockError();
      return;
    }
    // Some embedded browsers neither lock nor report an error: treat silence as failure.
    this.lockTimer = window.setTimeout(() => {
      if (!this.locked && this.enabled && !this.dragMode) this.cb.onLockError();
    }, 900);
  }

  exitLock(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  /** Switch to drag-to-look (called by the game after a lock failure). */
  enableDragMode(): void {
    this.dragMode = true;
  }

  private readonly onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (this.locked) {
      this.dragMode = false; // lock works after all
      window.clearTimeout(this.lockTimer);
    }
    else this.down.clear();
    this.cb.onLockChange(this.locked);
  };

  private readonly onLockError = (): void => {
    this.cb.onLockError();
  };

  // ---------------------------------------------------------------- events

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.enabled && GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;

    if (e.code === 'Backquote' || e.code === 'F3') {
      this.cb.onToggleDebug();
      return;
    }
    if (!this.enabled) return;

    this.down.add(e.code);
    switch (e.code) {
      case 'Space': this.jumpEdge = true; break;
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyC': this.slideEdge = true; break;
      case 'KeyE': this.interactEdge = true; break;
      case 'KeyR': this.cb.onRestartCheckpoint(); break;
      case 'Escape':
      case 'KeyP':
        // With pointer lock the browser consumes Escape itself; in drag mode we handle it.
        if (this.dragMode) this.cb.onPauseKey();
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
    this.dragging = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.locked || (this.dragMode && this.dragging)) {
      // Guard against the occasional huge spike some browsers emit when the lock engages.
      this.dx += Math.max(-250, Math.min(250, e.movementX));
      this.dy += Math.max(-250, Math.min(250, e.movementY));
    }
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.dragging = true;
  };

  private readonly onMouseUp = (): void => {
    this.dragging = false;
  };

  private readonly onContextMenu = (e: Event): void => {
    if (this.enabled) e.preventDefault();
  };

  // ---------------------------------------------------------------- sampling

  private key(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Fills `out` with the current held state and latched edges (edges are NOT cleared). */
  sample(out: PlayerInput): void {
    const f = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    const b = this.key('KeyS', 'ArrowDown') ? 1 : 0;
    const r = this.key('KeyD', 'ArrowRight') ? 1 : 0;
    const l = this.key('KeyA', 'ArrowLeft') ? 1 : 0;
    out.moveZ = f - b;
    out.moveX = r - l;
    out.sprint = this.key('ShiftLeft', 'ShiftRight');
    out.jumpHeld = this.key('Space');
    out.slideHeld = this.key('ControlLeft', 'ControlRight', 'KeyC');
    out.jumpPressed = this.jumpEdge;
    out.slidePressed = this.slideEdge;
    out.interactPressed = this.interactEdge;
  }

  /** Clears latched edges; call once after the physics steps of a frame ran. */
  consumeEdges(): void {
    this.jumpEdge = false;
    this.slideEdge = false;
    this.interactEdge = false;
  }

  /** Returns and clears accumulated mouse movement. */
  consumeMouse(out: { x: number; y: number }): void {
    out.x = this.dx;
    out.y = this.dy;
    this.dx = 0;
    this.dy = 0;
  }

  /** Forget everything (used when the game pauses / respawns). */
  reset(): void {
    this.down.clear();
    this.jumpEdge = this.slideEdge = this.interactEdge = false;
    this.dx = this.dy = 0;
  }
}
