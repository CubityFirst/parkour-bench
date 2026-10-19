import './styles/main.css';
import { Game } from './game/Game';

declare global {
  interface Window {
    __game?: ReturnType<Game['debugApi']>;
  }
}

async function boot(): Promise<void> {
  const loading = document.getElementById('loading');
  const game = new Game();
  try {
    await game.init();
  } catch (err) {
    console.error('ROOFTOP FLOW failed to start', err);
    if (loading) {
      loading.innerHTML =
        '<div class="logo small">ROOFTOP <span>FLOW</span></div>' +
        '<p style="max-width:42ch;text-align:center;font:500 14px/1.5 system-ui">' +
        'This game needs a desktop browser with WebGL 2 enabled. Please check that hardware acceleration is on and reload.</p>';
    }
    return;
  }
  // Testing hooks (teleport, scripted stepping) are only exposed in dev builds or with ?debug.
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) {
    window.__game = game.debugApi();
  }

  // Hot-module reload: tear everything down so GPU resources are released.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      game.dispose();
      window.__game = undefined;
    });
  }
}

void boot();
