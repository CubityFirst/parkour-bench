import "./styles/main.css";
import { Game } from "./game/Game";
try {
  new Game();
} catch (error) {
  console.error(error);
  document.getElementById("app")!.innerHTML =
    '<div style="padding:12vh 10vw;font-family:Arial,sans-serif"><h1>Rooftop Flow</h1><p>Your browser couldn’t start the 3D renderer. Enable hardware acceleration and reload in a desktop browser.</p><button onclick="location.reload()">Try again</button></div>';
}
