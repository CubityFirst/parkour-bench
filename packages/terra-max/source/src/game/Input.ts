export class Input {
  private readonly keys = new Set<string>();
  private readonly justPressed = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;

  constructor() {
    window.addEventListener('keydown', (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(event.code) || event.code.startsWith('Control')) {
        event.preventDefault();
      }
      if (!this.keys.has(event.code)) this.justPressed.add(event.code);
      this.keys.add(event.code);
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement) {
        this.mouseX += event.movementX;
        this.mouseY += event.movementY;
      }
    });

    window.addEventListener('blur', () => this.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  consumePressed(...codes: string[]): boolean {
    const matched = codes.some((code) => this.justPressed.has(code));
    codes.forEach((code) => this.justPressed.delete(code));
    return matched;
  }

  consumeLook(): { x: number; y: number } {
    const look = { x: this.mouseX, y: this.mouseY };
    this.mouseX = 0;
    this.mouseY = 0;
    return look;
  }

  clear(): void {
    this.keys.clear();
    this.justPressed.clear();
    this.mouseX = 0;
    this.mouseY = 0;
  }
}
