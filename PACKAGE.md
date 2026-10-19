# Package format (schema version 1)

Each finished run becomes one folder under `packages/<slug>/`. A package is
self-contained: the hub can serve it at any sub-path without rebuilding it.

```
packages/<slug>/
  manifest.json        metadata, verification results and fix history (see below)
  thumbnail.webp       640x360 title-screen thumbnail for the landing card
  dist/                static build made with `vite build --base ./`; entry is dist/index.html
  source/              the model's project, without node_modules/, dist/ or the brief
  screenshots/         menu.png, idle-{500,2000,5000}.png, sprint-{2000,5000}.png
```

`dist/` must only use relative URLs, so it works at `/<slug>/` or any other path.
`tools/validate-package.mjs` rejects a root-relative `src="/…"` or `href="/…"` in
`dist/index.html`.

## manifest.json

`schema/manifest.schema.json` is the formal definition. Example:

```json
{
  "schemaVersion": 1,
  "slug": "luna-max",
  "title": "Rooftop Flow",
  "blurb": "Momentum movement over a procedural city, with fall recovery and a progress bar.",
  "model": { "family": "GPT-6-Luna", "id": "gpt-6-luna", "provider": "codex", "effort": "max" },
  "status": "complete",
  "brief": { "file": "brief/prompt.txt", "sha256": "7f8abe95…" },
  "createdAt": "2026-10-19T21:20:00.000Z",
  "entry": "dist/index.html",
  "thumbnail": "thumbnail.webp",
  "storageKeys": ["rooftop-flow-best-time"],
  "build": { "command": "vite build --base ./", "ok": true, "typecheck": "pass" },
  "verification": {
    "pageErrors": [],
    "replacementChars": 0,
    "grounded": true,
    "moves": true,
    "notes": "Vault prompt at the first block."
  },
  "fixRounds": [],
  "notes": ""
}
```

| Field | Meaning |
| --- | --- |
| `status` | `complete`: finished and verified. `partial`: playable but unfinished, or stopped by a quota. `failed`: doesn't build or can't be played. The hub only lists `complete` and `partial`. |
| `model.family` | Display name. The hub groups packages with the same family onto one card with an effort picker. |
| `model.effort` | `low`, `medium`, `high`, `xhigh` or `max`. |
| `storageKeys` | localStorage keys the game uses, as detected by the packager. Every game shares one origin, so the hub namespaces each game's localStorage under `<slug>:`; two packages may use the same key name. |
| `storageDirect` | Keys the game reads or writes by direct property access (`localStorage.best`, `localStorage['best']`). The hub's isolation can't namespace these, so the validator fails the package if one matches another package's key. |
| `build.typecheck` | `pass`, `fail` or `skipped`. A failed typecheck is recorded, not fatal: the hub only needs `dist/`. |
| `verification.pageErrors` | Uncaught page errors seen in headless Chrome. |
| `verification.replacementChars` | Count of `�` in the rendered page text. More than 0 means mis-encoded source. |
| `verification.grounded` / `moves` | The orchestrator's verdict from the screenshots: does the player stand on the start roof, and does sprinting move them? `null` until judged. |
| `fixRounds` | `{ "issue": "...", "at": "<ISO time>" }` for each bug report sent back to the model. |
