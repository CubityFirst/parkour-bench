/** Keyboard + pointer-lock mouse state. "Pressed" keys are edge-triggered per frame. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;

  constructor(private lockTarget: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ControlLeft', 'ControlRight', 'KeyC', 'KeyE', 'Tab'].includes(e.code) && this.locked) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  get locked() { return document.pointerLockElement === this.lockTarget; }
  lock() { this.lockTarget.requestPointerLock(); }
  unlock() { if (this.locked) document.exitPointerLock(); }

  down(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }
  wasPressed(...codes: string[]) { return codes.some((c) => this.pressed.has(c)); }

  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; }
}
