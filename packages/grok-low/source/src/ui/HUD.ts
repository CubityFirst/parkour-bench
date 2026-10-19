export class HUD {
  private readonly timer: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly badge: HTMLElement;

  constructor(root: HTMLElement) {
    this.crosshair = el("div", "crosshair");
    this.crosshair.innerHTML = "<i></i><i></i><i></i><i></i><b></b>";
    this.timer = el("div", "timer");
    this.toast = el("div", "toast");
    this.hint = el("div", "hint");
    this.badge = el("div", "badge");
    root.append(this.crosshair, this.timer, this.toast, this.hint, this.badge);
  }

  set(view: { time: string; hint: string; toast: string; showPlay: boolean; bot: boolean }): void {
    this.timer.textContent = view.time;
    this.timer.hidden = !view.showPlay;
    this.crosshair.hidden = !view.showPlay;
    this.hint.textContent = view.hint;
    this.hint.hidden = view.hint.length === 0;
    this.toast.textContent = view.toast;
    this.toast.hidden = view.toast.length === 0;
    this.badge.hidden = !view.bot;
    this.badge.textContent = "BOT RUN";
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
