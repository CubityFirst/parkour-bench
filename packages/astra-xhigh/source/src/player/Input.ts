export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  dragLook = false;
  private dragging = false;
  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (
        [
          "Space",
          "ControlLeft",
          "ControlRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(e.code)
      )
        e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.clear());
    window.addEventListener("mousedown", (e) => {
      if (e.target instanceof HTMLCanvasElement) this.dragging = true;
    });
    window.addEventListener("mouseup", () => (this.dragging = false));
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement || (this.dragLook && this.dragging)) {
        this.mouseX += e.movementX;
        this.mouseY += e.movementY;
      }
    });
  }
  down(...keys: string[]) {
    return keys.some((k) => this.keys.has(k));
  }
  take(key: string) {
    const has = this.pressed.has(key);
    this.pressed.delete(key);
    return has;
  }
  clearTransient() {
    this.pressed.clear();
    this.mouseX = 0;
    this.mouseY = 0;
  }
  clear() {
    this.keys.clear();
    this.dragging = false;
    this.clearTransient();
  }
}
