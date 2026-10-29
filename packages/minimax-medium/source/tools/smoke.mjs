/**
 * Headless smoke test for ROOFTOP FLOW.
 *
 * Boots the dev build in headless Chrome, drives the player with a simple
 * autopilot and reports how far it gets. Run with:
 *
 *   node tools/smoke.mjs [url]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:5321/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const OUT_DIR = new URL('../shots/', import.meta.url).pathname.replace(/^\//, '');

mkdirSync(OUT_DIR, { recursive: true });

const profile = join(tmpdir(), 'rooftop-flow-smoke');
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,720',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
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
  throw new Error('Chrome did not expose a debugging target');
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];

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
    consoleErrors.push(
      'EXCEPTION: ' +
        (msg.params.exceptionDetails.exception?.description ??
          msg.params.exceptionDetails.text)
    );
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(
      'CONSOLE: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    );
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push('LOG: ' + msg.params.entry.text);
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

async function screenshot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, `${name}.png`), Buffer.from(res.data, 'base64'));
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Network.enable');

await send('Page.navigate', { url: URL_TO_TEST });
await sleep(6000);

const boot = await evaluate(`(() => {
  const g = window.game;
  const loading = document.getElementById('loading');
  return {
    ok: !!g,
    hasGame: typeof window.game,
    loadingText: loading ? loading.innerText.slice(0, 200) : null,
    scripts: [...document.querySelectorAll('script')].map(s => s.src || 'inline'),
    ready: document.readyState,
  };
})()`);
console.log('boot:', JSON.stringify(boot));
if (consoleErrors.length) console.log('early console errors:', consoleErrors);
if (!boot?.ok) {
  console.log('game failed to boot - aborting');
  ws.close();
  chrome.kill();
  process.exit(1);
}

await screenshot('01-menu');

// ---------------------------------------------------------------- start
await evaluate(`document.getElementById('btn-start').click()`);
await sleep(1200);

// ------------------------------------------------------------ autopilot
const AUTOPILOT = `
window.__auto = (() => {
  const g = window.game;
  const state = { held: new Set(), jumpAt: 0, lastJump: 0, log: [] };

  const takeoffs = [-22, -26.5, -34, -58, -80, -104, -130, -140, -162, -194, -216.5, -222, -226, -268];
  const vaults = [-6, -206, -240, -256];
  const slides = [[-17, -13], [-126, -110], [-214, -210], [-250, -246]];
  const waypoints = [
    { z: 99, x: 0 }, { z: -38, x: 4 }, { z: -58, x: 6 }, { z: -78, x: 5 },
    { z: -84, x: -1 }, { z: -102, x: -1 }, { z: -108, x: 0 }, { z: -128, x: -1 },
    { z: -140, x: -2.5 }, { z: -160, x: -2.5 }, { z: -192, x: -2.5 }, { z: -225, x: -2 },
    { z: -268, x: -2 }, { z: -295, x: 0 },
  ];

  const key = (code, down) => {
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true });
    window.dispatchEvent(ev);
  };
  const hold = (code, on) => {
    if (on && !state.held.has(code)) { state.held.add(code); key(code, true); }
    if (!on && state.held.has(code)) { state.held.delete(code); key(code, false); }
  };

  const timer = setInterval(() => {
    const p = g.physics;
    const pos = p.position;
    const z = pos.z, x = pos.x;

    hold('KeyW', true);
    hold('ShiftLeft', true);

    // steer towards the waypoint for this stretch of the route
    let target = 0;
    for (const wp of waypoints) { if (z <= wp.z) target = wp.x; }
    const canSteer = p.horizontalSpeed > 3 && !p.sliding;
    hold('KeyD', canSteer && x < target - 0.6);
    hold('KeyA', canSteer && x > target + 0.6);

    // jump at take-off points
    const now = performance.now();
    for (const t of takeoffs) {
      if (z < t + 1.2 && z > t - 1.0 && p.grounded && now - state.lastJump > 400) {
        key('Space', true);
        setTimeout(() => key('Space', false), 260);
        state.lastJump = now;
        break;
      }
    }

    // slide under ducts
    const needSlide = slides.some(([far, near]) => z <= near && z >= far);
    hold('ControlLeft', needSlide);

    // stuck detection: nudge with a jump
    if (p.grounded && p.horizontalSpeed < 0.6) {
      state.stuck = (state.stuck ?? 0) + 0.06;
      if (state.stuck > 1.2 && now - state.lastJump > 500) {
        key('Space', true);
        setTimeout(() => key('Space', false), 260);
        state.lastJump = now;
        state.stuck = 0;
      }
    } else {
      state.stuck = 0;
    }

    // vault barriers
    for (const v of vaults) {
      if (Math.abs(z - v) < 0.9 && p.grounded && now - state.lastJump > 400) {
        key('KeyE', true);
        setTimeout(() => key('KeyE', false), 60);
        state.lastJump = now;
        break;
      }
    }

    state.log.push([Math.round(now / 1000), +z.toFixed(1), +x.toFixed(1), p.grounded ? 1 : 0]);
    if (state.log.length > 4000) state.log.shift();
  }, 60);

  return () => {
    clearInterval(timer);
    for (const c of [...state.held]) hold(c, false);
  };
})();
`;
await evaluate(AUTOPILOT);

let finished = false;
let bestZ = 0;
const started = Date.now();
let last = '';

while (Date.now() - started < 100000) {
  await sleep(1000);
  const s = await evaluate(`(() => {
    const g = window.game;
    const p = g.physics;
    return {
      state: g.state,
      z: +p.position.z.toFixed(2),
      x: +p.position.x.toFixed(2),
      y: +p.position.y.toFixed(2),
      speed: +p.horizontalSpeed.toFixed(2),
      grounded: p.grounded,
      wall: !!p.wallRun,
      slide: p.sliding,
      cp: g.checkpointIndex,
      time: +g.runTime.toFixed(2),
      finishVisible: !document.getElementById('finish').classList.contains('hidden'),
    };
  })()`);
  if (!s) continue;
  bestZ = Math.min(bestZ, s.z);
  const line = `t=${s.time}s z=${s.z} x=${s.x} y=${s.y} v=${s.speed} g=${s.grounded} wall=${s.wall} slide=${s.slide} cp=${s.cp} state=${s.state}`;
  if (line !== last) console.log(line);
  last = line;
  if (s.finishVisible || s.state === 'finished') {
    finished = true;
    console.log('FINISHED at', JSON.stringify(s));
    await screenshot('03-finish');
    break;
  }
  if (Math.round(s.time * 2) % 10 === 0) {
    await screenshot(`shot-${Math.round(s.time)}s`);
  }
}

console.log('furthest z:', bestZ, 'finished:', finished);
console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');

await evaluate(`window.__auto && window.__auto()`);
await sleep(300);
await screenshot('02-final');

ws.close();
chrome.kill();
process.exit(0);
