import type { Settings } from '../game/GameState'
import { formatTime } from './HUD'

export class Menu {
  readonly root: HTMLElement
  onStart: () => void = () => {}
  onResume: () => void = () => {}
  onRestart: () => void = () => {}
  onCheckpoint: () => void = () => {}
  onMenu: () => void = () => {}
  onSettings: (settings: Settings) => void = () => {}

  private readonly main: HTMLElement
  private readonly controls: HTMLElement
  private readonly pause: HTMLElement
  private readonly finish: HTMLElement
  private readonly finishTime: HTMLElement
  private readonly finishBest: HTMLElement
  private readonly bestLabel: HTMLElement
  private settings: Settings

  constructor(parent: HTMLElement, settings: Settings, best: number | null) {
    this.settings = { ...settings }
    this.root = document.createElement('div')
    this.root.className = 'menu'
    this.root.innerHTML = `
      <section class="panel main-panel">
        <p class="kicker">First-person parkour</p>
        <h1>ROOFTOP<br>FLOW</h1>
        <p class="lede">Sprint the white roofs. Red shows the way across.</p>
        <div class="actions">
          <button type="button" data-action="start">Start run</button>
          <button type="button" data-action="controls" class="ghost">Controls</button>
        </div>
        <p class="best"></p>
        ${settingsBlock()}
      </section>
      <section class="panel controls-panel">
        <h2>Controls</h2>
        <ul class="keys">
          <li><span>WASD</span> Move</li>
          <li><span>Mouse</span> Look</li>
          <li><span>Shift</span> Sprint</li>
          <li><span>Space</span> Jump</li>
          <li><span>Ctrl / C</span> Slide</li>
          <li><span>E</span> Vault</li>
          <li><span>R</span> Restart from checkpoint</li>
          <li><span>Esc</span> Pause</li>
        </ul>
        <button type="button" data-action="back" class="ghost">Back</button>
      </section>
      <section class="panel pause-panel">
        <h2>Paused</h2>
        <div class="actions">
          <button type="button" data-action="resume">Resume</button>
          <button type="button" data-action="checkpoint" class="ghost">Checkpoint</button>
          <button type="button" data-action="restart" class="ghost">Restart run</button>
          <button type="button" data-action="menu" class="ghost">Main menu</button>
        </div>
        ${settingsBlock()}
      </section>
      <section class="panel finish-panel">
        <p class="kicker">Run clear</p>
        <h2>LEVEL COMPLETE</h2>
        <p class="finish-time">0:00.00</p>
        <p class="finish-best"></p>
        <div class="actions">
          <button type="button" data-action="restart">Run again</button>
          <button type="button" data-action="menu" class="ghost">Main menu</button>
        </div>
      </section>
    `
    parent.append(this.root)
    this.main = this.root.querySelector('.main-panel') as HTMLElement
    this.controls = this.root.querySelector('.controls-panel') as HTMLElement
    this.pause = this.root.querySelector('.pause-panel') as HTMLElement
    this.finish = this.root.querySelector('.finish-panel') as HTMLElement
    this.finishTime = this.root.querySelector('.finish-time') as HTMLElement
    this.finishBest = this.root.querySelector('.finish-best') as HTMLElement
    this.bestLabel = this.root.querySelector('.best') as HTMLElement
    this.setBest(best)
    this.bind()
    this.showMain()
  }

  showMain() {
    this.show('main')
  }

  showPause() {
    this.show('pause')
  }

  showFinish(timeMs: number, bestMs: number | null, isNew: boolean) {
    this.finishTime.textContent = formatTime(timeMs)
    this.finishBest.textContent = isNew
      ? 'New best time'
      : bestMs === null
        ? ''
        : `Best  ${formatTime(bestMs)}`
    this.show('finish')
  }

  hide() {
    this.root.classList.add('is-hidden')
  }

  setBest(best: number | null) {
    this.bestLabel.textContent = best === null ? 'No best time yet' : `Best  ${formatTime(best)}`
  }

  private show(which: 'main' | 'controls' | 'pause' | 'finish') {
    this.root.classList.remove('is-hidden')
    this.main.hidden = which !== 'main'
    this.controls.hidden = which !== 'controls'
    this.pause.hidden = which !== 'pause'
    this.finish.hidden = which !== 'finish'
    this.root.classList.toggle('is-dim', which === 'pause' || which === 'finish')
  }

  private bind() {
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('button')
      if (!target) return
      const action = target.dataset.action
      if (action === 'start') this.onStart()
      if (action === 'resume') this.onResume()
      if (action === 'restart') this.onRestart()
      if (action === 'checkpoint') this.onCheckpoint()
      if (action === 'menu') this.onMenu()
      if (action === 'controls') this.show('controls')
      if (action === 'back') this.show('main')
    })
    this.root.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      if (target.dataset.setting === 'sensitivity') {
        this.settings.sensitivity = Number(target.value) / 100
      }
      if (target.dataset.setting === 'motion') this.settings.motion = target.checked
      if (target.dataset.setting === 'sound') this.settings.sound = target.checked
      this.syncLabels()
      this.onSettings(this.settings)
    })
    this.syncLabels()
  }

  private syncLabels() {
    const labels = this.root.querySelectorAll<HTMLElement>('[data-readout="sensitivity"]')
    labels.forEach((label) => {
      label.textContent = this.settings.sensitivity.toFixed(2)
    })
    const sens = this.root.querySelectorAll<HTMLInputElement>('[data-setting="sensitivity"]')
    sens.forEach((input) => {
      input.value = String(Math.round(this.settings.sensitivity * 100))
    })
    const motion = this.root.querySelectorAll<HTMLInputElement>('[data-setting="motion"]')
    motion.forEach((input) => {
      input.checked = this.settings.motion
    })
    const sound = this.root.querySelectorAll<HTMLInputElement>('[data-setting="sound"]')
    sound.forEach((input) => {
      input.checked = this.settings.sound
    })
  }
}

function settingsBlock() {
  return `
    <div class="settings">
      <label>Mouse sensitivity <b data-readout="sensitivity">100</b>
        <input data-setting="sensitivity" type="range" min="35" max="220" value="100" />
      </label>
      <label class="check"><input data-setting="motion" type="checkbox" checked /> Camera motion</label>
      <label class="check"><input data-setting="sound" type="checkbox" checked /> Sound</label>
    </div>
  `
}
