import './styles/main.css';
import * as THREE from 'three';
import { Game } from './game/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #scene not found');
}

const game = new Game(canvas);
game.start();

// Expose the game instance for debugging / automated smoke tests.
(window as unknown as { __ROOFTOP__: Game }).__ROOFTOP__ = game;

if (import.meta.env.DEV) {
  (window as unknown as { __THREE__: typeof THREE }).__THREE__ = THREE;
}
