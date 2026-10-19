import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow/latin-900.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-800-italic.css";
import "./styles/main.css";
import { Game } from "./game/Game";

try {
  const game = new Game();
  // A small development-only inspection hook for reproducible movement and browser checks.
  if (import.meta.env.DEV) Object.assign(window, { __flow: game });
} catch (error) {
  console.error("ROOFTOP FLOW could not initialize:", error);
  const panel = document.querySelector<HTMLElement>("#render-error");
  if (panel) panel.hidden = false;
}
