import './styles/main.css';
import { Game } from './game/Game';

try {
  new Game(document.querySelector<HTMLCanvasElement>('#world')!);
} catch (error) {
  console.error(error);
  document.querySelector('#app')!.innerHTML = `<section class="overlay"><div class="dialog"><div class="eyebrow">UPSHIFT / RENDERER UNAVAILABLE</div><h2>A clearer view.</h2><p>This game needs WebGL. Enable hardware acceleration in your browser, then reload to get back on the rooftops.</p><button class="button primary" onclick="location.reload()">Try again ↗</button></div></section>`;
}
