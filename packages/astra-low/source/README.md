# Rooftop Flow

An original first-person rooftop parkour game built with Three.js, TypeScript and Vite. All world geometry is procedural; no models or game assets are downloaded.

## Run

```sh
npm install
npm run dev
```

Open the local URL shown by Vite in a desktop browser. Click **Start run** to capture the mouse. `npm run build` checks TypeScript and produces `dist/`; `npm run preview` serves the production build.

## Controls

- WASD: move; mouse: look
- Shift: sprint
- Space: jump (hold for maximum height), wall jump
- C / Ctrl: slide
- E: vault a low red barrier
- R: respawn at the last checkpoint
- Escape: pause and release the mouse

Follow red markings through six sectors. For the wall-run gap in sector four, move toward the right-hand red wall before jumping and hold sprint and forward. Ledge recovery is automatic when moving toward a reachable roof. The finish arch is at the end of sector six. Falls retain the run timer; best completed time is stored in your browser. Menu settings control mouse sensitivity, camera motion, and sound.

Physics runs at 120 Hz. The course uses axis-aligned solid collision geometry, procedural city architecture, shared mesh resources, and a moving sunlight shadow region. The UI font uses Google Fonts with local fallbacks; gameplay works without that font request.
