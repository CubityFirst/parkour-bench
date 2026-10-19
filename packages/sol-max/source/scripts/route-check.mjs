import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(process.env.FLOW_TEST_URL ?? "http://localhost:5177", {
  waitUntil: "networkidle",
});
const report = await page.evaluate(async () => {
  const { ROOFTOPS } = await import("/src/world/Level.ts");
  const game = window.__flow;
  game.state = "playing";
  game.checkpoint = 0;
  game.elapsed = 0;
  game.ui.setState("playing");
  game.player.reset(game.level.checkpoints[0].position);
  const moves = {},
    failures = [],
    checkpointTimes = [],
    vaults = [];
  game.player.onEvent = (event) => {
    moves[event] = (moves[event] ?? 0) + 1;
  };
  game.audio.event = () => {};
  let controls;
  game.input.read = () => controls;
  game.input.yaw = 0;
  let priorCheckpoint = 0,
    priorZ = game.player.position.z;
  const dt = 1 / 120;
  for (let frame = 0; frame < 120 * 160; frame++) {
    const p = game.player;
    const roof = ROOFTOPS.find(
      (r) =>
        p.position.z <= r.start + 0.35 &&
        p.position.z >= r.end - 0.35 &&
        Math.abs(p.position.y - r.y) < 2,
    );
    const jump =
      !!roof &&
      p.grounded &&
      p.position.z - roof.end < 0.95 &&
      p.position.z > roof.end - 0.2 &&
      roof !== ROOFTOPS.at(-1);
    const slide = [-84, -263, -282, -303, -477].some(
      (z) => p.position.z < z + 6 && p.position.z > z - 5,
    );
    const hurdle = game.level.world
      .nearby(p.position, 3)
      .find(
        (c) =>
          c.kind === "vault" &&
          c.name !== "Launch ramp" &&
          c.bounds.max.z < p.position.z &&
          c.bounds.max.z > p.position.z - 1.8 &&
          p.position.x > c.bounds.min.x &&
          p.position.x < c.bounds.max.x &&
          c.bounds.max.y > p.position.y + 0.3,
      );
    controls = {
      forward: 1,
      right: 0,
      sprint: true,
      slide,
      jump,
      jumpHeld: true,
      vault: !!hurdle,
    };
    if (hurdle && !p.traversal)
      vaults.push({ z: p.position.z, obstacle: hurdle.name });
    game.physics(dt);
    if (game.checkpoint !== priorCheckpoint) {
      checkpointTimes.push({
        section: game.checkpoint + 1,
        time: game.elapsed,
      });
      priorCheckpoint = game.checkpoint;
    }
    if (p.position.z > priorZ + 10) {
      failures.push({ from: priorZ, to: p.position.z, frame });
      if (failures.length > 3) break;
    }
    priorZ = p.position.z;
    if (game.state === "finished") break;
  }
  game.firstPerson.update(1 / 60, 1);
  game.renderer.render(game.scene, game.camera);
  return {
    state: game.state,
    time: game.elapsed,
    checkpoint: game.checkpoint,
    position: game.player.position.toArray(),
    moves,
    failures,
    checkpointTimes,
    vaults: vaults.slice(0, 25),
  };
});
await writeFile(
  "artifacts/route-report.json",
  JSON.stringify({ ...report, errors }, null, 2),
);
await page.screenshot({ path: "artifacts/route-finish.png" });
console.log(JSON.stringify({ ...report, errors }, null, 2));
await browser.close();
if (report.state !== "finished" || report.failures.length || errors.length)
  process.exitCode = 1;
