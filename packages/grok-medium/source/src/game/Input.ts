import type { InputFrame } from './types';

export class Input {
  forward = 0;
  strafe = 0;
  sprint = false;
  jumpHeld = false;
  slide = false;
  dx = 0;
  dy = 0;
  private jumpEdge = false;
  private vaultEdge = false;
  private keys = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpEdge = true;
      if (e.code === 'KeyE') this.vaultEdge = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) {
        void canvas.requestPointerLock();
      }
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  lock(): void {
    void this.canvas.requestPointerLock();
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  sample(): { frame: InputFrame; dx: number; dy: number } {
    const w = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const s = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const a = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const d = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    this.forward = (w ? 1 : 0) - (s ? 1 : 0);
    this.strafe = (d ? 1 : 0) - (a ? 1 : 0);
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.jumpHeld = this.keys.has('Space');
    this.slide = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC');
    const frame: InputFrame = {
      forward: this.forward,
      strafe: this.strafe,
      sprint: this.sprint,
      jumpHeld: this.jumpHeld,
      jumpPressed: this.jumpEdge,
      slide: this.slide,
      vaultPressed: this.vaultEdge,
    };
    this.jumpEdge = false;
    this.vaultEdge = false;
    const dx = this.dx;
    const dy = this.dy;
    this.dx = 0;
    this.dy = 0;
    return { frame, dx, dy };
  }

  consumeRestart(): boolean {
    if (this.keys.has('KeyR')) {
      this.keys.delete('KeyR');
      return true;
    }
    return false;
  }
}
