import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.GAME_URL || "http://localhost:5173/", {
  waitUntil: "networkidle",
});
await page.screenshot({ path: "test-results/menu.png" });
await page.click("#start");
await page.waitForTimeout(300);
await page.screenshot({ path: "test-results/playing.png" });
console.log(
  "start",
  await page.evaluate(() => ({
    screen: window.__game.screen,
    dragLook: window.__game.input.dragLook,
  })),
);
const result = await page.evaluate(() => {
  const g = window.__game,
    p = g.player,
    input = g.input;
  const edges = [
    -47.3, -85.35, -123.3, -169.3, -311.1, -369.3, -424, -489.3, -534.3, -579.3,
    -634.3, -689.3, -744.3,
  ];
  const vaults = [-12, -397],
    ducts = [-29, -198, -221, -244, -468];
  const used = new Set(),
    events = [],
    visited = [];
  g.player.onEvent = (e) => {
    events.push({ e, z: p.position.z, y: p.position.y });
  };
  let previousCheckpoint = 0,
    lastZ = p.position.z,
    stationary = 0,
    fail = null;
  for (let i = 0; i < 20000 && g.screen === "playing"; i++) {
    const z = p.position.z;
    input.keys.add("KeyW");
    input.keys.add("ShiftLeft");
    if (p.grounded && p.velocity.y <= 0 && !input.pressed.has("Space"))
      input.keys.delete("Space");
    for (const edge of edges)
      if (z < edge && z > edge - 1 && !used.has(edge)) {
        used.add(edge);
        input.keys.add("Space");
        input.pressed.add("Space");
      }
    for (const v of vaults)
      if (z < v + 1.7 && z > v + 0.8 && !used.has(v)) {
        used.add(v);
        input.pressed.add("KeyE");
      }
    if (ducts.some((d) => z < d + 4 && z > d - 3)) input.keys.add("KeyC");
    else input.keys.delete("KeyC");
    let target = 0;
    if (z < -300 && z > -345) target = -0.5;
    if (z < -415 && z > -455) target = 0.5;
    input.keys.delete("KeyA");
    input.keys.delete("KeyD");
    if (!p.wallSide && p.grounded) {
      if (p.position.x < target - 0.1) input.keys.add("KeyD");
      if (p.position.x > target + 0.1) input.keys.add("KeyA");
    }
    g.step(1 / 120);
    if (g.checkpoint !== previousCheckpoint) {
      visited.push(g.checkpoint);
      previousCheckpoint = g.checkpoint;
    }
    if (Math.abs(p.position.z - lastZ) < 0.0001) stationary++;
    else stationary = 0;
    lastZ = p.position.z;
    if (g.respawns > 0 || stationary > 180) {
      fail = {
        i,
        z: p.position.z,
        y: p.position.y,
        x: p.position.x,
        state: p.state,
        respawns: g.respawns,
      };
      break;
    }
  }
  return {
    screen: g.screen,
    time: g.runTime,
    position: p.position.toArray(),
    visited,
    fail,
    events,
  };
});
assert.equal(result.screen, "finish");
assert.equal(result.fail, null);
assert.deepEqual(result.visited, [1, 2, 3, 4, 5]);
assert(result.time >= 60 && result.time <= 120);
assert.equal(result.events.filter((e) => e.e === "vault").length, 2);
assert.equal(result.events.filter((e) => e.e === "wall").length, 2);
assert.equal(result.events.filter((e) => e.e === "slide").length, 5);
console.log(
  `Course completed in ${result.time.toFixed(2)} s: all checkpoints, two vaults, two wall runs, five slides, and no falls.`,
);
const saved = await page.evaluate(() =>
  Number(localStorage.getItem("parkour-bench:astra-xhigh:rooftop-flow:best:v1")),
);
assert(saved > 0);
await page.screenshot({ path: "test-results/finish.png" });
await page.reload({ waitUntil: "networkidle" });
assert.equal(await page.evaluate(() => window.__game.bestTime), saved);
await page.click("#start");
assert.equal(await page.evaluate(() => window.__game.checkpoint), 0);
assert((await page.evaluate(() => window.__game.runTime)) < 1);
assert.deepEqual(errors, []);
console.log("Finish screen, saved best time, and fresh-run reset passed.");
await page.screenshot({ path: "test-results/course-result.png" });
console.log("errors", errors);
await browser.close();
