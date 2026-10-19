import { Game } from './game/Game';

declare global {
  interface Window {
    __game?: Game;
  }
}

const canvas = document.querySelector('#view');
const fatal = document.querySelector('#fatal');

function fail(message: string): void {
  if (fatal instanceof HTMLElement) {
    fatal.hidden = false;
    fatal.textContent = message;
  }
}

if (!(canvas instanceof HTMLCanvasElement)) {
  fail('The view canvas is missing.');
} else {
  try {
    window.__game = new Game(canvas);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WebGL failed to start.';
    fail(message);
  }
}
