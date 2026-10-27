/**
 * Central input state. Listens on the window and exposes a snapshot object
 * the player controller reads each fixed physics step.
 */
export class Input {
  private pressed = new Set<string>();
  /** Edge-detected "just pressed this frame" set, cleared after each consumer call. */
  private edge = new Set<string>();

  // Angles are supplied directly by the mouse-move handler.
  mouseDX = 0;
  mouseDY = 0;
  sensitivity = 1.0;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const code = e.code;
    this.pressed.add(code);
    this.edge.add(code);
    // Prevent the browser scrolling / searching on game keys.
    if (['Space', 'ControlLeft', 'ControlRight', 'KeyE', 'Tab'].includes(code)) {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.pressed.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.isPointerLocked()) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private isPointerLocked(): boolean {
    return !!(document.pointerLockElement as Element | null);
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', () => this.releaseAll());
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.releaseAll();
  }

  releaseAll(): void {
    this.pressed.clear();
    this.edge.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  lockElement: HTMLElement | null = null;

  requestLock(): void {
    this.lockElement?.requestPointerLock();
  }

  isLocked(): boolean {
    return this.isPointerLocked();
  }

  down(code: string): boolean {
    return this.pressed.has(code);
  }

  // --- Directional helpers -------------------------------------------------
  get forward(): boolean {
    return this.down('KeyW');
  }
  get back(): boolean {
    return this.down('KeyS');
  }
  get left(): boolean {
    return this.down('KeyA');
  }
  get right(): boolean {
    return this.down('KeyD');
  }
  get sprint(): boolean {
    return this.down('ShiftLeft') || this.down('ShiftRight');
  }
  get jumpHeld(): boolean {
    return this.down('Space');
  }
  /** Jump edge (buffered by the player controller). */
  get jumpPressed(): boolean {
    return this.edge.has('Space');
  }
  get slideHeld(): boolean {
    return this.down('ControlLeft') || this.down('ControlRight') || this.down('KeyC');
  }
  get slidePressed(): boolean {
    return this.edge.has('ControlLeft') || this.edge.has('ControlRight') || this.edge.has('KeyC');
  }
  get vaultPressed(): boolean {
    return this.edge.has('KeyE');
  }

  /** Consume accumulated mouse delta into yaw/pitch changes. */
  consumeLook(deltaYaw: (dx: number) => void, deltaPitch: (dy: number) => void): void {
    deltaYaw(this.mouseDX * 0.0021 * this.sensitivity);
    deltaPitch(this.mouseDY * 0.0021 * this.sensitivity);
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Clear edge-detected keys (call once at the end of each frame). */
  postUpdate(): void {
    this.edge.clear();
  }
}
