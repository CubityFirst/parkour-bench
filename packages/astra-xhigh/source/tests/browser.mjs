import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
  downloadsPath: process.cwd() + "/test-results",
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(process.env.GAME_URL || "http://localhost:5173/", {
    waitUntil: "networkidle",
  });
  await page.screenshot({ path: "test-results/menu.png" });
  const stats = await page.evaluate(() => ({
    game: !!window.__game,
    draws: window.__game?.renderer.info.render.calls,
    triangles: window.__game?.renderer.info.render.triangles,
  }));
  assert(stats.game);
  console.log("Scene:", stats);
  await page.click("#controls");
  assert(await page.locator("#controls-content").isVisible());
  await page.click("#dialog-done");
  await page.click("#settings");
  await page.locator("#sensitivity").fill("1.4");
  await page.locator("#sensitivity").dispatchEvent("input");
  await page.check("#motion");
  await page.uncheck("#audio-setting");
  await page.click("#dialog-done");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__game.ui.sensitivity), 1.4);
  assert.equal(await page.evaluate(() => window.__game.ui.reducedMotion), true);
  assert.equal(await page.evaluate(() => window.__game.ui.sound), false);
  await page.click("#settings");
  await page.locator("#sensitivity").fill("1");
  await page.locator("#sensitivity").dispatchEvent("input");
  await page.uncheck("#motion");
  await page.check("#audio-setting");
  await page.click("#dialog-done");
  await page.click("#start");
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__game.screen), "playing");
  await page.screenshot({ path: "test-results/playing.png" });
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForFunction(() => window.__game.player.position.z < 4, {
    timeout: 5000,
  });
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  assert(
    (await page.evaluate(() => window.__game.player.position.z)) < 4,
    "W + Shift must move the runner",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.__game.screen), "paused");
  const pausedTime = await page.evaluate(() => window.__game.runTime);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__game.runTime), pausedTime);
  await page.click("#resume");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.__game.screen), "playing");
  await page.keyboard.press("r");
  await page.waitForTimeout(50);
  assert((await page.evaluate(() => window.__game.player.position.z)) > 7);
  // Falling returns to the latest checkpoint and clears momentum.
  await page.evaluate(() => {
    const g = window.__game;
    g.checkpoint = 3;
    g.player.position.y = 20;
    g.player.velocity.set(4, -20, -10);
    g.step(1 / 120);
  });
  assert.equal(
    await page.evaluate(() => window.__game.player.position.z),
    -291,
  );
  assert.equal(await page.evaluate(() => window.__game.player.speed), 0);
  await page.keyboard.press("Escape");
  await page.click("#back-menu");
  assert.equal(await page.evaluate(() => window.__game.screen), "menu");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "test-results/menu-1280.png" });
  const bounds = await page.locator(".route-stats").boundingBox();
  assert(
    bounds.y + bounds.height < 650,
    "Menu content must fit above its footer",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/menu.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: menus, settings persistence, movement, pause, resume, restart and fall recovery. No runtime errors.",
  );
} finally {
  await browser.close();
}
