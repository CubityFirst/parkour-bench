import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.goto(process.env.FLOW_TEST_URL ?? "http://localhost:5177", {
  waitUntil: "networkidle",
});
await page.click("#controls-button");
await expect(page.locator("#controls-panel")).toBeVisible();
await page.locator("#controls-panel .close-panel").click();
await expect(page.locator("#controls-panel")).toBeHidden();
await page.locator(".settings-button").first().click();
await expect(page.locator("#settings-panel")).toBeVisible();
await page.locator("#sensitivity").evaluate((input) => {
  input.value = "1.35";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.locator("#reduced-motion").check();
assert.equal(await page.evaluate(() => window.__flow.input.sensitivity), 1.35);
assert.equal(
  await page.evaluate(() => window.__flow.firstPerson.reducedMotion),
  true,
);
await page.screenshot({ path: "artifacts/settings.png" });
await page.locator("#settings-panel .close-panel").click();
await page.click(".sound-button");
assert.equal(await page.evaluate(() => window.__flow.audio.enabled), false);
await page.click(".sound-button");
assert.equal(await page.evaluate(() => window.__flow.audio.enabled), true);
await page.click("#start-button");
await page.keyboard.down("KeyW");
await page.keyboard.down("Shift");
await page.waitForFunction(() => window.__flow.player.position.z < 13, null, {
  timeout: 15000,
});
await page.keyboard.up("KeyW");
await page.keyboard.up("Shift");
await page.keyboard.press("KeyR");
await page.waitForFunction(() => window.__flow.player.position.z === 16);
assert.equal(await page.evaluate(() => window.__flow.player.speed), 0);
await page.keyboard.press("Escape");
await expect(page.locator("#pause-menu")).toBeVisible();
const pausedTime = await page.evaluate(() => window.__flow.elapsed);
await page.waitForTimeout(400);
assert.equal(await page.evaluate(() => window.__flow.elapsed), pausedTime);
await page.click("#resume-button");
await page.evaluate(() => {
  const p = window.__flow.player;
  p.position.set(80, 20, 16);
  p.grounded = false;
  p.velocity.set(5, -20, 4);
});
await page.waitForFunction(
  () =>
    window.__flow.player.position.x === 0 &&
    window.__flow.player.position.z === 16,
  null,
  { timeout: 15000 },
);
assert.equal(await page.evaluate(() => window.__flow.player.speed), 0);
await page.keyboard.press("Escape");
await page.click("#quit-button");
await expect(page.locator(".home-menu")).toBeVisible();
await page.reload({ waitUntil: "networkidle" });
assert.equal(await page.evaluate(() => window.__flow.input.sensitivity), 1.35);
assert.equal(
  await page.evaluate(() => window.__flow.firstPerson.reducedMotion),
  true,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "artifacts/narrow-menu.png" });
assert.deepEqual(errors, []);
console.log(
  "PASS: controls, sensitivity, reduced motion, mute, keyboard movement, reset, pause timer, resume, fall recovery, menu, and stored settings.",
);
await browser.close();
