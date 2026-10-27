import './styles/main.css';
import { Game } from './game/Game';

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Missing #game canvas');

  // Let the loading screen paint before the (synchronous) city build.
  requestAnimationFrame(() =>
    setTimeout(() => {
      try {
        const game = new Game(canvas);
        game.start();
        if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
          (window as unknown as { __rf: Game }).__rf = game;
        }
      } catch (err) {
        console.error(err);
        const el = document.querySelector('#loading .loading-text span');
        if (el) el.textContent = 'WebGL failed to start — please use a recent desktop browser.';
      }
    }, 30),
  );
}

boot();
