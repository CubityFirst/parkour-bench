# ROOFTOP FLOW

A first-person browser parkour game built with Three.js, TypeScript, and Vite.
One authored rooftop route with six sections, checkpoints, a timer, and a finish line.
All geometry, materials, textures, and sound effects are procedural. There are no external assets.

## Install and run

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`), click **Start Game**, then click the
game view to capture the mouse if it has been released.

Production build:

```bash
npm run build      # type-checks with tsc, then bundles with Vite into dist/
npm run preview    # serves dist/ locally
```

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look around |
| Shift | Sprint |
| Space | Jump (hold for a higher jump, tap for a short hop). Also jumps off a wall during a wall run |
| Ctrl / C | Slide (while running on the ground) |
| E | Vault low red obstacles. Mantling onto ledges happens automatically when you bump one while airborne |
| R | Restart from the current checkpoint |
| Esc | Pause and release the mouse |

Movement is momentum-based. Sprinting before a jump carries you further, air steering is limited so
you cannot turn a sprint into a stop, and wall runs and mantles keep most of your forward speed.

## The level

The route runs from the start down the -Z axis to the red finish arch.

1. **Movement tutorial.** Flat start, a small red vault crate, and a short gap.
2. **Rooftop jumps.** Gaps of 4.5 to 5 m with small height steps. Red strips mark take-off edges.
3. **Sliding challenge.** Three full-width gates hang 1.1 m above the roof. Slide under each one.
4. **Wall run.** A 12 m gap that a jump cannot cross. Run alongside the tall red wall to carry across.
5. **Combination.** A vault, a slide gate, and a 6 m gap bridged by a second red wall.
6. **Final sprint.** Four jumps with rising and falling ledges, then the finish arch.

Checkpoints sit at the start of sections 2 to 6. Falling below the roofs respawns you at the latest checkpoint.
The run timer keeps running through respawns, so every reset costs time.
The best time is saved in `localStorage`.

## Project structure

```
src/
  main.ts                    Entry point
  game/
    Game.ts                  Renderer, scene, fixed-step loop, run flow, pointer lock
    GameState.ts             Screens, run timer, best time and settings persistence
    Input.ts                 Keyboard and mouse sampling with latched press edges
  player/
    PlayerPhysics.ts         Box body with exact per-axis swept collision and ground probe
    PlayerController.ts      Movement state machine: ground, air, slide, wall run, vault, mantle
    ParkourSystem.ts         Read-only queries: wall-run contact, vault target, mantle target
    FirstPersonCamera.ts     Look, bob, speed FOV, roll, landing dip, vault lift
    ArmsView.ts              Low-poly forearms that sway and reach during vaults
  world/
    CollisionWorld.ts        Static AABB collider store
    Level.ts                 Authored route, colliders, checkpoints, hints, finish zone
    Checkpoints.ts           Forward-only checkpoint tracking and respawn points
    CityGenerator.ts         Sky dome, ground, and instanced background towers (no collision)
    Materials.ts             Shared materials and procedural concrete texture
  audio/
    AudioManager.ts          Web Audio synthesis for footsteps, jumps, landings, slides, wind, checkpoints
  ui/
    HUD.ts                   Crosshair, timer, speed, toasts, contextual hints
    Menu.ts                  Main menu, controls, pause, finish, settings
  styles/
    main.css                 HUD and overlay styling (white, black, gray, red)
index.html                   Overlay markup
```

## Design notes

- **Fixed timestep.** Physics steps at 120 Hz. The camera interpolates between the last two physics
  states, so motion stays smooth on high-refresh displays. Catch-up steps are capped to avoid spirals.
- **Collision.** The body is an axis-aligned box. Movement resolves one axis at a time, and each sweep is
  computed analytically against every collider, so thin walls cannot be tunnelled through at speed.
- **Parkour flags.** Only boxes tagged in `Level.ts` can be vaulted (`vaultable`), mantled (`climbable`),
  or wall-run (`wallRun`). Everything else is a plain wall or gate. The route stays readable, and nothing
  can be exploited by accident.
- **Wall-run limits.** A wall can be used once per airtime and only while moving along it. Wall runs last at most
  1.6 s, and the descent is slow but not zero.
- **Reduce motion.** The option in the main menu scales head bob, FOV change, roll, landing dip, and vault lift to about a third.
- **Red as signal.** Red marks what the player should interact with: vault crates, wall-run walls, slide gates,
  take-off strips, and the finish arch. The rest of the route stays white and grey.

## Tuning

Movement values live at the top of `src/player/PlayerController.ts`. Level layout and gap sizes are in
`src/world/Level.ts`. Gap widths were chosen against the movement values: a sprint jump covers about 6.5 m,
and a walking jump about 4.3 m.
