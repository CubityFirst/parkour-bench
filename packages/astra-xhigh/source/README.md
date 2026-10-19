# Rooftop Flow

An original first-person rooftop parkour game built with Three.js, TypeScript, and Vite. Run a 800-metre course through six sectors of New Eden, above a procedural glass-and-concrete city.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Click **Begin Run** to capture your mouse. Desktop Chrome, Firefox, or Edge with WebGL2 and hardware acceleration is recommended. If an embedded browser cannot capture the pointer, drag on the scene to look around.

```sh
npm run build    # Type-check and produce dist/
npm run preview  # Serve the production build
npm test         # Fixed-timestep movement and course checks
```

## Controls

| Input    | Action                                            |
| -------- | ------------------------------------------------- |
| WASD     | Move                                              |
| Mouse    | Look                                              |
| Shift    | Sprint                                            |
| Space    | Jump; hold for more height; jump away from a wall |
| C / Ctrl | Slide while running, crouch when slow             |
| E        | Vault a low obstacle in front of you              |
| R        | Return to the current checkpoint                  |
| Esc      | Pause and release the mouse                       |

Red surfaces mark traversal opportunities. Hold Shift and jump alongside a red wall to wall-run automatically. A reachable roof edge automatically triggers a ledge recovery. The red finish gate completes the run. Timer pauses in menus; falls preserve elapsed time and return you to the most recent checkpoint. Best time and runner preferences are saved in local storage.

The six sectors introduce running and vaulting, rooftop jumps, sliding, wall-running, a combined sequence, and a final sprint. Sprint at takeoff markers and hold jump to cross the larger gaps. The first rooftop provides a longer run-up and assists the introductory vault and slide while sprinting. E and C still work manually; all later barriers and ducts require those controls. Falls preserve held movement keys, so sprinting continues after a checkpoint respawn. Wall runs last less than two seconds and reset only after landing.

## Implementation

- Fixed 120 Hz player simulation, axis-separated collision resolution, jump buffering and coyote time.
- Reduced-height slides, finite wall runs, wall jumps, animated vaults and ledge recovery.
- Procedural instanced architecture, glass/concrete textures, animated flags, shadowed sunlight and atmospheric haze.
- Lightweight synthesized Web Audio effects; mute, sensitivity and reduced camera motion settings.
- HTML/CSS menus and HUD with checkpoints, pause, finish, and best-time persistence.

All game geometry, materials, sounds, and branding are original and generated locally. The open-source Barlow Condensed, DM Sans, and IBM Plex Mono fonts are bundled locally with their licenses. No backend, paid assets, or runtime game APIs are required.

## Browser verification

The optional Playwright checks cover menus, saved settings, movement, pause/resume, checkpoint recovery, an entire course completion using the real fixed-step simulation, and best-time persistence. Start the development server, then run:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright install chromium
GAME_URL=http://localhost:5173 PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npm run test:browser
```

Use the port Vite reports if 5173 is already occupied. Screenshots are written to `test-results/`. The course test drives the production movement and game-state code through an accelerated, deterministic run; it does not teleport between challenges. The development-only `window.__game` diagnostic handle is omitted from production builds.

The production sprint regression reproduces a keyboard-only start with W and Shift held continuously, including a fall and respawn. Build and serve the game with a relative base, then point it at that URL:

```sh
npx vite build --base ./
npx vite preview
# In another terminal (CHROME may specify an installed Chromium executable):
GAME_URL=http://localhost:4173/ PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npm run test:sprint
```

This regression uses only the visible production HUD, and also works when the build is served under a sub-path.
