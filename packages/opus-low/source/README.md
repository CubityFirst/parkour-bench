# ROOFTOP FLOW

A Mirror's Edge–inspired first-person parkour game built with Three.js, TypeScript and Vite.

## Run

```bash
npm install
npm run dev      # then open the printed localhost URL
npm run build    # type-check + production build into dist/
```

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump (hold for higher jumps) |
| Ctrl / C | Slide (tap while running; hold to crouch-crawl) |
| E | Vault |
| R | Restart from last checkpoint |
| Esc | Pause |

To wall run, sprint, jump alongside a red wall and hold W. Press Space to leap off.
To climb a ledge, jump into it while holding W.

## Level

1. Tutorial roof: vault hurdle, slide bar, first gap
2. Rooftop jumps (red edges mark take-off points)
3. Slide under the red ducts
4. Wall run along the red wall (right)
5. Vault, gap, wall run (left), slide, ledge climb
6. Final sprint to the red gate

## Code layout

- `src/game` – game loop (fixed 120 Hz physics + render interpolation), input, state
- `src/player` – movement (`PlayerController`), collision (`PlayerPhysics`), wall run / vault / mantle (`ParkourSystem`), camera effects, arms
- `src/world` – level layout, AABB collision world, checkpoints, procedural background city and materials
- `src/ui`, `src/audio` – DOM menus/HUD and Web Audio sound effects
