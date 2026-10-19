import './styles/main.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #game-canvas in index.html');
}

new Game(canvas).start();
