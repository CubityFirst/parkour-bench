/** Keyboard edges are consumed by physics, not the render loop. */
export class PlayerInput {
  readonly held = new Set<string>();
  private pressed = new Set<string>();
  private listeners: Array<() => void> = [];
  private dragging = false;

  constructor(
    private element: HTMLElement,
    private active: () => boolean,
    private look: (x: number, y: number) => void,
  ) {
    this.listen(document, 'keydown', ((event: KeyboardEvent) => {
      if (!this.active()) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight'].includes(event.code)) event.preventDefault();
      if (!this.held.has(event.code)) this.pressed.add(event.code);
      this.held.add(event.code);
    }) as EventListener);
    this.listen(document, 'keyup', ((event: KeyboardEvent) => {
      this.held.delete(event.code);
    }) as EventListener);
    this.listen(document, 'mousemove', ((event: MouseEvent) => {
      if (this.active() && (document.pointerLockElement === this.element || this.dragging)) this.look(event.movementX, event.movementY);
    }) as EventListener);
    // Embedded browsers can deny pointer lock. A held primary mouse button still
    // provides ordinary drag-to-look without changing keyboard movement.
    this.listen(element, 'mousedown', ((event: MouseEvent) => {
      if (this.active() && event.button === 0 && !document.pointerLockElement) this.dragging = true;
    }) as EventListener);
    this.listen(document, 'mouseup', ((event: MouseEvent) => {
      if (event.button === 0) this.dragging = false;
    }) as EventListener);
    this.listen(window, 'blur', () => this.clear());
    this.listen(document, 'pointerlockchange', () => {
      this.dragging = false;
      if (document.pointerLockElement !== this.element) this.clear();
    });
  }

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.listeners.push(() => target.removeEventListener(type, listener));
  }

  down(...codes: string[]): boolean { return codes.some(code => this.held.has(code)); }

  take(...codes: string[]): boolean {
    let found = false;
    for (const code of codes) {
      if (this.pressed.delete(code)) found = true;
    }
    return found;
  }

  clear(): void { this.held.clear(); this.pressed.clear(); this.dragging = false; }
  dispose(): void { this.listeners.forEach(remove => remove()); this.clear(); }
}
