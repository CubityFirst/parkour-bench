import './styles/main.css';
import { Game } from './game/Game';

const game = new Game(document.getElementById('app')!);
// Handy for debugging from the devtools console.
(window as unknown as { game: Game }).game = game;
