import './styles/main.css';
import { Game } from './game/Game';
import { requireElement } from './ui/HUD';

// Entry point: find the canvas, create the game and start the render loop.
const canvas = requireElement<HTMLCanvasElement>('game-canvas');
new Game(canvas).start();
