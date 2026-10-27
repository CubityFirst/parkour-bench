import './styles/main.css';
import { Game } from './game/Game';

const app = document.getElementById('app')!;
const game = new Game(app);
// Exposed for debugging from the browser console.
(window as unknown as { __game: Game }).__game = game;
