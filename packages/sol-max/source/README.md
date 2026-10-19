# ROOFTOP FLOW

A complete first-person parkour game across the sunlit rooftops of Meridian City. Built with Three.js, TypeScript, and Vite. All architecture, textures, clouds, movement animations, and sounds are generated in the browser. Fonts are bundled locally; the game needs no network connection after loading.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite in a desktop browser. Click **Start Run** (or press Enter). The mouse locks to the game; Escape pauses and releases it. If pointer lock is unavailable, click and drag on the game to look around.

```sh
npm run build     # Type-check and create dist/
npm run preview   # Serve the production build
npm test          # Deterministic movement and collision checks
```

## Controls

| Input                   | Action                                                  |
| ----------------------- | ------------------------------------------------------- |
| WASD / arrow keys       | Move                                                    |
| Mouse                   | Look                                                    |
| Shift                   | Sprint                                                  |
| Space                   | Jump; hold for more height                              |
| C / Ctrl                | Slide while running; hold to remain crouched            |
| E                       | Vault a nearby low obstacle                             |
| Space beside a red wall | Enter a wall run while moving; press again to kick away |
| R                       | Return to the latest checkpoint                         |
| Escape                  | Pause / resume                                          |

Sprint and jump near red roof edges. Red wall runs engage automatically when you are airborne, moving quickly, and close to either side of the wall. Keep moving forward. A short mantle catches reachable rooftop lips automatically. Slides keep you crouched beneath a ceiling until there is room to stand.

## The Meridian Run

An approximately 830-metre route with 17 rooftops and six sectors:

1. **First Light** — a safe run-up, vault practice, first jump, and a slide introduction.
2. **Open Air** — a sequence of rising roofs and a narrow service bridge.
3. **Low Profile** — three ventilation tunnels to slide through.
4. **Walk the Wall** — a 20-metre gap with a runnable red wall.
5. **In the Flow** — vaults, a slide, and a second wall run.
6. **The Home Stretch** — a final chain of sprint jumps to the red finish gate.

Checkpoints save progress during a run. Falls reset movement to the latest checkpoint; the timer continues. Pausing stops the timer. A clean, fast run takes around one minute; allow 60–120 seconds while learning. Your best completion time and camera preferences are saved locally when browser storage is available.

Use **Settings** to adjust mouse sensitivity and reduce camera motion, or mute sound with the speaker button. No enemies, combat, backend, downloaded models, or large audio files.

## Implementation

- `src/game/Game.ts` — fixed 120 Hz simulation, rendering, game states, checkpoints, finish, and input flow.
- `src/player/` — input, AABB collision physics, coyote time, jump buffering, slide clearance, limited wall runs, vault/mantle trajectories, and camera/body motion.
- `src/world/` — the authored route, collision data, procedural city, textures, sky, signage, and batched geometry.
- `src/ui/` and `src/styles/` — menus, settings, minimal HUD, and completion screen.
- `src/audio/` — synthesized Web Audio effects and speed-dependent wind.

Repeated architecture uses instanced meshes and shared materials. Shadows use one directional light with a 2048px shadow map that follows the runner. Device pixel ratio is capped at 1.6.

`scripts/visual-check.mjs` exercises the menu, keyboard movement, and pause in Chromium. `scripts/ui-check.mjs` checks controls, preferences, pause timing, restart, and fall recovery. `scripts/route-check.mjs` simulates a complete run using the real level collision world and game checkpoint/finish logic. These expect a development server at `http://localhost:5177` by default (override with `FLOW_TEST_URL`), and save results in `artifacts/`.

```sh
PLAYWRIGHT_BROWSERS_PATH=.browsers npx playwright install chromium
npm run dev -- --port 5177
# In another terminal:
PLAYWRIGHT_BROWSERS_PATH=.browsers node scripts/visual-check.mjs
PLAYWRIGHT_BROWSERS_PATH=.browsers node scripts/ui-check.mjs
PLAYWRIGHT_BROWSERS_PATH=.browsers node scripts/route-check.mjs
```
