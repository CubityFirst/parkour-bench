import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Production regression: keyboard activation, no pointer lock, and just one
// keydown per held key. This intentionally does not use window.__game.
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist"],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(process.env.GAME_URL || "http://localhost:4173/", {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Begin Run" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  const samples = [];
  for (let elapsed = 250; elapsed <= 10000; elapsed += 250) {
    await page.waitForTimeout(250);
    samples.push(
      await page.evaluate(
        (elapsed) => ({
          elapsed,
          speed: Number(document.getElementById("speed-value").textContent),
          movement: document.getElementById("movement").textContent,
          progress: parseFloat(document.getElementById("progress").style.width),
          screen: document.body.dataset.screen,
        }),
        elapsed,
      ),
    );
  }
  await mkdir("test-results/sprint", { recursive: true });
  await writeFile(
    "test-results/sprint/samples.json",
    JSON.stringify(samples, null, 2),
  );
  const at = (time) => samples.find((sample) => sample.elapsed === time);
  assert(at(2000).speed > 30, "Held sprint must clear the first vault barrier");
  assert(at(5000).speed > 30, "Held sprint must clear the introductory duct");
  assert(samples.every((sample) => sample.screen === "playing"));
  const resetIndex = samples.findIndex(
    (sample, i) => i > 0 && sample.progress < samples[i - 1].progress - 1,
  );
  assert(
    resetIndex > 0,
    "Missing the first jump must trigger checkpoint recovery",
  );
  assert(
    samples
      .slice(resetIndex + 1)
      .some(
        (sample) =>
          sample.speed > 30 &&
          sample.progress > samples[resetIndex].progress + 0.5,
      ),
    "Held sprint must resume after respawn without releasing or pressing the keys again",
  );
  assert.deepEqual(errors, []);
  console.log("Production keyboard sprint passed:", at(2000), at(5000));
  console.log(
    "Held movement also resumed after a fall and checkpoint respawn. No browser errors.",
  );
} finally {
  await browser.close();
}
