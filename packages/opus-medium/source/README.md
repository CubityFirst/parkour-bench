# ROOFTOP FLOW

A first-person rooftop parkour game inspired by Mirror's Edge, built with **Three.js + TypeScript + Vite**.
It has one rooftop level: sprint, jump, slide, vault, mantle and wall-run across a white city, from the start roof to the red finish gate.

## Run it

```bash
npm install
npm run dev        # then open the printed localhost URL
```

Other scripts:

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Click **START RUN** to lock the mouse. Press **Esc** to pause.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Shift (hold) | Sprint |
| Space | Jump (hold for full height). Press on a wall to wall-jump |
| Ctrl / C | Slide while running (tap for a short slide, hold for a longer one). Crouch when slow |
| E | Vault a low obstacle in front of you |
| Hold W | Climb a ledge you jumped at, wall-run when airborne beside a wall |
| R | Restart from the last checkpoint |
| Esc | Pause (P also works) |

Mouse sensitivity, camera motion (Full / Reduced) and volume are in the main menu and the pause menu. Settings and your best time are saved in `localStorage`.

## The level

1. **Tutorial roof**: a low red barrier (jump it or vault it with E), a red duct to slide under, then a short gap.
2. **Rooftop jumps**: gaps that get longer. Red lines mark where to take off. The last roof is higher, so you climb its ledge if you come up short.
3. **Slide alley**: across a narrow bridge, then three red ducts to slide under.
4. **Wall run**: a 12 m gap that you can't clear with a jump. Run along the red glass wall to cross it.
5. **Combination**: vault, jump, turn left, wall-run a second red wall, slide, then jump and climb a higher ledge.
6. **Final sprint**: an auto-vault barrier, more jumps and a duct, then the red finish gate.

There are four checkpoints. If you fall, you respawn at the last one.

## Code layout

```
src/
  main.ts                  entry point
  config.ts                all movement / physics tuning values
  game/Game.ts             renderer, scene, lights, fixed-timestep loop, game flow
  game/GameState.ts        phase, timer, settings + best time persistence
  game/Input.ts            keyboard/mouse; key presses are held until a sim step uses them
  player/PlayerController.ts  movement state machine (ground/air/slide/wallrun/vault/mantle)
  player/PlayerPhysics.ts  AABB body: axis-separated sweep with sub-steps, step-up, ground probe
  player/ParkourSystem.ts  wall / vault / ledge detection queries
  player/FirstPersonCamera.ts  interpolation, head bob, FOV kick, roll, landing dip
  player/PlayerBody.ts     low-poly first-person arms and slide legs
  world/Level.ts           the route: rooftops, obstacles, red markers, hints, checkpoints, finish
  world/CityGenerator.ts   seeded background city (batched + instanced)
  world/CollisionWorld.ts  static AABB world with a grid broad-phase
  world/Checkpoints.ts     checkpoint activation / respawn point
  world/GeometryBatcher.ts merges boxes per material, with world-space UVs
  world/Materials.ts       canvas-generated textures and materials
  world/Sky.ts             gradient sky dome, clouds, PMREM environment map
  ui/HUD.ts, ui/Menu.ts    DOM HUD, menus, pause and finish screens
  audio/AudioManager.ts    sound effects generated with the Web Audio API
  styles/main.css
```

### How it works

- Physics runs at a fixed **120 Hz** and rendering interpolates between steps. Jump arcs come out the same at any frame rate: the route was checked at 30, 60 and 144 fps.
- The world is made of axis-aligned boxes, so collision is simple and predictable. Large moves are split into sub-steps of 12 cm or less to stop the player passing through walls.
- Jump numbers: apex ≈ 1.5 m, sprint jump ≈ 6.5 m flat, wall run ≈ 15 m. Level gaps are sized from these.
- There are no external assets. All textures, geometry and sounds are generated in code.
