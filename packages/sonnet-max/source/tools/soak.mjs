// Memory soak: runs the full course with the autopilot (twice, via Restart) while sampling the JS heap and
// WebGL object counts, to catch per-frame allocations and resource leaks.
//   node tools/soak.mjs [url]
import { createRequire } from 'node:module';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/?debug';
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
  args: ['--use-angle=d3d11', '--enable-gpu', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3000);
const sample = () =>
  page.evaluate(async () => {
    if (window.gc) window.gc();
    await new Promise((r) => setTimeout(r, 50));
    const m = performance.memory;
    const info = window.__rooftop.info();
    return { heapMB: +(m.usedJSHeapSize / 1048576).toFixed(1), geometries: info.geometries, textures: info.textures, programs: info.programs, phase: window.__rooftop.state().phase };
  });
const base = await sample();
console.log('baseline', JSON.stringify(base));
for (let lap = 1; lap <= 2; lap++) {
  await page.click(lap === 1 ? '#btn-start' : '#btn-restart');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__rooftop.autopilot(true));
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await page.waitForTimeout(10000);
    const s = await sample();
    console.log(`lap ${lap} +${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(s));
    if (s.phase === 'finished') break;
  }
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__rooftop.autopilot(false));
}
const end = await sample();
console.log('end', JSON.stringify(end));
console.log('heap growth over the soak:', (end.heapMB - base.heapMB).toFixed(1), 'MB; GPU objects unchanged:', end.geometries === base.geometries && end.textures === base.textures);
console.log('errors:', errors);
await browser.close();
