import './styles/main.css';
import { Game } from './game/Game';

const root = document.querySelector<HTMLDivElement>('#app')!;
try {
  const game = new Game(root);
  // Readable development hook for inspecting the real simulation in browser tests.
  if (import.meta.env.DEV) (window as Window & { __REDLINE__?: Game }).__REDLINE__ = game;
  window.addEventListener('pagehide', () => game.dispose(), { once: true });
} catch (error) {
  console.error(error);
  root.innerHTML = `<div class="fatal"><h1>A little more altitude.</h1><p>This game needs WebGL in a modern desktop browser. Enable hardware acceleration, then reload to get back to the rooftops.</p><button onclick="location.reload()">TRY AGAIN ↗</button></div>`;
}
