import type { InputSnapshot } from '../player/PlayerController';

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyC', 'KeyE', 'KeyR',
]);

/**
 * Keyboard + mouse state. Key presses are latched until a physics step consumes
 * them so quick taps are never lost between fixed updates.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  /** When false, game keys are ignored (menus open). */
  enabled = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === this.target) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Returns true once per physical key press. */
  consume(code: string): boolean {
    return this.pressed.delete(code);
  }

  takeMouseDelta(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Builds the per-step snapshot for the player controller. */
  snapshot(): InputSnapshot {
    const f = (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0) - (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0);
    const r = (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0);
    // Consume every slide key (no short-circuit) so no stale press lingers.
    const slideKeys = [this.consume('ControlLeft'), this.consume('ControlRight'), this.consume('KeyC')];
    const slidePressed = slideKeys.some(Boolean);
    return {
      forward: f,
      right: r,
      sprint: this.isDown('ShiftLeft') || this.isDown('ShiftRight'),
      jumpHeld: this.isDown('Space'),
      jumpPressed: this.consume('Space'),
      slideHeld: this.isDown('ControlLeft') || this.isDown('ControlRight') || this.isDown('KeyC'),
      slidePressed,
      vaultPressed: this.consume('KeyE'),
    };
  }

  /** True if any movement key is held (used to start the run timer). */
  anyMovement(): boolean {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
      if (this.down.has(k)) return true;
    }
    return false;
  }
}
