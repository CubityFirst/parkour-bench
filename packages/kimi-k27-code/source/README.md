# Rooftop Flow

A Mirror's Edge–inspired first-person parkour game built with **Three.js**, **TypeScript**, and **Vite**.

Run, sprint, jump, slide, vault, and wall-run across bright white rooftops in a minimalist futuristic city. Follow the red Runner Vision markers, hit checkpoints, and race to the finish line.

## Features

- Fast, momentum-based first-person movement
- Parkour mechanics: sprinting, sliding, vaulting, wall running, ledge recovery
- Six connected level sections with checkpoints and a finish line
- Clean Mirror's Edge–style visual identity (white architecture, blue sky, red accents)
- Procedural background city skyline
- Minimal HUD, start menu, pause menu, and finish screen with best-time storage
- Lightweight Web Audio API sound effects

## Controls

| Key | Action |
|-----|--------|
| W A S D | Move |
| Mouse | Look around |
| Shift | Sprint |
| Space | Jump (hold for higher jump) |
| Ctrl / C | Slide |
| E | Vault / climb |
| R | Restart from checkpoint |
| Esc | Pause / unlock mouse |

## Getting Started

```bash
npm install
npm run dev
```

Then open the local URL shown in your terminal (usually `http://localhost:5173`).

Click **Start Game** and click on the game canvas to lock the mouse pointer.

## Build

```bash
npm run build
```

The production build is written to the `dist/` folder.

## Project Structure

```
src/
  main.ts
  game/
    Game.ts
    GameState.ts
  player/
    PlayerController.ts
    PlayerPhysics.ts
    ParkourSystem.ts
    FirstPersonCamera.ts
  world/
    Level.ts
    CityGenerator.ts
    CollisionWorld.ts
    Checkpoints.ts
  ui/
    HUD.ts
    Menu.ts
  audio/
    AudioManager.ts
  styles/
    main.css
```
