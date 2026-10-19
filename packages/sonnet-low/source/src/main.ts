import './styles/main.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
new Game(canvas).start();
