export interface MoveInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
  jumpPressed: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
}
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  yaw = 0;
  pitch = 0;
  sensitivity = Number(localStorage.getItem('upshift-sensitivity') || 1);
  enabled = false;
  constructor(readonly canvas: HTMLCanvasElement, onPause: () => void, onRestart: () => void) {
    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (['Space', 'ControlLeft', 'ControlRight', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'KeyR' && !e.repeat) onRestart();
      if (e.code === 'Escape') onPause();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.clear(); if (this.enabled) onPause(); });
    document.addEventListener('mousemove', e => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * 0.002 * this.sensitivity;
      this.pitch = Math.max(-1.4, Math.min(1.35, this.pitch - e.movementY * 0.002 * this.sensitivity));
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.enabled) onPause();
    });
  }
  clear() { this.keys.clear(); this.pressed.clear(); }
  sample(): MoveInput {
    const has = (k: string) => this.keys.has(k);
    const state = {
      forward: Number(has('KeyW') || has('ArrowUp')) - Number(has('KeyS') || has('ArrowDown')),
      strafe: Number(has('KeyD') || has('ArrowRight')) - Number(has('KeyA') || has('ArrowLeft')),
      sprint: has('ShiftLeft') || has('ShiftRight'),
      jump: has('Space'),
      jumpPressed: this.pressed.has('Space'),
      slidePressed: this.pressed.has('KeyC') || this.pressed.has('ControlLeft') || this.pressed.has('ControlRight'),
      vaultPressed: this.pressed.has('KeyE'),
    };
    this.pressed.clear();
    return state;
  }
}
