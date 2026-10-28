import './styles/main.css';
import { Game } from './game/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #scene not found');
}

try {
  const game = new Game(canvas);
  game.boot();
  // Exposed for quick debugging from the console.
  (window as unknown as { game: Game }).game = game;
} catch (error) {
  console.error('Failed to start ROOFTOP FLOW', error);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML = `<div class="loader"><div class="brand-mark"></div><p>FAILED TO START</p><span style="font-size:11px;color:#8b939c;letter-spacing:0.05em">${String(
      error,
    )}</span></div>`;
  }
}
