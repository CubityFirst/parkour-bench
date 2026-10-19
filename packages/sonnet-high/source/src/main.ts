import './styles/main.css';
import { Game } from './game/Game.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #game not found');

const loading = document.getElementById('loading');

try {
  const game = new Game(canvas);
  // Handy for debugging / automated checks from the browser console.
  (window as unknown as { __game: Game }).__game = game;

  const shot = new URLSearchParams(location.search).get('shot');
  if (shot) {
    const [x, y, z, yaw = 0, pitch = 0] = shot.split(',').map(Number);
    game.debugShot(x, y, z, yaw, pitch);
  }

  // Vite HMR: dispose GPU resources before the module is replaced.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => game.dispose());
  }
  requestAnimationFrame(() => requestAnimationFrame(() => loading?.classList.add('done')));
} catch (err) {
  console.error(err);
  if (loading) {
    loading.textContent = 'WebGL is required to play ROOFTOP FLOW. Please use a recent desktop browser.';
    loading.style.letterSpacing = '0.05em';
    loading.style.padding = '24px';
    loading.style.textAlign = 'center';
  }
}
