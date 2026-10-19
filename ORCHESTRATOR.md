# Orchestrator guide

You are the orchestrator for parkour-bench. The user names one or more models and
effort levels. You run one subagent per (model, effort) pair against the same brief,
check what each one built, and package every result so the parkour hub can ingest it.

You do not write or fix game code yourself. Every line of a game is its model's work.

## 1. Read the request

The user asks in plain words ("run Kimi K3 at max and GPT-6-Luna at low, medium and
high") or points at a JSON file shaped like `bench.example.json`. Turn it into a list of
runs, each with:

| Field | Example | Notes |
| --- | --- | --- |
| `provider` | `codex`, `opencode`, `claudeAgent` | A `providerInstanceId` from `orchestrator_capabilities`. |
| `model` | `gpt-6-luna`, `opencode-go/kimi-k3` | The exact model id from the same catalogue. |
| `family` | `GPT-6-Luna` | Display name. Every build of one model must use the same family, so the hub groups them on one card. |
| `effort` | `low` … `ultra` | One of `low`, `medium`, `high`, `xhigh`, `max`, `ultra`. |
| `slug` | `luna-max` | `<short-family>-<effort>`, lowercase, `[a-z0-9-]`. Must not already exist in `packages/`. |

Call `orchestrator_capabilities` first and check that every model and effort exists.
Providers name the effort option differently (`reasoningEffort`, `effort`, `variant`)
and some don't offer every level: Qwen3.8 Flash has no `high`, and Kimi K3 offers only
`max`. `ultra` exists only on some Codex models (Sol, Astra), not on Luna. If a
requested level is missing, say so and offer the nearest one. Don't substitute silently.

## 2. Pick endpoints and concurrency

- Prefer endpoints the user's plans already cover. On OpenCode, `opencode-go/*` uses the
  Go subscription and `opencode/*` is pay-per-use credit.
- These fail on the first request, before any work happens. Report them to the user and
  don't retry, because only the user can change the setting:
  - "This Go model trains on request data": a *Contributor* model, blocked by the
    workspace's Privacy settings.
  - "requires Global regions": the workspace's Privacy region setting.
  - "Insufficient account funds": pay-per-use credit is empty.
- **Concurrency:** five OpenCode Go runs in parallel used up the Go usage cap in about
  20 minutes, so run **at most 2 Go jobs at once**. Codex handled 5 at once. If a run
  stops with "usage limit exceeded", stop starting new runs on that provider, and tell
  the user which runs are left and how far each got.

## 3. Seed each run

For each run:

```bash
node tools/new-run.mjs <slug>
```

This creates `runs/<slug>/` with the brief and reference images, and prints the exact
subagent task text. `runs/` is inside this repo, so subagents never touch an "external
directory". Outside the project, OpenCode would ask for permission on every file access.

## 4. Start the subagents

Use `delegate_task` with `mode: "async"`, `role: "implementation"`, the run's provider
and model, the effort option, and a stable `clientRequestId` such as `bench-<slug>-v1`.
Pass the printed task text **verbatim**. Don't add hints, tips or warnings about bugs
seen in other runs: every model gets the identical brief, so the comparison stays fair.

The child inherits your runtime mode. If it can't write to `runs/<slug>/`, report that
instead of loosening anything yourself.

Keep a table of slug → taskId → childThreadId. End your turn after starting a batch;
completion notifications wake you.

## 5. When a run finishes

1. Read `task_status`.
   - **Failed on a quota or account error:** follow section 2. If it got a long way first,
     nudge the same child thread later with `t3_thread_send` so it keeps its plan.
   - **Provider stream error mid-run:** nudge the same thread once. Tell it what it had
     already written and that the cut-off wasn't its fault.
2. Package it:

   ```bash
   node tools/package-run.mjs --slug <slug> --family "<family>" --model <model> \
     --provider <provider> --effort <effort> --title "<game title>" --blurb "<card blurb>" \
     --start "<start button text>"
   ```

   This installs dependencies, builds with a relative base (`--base ./`), copies the
   source and screenshots into `packages/<slug>/`, serves the build under a sub-path,
   drives it in headless Chrome, makes the thumbnail and writes `manifest.json`.
   - Take the title from the game's own menu.
   - Keep the blurb under 90 characters and make it factual, from the game's README or
     level code. Don't use "TBD".
   - `--start` is a case-insensitive regex for the menu's start button.
3. **Look at the screenshots yourself** in `packages/<slug>/screenshots/`:
   - `menu.png`: title screen renders, and there's no `�` (a mis-encoded character).
   - `idle-500.png` and `idle-5000.png`: no input at all. The player should be standing
     on the starting roof, with the view the same in both.
   - `sprint-2000.png` and `sprint-5000.png`: W and Shift held. The view should have
     moved forward.

   An upside-down or "under the city" view means a spawn or collision bug.
4. Record what you saw:

   ```bash
   node tools/verdict.mjs <slug> --grounded true --moves true --notes "Vault prompt at first block."
   ```

5. Run `node tools/validate-package.mjs <slug>`. It must pass before you report the
   package as ready.

## 6. Bugs: send them back to the same model

If the build fails, the page throws, text is mis-encoded, or the player can't stand or
move:

- Send a concrete bug report to **that run's own child thread** (`t3_thread_send`,
  mode `auto`). Include what you did, what you saw at which timestamp, and the URL it was
  served at.
- Point it at the test harness, so it can reproduce the bug rather than guess from the
  code: `node tools/shoot.mjs --url <url> --out <dir> --start "<regex>"`. A model that
  only reads its code tends to "fix" the wrong thing.
- **Encoding:** on Windows, files written through PowerShell default to ANSI, so `·` and
  `→` turn into `�`. Ask for UTF-8 source files.
- Allow up to **2 fix rounds**, then package what exists with `--status partial` and
  describe the problem in `--notes`.
- Record every round with `node tools/verdict.mjs <slug> --fix "<what was wrong>"`.

## 7. Report

For each run, report the slug, the result (complete, partial or failed, and why), a
screenshot path, the verdict, and the package path. Then tell the user the packages are
ready to ingest in the hub:

```bash
cd ../parkour-hub && node scripts/ingest.mjs ../parkour-bench/packages/<slug>
```

Don't ingest or deploy unless the user asks. Deploying publishes to a public site.

## Rules of thumb

- Never edit files under `runs/<slug>/` yourself, and never patch packaged builds.
- Keep `brief/` unchanged. If the brief changes, every earlier package was built from a
  different brief: the manifest records its SHA-256, so say so.
- Commit packages (`git add packages/<slug>`) once they validate; `runs/` is ignored.
- Long background servers time out after about 30 minutes, so restart them when needed.
  `package-run.mjs` starts its own server for each run.
