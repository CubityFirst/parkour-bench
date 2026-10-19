import { Game } from './game/Game';

const game = new Game();
if (import.meta.env.DEV) {
  (window as unknown as { __flow?: { snapshot(): unknown } }).__flow = game;
}
