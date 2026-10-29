/**
 * Visual capture tool - drops the camera at a few fixed viewpoints and saves
 * screenshots so the art direction can be reviewed quickly.
 *
 *   node tools/shots.mjs [url]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:5321/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const OUT_DIR = new URL('../shots/', import.meta.url).pathname.replace(/^\//, '');

mkdirSync(OUT_DIR, { recursive: true });

const profile = join(tmpdir(), 'rooftop-flow-shots');
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
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('CONSOLE: ' + msg.params.args.map((a) => a.value ?? '').join(' '));
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

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, `${name}.png`), Buffer.from(res.data, 'base64'));
  console.log('saved', name);
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_TO_TEST });
await sleep(6000);

await evaluate(`document.getElementById('btn-start').click()`);
await sleep(1500);

// Freeze the game loop and take over the camera.
await evaluate(`
  (() => {
    const g = window.game;
    g.__frozen = true;
    const origFrame = g.frame;
    g.state = 'menu';          // stops the simulation from moving the player
    window.__place = (x, y, z, yaw, pitch) => {
      const p = g.physics;
      p.position.set(x, y, z);
      p.velocity.set(0, 0, 0);
      p.grounded = true;
      g.cam.yaw = yaw;
      g.cam.pitch = pitch;
      g.cam.reset();
    };
  })()
`);

const views = [
  ['v1-start', 0, 41.6, 5.4, 0, -0.02],
  ['v2-jumps', 4, 42.6, -52, 0.25, -0.12],
  ['v3-slide', 0, 41.5, -112, 0, -0.06],
  ['v4-wallrun', -1.5, 41.5, -150, 0, 0.0],
  ['v5-combo', -2, 41.5, -203, 0, -0.04],
  ['v6-finish', 0, 41.5, -280, 0, 0.0],
  ['v7-city', 0, 60, -120, 1.9, -0.35],
];

for (const [name, x, y, z, yaw, pitch] of views) {
  await evaluate(`window.__place(${x}, ${y}, ${z}, ${yaw}, ${pitch})`);
  await sleep(700);
  await shot(name);
}

console.log('errors:', errors.length ? errors : 'none');
ws.close();
chrome.kill();
process.exit(0);
