export function formatTime(ms: number): string {
  const clamped = Math.max(0, ms)
  const minutes = Math.floor(clamped / 60000)
  const seconds = Math.floor(clamped / 1000) % 60
  const centis = Math.floor(clamped / 10) % 100
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`
}

export class HUD {
  readonly root: HTMLElement
  private readonly timer: HTMLElement
  private readonly hint: HTMLElement
  private readonly toast: HTMLElement
  private readonly flash: HTMLElement
  private readonly debug: HTMLElement
  private hintTimer = 0
  private toastTimer = 0

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud'
    this.root.innerHTML = `
      <div class="vignette"></div>
      <div class="crosshair" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="timer">0:00.00</div>
      <div class="toast"></div>
      <div class="hint"></div>
      <div class="flash"></div>
      <div class="debug"></div>
    `
    parent.append(this.root)
    this.timer = this.root.querySelector('.timer') as HTMLElement
    this.hint = this.root.querySelector('.hint') as HTMLElement
    this.toast = this.root.querySelector('.toast') as HTMLElement
    this.flash = this.root.querySelector('.flash') as HTMLElement
    this.debug = this.root.querySelector('.debug') as HTMLElement
  }

  setVisible(visible: boolean) {
    this.root.classList.toggle('is-on', visible)
  }

  setTime(ms: number) {
    this.timer.textContent = formatTime(ms)
  }

  showHint(text: string) {
    this.hint.textContent = text
    this.hint.classList.add('is-on')
    this.hintTimer = 4.8
  }

  showToast(text: string) {
    this.toast.textContent = text
    this.toast.classList.add('is-on')
    this.toastTimer = 2.4
  }

  flashRespawn() {
    this.flash.classList.add('is-on')
    window.setTimeout(() => this.flash.classList.remove('is-on'), 180)
  }

  setDebug(text: string) {
    this.debug.textContent = text
    this.debug.classList.toggle('is-on', text.length > 0)
  }

  tick(dt: number) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt
      if (this.hintTimer <= 0) this.hint.classList.remove('is-on')
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) this.toast.classList.remove('is-on')
    }
  }
}
