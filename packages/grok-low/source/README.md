# ROOFTOP FLOW

A first-person rooftop parkour game. Sprint, jump, slide, vault, and wall-run a single city route from the start roof to the red finish line.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints. The game uses the browser's WebGL renderer and does not need a server of its own.

`npm run build` typechecks and writes a static bundle. `npm run selftest` checks the movement frame, collision, and that a scripted runner can finish the route.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look (pointer lock) |
| Shift | Sprint |
| Space | Jump |
| Ctrl or C | Slide |
| E | Vault |
| R | Restart at the last checkpoint (timer keeps running) |
| Esc | Pause |

Mouse sensitivity and a reduced-camera-motion option are on the main menu and the pause menu. The best finish time is stored in this browser.

## Debug

Add `?bot=1` to watch a scripted runner complete the route. Add `?colliders=1` to draw the collision boxes.
