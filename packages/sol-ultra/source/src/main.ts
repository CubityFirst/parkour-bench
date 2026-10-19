import './styles/main.css';
import { Game } from './game/Game';

const root = document.querySelector<HTMLElement>('#app')!;
try {
  const game = new Game(root);
  // A small read-only inspection surface is useful for performance and physics checks.
  Object.defineProperty(window, '__stride', { value: game, configurable: true });
  game.startLoop();
} catch (error) {
  console.error(error);
  root.innerHTML = `<div style="max-width:520px;margin:15vh auto;font:16px/1.7 system-ui;padding:32px;background:#fff"><h1>STRIDE</h1><p>The city needs WebGL to render. Enable hardware acceleration in your browser and reload to start your run.</p></div>`;
}
