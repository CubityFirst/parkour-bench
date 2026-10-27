/**
 * Keyboard + mouse input. Key presses are latched as "pressed" edges until a
 * fixed simulation step consumes them, so no input is lost at high frame rates.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'sprint' | 'jump' | 'crouch' | 'vault' | 'restart' | 'pause';

const BINDINGS: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'jump',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
  KeyE: 'vault',
  KeyR: 'restart',
  Escape: 'pause',
};

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  /** When false, game keys are ignored (menus open). */
  enabled = false;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const a = BINDINGS[e.code];
    if (!a) return;
    if (this.enabled && a !== 'pause') e.preventDefault();
    if (!this.enabled) return;
    if (!e.repeat && !this.down.has(a)) this.pressed.add(a);
    this.down.add(a);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const a = BINDINGS[e.code];
    if (!a) return;
    this.down.delete(a);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || document.pointerLockElement !== this.target) return;
    // Ignore absurd spikes some browsers emit on pointer lock changes.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  isDown(a: Action): boolean { return this.down.has(a); }

  /** Returns true once per physical press. */
  consume(a: Action): boolean {
    if (this.pressed.has(a)) { this.pressed.delete(a); return true; }
    return false;
  }

  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return r;
  }

  reset(): void {
    this.down.clear();
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
  }

  /** Debug / automation hook: simulate key state. */
  setDown(a: Action, v: boolean): void {
    if (v) { if (!this.down.has(a)) this.pressed.add(a); this.down.add(a); }
    else this.down.delete(a);
  }
}
