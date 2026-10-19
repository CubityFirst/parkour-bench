import { MoveInput } from '../player/PlayerController';

/**
 * Keyboard and mouse input. Held keys are sampled every fixed tick. "Pressed" edges
 * are latched between ticks, so a tap is never lost even if the frame rate is high.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly edges = new Set<string>();
  private lookX = 0;
  private lookY = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.edges.add(e.code);
      this.held.add(e.code);
      if (GAME_KEYS.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    // Losing focus leaves keys stuck otherwise.
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
  }

  /** Builds the movement input for one fixed tick. */
  sample(yaw: number): MoveInput {
    return {
      forward: (this.anyHeld('KeyW', 'ArrowUp') ? 1 : 0) - (this.anyHeld('KeyS', 'ArrowDown') ? 1 : 0),
      strafe: (this.anyHeld('KeyD', 'ArrowRight') ? 1 : 0) - (this.anyHeld('KeyA', 'ArrowLeft') ? 1 : 0),
      sprint: this.anyHeld('ShiftLeft', 'ShiftRight'),
      jumpHeld: this.anyHeld('Space'),
      jumpPressed: this.anyEdge('Space'),
      slidePressed: this.anyEdge('ControlLeft', 'ControlRight', 'KeyC'),
      vaultPressed: this.anyEdge('KeyE'),
      yaw,
    };
  }

  /** Clears one-shot press flags. Call after each fixed tick. */
  endTick(): void {
    this.edges.clear();
  }

  /** Returns and resets the accumulated mouse movement since the last call. */
  takeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  /** Forgets all keys and edges, e.g. when opening the pause menu. */
  clear(): void {
    this.held.clear();
    this.edges.clear();
    this.lookX = 0;
    this.lookY = 0;
  }

  private anyHeld(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private anyEdge(...codes: string[]): boolean {
    return codes.some((c) => this.edges.has(c));
  }
}

/** Keys whose default browser action (scrolling, etc.) we suppress during play. */
const GAME_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
]);
