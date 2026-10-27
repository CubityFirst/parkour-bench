# Rooftop Flow

An original first-person rooftop time trial built with Three.js, TypeScript, and Vite. Follow the red route across six districts, reach the extraction gate, and try to beat your best time.

## Run locally

Requires a recent Node.js release and a desktop browser with WebGL.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Click **Start run** to capture the mouse. The game is designed for a keyboard and mouse; pointer lock requires a browser window and a user click.

## Controls

| Control | Action |
| --- | --- |
| W A S D / mouse | Move / look |
| Shift | Sprint |
| Space | Jump; jump away from a wall |
| Ctrl or C | Slide (hold to stay low) |
| E | Vault a low obstacle or mantle a reachable ledge |
| R | Return to the latest checkpoint |
| Escape | Pause / release mouse |

For the long gap, sprint and jump close to the red wall on the right. Keep moving forward to run along it; jump away when needed. If you miss a ledge, press E or Space near it to mantle. Checkpoints save your position during a run; your best completion time is saved in your browser. Mouse sensitivity, reduced camera motion, and sound can be adjusted from the menu.

Use `npm run build` to type-check and create a production build, or `npm run preview` to serve that build.
