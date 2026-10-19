# Rooftop Flow

An original first-person rooftop parkour course built with Three.js, TypeScript, and Vite. The route uses white concrete roofs, blue glass skyline silhouettes, and red runner-vision guides.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). For a production check:

```bash
npm run build
```

## Controls

| Input | Action |
| --- | --- |
| WASD + Mouse | Move / look |
| Shift | Sprint |
| Space | Jump; jump away from a wall run |
| Ctrl / C | Slide under low beams |
| E | Vault a waist-high obstacle or mantle a ledge |
| R | Return to the latest checkpoint |
| Esc | Pause and release the mouse |

Red surfaces show the intended line. At the wide wall gap, sprint to the long red wall on the left, jump while beside it, and hold your forward line to run across. Completion and best times are stored locally in the browser.

## Project layout

- `src/player/PlayerController.ts` — fixed-step momentum movement, jumping, sliding, vaulting, mantling, and wall runs.
- `src/world/CollisionWorld.ts` — lightweight AABB collision and traversal queries.
- `src/world/Level.ts` — complete rooftop course, checkpoints, visual props, and procedural skyline.
- `src/main.ts` — renderer, HUD, menus, timing, checkpoints, and game loop.
