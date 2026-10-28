# ROOFTOP FLOW

A fast, first-person rooftop parkour game inspired by the movement language of
*Mirror's Edge*. Built with **Three.js**, **TypeScript** and **Vite** — no
external models, textures, audio files or game engines are used. Every mesh is
procedural, every texture is drawn on a canvas at runtime and every sound is
synthesised with the Web Audio API.

![gameplay](reference/ref-2-rooftop.png)

---

## Quick start

```bash
npm install
npm run dev
```

Then open **http://127.0.0.1:5173/** in a desktop browser (Chrome, Edge or
Firefox) and click **START RUN** — the mouse is captured by the pointer lock
API, press `Esc` to release it.

Other scripts:

```bash
npm run build     # type-check + production bundle into dist/
npm run preview   # serve the production build
```

---

## Controls

| Key | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Look around (pointer lock) |
| `Shift` | Sprint |
| `Space` | Jump (hold for height, release early to cut the jump) |
| `Ctrl` / `C` | Slide (hold) |
| `E` | Vault |
| `R` | Restart from the last checkpoint |
| `Esc` | Pause / release the mouse |

Movement also has **coyote time** (0.12 s), **jump buffering** (0.16 s),
**variable jump height**, air control, momentum preservation and automatic
**ledge recovery** when you land just below a roof edge.

---

## The level

Six hand-built sections across twelve rooftops of the *Meridian District*,
roughly 400 m long and designed for a 60–120 second clean run.

| # | Section | What it teaches |
|---|---|---|
| 1 | Movement tutorial | Running, sprinting, jumping, vaulting, sliding, the first gap |
| 2 | Rooftop jumps | Chaining sprint jumps between rooftops of different heights |
| 3 | Sliding challenge | A corridor of overhead ducts that has to be slid under |
| 4 | Wall run | An 11 m gap that cannot be jumped — sprint, jump and ride the red wall |
| 5 | Parkour combination | Vault → slide → wall run in one flow |
| 6 | Final sprint | Fast jumps to the red finish gate |

**Runner vision** is used sparingly and only where it matters: red pipes, red
take-off stripes on the roof lips, red vent lips, red vault crates, red wall-run
surfaces, red checkpoint arches and the red finish gate. The route also reads
from the architecture alone.

Falling off the rooftops respawns you at the last checkpoint. The run timer,
the best time (saved in `localStorage`) and a route progress bar are shown in
the HUD.

---

## Architecture

```
src/
├── main.ts                    entry point
├── core/
│   ├── Input.ts               keyboard + pointer lock
│   └── Materials.ts           shared palette, procedural facade/roof textures
├── game/
│   ├── Config.ts              every movement constant in one place
│   ├── Game.ts                renderer, scene, game loop, state machine
│   └── GameState.ts           state enum + time formatting
├── player/
│   ├── PlayerController.ts    movement state machine + parkour moves
│   ├── PlayerPhysics.ts       AABB body, collision resolution, ground probes
│   ├── ParkourSystem.ts       wall / vault / ledge detection
│   ├── FirstPersonCamera.ts   FOV, bob, roll, landing impact, vault dip
│   └── PlayerBody.ts          low-poly forearms that react to movement
├── world/
│   ├── CollisionWorld.ts      axis aligned solid registry
│   ├── Level.ts               the six level sections, props and checkpoints
│   ├── CityGenerator.ts       instanced background skyline
│   └── Sky.ts                 gradient sky shader + PMREM environment
├── ui/
│   ├── HUD.ts                 crosshair, timer, progress, hints, toasts
│   └── Menu.ts                main menu, pause menu, finish screen, settings
├── audio/
│   └── AudioManager.ts        synthesised footsteps, jumps, wind, slide, chimes
└── styles/main.css
```

### Physics notes

* The player is an axis-aligned box. Movement is resolved one axis at a time
  (X → Z → Y) and every step is sub-stepped to a maximum travel distance of
  0.2 m, so tunnelling is impossible even at 50 m/s.
* The whole world is made of axis-aligned boxes, which makes collision exact
  and cheap — no triangle raycasts in the hot path.
* The simulation runs at a fixed 120 Hz timestep, decoupled from rendering.
* The sun's shadow camera follows the player, so a single 2048² shadow map
  covers the whole level at high resolution.
* Static level geometry is merged per material, which keeps the whole city at
  roughly 25 draw calls.

---

## Settings

* **Mouse sensitivity** — 0.2× to 2.5×
* **Reduced camera motion** — softens head bob, roll and landing impact
* **Sound** — toggle the synthesised audio

All settings and the best time are stored in `localStorage`.

---

## Notes

The project is self-contained: `npm install` pulls only `three`, `vite`,
`typescript` and the Three.js type definitions. The level design, the
"Meridian District" city and the character are original work made for this
project.
