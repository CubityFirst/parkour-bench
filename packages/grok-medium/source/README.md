# ROOFTOP FLOW

A first-person rooftop parkour game in the browser. Sprint, jump, slide, vault, and wall-run a single course of white roofs, glass towers, and red route markers.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Click **Start run** to capture the mouse.

Production build:

```bash
npm run build
npm run preview
```

Movement checks without a browser:

```bash
npm test
```

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump (tap for a short hop, hold for full height) |
| Ctrl or C | Slide |
| E | Vault a red barrier |
| R | Restart from the last checkpoint |
| Esc | Pause |
| F2 | Collision wireframe |

Jump beside a red wall while sprinting to wall-run. The run drops you onto the next roof, or press Space to jump off early. Falling off respawns at the last checkpoint. The timer keeps running until you cross the finish arch.

Mouse sensitivity and camera motion are in the main menu and the pause menu. They are saved in local storage, along with your best time.

## Layout

- `src/player` — look frame, physics, parkour, camera, body
- `src/world` — course, collision, city, checkpoints, materials
- `src/ui` — menu and HUD
- `src/audio` — synthesized movement cues
- `src/game` — loop, input, and game flow

The level runs toward world -Z, which is the camera's forward direction at yaw 0.
