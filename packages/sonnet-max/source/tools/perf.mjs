// Frame-time + render-stat probe in real Chrome during an autopilot run.
//   node tools/perf.mjs [url] [seconds=20] [width=1920] [height=1080] [quality=high|medium|low] [--software]
import { createRequire } from 'node:module';
import path from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const software = process.argv.includes('--software');
const [url = 'http://localhost:5173/?debug', secs = '20', w = '1920', h = '1080', quality = 'high'] = args;
const from = process.env.PLAYWRIGHT_FROM ?? path.resolve('package.json');
const require = createRequire(from);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const launchArgs = software
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.evaluate((q) => window.__rooftop.setQuality(q), quality);
await page.getByRole('button', { name: /start/i }).first().click();
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__rooftop.autopilot(true);
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => {
    window.__frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(Number(secs) * 1000);
const result = await page.evaluate(() => {
  const f = window.__frames.slice(Math.min(10, Math.max(0, window.__frames.length - 3))).sort((a, b) => a - b);
  if (f.length < 2) return { frames: f.length, note: 'too few frames (software GL is slow)', info: window.__rooftop.info() };
  const avg = f.reduce((s, v) => s + v, 0) / f.length;
  const pct = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
  return {
    frames: f.length,
    avgMs: +avg.toFixed(2),
    fps: +(1000 / avg).toFixed(1),
    p50: +pct(0.5).toFixed(2),
    p95: +pct(0.95).toFixed(2),
    p99: +pct(0.99).toFixed(2),
    worst: +f[f.length - 1].toFixed(2),
    info: window.__rooftop.info(),
    state: window.__rooftop.state(),
  };
});
const bench = await page.evaluate(() => {
  window.__rooftop.freeCam(0, 70, 0, 0, 0); // stop the game loop's own rendering work
  return window.__rooftop.bench(90);
});
console.log(`viewport ${w}x${h} quality=${quality}${software ? ' (software GL)' : ''}`);
console.log('synchronous GPU bench (ms per frame incl. gl.finish):');
for (const b of bench) console.log(`  ${b.spot.padEnd(20)} ${String(b.ms).padStart(6)} ms  (${(1000 / b.ms).toFixed(0)} fps)  ${b.calls} draw calls, ${(b.triangles / 1000).toFixed(0)}k triangles`);
console.log(JSON.stringify(result, null, 2));
console.log('errors:', errors);
await browser.close();
