# ROOFLINE

A first-person rooftop parkour game for the browser, inspired by the movement and look of
Mirror's Edge. Sprint, vault, slide, wall-run and ride a zipline across a bright white city, and
follow the red to the finish gate as fast as you can.

Built with **Three.js**, **TypeScript** and **Vite**. There are no external models, textures or
audio files: geometry, textures, the sky and the sound effects are all generated in code.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173), click **Start Run** and play.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check, then a production build in `dist/` (relative paths, works from any sub-folder) |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript only |
| `npm run sim` | Headless route test: a scripted runner completes the whole level with the real physics (needs Node 22.18+ or 23.6+, which run `.ts` files directly) |

Use a recent desktop Chrome, Edge or Firefox with hardware acceleration enabled.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the game to capture the mouse) |
| Shift | Sprint (hold), or turn on *Auto sprint* in Settings |
| Space | Jump. Hold it for a higher jump. Running into a low obstacle vaults it |
| C / Ctrl | Slide while running, crouch when slow |
| E | Vault / grab the zipline |
| R | Restart from the last checkpoint |
| Esc | Pause and release the mouse |

Ctrl is a browser shortcut key, so **C** is the more comfortable slide key. While you are playing,
the page asks for confirmation before closing, so a stray Ctrl+W can't end a run.

## The moves

- **Momentum.** Running builds to sprint speed over about a second. Speed carries through jumps,
  vaults, slides and landings. Air control is deliberately limited.
- **Jumping.** Hold Space longer for a higher jump. Coyote time lets you jump just after leaving
  an edge, and a jump buffer remembers a press made just before you land.
- **Vault.** Press Space or E while running at a red barrier or other low obstacle. You go over
  without losing speed. Walls that are too tall can't be vaulted.
- **Slide.** Press C while running to drop low and slide under ducts and pipes. Jump out of a
  slide to keep the speed. Hold C as you land from a jump to go straight into a slide.
- **Wall run.** Sprint, jump at a wall at a shallow angle and keep holding W. Gravity is light at
  first and builds up, so every wall run ends. Press Space to kick off. You can't run the same
  wall twice without touching the ground.
- **Ledge recovery.** If a jump comes up short, keep holding W into the ledge and you climb up.
- **Zipline.** Stand under the cable and press E, or jump into it. Space lets go.

## The level

One hand-built route of about 500 m. A strong run takes around 60 to 90 seconds. Five checkpoints
save your progress, and falling off a roof respawns you at the last one. The clock starts with
your first move.

1. **Tutorial roof**: run and sprint, vault a red barrier, slide under a red duct, jump a short gap.
2. **Rooftop jumps**: sprint jumps between roofs, a ledge you have to climb, a big drop, a narrow
   bridge.
3. **Slide corridor**: a roof full of machinery with red ducts crossing your path. Chain slides
   to keep your speed.
4. **Wall run**: a 13 m gap you can only cross by wall-running along the red wall of a tower.
5. **Combination**: vault, jump onto a narrow red beam, wall-run on the other side, slide under a
   pipe and climb a ledge.
6. **Final sprint**: ride the zipline down, jump the last roofs and run through the red finish gate.

Red marks things you can use: take-off edges, vault barriers, ducts and pipes to slide under,
wall-run panels, climbable ledges, the beam, the zipline tower and the finish. Your best time and
checkpoint splits are saved locally.

## Settings

Mouse sensitivity, invert Y, field of view, camera motion (Full, Reduced or Off), volume, auto
sprint, tutorial hints, and graphics quality. *High* adds bloom, a 2048 shadow map and a higher
render resolution. *Low* is for weaker GPUs. Settings are saved locally. Mouse sensitivity and
camera motion are also on the title screen.

## How it works

```
src/
  main.ts                    entry point
  game/Game.ts               renderer, main loop, phases, respawns, UI and audio wiring
  game/GameState.ts          run timer, splits, best-time storage
  game/Input.ts              keyboard, pointer lock (with a drag-to-look fallback)
  game/Settings.ts           persisted options
  player/PlayerController.ts movement state machine (ground, air, slide, wall run, vault, mantle, zipline)
  player/PlayerPhysics.ts    collision mover: swept cylinder against boxes, step-up, ground snapping
  player/ParkourSystem.ts    probes that find vaults, ledges, runnable walls and zipline grabs
  player/PlayerConfig.ts     every movement tuning value in one place
  player/FirstPersonCamera.ts head bob, speed FOV, roll, landing and vault camera effects
  player/PlayerBody.ts       first-person arms and legs, plus the player's shadow
  world/LevelData.ts         the route as plain data (no rendering)
  world/CityGenerator.ts     seeded background city, kept clear of the route
  world/CollisionWorld.ts    box colliders in a uniform grid; raycasts and support queries
  world/Level.ts             builds all visuals: merged geometry, flags, lattice tower, cranes
  world/Materials.ts         procedural facade, roof and grate textures
  world/GeometryBuilder.ts   batches boxes into one mesh per material, with world-space UVs
  world/Sky.ts               gradient sky, sun, clouds, environment map for reflections
  world/Checkpoints.ts       checkpoint and finish triggers, beacon beams
  ui/HUD.ts, ui/Menu.ts      overlays (plain DOM and CSS)
  audio/AudioManager.ts      Web Audio sound effects
tools/route-sim.ts           headless completion test
```

- **Fixed timestep.** Physics runs at 120 Hz with an accumulator. Rendering interpolates between
  the last two physics states, so jump heights and distances are the same at any frame rate.
- **Collision.** The world is axis-aligned boxes and the player is a vertical cylinder. Each step
  is split into short sub-steps (at most 12 cm), so high speeds and long falls never tunnel
  through anything. Low steps are climbed automatically. Crouch and slide shrink the cylinder,
  and you only stand up again when there is headroom.
- **Parkour.** Each move is found by probing the same collision world, and its whole path is
  checked for clearance before it starts. A vault or mantle never ends inside geometry.
- **Rendering.** Static geometry is merged per material: the whole city is a few dozen draw calls.
  Facade textures tile in world units so floors line up with the roof edge. Glass reflects a
  prefiltered environment map made from the sky. The sun's shadow map follows the player and is
  snapped to texels to stop shimmering. Lighting uses neutral tone mapping and distance haze.
- **The level is data.** `LevelData.ts` drives the collision world, the visuals and the headless
  test. `npm run sim` replays a racing line through the whole route and fails if any jump becomes
  impossible after a tuning change.
