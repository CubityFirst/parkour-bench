# STRIDE — Rooftop Runner

An original, first-person rooftop parkour game built with Three.js, TypeScript, and Vite. Follow the red across six sections of a sunlit city, from your first rooftop jump to the final sprint.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Click **Start Run** to capture your mouse. The game uses WebGL and works in modern desktop Chrome, Firefox, and Edge with hardware acceleration enabled.

```sh
npm run build
npm run preview
```

## Controls

| Control | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Shift | Sprint |
| Space (hold for height) | Jump / jump away from wall |
| C or Ctrl | Slide / crouch |
| E | Vault a red obstacle / climb a reachable ledge |
| R | Return to the latest checkpoint |
| Escape | Pause and release the mouse |

Sprint-jump alongside a red wall to wall-run automatically. Jump again to push away. Sprint into low ventilation gates and slide under them. Follow red arrows and architectural cues; checkpoint markers save progress automatically. Falling returns you to the most recent checkpoint. The run timer pauses with the game; your best completed time and preferences are stored on this browser.

The pause and settings menus offer mouse sensitivity, reduced camera motion, and synthesized audio controls. All geometry, textures, and audio are generated locally: no backend, asset downloads, or external service is needed.

## Structure

- `src/game`: game state, fixed timestep, checkpoint and completion management
- `src/player`: keyboard/mouse input, character collision, parkour and camera feedback
- `src/world`: playable course, collision boxes, procedural city and sky
- `src/ui`: menus, route map, settings and HUD
- `src/audio`: lightweight Web Audio effects

Physics updates at 120 Hz independently of the rendering frame rate. Background facades use shared procedural materials and instanced geometry. Rendering caps pixel density and uses one moving directional shadow volume.

## Verification

`npm test` checks the actual controller's sprint speed, jump distance, vaulting, slide clearance, ledge recovery, wall-running, and collision handling.

With the development server running, `npm run test:route` simulates an uninterrupted run through the authored level, and `npm run test:browser` checks the interface, settings, keyboard input, checkpoints, pause, completion, and persistence. The browser checks require Playwright Chromium (`npx playwright install chromium`). Set `STRIDE_URL` if your server uses a port other than 5173. Browser screenshots are written to `artifacts/`.
