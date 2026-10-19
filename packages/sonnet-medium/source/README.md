# ROOFTOP FLOW

A Mirror's Edge–inspired first-person rooftop parkour game. Three.js + TypeScript + Vite, no external assets
(geometry, textures and sound are all procedural).

## Run

```bash
npm install
npm run dev      # open the printed URL, click "Start Game"
npm run build    # type-check + production build
npm run sim      # headless bot plays the whole level at 60/120/240 Hz (verifies it is completable)
```

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump (hold for height; coyote time + buffering) |
| Ctrl / C | Slide (while sprinting) |
| E | Vault low (red) obstacles |
| Wall-run | Jump beside a red wall, keep holding W, Space to jump off |
| R | Restart from checkpoint |
| Esc | Pause |

Mantling: falling/jumping into a ledge just above you pulls you up automatically while holding W.

## Layout

`src/game` loop/state/input · `src/player` physics, parkour detection, controller, camera, body ·
`src/world` level data + collision, procedural city/sky/textures, checkpoints · `src/ui` HUD/menus · `src/audio` Web Audio synth.

Physics runs at a fixed 120 Hz with render interpolation; collision is sub-stepped AABB sweeps on a spatial grid.
Level jumps are sized against the movement constants in `PlayerController.ts` (`MOVE`).
Settings (sensitivity, reduced camera motion) and best time persist in localStorage.
