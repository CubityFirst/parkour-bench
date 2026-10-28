import './styles/main.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;

if (!canvas) {
  throw new Error('Canvas element #game-canvas not found');
}

const game = new Game(canvas);

// Expose for debugging in the browser console.
(window as unknown as { game: Game }).game = game;
