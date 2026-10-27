/**
 * Keyboard + mouse input. Key state is polled by the fixed-step simulation;
 * key *presses* are queued so a tap is never lost, even if no physics step
 * runs during the frame it happened in.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  /** When false, game keys are ignored (menus open). */
  enabled = false;
  pointerLocked = false;

  /** Fired on any key down (used for pause/restart shortcuts). */
  onKey: ((code: string) => void) | null = null;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('mousedown', this.handleMouseDown);
    // Right mouse button is an alternate slide key — never open the context menu over the game.
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (this.enabled) {
      // Stop the page from scrolling / browser shortcuts where we can.
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab' || e.ctrlKey) e.preventDefault();
    }
    if (!e.repeat) {
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.onKey?.(e.code);
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly handleMouseDown = (e: MouseEvent): void => {
    if (!this.enabled || !this.pointerLocked) return;
    // Mouse buttons as optional alternates: right click = slide.
    if (e.button === 2) {
      this.down.add('Mouse2');
      this.pressed.add('Mouse2');
      const up = (ev: MouseEvent) => {
        if (ev.button === 2) {
          this.down.delete('Mouse2');
          document.removeEventListener('mouseup', up);
        }
      };
      document.addEventListener('mouseup', up);
    }
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked || !this.enabled) return;
    // Some browsers occasionally report huge spikes when locking — ignore them.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly handleLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
    if (!this.pointerLocked) this.clear();
  };

  readonly clear = (): void => {
    this.down.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  };

  isDown(...codes: string[]): boolean {
    if (!this.enabled) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** True once per press of any of the codes (consumes the press). */
  consume(...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) {
      if (this.pressed.delete(c)) hit = true;
    }
    return hit && this.enabled;
  }

  /** Drops queued presses (e.g. after unpausing). */
  flushPresses(): void {
    this.pressed.clear();
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /**
   * Requests pointer lock and resolves once the browser grants or refuses it.
   * Waits for the lock events rather than trusting the return value, because
   * not every browser returns a promise from requestPointerLock.
   */
  lock(): Promise<boolean> {
    if (document.pointerLockElement === this.element) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        window.clearTimeout(timer);
        resolve(ok);
      };
      const onChange = () => {
        if (document.pointerLockElement === this.element) finish(true);
      };
      const onError = () => finish(false);
      const timer = window.setTimeout(() => finish(document.pointerLockElement === this.element), 1500);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const result = this.element.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(() => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
