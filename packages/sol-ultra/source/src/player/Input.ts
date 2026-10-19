/** Key edges live until consumed, so rendering never drops a fixed-step input. */
export class Input {
  private readonly keys = new Set<string>();
  private readonly edges = new Set<string>();
  mouseX = 0;
  mouseY = 0;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight', 'Tab'].includes(event.code) && document.pointerLockElement) {
      event.preventDefault();
    }
    if (!this.keys.has(event.code)) this.edges.add(event.code);
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!document.pointerLockElement) return;
    this.mouseX += event.movementX;
    this.mouseY += event.movementY;
  };

  private readonly onBlur = (): void => this.clear();
  private readonly onPointerLockChange = (): void => {
    if (!document.pointerLockElement) this.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  pressed(code: string): boolean {
    return this.edges.delete(code);
  }

  clear(): void {
    this.keys.clear();
    this.edges.clear();
    this.mouseX = 0;
    this.mouseY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.clear();
  }
}
