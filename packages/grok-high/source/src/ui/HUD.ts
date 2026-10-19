import { formatTime, type GameMode } from '../game/GameState';
import type { RunFlags } from '../world/Checkpoints';

export class HUD {
  constructor(private readonly root: ParentNode) {}

  private el(id: string): HTMLElement {
    const node = this.root.querySelector(`#${id}`);
    if (!(node instanceof HTMLElement)) throw new Error(`Missing #${id}`);
    return node;
  }

  setMode(mode: GameMode): void {
    this.el('hud').hidden = mode === 'menu';
    this.el('pause').hidden = mode !== 'paused';
    this.el('finish').hidden = mode !== 'finished';
    this.el('menu').hidden = mode !== 'menu';
    document.body.classList.toggle('is-playing', mode === 'playing');
  }

  setLookHint(show: boolean): void {
    this.el('look-hint').hidden = !show;
  }

  update(elapsedMs: number, flags: RunFlags, debugText: string, debug: boolean): void {
    this.el('timer').textContent = formatTime(elapsedMs);
    this.el('hint').textContent = flags.hint;
    const toast = this.el('toast');
    const showToast = flags.toastTime > 0 && flags.toast.length > 0;
    toast.hidden = !showToast;
    toast.textContent = flags.toast;
    const debugEl = this.el('debug');
    debugEl.hidden = !debug;
    if (debug) debugEl.textContent = debugText;
  }

  flash(): void {
    const node = this.el('flash');
    node.classList.remove('on');
    void node.offsetWidth;
    node.classList.add('on');
  }

  showFinish(timeMs: number, bestMs: number | null, isNew: boolean): void {
    this.el('finish-time').textContent = formatTime(timeMs);
    this.el('finish-best').textContent = bestMs === null ? '—' : formatTime(bestMs);
    this.el('finish-new').hidden = !isNew;
  }
}
