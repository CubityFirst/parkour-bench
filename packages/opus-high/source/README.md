# ROOFTOP FLOW

A first-person rooftop parkour game for the browser, inspired by the movement and
look of *Mirror's Edge*: white rooftops, blue glass towers and red "runner vision"
markers that show the route. It's built with **Three.js + TypeScript + Vite**. The
geometry, textures and sounds are all generated in code, so there are no asset
downloads.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (normally http://localhost:5173) in desktop Chrome, Firefox
or Edge and press **START RUN**.

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-checks, then makes a production build in `dist/` |
| `npm run preview` | Serves the production build |
| `npm run typecheck` | Type-checks only |

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Shift | Sprint (hold) |
| Space | Jump. Hold for a higher jump. Jumps off a wall during a wall run |
| C / Ctrl | Slide while running. Crouch when moving slowly |
| E | Vault a low obstacle, or climb onto a chest-high ledge |
| R | Restart from the last checkpoint |
| Esc | Pause and release the mouse |

Tip: slide with **C**. Browsers keep Ctrl+W (close tab) even during a game, so the
game asks you to confirm before a running game's tab closes.

### Parkour moves

- **Wall run:** sprint along a wall, jump, and keep holding **W**. Gravity is weaker
  on the wall for about 1.6 s. Press **Space** to jump off. You can't run the same
  wall again until you touch the ground.
- **Ledge grab:** jump at a ledge up to about 2.2 m above your feet while holding
  **W** and you pull yourself up.
- **Vault:** press **E** in front of a waist-high obstacle to go over it without
  losing speed.
- **Slide:** sprint, then press **C**. A slide adds a little speed and goes under
  low ducts. Jump out of a slide to keep its momentum.

## The level

One course with six sections and four checkpoints. A clean run takes about 30–40 s,
and a first run usually takes 60–120 s.

1. **Movement tutorial:** running, a low wall (jump or vault), a duct to slide
   under, and a short gap.
2. **Rooftop jumps:** gaps that need a sprint jump, drops, two red stepping
   platforms and a ledge climb.
3. **Sliding challenge:** a row of red ventilation ducts.
4. **Wall run:** a 14 m gap that a normal jump can't cross (a sprint jump
   reaches about 8 m), next to a wall with red panels.
5. **Parkour combination:** vault, slide, sprint jump, a narrow beam, a left-side
   wall run and a ledge climb.
6. **Final sprint:** three more jumps to the red finish gate.

If you fall off a roof, you respawn at the last checkpoint. Your best time is saved
in `localStorage`.

## Project structure

```
src/
  main.ts                  entry point
  game/Game.ts             renderer, fixed 120 Hz simulation loop, game flow
  game/GameState.ts        phases, run timer, settings and best-time storage
  game/Input.ts            keyboard/mouse state with latched key presses
  player/PlayerController.ts  movement state machine (ground/air/slide/wallrun/vault/mantle)
  player/PlayerPhysics.ts  tuning values + AABB collide-and-slide with step-up
  player/ParkourSystem.ts  wall / vault / ledge detection queries
  player/FirstPersonCamera.ts  mouse look, head bob, FOV, roll, landing/vault kicks
  player/PlayerBody.ts     low-poly arms (overlay pass) and legs
  world/Level.ts           the course layout, checkpoints, hints, sections
  world/CityGenerator.ts   background skyline (merged meshes + instanced props)
  world/CollisionWorld.ts  AABB collision world
  world/Checkpoints.ts     checkpoint/finish triggers and light-beam markers
  world/GeometryBatcher.ts merges boxes into one mesh per material, world-space UVs
  world/Materials.ts       procedural canvas textures and shared materials
  world/Sky.ts             sky shader, sun/shadows, fog, environment map
  ui/HUD.ts, ui/Menu.ts    HUD, main/pause/controls/finish screens
  audio/AudioManager.ts    Web Audio sound effects
  styles/main.css
```

### How it works

- **Physics:** the simulation runs at a fixed 120 Hz, separate from the frame
  rate, and the camera interpolates between steps. The player is an AABB that
  resolves collisions one axis at a time. One step moves at most a few centimetres,
  so fast movement can't pass through geometry.
- **Movement:** acceleration eases off near top speed, and speed above the cap
  (from slides or wall jumps) decays slowly instead of being cut. Air control is
  limited. Jumps have coyote time, input buffering and variable height.
- **Rendering:** level geometry is merged into a small number of draw calls (one
  per material). It uses ACES tone mapping, sRGB output, a 2048 shadow map that
  follows the player, exponential fog, and a PMREM environment map built from the
  sky shader so the glass reflects it.
- **Camera motion settings:** *Full*, *Reduced* and *Minimal* scale the head bob,
  roll, FOV changes and landing/vault kicks.

## Debugging

In dev mode, or with `?debug` in the URL, the game object is available as
`window.__rf`. For example, `__rf.simulate({ forward: 1, sprint: true }, 120)` runs
one second of physics with the given input.
