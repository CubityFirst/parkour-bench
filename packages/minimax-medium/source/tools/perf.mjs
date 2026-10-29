/**
 * Performance probe - measures the frame rate while running the level.
 *
 *   node tools/perf.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:5321/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;

const profile = join(tmpdir(), 'rooftop-flow-perf');
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

process.on('exit', () => chrome.kill());

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('no debugging target');
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const errors = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description ?? ''));
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed');
  }
  return res.result.value;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_TO_TEST });
await sleep(6000);
await evaluate(`document.getElementById('btn-start').click()`);
await sleep(1500);

// Instrument the render loop.
await evaluate(`
  (() => {
    const g = window.game;
    window.__frames = [];
    window.__sim = [];
    const r = g.renderer;
    const origRender = r.render.bind(r);
    let last = performance.now();
    r.render = (scene, cam) => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      return origRender(scene, cam);
    };

    // Time just the simulation (physics + parkour), without rendering.
    const origFixed = g.fixedUpdate.bind(g);
    g.fixedUpdate = (dt) => {
      const t0 = performance.now();
      origFixed(dt);
      window.__sim.push(performance.now() - t0);
    };
  })()
`);

// Run forward for a while to exercise the game.
await evaluate(`
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', bubbles: true }));
`);

await sleep(12000);

const stats = await evaluate(`(() => {
  const f = window.__frames.slice(10);
  f.sort((a, b) => a - b);
  const sim = window.__sim.slice(10);
  sim.sort((a, b) => a - b);
  const g = window.game;
  const info = g.renderer.info;
  return {
    frames: f.length,
    median: f[Math.floor(f.length / 2)],
    p95: f[Math.floor(f.length * 0.95)],
    min: f[0],
    max: f[f.length - 1],
    simCount: sim.length,
    simMedian: sim.length ? sim[Math.floor(sim.length / 2)] : 0,
    simMax: sim.length ? sim[sim.length - 1] : 0,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs.length,
  };
})()`);

console.log('--- render stats (headless software rasteriser, no GPU) ---');
console.log('frames sampled   :', stats.frames);
console.log('median frame ms  :', stats.median.toFixed(2));
console.log('p95 frame ms     :', stats.p95.toFixed(2));
console.log('min / max ms     :', stats.min.toFixed(2), '/', stats.max.toFixed(2));
console.log('\n--- CPU simulation cost (hardware independent) ---');
console.log('sim steps        :', stats.simCount);
console.log('median step ms   :', stats.simMedian.toFixed(4));
console.log('max step ms      :', stats.simMax.toFixed(4));
console.log('\n--- scene complexity ---');
console.log('draw calls       :', stats.drawCalls);
console.log('triangles        :', stats.triangles.toLocaleString());
console.log('geometries       :', stats.geometries);
console.log('textures         :', stats.textures);
console.log('shader programs  :', stats.programs);
console.log('\nerrors:', errors.length ? errors : 'none');

ws.close();
chrome.kill();
process.exit(0);
