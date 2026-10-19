import { chromium } from "@playwright/test";
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
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1400);
await page.screenshot({ path: "artifacts/menu.png" });
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const g = window.__flow;
      return {
        initialized: !!g,
        state: g?.state,
        triangles: g?.renderer.info.render.triangles,
        calls: g?.renderer.info.render.calls,
        canvas: document
          .querySelector("canvas")
          ?.getBoundingClientRect()
          .toJSON(),
      };
    }),
    null,
    2,
  ),
);
await page.click("#start-button");
await page.waitForTimeout(300);
await page.keyboard.down("KeyW");
await page.keyboard.down("Shift");
await page.waitForTimeout(1100);
await page.keyboard.up("KeyW");
await page.keyboard.up("Shift");
await page.screenshot({ path: "artifacts/playing.png" });
console.log(
  "Movement:",
  await page.evaluate(() => ({
    state: window.__flow.state,
    pos: window.__flow.player.position.toArray(),
    speed: window.__flow.player.speed,
  })),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
console.log("Pause:", await page.locator("#pause-menu").isVisible());
await page.screenshot({ path: "artifacts/paused.png" });
console.log("Errors:", JSON.stringify(errors));
await browser.close();
