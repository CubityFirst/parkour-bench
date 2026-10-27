# ROOFTOP FLOW

A first-person rooftop parkour game inspired by Mirror's Edge, built with
**Three.js + TypeScript + Vite** and running entirely in the browser.

Sprint, jump, slide, vault and wall-run across a bright minimalist city of
white rooftops and red accents. One complete level, checkpoints, a finish line
and a saved best time.

## Getting started

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://127.0.0.1:5173`) and click
**START RUN**. Click the canvas if the pointer is not captured.

For a production build:

```bash
npm run build
npm run preview
```

## Controls

| Key | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Look |
| `SHIFT` | Sprint (hold) |
| `SPACE` | Jump (hold longer for higher jumps) |
| `CTRL` / `C` | Slide (hold) |
| `E` | Vault |
| `W` (held in air near a wall) | Wall-run |
| `R` | Restart from checkpoint |
| `ESC` | Pause |

## The run

Six sections across the rooftops — tutorial obstacles, rooftop jumps,
a sliding challenge under red ventilation ducts, two wall-run gaps,
a vault + slide + wall-run combination, and a final sprint to the FINISH
gate. Cross the gate to complete the level; the timer keeps your best time
in local storage.

Red objects are intentional: red boxes are vaultable, red duct frames want a
slide, red stripes mark wall-run walls, and red portals are checkpoints.
Falling off the rooftops respawns you at the last checkpoint.

## Tech notes

- Custom AABB physics with fixed-timestep substepping (120 Hz), no physics engine.
- Pointer Lock mouse look with adjustable sensitivity and a reduce-camera-motion option.
- Procedural geometry, canvas-generated textures, instanced background skyline.
- All sound effects are synthesized with the Web Audio API — no assets to download.
