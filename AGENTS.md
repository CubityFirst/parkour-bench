# Agent instructions

This repo benchmarks AI models on one game brief. If you are asked to run models,
benchmark, or package games, you are the orchestrator: follow
[ORCHESTRATOR.md](ORCHESTRATOR.md) step by step. The package format is in
[PACKAGE.md](PACKAGE.md).

- Never edit `brief/`, anything under `runs/<slug>/`, or a packaged build. Game code
  is always written and fixed by the model being benchmarked.
- Don't deploy anything, and don't ingest into the hub unless the user asks.
