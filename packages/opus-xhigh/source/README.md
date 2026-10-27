# ROOFTOP FLOW

A first-person rooftop parkour game for the browser, inspired by the movement and look of
Mirror's Edge: white rooftops, blue sky, glass towers and red "runner vision" cues that show the
way. Sprint, jump, slide, vault, climb and wall-run across a hand-built route of six sections to
the red finish gate. Your best time is saved in your browser.

Built with **Three.js + TypeScript + Vite**. All geometry, textures and sounds are generated
procedurally at startup: no model, texture or audio files, and no backend.

## Quick start

Requirements: Node.js 20.19+ (or 22.12+) and a desktop browser with WebGL 2 (Chrome, Edge or
Firefox).

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173), click **Start Run** and the mouse is
captured. Press **Esc** to pause.

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-checks and builds a static production bundle into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run typecheck` | TypeScript check only |

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Shift | Sprint (hold) |
| Space | Jump (hold for full height) · jump off walls during a wall run |
| C / Ctrl (or right mouse) | Slide while running · crouch when slow |
| E | Vault low obstacles · climb onto ledges |
| R | Restart from the last checkpoint |
| Esc | Pause / release the mouse |
| F3 | Toggle the debug overlay (FPS, state, speed) |

Tips:

- **Wall run:** sprint along a wall (the red panels), jump, and keep holding **W**. Press
  **Space** to kick off the wall.
- **Ledges:** keep holding **W** in the air and you pull yourself up any ledge you can reach.
- **Momentum:** hold **C** while landing to slide out of the fall without losing speed, and jump
  out of slides to carry the speed into the next gap.
- Prefer **C** to slide: **Ctrl+W** closes the browser tab and pages can't block it. The game asks
  before the page unloads mid-run, just in case.

Settings (main menu, or Settings in the pause menu): mouse sensitivity, camera motion
(Full/Reduced; Reduced tones down head bob, roll, FOV kick and landing shake), horizontal field
of view, volume and invert Y.

## The level

One continuous route over the rooftops, with a checkpoint after each major section:

1. **Movement tutorial.** A big start roof: run, sprint, a red-topped barrier to jump or vault,
   a vent bank you can only pass by sliding, and a short gap.
2. **Rooftop jumps.** Widening gaps between buildings, a drop, a higher roof you reach by
   grabbing the ledge, and a long sprint jump. Red stripes mark the take-off edges.
3. **Sliding challenge.** A channel of low vent banks and red pipe racks. Keep sliding to keep
   your speed.
4. **Wall run.** A 13 m gap that no normal jump can clear, beside a tall wall with red panels.
5. **Combination.** A vault barrier, a gap jump, a wall run on the left, a slide under pipes,
   then a jump and climb up a wall.
6. **Final sprint.** A narrow bridge, three descending gap jumps and the red finish gate.

A scripted test bot that uses the real physics finishes the route in about 46 s with perfect
inputs, so a clean human run lands roughly in the 60–120 s range. Falling off the roofs fades
out and respawns you at the latest checkpoint with all momentum cleared. The run timer starts on
your first input and keeps running through respawns.

## Project structure

```
index.html                  HUD and menu markup
src/
  main.ts                   Entry point, WebGL check
  styles/main.css           Menus and HUD
  game/
    Game.ts                 Renderer, scene, fixed-timestep loop, phases, checkpoints, respawn
    GameState.ts            Phase, timer, splits, best time (localStorage)
    Input.ts                Keyboard/mouse state, queued key presses, pointer lock
    Settings.ts             Persistent settings
  player/
    MovementConfig.ts       Every movement tuning value in one place
    PlayerController.ts     Movement state machine (ground, crouch, slide, air, wall run, vault, mantle)
    PlayerPhysics.ts        Swept AABB collision: per-axis sweeps, step-up, ground snap, depenetration
    ParkourSystem.ts        Wall, ledge and vault detection, plus scripted vault/mantle paths
    FirstPersonCamera.ts    Mouse look, head bob, speed FOV, roll, spring-based impacts
    PlayerBody.ts           View-model arms, legs, invisible shadow-casting body
  world/
    CollisionWorld.ts       Static AABB colliders in a uniform-grid broadphase
    Level.ts                The hand-designed route, checkpoints, hints, finish
    LevelBuilder.ts         Route-local coordinate frames and prop helpers (buildings, vents, barriers…)
    CityGenerator.ts        Procedural background city, skyline ring, red radio towers, street
    MeshBatcher.ts          Merges static boxes into one mesh per material (world-scaled UVs, baked AO)
    Materials.ts            Canvas-generated textures and shared materials
    Sky.ts                  Gradient sky with sun and clouds, also baked into the reflection environment
    Checkpoints.ts          Checkpoint progress and light-beam beacons
  ui/
    HUD.ts                  Timer, checkpoint toasts and splits, control hints, crosshair cue, fade
    Menu.ts                 Main, pause and finish screens, controls and settings panels
  audio/
    AudioManager.ts         Web Audio synthesis: footsteps, jump, land, slide, wind, chimes
```

## How it works

**Fixed-timestep simulation.** Physics runs at 120 Hz from an accumulator, independent of the
render rate. Rendering interpolates the player position between the last two physics states, so
movement stays smooth at any frame rate and jumps behave identically on 60 Hz and 240 Hz screens.
Key presses are queued, so a tap is never lost between physics steps.

**Collision.** Every piece of playable geometry is an axis-aligned box, and so is the player.
Movement is resolved one axis at a time with swept tests that clamp travel to the first contact,
so nothing tunnels through thin walls even at very high speed. Small lips are climbed by a
step-up pass, and the camera eases over the height change. A uniform grid keeps queries cheap.

**Movement feel.** On the ground the velocity *direction* turns toward your input at a
speed-dependent rate, and the speed accelerates toward the run or sprint target. Momentum carries
through turns, sprinting builds up over about half a second, and speed above sprint (from slides
or wall runs) bleeds away slowly. Jumps use coyote time, a jump buffer, variable height and
slightly heavier gravity on the way down. Air control can steer you but can't add speed.

**Parkour moves.**

- *Slide:* a speed boost, then friction that grows the longer you slide. You stand up once there
  is headroom; under a duct you stay crouched instead of clipping into it.
- *Wall run:* a probe beside the player finds tall walls. The run keeps your speed, follows a
  rising-then-falling arc, lasts at most 1.35 s, and can only be used once per wall until you
  touch the ground.
- *Vault and mantle:* short scripted paths, checked against the collision world before they
  start. Vaults keep your momentum, and a jump pressed during a vault chains straight into a jump.

**Rendering.** The route and the city are merged into a handful of meshes, one per material,
with world-scaled UVs and baked vertex-colour ambient occlusion. Rooftop clutter in the
background city is instanced. The sun casts PCF shadows from a shadow camera that follows the
player and is texel-snapped to avoid shimmer. The sky is rendered into a PMREM environment map,
which gives image-based lighting and reflective glass. The scene uses linear fog and neutral tone
mapping, and pixel ratio is capped at 1.5.

## Browser notes

- Mouse capture uses the Pointer Lock API. After pressing Esc, browsers wait about a second
  before allowing the mouse to be captured again; if Resume doesn't capture the mouse, click
  again.
- The game needs WebGL 2 and hardware acceleration for a smooth frame rate.
