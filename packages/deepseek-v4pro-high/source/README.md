# ROOFTOP FLOW

A Mirror's Edge–inspired, first-person 3D parkour game built with **Three.js + TypeScript + Vite**.

Sprint, jump, slide, vault and wall-run across a minimalist futuristic city of white rooftops,
red architecture and glass skyscrapers. Reach the finish line in the fastest time.

## Requirements

- Node.js 18+ and npm.

## Install & run

```bash
npm install
npm run dev
```

Then open the URL printed by Vite (usually http://localhost:5173) in a modern desktop
browser (Chrome, Firefox or Edge).

## Build for production

```bash
npm run build
npm run preview
```

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Mouse | Look around |
| Shift | Sprint |
| Space | Jump (hold for higher jumps) |
| Ctrl / C | Slide |
| E | Vault / mantle |
| R | Restart from checkpoint |
| Esc | Pause / unlock mouse |

## Project structure

```
src/
  main.ts                 entry point
  constants.ts            tuning values + color palette
  input/Input.ts          keyboard + pointer-lock mouse input
  game/Game.ts            renderer, scene, loop, wiring
  game/GameState.ts       state machine + run/best time
  player/PlayerPhysics.ts AABB physics + fixed-timestep collision
  player/PlayerController.ts  movement + state machine
  player/ParkourSystem.ts wall-run / vault / mantle detection
  player/FirstPersonCamera.ts camera, FOV, head-bob, tilt
  world/CollisionWorld.ts AABB storage + raycasts
  world/Level.ts          the playable rooftop route
  world/CityGenerator.ts  background skyline
  world/Checkpoints.ts    checkpoints + finish trigger
  ui/HUD.ts               crosshair, timer, hints
  ui/Menu.ts              main menu, controls, pause, finish
  audio/AudioManager.ts   procedural Web Audio sound
  styles/main.css
```
