import './styles/main.css';
import { Game } from './game/Game';

const canvas = document.getElementById('scene');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #scene canvas');
}

new Game(canvas).start();
