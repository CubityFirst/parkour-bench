# ROOFTOP FLOW

A first-person browser parkour game built with Three.js, TypeScript and Vite. One complete rooftop level with checkpoints, a timer, a finish line, and a local best time.

## Install and run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default http://localhost:5173). Click **START GAME** to capture the mouse.

Production build:

```bash
npm run build      # type-check (tsc --noEmit) + vite build into dist/
npm run preview    # serve dist/ locally
```

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look around |
| Shift | Sprint |
| Space | Jump (hold for higher; jump off a wall while wall running) |
| Ctrl / C | Slide (while sprinting) |
| E | Vault |
| Walk or fall into a ledge | Mantle up (automatic) |
| Airborne, against a red wall | Wall run |
| R | Restart from the last checkpoint |
| Esc | Pause |

## The level

Six sections, running from the start roof towards -Z:

1. **Tutorial**: a low red crate and a 3.5 m gap.
2. **Rooftop jumps**: step-up roofs and 4.5 m gaps, with red takeoff markers.
3. **Slide challenge**: three red ducts hang at head height. Slide under them.
4. **Wall run**: an 11 m gap that a normal jump cannot cross, with a long red wall beside it.
5. **Combination**: a vault barrier, a 1.9 m mantle ledge, and a gap.
6. **Final sprint**: step-ups and gaps, ending at the red finish arch.

Checkpoints sit after each major section. Falling below the level respawns you at the latest checkpoint.

## Project layout

```
src/
  main.ts                    entry point
  game/Game.ts               state machine, fixed-step loop, event wiring, best time
  game/Input.ts              keyboard and mouse state, edge-triggered presses
  player/PlayerController.ts ground/air movement, jumping, sliding, coyote time, buffering
  player/ParkourSystem.ts    wall running, vaulting, mantling
  player/PlayerPhysics.ts    box-body collision resolved per axis
  player/FirstPersonCamera.ts head bob, roll, FOV, landing and takeoff feedback
  player/MoveConfig.ts       all movement tuning values
  world/CollisionWorld.ts    static AABB store and overlap queries
  world/Level.ts             level geometry, checkpoints, route hints
  world/Checkpoints.ts       checkpoint progression
  world/CityGenerator.ts     seeded background skyline (visual only)
  world/Assets.ts            shared geometry and procedural materials
  audio/AudioManager.ts      Web Audio sound effects, no asset files
  ui/HUD.ts, Menu.ts         in-run HUD, menus, finish screen
  styles/main.css
index.html                   menu, pause and finish markup
```

## Notes

- Everything is procedural: no models, textures or audio files.
- Movement tuning lives in `src/player/MoveConfig.ts`.
- The best time is stored in `localStorage` under `rooftop-flow.best-time`.
- The reduce-camera-motion option scales head bob, roll and FOV changes down.
