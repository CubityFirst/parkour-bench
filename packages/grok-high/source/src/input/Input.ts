import { blankInput, type PlayerInput } from '../player/types';

const MOVE = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ControlLeft', 'ControlRight', 'KeyC',
]);

export class Input {
  private readonly held = new Set<string>();
  private readonly edges = new Set<string>();
  private dx = 0;
  private dy = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (event) => {
      if (MOVE.has(event.code)) event.preventDefault();
      if (!this.held.has(event.code)) this.edges.add(event.code);
      this.held.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      this.held.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
    });
    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.dx += event.movementX;
      this.dy += event.movementY;
    });
  }

  consumeLook(): { x: number; y: number } {
    const look = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return look;
  }

  snapshot(): PlayerInput {
    const input = blankInput();
    const down = (code: string) => this.held.has(code);
    const edge = (code: string) => this.edges.has(code);
    input.forward = (down('KeyW') || down('ArrowUp') ? 1 : 0) - (down('KeyS') || down('ArrowDown') ? 1 : 0);
    input.strafe = (down('KeyD') || down('ArrowRight') ? 1 : 0) - (down('KeyA') || down('ArrowLeft') ? 1 : 0);
    input.sprint = down('ShiftLeft') || down('ShiftRight');
    input.jump = down('Space');
    input.jumpPressed = edge('Space');
    input.slide = down('ControlLeft') || down('ControlRight') || down('KeyC');
    input.slidePressed = edge('ControlLeft') || edge('ControlRight') || edge('KeyC');
    input.vaultPressed = edge('KeyE');
    input.restart = edge('KeyR');
    this.edges.clear();
    return input;
  }

  debugToggle(): boolean {
    return this.edges.has('F3');
  }
}
