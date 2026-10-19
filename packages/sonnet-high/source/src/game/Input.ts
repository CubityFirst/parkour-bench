import type { PlayerInput } from '../player/PlayerController.ts';

const MAX_PITCH = (89 * Math.PI) / 180;
/** Radians per pixel at sensitivity 1.0. */
const BASE_SENSITIVITY = 0.0022;

/**
 * Keyboard + mouse input. Mouse look is applied immediately per frame (low latency); button /
 * key *edges* are latched until a physics tick consumes them so nothing is lost on frames that
 * run zero fixed steps.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  /** Fallback when the Pointer Lock API is unavailable: drag with the mouse to look. */
  dragLook = false;
  /** Raised for one frame when R was pressed. */
  restartRequested = false;
  /** Raised when Escape was pressed while not pointer-locked (drag-look mode). */
  escapeRequested = false;

  private readonly down = new Set<string>();
  private jumpEdge = false;
  private slideEdge = false;
  private vaultEdge = false;
  private dragging = false;
  private active = false;
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  /** Enable / disable gameplay input (disabled while menus are open). */
  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.clear();
  }

  clear = (): void => {
    this.down.clear();
    this.jumpEdge = this.slideEdge = this.vaultEdge = false;
    this.dragging = false;
  };

  private isGameKey(code: string): boolean {
    return (
      code === 'Space' ||
      code === 'ControlLeft' ||
      code === 'ControlRight' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight' ||
      code === 'Tab' ||
      code.startsWith('Arrow') ||
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'KeyC' ||
      code === 'KeyE' ||
      code === 'KeyR'
    );
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (this.isGameKey(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    switch (e.code) {
      case 'Space':
        this.jumpEdge = true;
        break;
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyC':
        this.slideEdge = true;
        break;
      case 'KeyE':
        this.vaultEdge = true;
        break;
      case 'KeyR':
        this.restartRequested = true;
        break;
      case 'Escape':
        this.escapeRequested = true;
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onMouseDown = (): void => {
    if (this.active && this.dragLook) this.dragging = true;
  };
  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.active) return;
    const locked = document.pointerLockElement === this.target;
    if (!locked && !(this.dragLook && this.dragging)) return;
    const dx = e.movementX;
    const dy = e.movementY;
    // Some browsers occasionally report a huge spurious delta right after locking.
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
    const s = BASE_SENSITIVITY * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    // keep yaw bounded
    if (this.yaw > Math.PI * 2 || this.yaw < -Math.PI * 2) this.yaw %= Math.PI * 2;
  };

  held(code: string): boolean {
    return this.down.has(code);
  }

  /** Snapshot for one physics tick. Call `clearEdges()` after the first tick of a frame. */
  snapshot(): PlayerInput {
    const k = this.down;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return {
      moveX: strafe,
      moveY: forward,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      jumpHeld: k.has('Space'),
      jumpPressed: this.jumpEdge,
      slideHeld: k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC'),
      slidePressed: this.slideEdge,
      vaultPressed: this.vaultEdge,
      yaw: this.yaw,
    };
  }

  clearEdges(): void {
    this.jumpEdge = this.slideEdge = this.vaultEdge = false;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
  }
}
