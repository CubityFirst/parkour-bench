# ROOFTOP FLOW

A first-person rooftop parkour game in the browser. Sprint, jump, slide, vault, and wall-run a white city marked with red.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints (http://localhost:5173). Click **Start run** to capture the mouse.

```bash
npm run build
npm run test:sim
```

`test:sim` drives the course with a scripted runner and checks that the route can be finished.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump |
| Ctrl or C | Slide |
| E | Vault |
| R | Restart from the latest checkpoint |
| Esc | Pause |
| F3 | Collision wireframe and speed readout |

Mouse sensitivity, camera motion, and sound are in the main menu and the pause menu. The best time is stored in this browser.

## Layout

The run is one continuous roof course: a short tutorial, sprint jumps, a duct alley, two wall-runs, a combination, and a finish arch. Falling off respawns at the last checkpoint.
