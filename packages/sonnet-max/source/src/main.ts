import './styles/main.css';
import { Game } from './game/Game.ts';

const canvas = document.getElementById('game-canvas');
const loading = document.getElementById('loading');

function fail(message: string): void {
  if (loading) {
    loading.classList.remove('done');
    loading.innerHTML = `<span style="max-width:70ch;text-align:center;line-height:1.7;letter-spacing:.18em">${message}</span>`;
  }
}

if (!(canvas instanceof HTMLCanvasElement)) {
  fail('CANVAS NOT FOUND');
} else {
  try {
    const game = new Game(canvas);
    void game.boot();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      fail('GRAPHICS CONTEXT LOST - RELOAD THE PAGE TO CONTINUE.');
    });
  } catch (err) {
    console.error(err);
    fail('COULD NOT START WEBGL. TRY A DESKTOP BROWSER WITH HARDWARE ACCELERATION ENABLED.');
  }
}
