# ROOFTOP FLOW

A Mirror's Edge–inspired first-person parkour game for the browser. Sprint, jump, slide, vault, mantle and
wall-run across a bright white-and-red rooftop level above a glass-and-concrete city.

Built with **Three.js + TypeScript + Vite**. No external assets: all geometry, materials, sky and sound are procedural.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm run preview` | Serve the production build |
| `npm run sim` | Headless verification: a bot plays the real level with the real controller and must reach the finish |
| `node tools/e2e.mjs` | Browser smoke test (needs `npm run dev` running and Chrome) |

Use a desktop browser with WebGL2 (Chrome, Edge, Firefox). Click **Start Game**; the mouse is captured (Pointer Lock).
`Esc` releases it and opens the pause menu. If pointer lock is unavailable, drag with the mouse to look.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Shift | Sprint (hold) |
| Space | Jump (hold = higher, tap = hop) |
| Ctrl / C | Slide (while running) |
| E | Vault low obstacles |
| R | Restart from checkpoint |
| Esc | Pause / release mouse |

Techniques: jump toward a red wall at speed and hold **W** to wall-run (**Space** leaps off, one wall run per wall until
you land); jump at a ledge just above you to mantle automatically; slide under red ducts, vault red obstacles.
The menu has mouse sensitivity, volume and **Reduce camera motion**.

## The level (60–120 s run)

1. **Movement** – start roof: sprint, a vault box, a low canopy to slide under, a short gap.
2. **Rooftop jumps** – gaps of 4.0 / 5.0 / 3.6 m, a climbable ledge, a narrow bridge. Checkpoint 1.
3. **Sliding** – a roof of low red ducts, a vault box and a long ventilation tunnel. Checkpoint 2.
4. **Wall run** – a 14 m gap that can only be crossed by running along the red wall. Checkpoint 3.
5. **Combination** – jump, vault, slide, drop, then a left-side wall run over a 12 m gap. Checkpoint 4.
6. **Final sprint** – five jumps towards the red finish gate.

Falling off respawns you at the latest checkpoint. The best time is stored in `localStorage`.

## Architecture

```
src/
  main.ts                    entry point
  game/Game.ts               renderer, scene, main loop, game flow (menu → run → pause → finish)
  game/GameState.ts          settings, best time, run clock
  game/Input.ts              keyboard + pointer-lock mouse, latched key edges
  player/MovementConfig.ts   every movement tuning value
  player/PlayerPhysics.ts    AABB body: swept per-axis collision, step-up, ground detection
  player/ParkourSystem.ts    probes for vault / mantle / wall-run (plans are pre-validated)
  player/PlayerController.ts movement state machine (ground, air, slide, wall-run, vault, mantle)
  player/FirstPersonCamera.ts bob, roll, FOV, landing spring, slide height, vault dip
  player/PlayerBody.ts       low-poly arms and legs, drawn in a separate depth-cleared pass
  world/CollisionWorld.ts    AABB world with a spatial grid
  world/LevelLayout.ts       pure-data level (solids, checkpoints, hints, finish)
  world/Level.ts             turns the layout into merged meshes + colliders
  world/Materials.ts         procedural concrete / office / glass / grate shaders
  world/CityGenerator.ts     instanced background skyline
  world/Sky.ts               gradient sky with clouds, baked into an environment map
  world/Checkpoints.ts       checkpoint pads and respawn points
  ui/HUD.ts, ui/Menu.ts      DOM overlays
  audio/AudioManager.ts      Web Audio synthesis
tools/sim.ts                 headless level-completion bot
```

Physics runs at a fixed 120 Hz step, independent of frame rate, with render interpolation. Movement is sub-stepped
(≤ 12 cm per collision step) so even 16 m/s cannot tunnel through geometry. Gravity, jump speed, gap sizes and wall
lengths are all tuned together; `npm run sim` re-verifies that the level stays completable (including sloppy jumps).

## Performance notes

Level geometry is merged into one mesh per material, the background city is two instanced meshes, shadows use a single
2048² map that follows the player, and a small dynamic-resolution controller lowers the pixel ratio if frames get slow.
