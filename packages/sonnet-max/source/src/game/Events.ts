type Listener<T> = (payload: T) => void;

/** Tiny typed event emitter used to decouple gameplay from audio / camera / HUD feedback. */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Listener<never>[]>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(listener as Listener<never>);
    return () => {
      const l = this.listeners.get(event);
      if (!l) return;
      const i = l.indexOf(listener as Listener<never>);
      if (i >= 0) l.splice(i, 1);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.listeners.get(event);
    if (!list) return;
    for (let i = 0; i < list.length; i++) (list[i] as Listener<Events[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
