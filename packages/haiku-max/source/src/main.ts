import './styles/main.css';
import { Game } from './game/Game';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container in index.html');

try {
  const game = new Game(container);
  game.start();

  if (import.meta.env.DEV) {
    // Exposed for debugging from the browser console in development builds only.
    (window as unknown as { game: Game }).game = game;
  }
} catch (error) {
  console.error(error);
  container.textContent = 'ROOFTOP FLOW needs WebGL 2. Please try a current version of Chrome, Edge or Firefox.';
}
