import './styles/main.css';
import { Game } from './game/Game.ts';

function showFatal(message: string): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:40px;' +
    'background:#f4f5f6;color:#121417;font:600 16px/1.6 "Segoe UI",Arial,sans-serif;text-align:center;';
  el.textContent = message;
  document.body.appendChild(el);
}

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const ui = document.getElementById('ui-root');

if (!canvas || !ui) {
  showFatal('ROOFLINE could not find its canvas element.');
} else {
  try {
    const game = new Game(canvas, ui);
    game.start();
    if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
  } catch (err) {
    console.error(err);
    showFatal('ROOFLINE needs WebGL to run. Please use a recent desktop version of Chrome, Edge or Firefox with hardware acceleration enabled.');
  }
}
