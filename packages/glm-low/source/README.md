# ROOFTOP FLOW

A first-person rooftop parkour game inspired by Mirror's Edge, built with **Three.js + TypeScript + Vite**. Sprint, jump, slide, vault and wall-run across a bright minimalist city of white rooftops and red runner-vision accents. One complete level with 6 sections, checkpoints and a finish gate.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL (e.g. http://localhost:5173), click **START RUN**, and the pointer locks.

To build a production bundle:

```bash
npm run build
npm run preview
```

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look (pointer lock) |
| Shift | Sprint |
| Space | Jump (hold for height) |
| Ctrl / C | Slide |
| E | Vault red obstacles |
| R | Restart from checkpoint |
| Esc | Pause |

## The level (60–120s)

1. **Tutorial roof** — sprint, vault a red AC unit, slide under a duct, small gap
2. **Rooftop jumps** — two sprint gaps across buildings
3. **Vent Alley** — chain three slide ducts with momentum
4. **The Billboard** — 14 m gap, only crossable by wall-running the red wall
5. **Red Room** — slide + vault + bridge/jump combination
6. **Final Sprint** — high rooftops, red finish gate saves your best time (localStorage)

## Architecture

```
src/
  main.ts                 entry point
  game/Game.ts            loop, state, checkpoints, UI wiring
  game/GameState.ts       tunables + routing fuel
  player/PlayerController.ts  movement physics (fixed 120 Hz timestep)
  player/FirstPersonCamera.ts FOV, bob, tilt, landing/vault feedback
  player/Input.ts         keyboard/mouse/pointer-lock
  world/Level.ts          the rooftop route
  world/CityGenerator.ts  instanced background skyline
  world/CollisionWorld.ts static AABB collision + sweeps
  ui/HUD.ts, ui/Menu.ts   HUD, menus, settings, best time
  audio/AudioManager.ts   procedural WebAudio SFX
  styles/main.css
```

Physics notes: fixed-step `dt = 1/120` with axis-separated AABB resolution, coyote time, jump buffering, reduced wall-run gravity, and varied jump height by button hold. Checkpoints (red dot HUD icons) respawn the player on falling off.
