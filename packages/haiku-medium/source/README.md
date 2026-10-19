# ROOFTOP FLOW

A first-person parkour game for the browser, built with Three.js, TypeScript and Vite. One rooftop level, six sections, checkpoints, a timer and a finish line. No external assets: geometry, materials and sound are all generated in code.

## Install and run

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

- `npm run build`: type-checks with `tsc --noEmit`, then bundles to `dist/`
- `npm run preview`: serves the production build

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look (click the game to lock the pointer) |
| Shift | Sprint |
| Space | Jump (hold for a higher jump; press while on a wall to wall-jump) |
| Ctrl / C | Slide |
| E | Vault / interact |
| R | Respawn at the last checkpoint |
| Esc | Pause and unlock the mouse |

## Mechanics

- **Momentum movement:** ground acceleration only raises speed toward the target, so sprint speed is never bled off by input. Friction applies only when there is no input. Air control is deliberately weak.
- **Jumping:** coyote time (0.12 s), jump buffering (0.12 s), and a variable height that decays when jump is released early.
- **Sliding:** slide from sprint speed with a small boost. The collision box drops to 0.85 m, so you pass under the red ducts. Standing back up only happens when there is headroom.
- **Wall running:** airborne and above 6.5 m/s, next to a wall flagged `wallRun`. Gravity is reduced, the run lasts at most 1.4 s, and a wall cannot be re-run until you land.
- **Vault (E):** climbs crates up to 1.3 m tall, up to 3.2 m deep. Movement is a short scripted arc that keeps you clear of the obstacle.
- **Mantle:** airborne, pressing toward a ledge between 0.7 m and 1.5 m high, with a clear landing spot.
- **Respawn:** falling below the level resets velocity and parkour state and returns you to the last checkpoint.

## Layout

```
src/
  main.ts                       entry point
  styles/main.css               menus, HUD, finish screen
  game/Game.ts                  renderer, fixed-step loop, phases, pointer lock
  game/GameState.ts             phases, settings, best time (localStorage), formatting
  player/PlayerPhysics.ts      tuning constants, momentum, gravity, jumping, collision step
  player/ParkourSystem.ts       slide, wall run, vault, mantle
  player/PlayerController.ts    input to physics and parkour, checkpoints, finish trigger
  player/FirstPersonCamera.ts   look, FOV by speed, bob, roll, landing dip, reduce-motion
  world/CollisionWorld.ts       AABB collision, swept in sub-steps
  world/Level.ts                level layout as data, checkpoints, finish arch
  world/CityGenerator.ts        sky dome, far city (instanced), haze ground
  audio/AudioManager.ts         Web Audio sound effects, wind, footsteps
  input/InputManager.ts         keyboard and mouse state
  ui/HUD.ts, ui/Menu.ts         in-game HUD, menus, finish screen
```

## Level

The route runs from the start (z ≈ 2) toward -Z. Each section is a block in `src/world/Level.ts`:

1. **Tutorial**: a large roof, a 1 m red crate to vault, and a 3.5 m gap.
2. **Rooftop jumps**: stepped rooftops with 4–5 m gaps and red pads at the take-off points.
3. **Sliding**: three low red ducts (1.0–2.2 m) across the full width.
4. **Wall run**: a 7 m gap that a normal jump cannot cross. A tall red wall beside it lets you run across.
5. **Combination**: a vault crate, a 1.2 m red ledge to mantle onto, and a low red beam to slide under.
6. **Final sprint**: short rooftops with a step up, ending at the red finish arch.

The best time is saved in `localStorage` under `rooftop-flow.bestTime`.

## Known limits

- Tuned by reasoning and a headless load test. It has not been playtested end to end, so jump timings and ledge sizes may need adjusting by feel.
- Wall running is in section 4 only. Section 5 has no wall run.
- Requires a WebGL2-capable desktop browser. Pointer lock is needed for mouse look.
