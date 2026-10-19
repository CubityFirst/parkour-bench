# ROOFTOP FLOW

A first-person rooftop parkour game. The level, buildings, and interface are original. It runs in the browser with Three.js, TypeScript, and Vite.

## Play

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually `http://127.0.0.1:5173`. Choose **Start**, then click the view if the browser is waiting for pointer lock.

## Controls

- WASD or the arrow keys move.
- The mouse looks around.
- Shift sprints.
- Space jumps. A tap is a short hop. Holding Space reaches full height.
- Ctrl or C slides. Space jumps out of a slide.
- E vaults a low obstacle.
- R restarts from the latest checkpoint. The run timer keeps going.
- Esc pauses.
- F3 draws the collision boxes and a speed readout.

Mouse sensitivity and reduced camera motion are on the main menu. They stay in this browser. A finished run stores its best time locally when the time is longer than one second.

## Checks

```bash
npm test
```

Runs a headless pass of the rooftop route.

```bash
npm run build
```

Typechecks the project and writes a static build to `dist/`.
