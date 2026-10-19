import { PlayerInput, emptyInput } from '../player/PlayerController';

/** Keyboard + mouse state. Edge-triggered keys (jump/slide/vault) stay set until consumed. */
export class Input {
  private keys = new Set<string>();
  private jumpEdge = false;
  private slideEdge = false;
  private vaultEdge = false;
  private restartEdge = false;
  mouseDX = 0;
  mouseDY = 0;
  enabled = false;

  onRestart?: () => void;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('mousemove', this.mouseMove);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('mousemove', this.mouseMove);
  }

  clear = (): void => {
    this.keys.clear();
    this.jumpEdge = this.slideEdge = this.vaultEdge = false;
  };

  private keyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (['Space', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) { e.preventDefault(); return; }
    if (e.code === 'Space') this.jumpEdge = true;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') this.slideEdge = true;
    if (e.code === 'KeyE') this.vaultEdge = true;
    if (e.code === 'KeyR') { this.onRestart?.(); e.preventDefault(); }
    this.keys.add(e.code);
  };

  private keyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private mouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    const locked = document.pointerLockElement === this.target;
    // fallback: drag to look if pointer lock is unavailable
    if (locked || (e.buttons & 1)) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }
  };

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Builds the input for one fixed step. Edges are consumed with `consumeEdges`. */
  poll(yaw: number): PlayerInput {
    const i = emptyInput();
    i.moveZ = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    i.moveX = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    i.sprint = this.down('ShiftLeft', 'ShiftRight');
    i.jumpHeld = this.down('Space');
    i.jumpPressed = this.jumpEdge;
    i.slideHeld = this.down('ControlLeft', 'ControlRight', 'KeyC');
    i.slidePressed = this.slideEdge;
    i.vaultPressed = this.vaultEdge;
    i.yaw = yaw;
    return i;
  }

  consumeEdges(): void {
    this.jumpEdge = this.slideEdge = this.vaultEdge = false;
  }

  /** True when any movement key is held (starts the run timer). */
  get anyMovement(): boolean {
    return this.down('KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
  }

  takeMouse(): [number, number] {
    const r: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return r;
  }
}
