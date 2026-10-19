import './styles/main.css';
import { Game } from './game/Game';

const canvas = document.getElementById('scene');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing <canvas id="scene"> in index.html');
}

new Game(canvas);
