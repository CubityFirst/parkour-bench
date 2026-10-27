/** Timer + hint + checkpoint toast + icons in the in-game HUD. */
export class HUD {
  private el = {
    hud: document.getElementById('hud')!,
    timer: document.getElementById('timer')!,
    hint: document.getElementById('hint')!,
    toast: document.getElementById('checkpoint-toast')!,
    icons: document.getElementById('checkpoint-icons')!,
  };
  private hintTimer = 0;
  private toastTimer = 0;
  private toast: string | null = null;

  show(): void {
    this.el.hud.classList.remove('hidden');
  }
  hide(): void {
    this.el.hud.classList.add('hidden');
  }

  buildIcons(count: number): void {
    this.el.icons.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'checkpoint-dot';
      this.el.icons.appendChild(d);
    }
  }

  activateIcon(index: number): void {
    const dot = this.el.icons.children[index] as HTMLElement | undefined;
    if (dot) dot.classList.add('active');
  }

  resetIcons(count: number): void {
    this.buildIcons(count);
  }

  setTimer(seconds: number): void {
    this.el.timer.textContent = formatTime(seconds);
  }

  hint(text: string, duration = 4.5): void {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('visible');
    this.hintTimer = duration;
  }

  clearHint(): void {
    this.el.hint.classList.remove('visible');
    this.hintTimer = 0;
  }

  toastMsg(text: string, duration = 2.4): void {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('visible');
    this.toastTimer = duration;
    this.toast = text;
  }

  update(dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.remove('visible');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('visible');
    }
    void this.toast;
  }
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}
