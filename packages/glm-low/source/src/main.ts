import { Game } from './game/Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

// Bootstrap once the DOM is parsed.
function boot(): void {
  const game = new Game(canvas);
  window.addEventListener('beforeunload', () => game.dispose());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
