import { Game } from "./game/Game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const ui = document.querySelector<HTMLElement>("#ui");

if (!canvas || !ui) {
  throw new Error("Missing #game or #ui");
}

try {
  new Game(canvas, ui);
} catch (err) {
  ui.innerHTML = '<div class="panel"><div class="card"><h2>WebGL failed to start</h2></div></div>';
  console.error(err);
}
