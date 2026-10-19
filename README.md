# parkour-bench

A benchmark harness: give several AI models, at chosen effort levels, the same
Mirror's Edge-style parkour game brief, then package each result in one standard format.
The [parkour hub](../parkour-hub) ingests the packages and serves them side by side at
https://parkour.cubityfir.st.

An orchestrator agent does the work, following [ORCHESTRATOR.md](ORCHESTRATOR.md): it
starts one subagent per (model, effort) pair, checks each build in headless Chrome,
sends bugs back to the model that wrote them, and writes a package.

## Layout

| Path | What |
| --- | --- |
| `brief/prompt.txt`, `brief/reference/` | The game brief and two reference images. Every run gets these, unchanged. |
| `brief/subagent-task.md` | The exact task text each subagent receives. |
| `ORCHESTRATOR.md` | The orchestrator's procedure: endpoints, concurrency, fix rounds, reporting. |
| `PACKAGE.md`, `schema/manifest.schema.json` | The package format the hub ingests. |
| `bench.example.json` | Example run request (models, efforts, concurrency). |
| `tools/` | `new-run`, `package-run`, `shoot`, `verdict` and `validate-package`. |
| `runs/<slug>/` | Subagent working folders. Git-ignored. |
| `packages/<slug>/` | Finished packages. Committed. |

## Running a benchmark

Open this folder in an agent that can start subagents (for example a T3 Code thread)
and ask, for example:

> Run GPT-6-Luna at low and max, and Kimi K3 at max.

The agent reads `AGENTS.md`, which points it to `ORCHESTRATOR.md`.

## Tools

```bash
npm install                                   # playwright-core; uses your installed Chrome
node tools/new-run.mjs luna-max               # seed runs/luna-max and print the subagent task
node tools/package-run.mjs --slug luna-max --family GPT-6-Luna --model gpt-6-luna \
  --provider codex --effort max --title "Rooftop Flow" --blurb "..." --start "start run"
node tools/verdict.mjs luna-max --grounded true --moves true --notes "..."
node tools/validate-package.mjs               # every package; non-zero exit on errors
```

Needs Node 20+, Google Chrome, and `ffmpeg` on `PATH` (or set `FFMPEG`) for thumbnails.

## Ingesting into the hub

```bash
cd ../parkour-hub
node scripts/ingest.mjs ../parkour-bench/packages/luna-max
node scripts/build.mjs luna-max
```
