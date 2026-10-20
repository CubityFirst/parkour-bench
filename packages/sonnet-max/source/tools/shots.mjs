// Scripted screenshot tool for visual iteration. Starts the game in real Chrome and takes a series of
// shots from arbitrary vantage points (via the ?debug API) with optional live lighting overrides.
//
//   node tools/shots.mjs spec.json outDir [url]
//
// spec.json: { "viewport": [1280, 720], "hud": false, "shots": [
//   { "name": "a", "place": [x, y, z, yaw, pitch], "tune": { "sun": 3, "exposure": 1 }, "wait": 500,
//     "keys": [["down","KeyW"],["wait",800],["up","KeyW"]], "eval": "window.__rooftop.look(0.2,0)" } ] }
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [specPath, outDir = 'tools/out', url = 'http://localhost:5173/?debug'] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const from = process.env.PLAYWRIGHT_FROM ?? path.resolve('package.json');
const require = createRequire(from);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const [vw, vh] = spec.viewport ?? [1280, 720];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
  if (spec.logConsole) console.log('[console]', m.type(), m.text());
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3000);

if (spec.menuShot) await page.screenshot({ path: path.join(outDir, spec.menuShot + '.png') });
if (spec.start !== false) {
  await page.getByRole('button', { name: /start/i }).first().click();
  await page.waitForTimeout(800);
}
if (spec.hud === false) await page.addStyleTag({ content: '#hud{display:none !important}' });
if (spec.freeze) await page.evaluate(() => window.__rooftop.game.input.enabled = false);

for (const shot of spec.shots) {
  if (shot.tune) await page.evaluate((t) => window.__rooftop.tune(t), shot.tune);
  if (shot.quality) await page.evaluate((q) => window.__rooftop.setQuality(q), shot.quality);
  if (shot.place) await page.evaluate((p) => window.__rooftop.place(...p), shot.place);
  if (shot.teleport !== undefined) await page.evaluate((id) => window.__rooftop.teleport(id), shot.teleport);
  if (shot.cam) await page.evaluate((c) => window.__rooftop.freeCam(...c), shot.cam);
  if (shot.eval) await page.evaluate(shot.eval);
  for (const k of shot.keys ?? []) {
    if (k[0] === 'down') await page.keyboard.down(k[1]);
    else if (k[0] === 'up') await page.keyboard.up(k[1]);
    else if (k[0] === 'press') await page.keyboard.press(k[1]);
    else if (k[0] === 'wait') await page.waitForTimeout(k[1]);
  }
  await page.waitForTimeout(shot.wait ?? 450);
  await page.screenshot({ path: path.join(outDir, shot.name + '.png') });
  if (shot.state) console.log(shot.name, JSON.stringify(await page.evaluate(() => window.__rooftop.state())));
}
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
