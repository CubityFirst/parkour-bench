import { Game } from './game/Game';

const app = document.getElementById('app');
if (!app) {
  throw new Error('Missing #app container');
}

// eslint-disable-next-line no-new
new Game(app);
