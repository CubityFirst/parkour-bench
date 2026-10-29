import './styles/main.css';
import { Game } from './game/Game';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;

function boot(): void {
  try {
    const game = new Game(canvas);
    // handy for debugging / automated smoke tests
    (window as unknown as { game: Game }).game = game;
  } catch (err) {
    console.error(err);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `<div class="loading-inner">
        <div class="loading-text" style="color:#ff5560">FAILED TO START</div>
        <p style="margin-top:14px;font-size:12px;color:rgba(244,247,250,.6);max-width:420px;text-align:center">
          ${(err as Error)?.message ?? 'Unknown error'}<br /><br />
          This game needs a browser with WebGL2 support.
        </p>
      </div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
