export class Input {
  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private actionQueued = false;
  private restartQueued = false;
  private mouseX = 0;
  private mouseY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (event) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (['Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'KeyC'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (!event.repeat) {
        if (event.code === 'Space') this.jumpQueued = true;
        if (event.code === 'KeyE') this.actionQueued = true;
        if (event.code === 'KeyR') this.restartQueued = true;
      }
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas) this.clear();
    });
    document.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.mouseX += event.movementX;
        this.mouseY += event.movementY;
      }
    });
  }

  down(...codes: string[]): boolean { return codes.some((code) => this.keys.has(code)); }
  takeJump(): boolean { const queued = this.jumpQueued; this.jumpQueued = false; return queued; }
  takeAction(): boolean { const queued = this.actionQueued; this.actionQueued = false; return queued; }
  takeRestart(): boolean { const queued = this.restartQueued; this.restartQueued = false; return queued; }
  takeMouse(): [number, number] {
    const result: [number, number] = [this.mouseX, this.mouseY];
    this.mouseX = 0;
    this.mouseY = 0;
    return result;
  }
  clear(): void {
    this.keys.clear();
    this.jumpQueued = false;
    this.actionQueued = false;
    this.restartQueued = false;
    this.mouseX = 0;
    this.mouseY = 0;
  }
}
