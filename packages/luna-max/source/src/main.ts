import "./styles/main.css";
import { Game } from "./game/Game";

try {
  new Game();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unable to start the game.";
  document.body.innerHTML = "<main style='font:16px Arial;padding:48px;color:#18252b;background:#e9f4f8'><h1>Rooftop Flow could not start</h1><p>" + message + "</p><p>Try a current desktop browser with WebGL enabled.</p></main>";
  console.error(error);
}

