# UPSHIFT

A complete first-person rooftop parkour game built with Three.js, TypeScript, and Vite. An original 650-meter course takes you across fourteen rooftops in Aster District, with six sectors, checkpoints, and a timed finish.

All architecture, materials, skies, character geometry, and sound effects are generated locally. No backend, asset service, or external runtime requests are needed.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and click **Start running**. The game captures the mouse; **Esc** releases it and pauses the run. If the default port is occupied, Vite prints the next available port.

```sh
npm run build       # Type-check and create the production bundle in dist/
npm run preview     # Serve that production bundle locally
```

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump; hold for more height |
| C / Ctrl | Slide while moving |
| E | Vault a nearby low red obstacle |
| R | Return to the current checkpoint |
| Esc | Pause and release the mouse |

Sprint and jump close to a red wall to wall-run automatically. Keep moving forward; press Space again to jump away. Hold Space near a reachable ledge to mantle onto it. Slide underneath red ventilation tunnels, and sprint before the marked rooftop gaps.

The timer starts on your first movement and stops while paused. Falling returns you to your latest checkpoint; your run time is retained. Crossing the finish gantry completes the course. Best times, sound preferences, mouse sensitivity, and reduced camera motion are saved on this browser.

## The course

1. **First steps** — a roomy starting roof, vault, slide, and short jump.
2. **Open air** — successive running jumps and a narrow maintenance bridge between elevated roofs.
3. **Stay low** — three low ventilation tunnels.
4. **Against the wall** — a 21-meter gap crossed using the right-hand wall.
5. **Find your flow** — vault, jump, slide, left-hand wall-run, and another vault.
6. **The home stretch** — a red balance strip and three final jumps to the finish.

A first successful run generally takes about a minute or two. An ideal automated line completes the course in approximately 51 seconds. Follow red markings and sector signs; white architecture forms the city around the route.

## Implementation

- `src/game/Game.ts` — state transitions, 120 Hz simulation loop, checkpoints, timing, settings, and rendering.
- `src/player/PlayerController.ts` — acceleration, air control, variable jumps, coyote time, jump buffering, sliding, wall runs, vaults, and ledge recovery.
- `src/player/Input.ts` — keyboard state and pointer-lock mouse look.
- `src/player/FirstPersonCamera.ts` — smooth look, speed FOV, landing motion, wall lean, and procedural body geometry.
- `src/world/CollisionWorld.ts` — static AABB collision, ground support, and wall queries.
- `src/world/Level.ts` — course geometry, procedural materials, instanced skyline, route cues, and flags.
- `src/world/Atmosphere.ts` — procedural sky, sunlight, shadows, and distance haze.
- `src/ui/UI.ts` / `src/styles/main.css` — title, controls, settings, HUD, pause, and finish screens.
- `src/audio/AudioManager.ts` — Web Audio footsteps, movement sounds, wind, and checkpoint feedback.

The player is a feet-positioned box with a standing height of 1.8 meters, sliding height of 0.82 meters, and radius of 0.34 meters. Collision advances in small axis-separated steps. Traversal arcs are checked against the collision world before a vault or mantle starts. Wall-run time is limited, and the same wall cannot be reacquired until landing.

Shared materials and instanced geometry keep the city inexpensive to draw. Pixel ratio is capped at 1.6, shadows use one 2048-pixel map, and there are no costly postprocessing passes.

## Verification

```sh
npm test
npm run build
```

The eleven physics tests cover landing, thin-wall collision, gap distance, variable jump height, sliding clearance, both wall-run sides, vaulting, respawn state, coyote time, jump buffering, and ledge recovery.

Browser tests use the actual course and controller. They check menus/settings, pointer lock, keyboard movement, pause timing, checkpoint restart, every traversal mechanic, course completion, and persisted best times. They save screenshots to `artifacts/`.

With the development server running:

```sh
PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium
mkdir -p .tmp
PLAYWRIGHT_BROWSERS_PATH=.playwright TMPDIR="$PWD/.tmp" npm run test:browser
```

If Vite uses another port, set `GAME_URL`, for example `GAME_URL=http://localhost:5176`. The browser tests select Chromium’s Metal backend on macOS. Desktop keyboard and mouse are required for gameplay.
