import './styles/main.css';
import { Game } from './game/Game';

function showFatal(message: string): void {
  document.getElementById('loading')?.classList.add('hidden');
  const screen = document.getElementById('error');
  const text = document.getElementById('error-text');
  if (text) text.textContent = message;
  screen?.classList.remove('hidden');
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!webglAvailable()) {
    showFatal('Rooftop Flow needs WebGL 2. Please use a recent desktop version of Chrome, Edge or Firefox with hardware acceleration enabled.');
    return;
  }
  const container = document.getElementById('viewport')!;
  const game = new Game(container);
  await game.init();
}

main().catch((err: unknown) => {
  console.error(err);
  showFatal(`Something went wrong while starting the game: ${err instanceof Error ? err.message : String(err)}`);
});
