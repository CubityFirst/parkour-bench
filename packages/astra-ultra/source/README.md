# REDLINE

A playable first-person rooftop parkour game built with Three.js, TypeScript, and Vite. Follow the red architecture across an original sunlit city, keep your momentum, and reach the finish.

## Run locally

Use Node.js 20.19+ (or a newer LTS release) and a modern desktop browser with WebGL and a mouse.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Select **Start Run** and click into the game to capture the mouse. Press **Esc** to release it and pause.

If your browser blocks mouse capture, hold the left mouse button and drag on the game to look around. Keyboard controls continue to work.

```bash
npm run build
npm run preview
```

The production build is written to `dist/`. No backend, paid assets, account, or external game services are needed.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump; hold briefly for a higher jump |
| Ctrl / C | Slide while moving; crouch under low obstacles |
| E | Vault a nearby low obstacle |
| R | Restart from the latest checkpoint |
| Esc | Pause and release the mouse |

Sprint toward red takeoff markers for long jumps. Jump beside red wall-running surfaces to cross wider gaps, then jump away from the wall. Approach a reachable ledge while airborne to pull yourself up automatically. Red accents and rooftop signs mark the intended route.

## The course

Six connected sections lead through a movement tutorial, rooftop jumps, low ventilation structures, a wall-run crossing and narrow skybridge, a combination of parkour moves, and the final sprint. Checkpoints save your progress during a run; falling returns you to the latest checkpoint. The finish screen records your time and saves your best locally in the browser. The roughly 640-meter course takes about 60–120 seconds to complete; a perfect scripted run takes about 54 seconds.

Mouse sensitivity, camera motion, and sound volume are adjustable in the menu. Reduce camera motion for a steadier view. Sound is synthesized through Web Audio and starts after your first interaction; the game remains playable when browser audio is unavailable.

## Implementation

The game uses procedural geometry and materials, lightweight custom collision and movement, a fixed physics timestep, pointer-lock camera controls, and HTML/CSS overlays. Rooftop obstacles and background architecture are original. No reference image is used as a game asset.

Keep hardware acceleration enabled for WebGL rendering.

## Browser verification

With the development server running on port 5173, install the test browser into this project and run:

```bash
PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium
npm run test:browser
```

Set `REDLINE_URL` if the development server uses a different URL. The focused suite checks controls, settings, collision, vaulting, slide clearance, jump height, every gap, both wall runs, checkpoint recovery, completion, and persistence. The route test drives real keyboard and mouse listeners continuously from start to finish, without teleporting. Reports are written to `.test-results/verification.json` and `artifacts/route-check.json`.
