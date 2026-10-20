// Captures the README gallery (docs/screenshots/*.jpg) from the running game in real Chrome.
//   node tools/capture-docs.mjs [url] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://localhost:5173/?debug', outDir = 'docs/screenshots'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const from = process.env.PLAYWRIGHT_FROM ?? path.resolve('package.json');
const require = createRequire(from);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.jpg`), type: 'jpeg', quality: 88 });
const state = () => page.evaluate(() => window.__rooftop.state());
const api = (fn, ...a) => page.evaluate(([f, args]) => window.__rooftop[f](...args), [fn, a]);

await page.goto(url, { waitUntil: 'load' });
await sleep(3000);
await shot('01-menu');
await page.click('#btn-start');
await sleep(900);
await api('place', 0, 62, 3, 0, 0);
await sleep(600);
await shot('02-start');

// Over the gaps (section 2), alley (3), runway (4), finish (6): static vantage points.
await api('place', 0, 62, -90, 0, -0.08);
await sleep(500);
await shot('03-rooftop-jumps');
await api('place', 19, 60, -193, -Math.PI / 2, 0);
await sleep(500);
await shot('04-slide-alley');
await api('place', 112, 60, -188, -Math.PI / 2, 0.05);
await sleep(500);
await shot('05-wall-run-runway');
await api('place', 258, 49, -60, -Math.PI, 0);
await sleep(500);
await shot('06-finish-gate');

// Vault in slow motion.
await api('place', 0, 62, -13, 0, -0.1);
await api('timeScale', 0.15);
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await sleep(3300);
await page.keyboard.press('KeyE');
await sleep(2300);
await shot('07-vault');
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');

// Wall run + mantle via the autopilot: poll until the state shows up.
await api('timeScale', 0.3);
await api('teleport', 3);
await api('autopilot', true, 3);
let got = { wall: false, mantle: false };
for (let i = 0; i < 400 && !got.wall; i++) {
  await sleep(40);
  const s = await state();
  if (s.state === 'wallrun') {
    await sleep(120);
    await shot('08-wall-run');
    got.wall = true;
  }
}
await api('autopilot', false);
await api('timeScale', 0.3);
await api('teleport', 5);
await api('autopilot', true, 5);
for (let i = 0; i < 700 && !got.mantle; i++) {
  await sleep(40);
  const s = await state();
  if (s.state === 'scripted') {
    await sleep(160);
    await shot('09-climb');
    got.mantle = true;
  }
}
await api('autopilot', false);

// Finish screen: run the last stretch with the autopilot at normal speed.
await api('timeScale', 1);
await api('place', 258, 49, -90, -Math.PI, 0);
await page.evaluate(() => {
  const g = window.__rooftop.game;
  g.run.started = true;
  g.run.elapsed = 74.38;
});
await api('autopilot', true, 5);
for (let i = 0; i < 400; i++) {
  await sleep(100);
  if ((await state()).phase === 'finished') break;
}
await sleep(2600);
await shot('10-level-complete');
console.log(JSON.stringify({ got, errors }));
await browser.close();
