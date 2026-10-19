# ROOFTOP FLOW

A Mirror's Edge–inspired first-person rooftop parkour game (Three.js + TypeScript + Vite).

## Run

```bash
npm install
npm run dev      # open the printed URL (default http://localhost:5173), click Start Game
npm run build    # type-check + production bundle
```

## Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look |
| Shift | Sprint (hold) |
| Space | Jump (hold for higher), wall-jump |
| Ctrl / C | Slide while sprinting |
| E | Vault low obstacles |
| R | Restart from checkpoint |
| Esc | Pause |

Tip: Ctrl+W closes the browser tab, so use **C** to slide while holding W.

Wall-run: jump while touching a red-striped wall, hold W (and Shift). Mantling onto ledges is automatic when you jump into a roof edge.

## Layout

`src/game` (loop, state) · `src/player` (input/controller, physics, parkour, camera) · `src/world` (level, city, collision, checkpoints) · `src/ui` · `src/audio`
