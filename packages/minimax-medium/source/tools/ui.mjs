/**
 * UI flow test - exercises the menu, pause, settings and restart paths.
 *
 *   node tools/ui.mjs [url]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:5321/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const OUT_DIR = new URL('../shots/', import.meta.url).pathname.replace(/^\//, '');

mkdirSync(OUT_DIR, { recursive: true });

const profile = join(tmpdir(), 'rooftop-flow-ui');
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1400,860',
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
}

const visible = (id) =>
  evaluate(`!document.getElementById('${id}').classList.contains('hidden')`);

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_TO_TEST });
await sleep(6000);

const checks = [];
const check = (name, value) => {
  checks.push({ name, ok: !!value });
  console.log(value ? 'PASS' : 'FAIL', '-', name);
};

// --- main menu ---------------------------------------------------------
check('main menu visible on load', await visible('menu'));
check('loading screen hidden', !(await visible('loading')));
await shot('ui-1-menu');

// --- controls screen ---------------------------------------------------
await evaluate(`document.getElementById('btn-controls').click()`);
await sleep(400);
check('controls screen opens', await visible('controls'));
await shot('ui-2-controls');
await evaluate(`document.getElementById('btn-controls-back').click()`);
await sleep(300);
check('controls screen closes', !(await visible('controls')));

// --- settings ----------------------------------------------------------
await evaluate(`
  (() => {
    const s = document.getElementById('opt-sens');
    s.value = '2.4';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    const m = document.getElementById('opt-motion');
    m.value = '0';
    m.dispatchEvent(new Event('input', { bubbles: true }));
    const v = document.getElementById('opt-volume');
    v.value = '0.3';
    v.dispatchEvent(new Event('input', { bubbles: true }));
  })()
`);
await sleep(300);
const settings = await evaluate(`(() => {
  const g = window.game;
  return {
    sens: g.cam.sensitivity,
    motion: g.cam.motionScale,
    out: document.getElementById('opt-sens-val').textContent,
  };
})()`);
check('sensitivity slider applied', Math.abs(settings.sens - 2.4) < 0.001);
check('sensitivity readout updated', settings.out === '2.40');
check('camera motion slider applied', settings.motion === 0);

// --- start the run -----------------------------------------------------
await evaluate(`document.getElementById('btn-start').click()`);
await sleep(1500);
check('HUD shown after start', await visible('hud'));
check('menu hidden after start', !(await visible('menu')));
const started = await evaluate(`window.game.state`);
check('game state is playing', started === 'playing');

// --- pause -------------------------------------------------------------
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
await sleep(600);
check('pause menu opens', await visible('pause'));
check('HUD hidden while paused', !(await visible('hud')));
const paused = await evaluate(`window.game.state`);
check('game state is paused', paused === 'paused');
await shot('ui-3-pause');

// --- resume ------------------------------------------------------------
await evaluate(`document.getElementById('btn-resume').click()`);
await sleep(600);
check('resume returns to playing', (await evaluate(`window.game.state`)) === 'playing');
check('pause menu hidden after resume', !(await visible('pause')));

// --- checkpoint respawn ------------------------------------------------
// Walk the player past the SLIDE checkpoint so it activates, then respawn.
await evaluate(`window.game.physics.position.set(0, 40, -112)`);
await sleep(500);
const cpState = await evaluate(`window.game.checkpointIndex`);
check('checkpoint activates when reached', cpState >= 3);

await evaluate(`window.game.physics.position.set(0, 40, -120)`);
await sleep(400);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }))`);
await sleep(500);
const respawned = await evaluate(`(() => {
  const g = window.game;
  const p = g.physics.position;
  const cp = g.level.checkpoints[Math.min(g.checkpointIndex, g.level.checkpoints.length - 1)];
  return {
    x: p.x, y: p.y, z: p.z,
    v: g.physics.velocity.length(),
    cpZ: cp.position.z,
    grounded: g.physics.grounded,
  };
})()`);
check(
  'respawn returns to the last checkpoint',
  Math.abs(respawned.z - respawned.cpZ) < 0.5 && respawned.v < 1
);

// --- falling off a roof respawns ---------------------------------------
// Drop the player into the open gap between the slide roof and the ledge.
await evaluate(`
  (() => {
    const g = window.game;
    g.physics.reset(new g.physics.position.constructor(-8, 30, -132));
    g.physics.velocity.set(0, -30, 0);
  })()
`);
await sleep(4000);
const recovered = await evaluate(`(() => {
  const g = window.game;
  return { y: g.physics.position.y, z: g.physics.position.z };
})()`);
check(
  'falling off a roof respawns at the checkpoint',
  recovered.y > 39 && Math.abs(recovered.z + 112) < 1
);

// --- restart from checkpoint -------------------------------------------
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
await sleep(500);
await evaluate(`document.getElementById('btn-checkpoint').click()`);
await sleep(700);
check('restart from checkpoint resumes play', (await evaluate(`window.game.state`)) === 'playing');

// --- restart level -----------------------------------------------------
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
await sleep(500);
await evaluate(`document.getElementById('btn-restart').click()`);
await sleep(700);
const restarted = await evaluate(`(() => {
  const g = window.game;
  return { z: g.physics.position.z, time: g.runTime, cp: g.checkpointIndex };
})()`);
check('restart level resets position', restarted.z > 0 && restarted.time < 2);
check('restart level resets checkpoint index', restarted.cp === 0);

// --- back to menu ------------------------------------------------------
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
await sleep(500);
await evaluate(`document.getElementById('btn-quit').click()`);
await sleep(600);
check('quit returns to main menu', await visible('menu'));
check('HUD hidden on main menu', !(await visible('hud')));
await shot('ui-4-menu-return');

// --- persistence -------------------------------------------------------
const stored = await evaluate(`(() => ({
  sens: localStorage.getItem('rooftop-flow-settings'),
  best: localStorage.getItem('rooftop-flow-best'),
}))()`);
check('settings persisted to localStorage', !!stored.sens);
console.log('  stored settings:', stored.sens);

console.log('\nconsole errors:', errors.length ? errors : 'none');
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
ws.close();
chrome.kill();
process.exit(failed.length || errors.length ? 1 : 0);
