// Real-browser smoke test + screenshot helper (Playwright driving the system Chrome with the real GPU).
//
//   node tools/browser-check.mjs <url> <outDir> [scenario]
//
// Scenarios: smoke (default) | shots
// Playwright is resolved from the normal node_modules; if it is not installed there, point
// PLAYWRIGHT_FROM at any package.json whose node_modules contains `playwright`.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://localhost:5173/?debug', outDir = 'tools/out', scenario = 'smoke'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const from = process.env.PLAYWRIGHT_FROM ?? path.resolve('package.json');
const require = createRequire(from);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const logs = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
  else if (m.type() === 'warning') logs.push('warn: ' + m.text());
});
const shot = async (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const state = () => page.evaluate(() => window.__rooftop?.state());
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(url, { waitUntil: 'load' });
await sleep(3500);
await shot('01-menu');

if (scenario === 'smoke' || scenario === 'shots') {
  const btn = page.getByRole('button', { name: /start|play|run/i }).first();
  await btn.click();
  await sleep(1200);
  await shot('02-idle');
  console.log('after start:', JSON.stringify(await state()));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await sleep(2000);
  await shot('03-sprint-2s');
  console.log('sprint 2s:', JSON.stringify(await state()));
  await sleep(1500);
  await shot('04-sprint-3.5s');
  console.log('sprint 3.5s:', JSON.stringify(await state()));
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
}

if (scenario === 'autopilot') {
  await page.getByRole('button', { name: /start/i }).first().click();
  await sleep(1000);
  await page.evaluate(() => window.__rooftop.autopilot(true));
  const t0 = Date.now();
  let lastShot = 0;
  let last = null;
  while (Date.now() - t0 < 170000) {
    await sleep(1000);
    last = await state();
    const secs = Math.floor((Date.now() - t0) / 1000);
    if (secs - lastShot >= Number(process.env.AP_INTERVAL ?? 7)) {
      lastShot = secs;
      await shot(`ap-${String(secs).padStart(3, '0')}`);
      console.log(`t=${secs}s`, JSON.stringify({ phase: last.phase, st: last.state, t: +last.time.toFixed(1), cp: last.checkpoint, x: +last.x.toFixed(0), y: +last.y.toFixed(1), z: +last.z.toFixed(0), sp: +last.speed.toFixed(1), falls: last.falls }));
    }
    if (last.phase === 'finished') break;
  }
  await sleep(3500);
  await shot('ap-finish-screen');
  const finishText = await page.evaluate(() => document.getElementById('finish')?.innerText);
  const best = await page.evaluate(() => window.localStorage.getItem('rooftop-flow-best-time'));
  console.log('final:', JSON.stringify(await state()));
  console.log('finish screen text:', JSON.stringify(finishText));
  console.log('saved best time:', best);
}

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return { canvas: !!c, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null };
});
console.log(JSON.stringify({ info, errors, logs: logs.slice(0, 8) }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
