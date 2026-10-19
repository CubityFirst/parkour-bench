# ROOFTOP FLOW

A first-person browser parkour time trial inspired by Mirror's Edge. Built with Three.js, TypeScript and Vite, with no external assets: geometry, materials, sound and sky are all procedural.

## Install and run

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173). Click **Start Game**, then click the canvas to capture the mouse if needed.

Production build:

```bash
npm run build      # type-check (tsc) + Vite bundle into dist/
npm run preview    # serve dist/ locally
```

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look around |
| Shift | Sprint |
| Space | Jump (hold for a higher jump) |
| Ctrl / C | Slide (while running) |
| E | Vault a red obstacle (or interact) |
| R | Restart from the last checkpoint |
| Esc | Pause and release the mouse |

Mantling is automatic: jump at a ledge that is too high to vault and keep pushing forward. Wall-running is automatic: jump off the edge beside a tall wall at speed. Coming back to the same wall needs a landing first.

## The level

Six sections, about 255 m of rooftops, with checkpoints after sections 1–4 and at the start of sections 5 and 6:

1. **Movement Tutorial**: sprint, jump, a vault over a red block, and a short gap.
2. **Rooftop Jumps**: rooftops with 4.5 m gaps and a rise. Red takeoff markers show where to jump.
3. **Sliding Challenge**: red ducts overhead. Slide under them without stopping.
4. **Wall Run**: a 9 m gap that can't be jumped. Jump beside the red wall and run along it.
5. **Parkour Combination**: vault, mantle a ledge, then slide under a duct.
6. **Final Sprint**: a few quick jumps to the red finish gate.

Falling below the rooftops respawns you at the last checkpoint. The timer keeps running, and the best time is saved locally.

## Project layout

```
src/
  main.ts                  entry point
  game/Game.ts            game loop, phases, checkpoints, finish
  game/GameState.ts       phases, settings and best-time storage, time formatting
  player/PlayerController.ts  movement state machine and tuning (TUNING)
  player/PlayerPhysics.ts     AABB collision: move, step-up, ground probe
  player/ParkourSystem.ts     vault, mantle and wall detection queries
  player/FirstPersonCamera.ts camera, FOV, head bob, roll, landing and vault effects
  input/Input.ts              keyboard and mouse state
  world/Level.ts              the six sections, checkpoints and finish
  world/CollisionWorld.ts     solid box list and overlap queries
  world/CityGenerator.ts      visual-only skyline, sky dome and street
  world/Materials.ts          shared materials and the unit box geometry
  audio/AudioManager.ts       Web Audio sound effects, synthesized at runtime
  ui/HUD.ts, ui/Menu.ts       in-game HUD and the menu, pause and finish screens
  styles/main.css             overlay styling
```

## Design notes

- **Fixed timestep.** Physics runs at 120 Hz regardless of display refresh rate. Rendering and camera effects run per frame.
- **Collision.** Everything solid is an axis-aligned box. Movement is resolved per axis in substeps of at most 8 cm, which keeps fast movement from tunnelling through thin floors. Low ledges (up to 0.45 m) are stepped onto automatically.
- **Tuning.** Movement values live in `TUNING` at the top of `PlayerController.ts`. A sprint jump clears about 7 m, and the level's gaps are sized from that.
- **Runner Vision.** Traversal surfaces are red: vault blocks, ducts, takeoff markers, the wall-run wall and the finish gate. The rest of the course is white and gray, so the route stays readable.
- **Reduce camera motion.** Turns head bob, strafe roll, wall tilt, landing dip and FOV kicks down to about a quarter. Available in Settings and saved locally.
- **Performance.** Shared geometry and materials, instanced meshes for the background city, shadow map sized at 2048 and following the player, and pixel ratio capped at 1.75.
