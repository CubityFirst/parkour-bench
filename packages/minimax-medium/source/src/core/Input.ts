/**
 * Input handling: keyboard state + pointer-lock mouse deltas.
 * Keys are tracked by KeyboardEvent.code so the layout stays consistent.
 */
export class Input {
  readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();

  mouseDX = 0;
  mouseDY = 0;
  locked = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (SWALLOW.has(e.code)) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.keys.clear();
    });

    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
    });
  }

  requestLock(): void {
    const el = this.target as HTMLElement & {
      requestPointerLock?: (o?: object) => Promise<void> | void;
    };
    try {
      const result = el.requestPointerLock?.();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          /* the browser refused the lock - the game stays playable */
        });
      }
    } catch {
      /* ignore */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the frame the key was pressed. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}

const SWALLOW = new Set([
  'Space',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyE',
  'KeyC',
  'ControlLeft',
  'ShiftLeft',
]);
