import { Game } from './game/Game'
import './styles/main.css'

const canvas = document.querySelector('#game')
const ui = document.querySelector('#ui')
if (!(canvas instanceof HTMLCanvasElement) || !(ui instanceof HTMLElement)) {
  throw new Error('Missing game canvas')
}

const game = new Game(canvas, ui)
game.start()

if (import.meta.env.DEV) {
  ;(window as unknown as { __ROOFTOP__?: Game }).__ROOFTOP__ = game
}
