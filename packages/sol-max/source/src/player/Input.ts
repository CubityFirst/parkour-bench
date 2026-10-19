export interface Controls {
  forward: number;
  right: number;
  sprint: boolean;
  slide: boolean;
  jump: boolean;
  jumpHeld: boolean;
  vault: boolean;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  enabled = false;
  private dragging = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (event) => {
      if (!this.enabled || event.target instanceof HTMLInputElement) return;
      if (
        [
          "Space",
          "ControlLeft",
          "ControlRight",
          "ShiftLeft",
          "ShiftRight",
          "Tab",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "KeyC",
          "KeyE",
          "KeyR",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(event.code)
      )
        event.preventDefault();
      if (!this.keys.has(event.code)) this.pressed.add(event.code);
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener("blur", () => this.clear());
    canvas.addEventListener("mousedown", () => {
      this.dragging = true;
    });
    window.addEventListener("mouseup", () => {
      this.dragging = false;
    });
    document.addEventListener("mousemove", (event) => {
      if (
        !this.enabled ||
        !(document.pointerLockElement === canvas || this.dragging)
      )
        return;
      this.yaw -= event.movementX * 0.0017 * this.sensitivity;
      this.pitch -= event.movementY * 0.0017 * this.sensitivity;
      this.pitch = Math.max(-1.35, Math.min(1.38, this.pitch));
    });
  }

  consume(code: string): boolean {
    const down = this.pressed.has(code);
    this.pressed.delete(code);
    return down;
  }

  read(): Controls {
    return {
      forward:
        Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
        Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")),
      right:
        Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
        Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft")),
      sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      slide:
        this.keys.has("KeyC") ||
        this.keys.has("ControlLeft") ||
        this.keys.has("ControlRight"),
      jump: this.consume("Space"),
      jumpHeld: this.keys.has("Space"),
      vault: this.consume("KeyE"),
    };
  }

  clear(): void {
    this.keys.clear();
    this.pressed.clear();
    this.dragging = false;
  }
}
