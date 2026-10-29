/**
 * Mechanic test - verifies each parkour verb actually does what it claims.
 *
 *   node tools/mechanics.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TO_TEST = process.argv[2] ?? 'http://127.0.0.1:5321/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;

const profile = join(tmpdir(), 'rooftop-flow-mech');
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

const checks = [];
const check = (name, value, detail = '') => {
  checks.push({ name, ok: !!value });
  console.log(value ? 'PASS' : 'FAIL', '-', name, detail);
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_TO_TEST });
await sleep(6000);
await evaluate(`document.getElementById('btn-start').click()`);
await sleep(1200);

// A small harness that drives the player with real key events.
await evaluate(`
  (() => {
    const g = window.game;
    const key = (code, down) =>
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    window.__key = key;
    window.__tap = (code, ms = 90) => { key(code, true); setTimeout(() => key(code, false), ms); };
    window.__hold = (code, on) => key(code, on);
    window.__place = (x, y, z, yaw = 0) => {
      g.physics.reset(new g.physics.position.constructor(x, y, z));
      g.cam.yaw = yaw; g.cam.pitch = 0; g.cam.reset();
      g.physics.velocity.set(0, 0, 0);
    };
  })()
`);

const state = () =>
  evaluate(`(() => {
    const g = window.game;
    const p = g.physics;
    return {
      x: p.position.x, y: p.position.y, z: p.position.z,
      vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z,
      speed: p.horizontalSpeed,
      grounded: p.grounded, sliding: p.sliding, wall: !!p.wallRun,
      height: p.height, airTime: p.airTime, coyote: p.coyote,
    };
  })()`);

/**
 * Waits until `cond` (a JS expression string) becomes true, or until
 * `gameSeconds` of *game* time has passed. Waiting on game time keeps the
 * test independent of the headless renderer's frame rate.
 */
async function until(cond, gameSeconds = 2.5) {
  const t0 = await evaluate(`window.game.runTime`);
  for (let i = 0; i < 400; i++) {
    await sleep(40);
    if (await evaluate(`(() => { try { return !!(${cond}); } catch { return false; } })()`)) {
      return true;
    }
    const t = await evaluate(`window.game.runTime`);
    if (t - t0 > gameSeconds) return false;
  }
  return false;
}

/** Lets `gameSeconds` of game time pass. */
async function gameWait(gameSeconds) {
  const t0 = await evaluate(`window.game.runTime`);
  for (let i = 0; i < 400; i++) {
    await sleep(40);
    const t = await evaluate(`window.game.runTime`);
    if (t - t0 > gameSeconds) return;
  }
}

// --- 1. running reaches sprint speed -----------------------------------
await evaluate(`window.__place(0, 41, 4); window.__hold('KeyW', true); window.__hold('ShiftLeft', true)`);
await until(`window.game.physics.horizontalSpeed > 11`, 3);
let s = await state();
check('sprint builds up speed', s.speed > 11, `speed=${s.speed.toFixed(1)}`);
check('player moves forward (-Z)', s.z < 3.5, `z=${s.z.toFixed(1)}`);

// --- 2. jump raises the player ------------------------------------------
await evaluate(`window.__hold('KeyW', false); window.__hold('ShiftLeft', false); window.__place(0, 40.1, 4)`);
await until(`window.game.physics.grounded`, 1);
await evaluate(`window.__tap('Space', 400)`);
await until(`!window.game.physics.grounded && window.game.physics.position.y > 40.4`, 1.5);
s = await state();
check('jump lifts the player', s.y > 40.4 && !s.grounded, `y=${s.y.toFixed(2)}`);
await until(`window.game.physics.grounded`, 3);
s = await state();
check('player lands again', s.grounded, `y=${s.y.toFixed(2)}`);

// --- 3. coyote time -----------------------------------------------------
// Run off the far edge of the plaza roof (z = -22) and jump a moment later.
await evaluate(`window.__place(-8, 40.1, -16); window.__hold('KeyW', true)`);
await until(`window.game.physics.position.z < -22.5`, 3);
await until(`!window.game.physics.grounded`, 1);
s = await state();
check('player is airborne after running off', !s.grounded, `z=${s.z.toFixed(1)}`);
check('coyote timer is running', s.coyote > 0, `coyote=${s.coyote.toFixed(3)}`);
await evaluate(`window.__tap('Space', 300)`);
await until(`window.game.physics.velocity.y > 1`, 1);
s = await state();
check('coyote time allows a late jump', s.vy > 1, `vy=${s.vy.toFixed(1)}`);
await evaluate(`window.__hold('KeyW', false)`);

// --- 4. slide ------------------------------------------------------------
await evaluate(`window.__place(0, 40.1, 4); window.__hold('KeyW', true); window.__hold('ShiftLeft', true)`);
await until(`window.game.physics.horizontalSpeed > 10`, 3);
await evaluate(`window.__tap('ControlLeft', 200)`);
await until(`window.game.physics.sliding`, 1);
s = await state();
check('slide lowers the player', s.sliding && s.height < 1.5, `h=${s.height.toFixed(2)}`);
check('slide keeps momentum', s.speed > 4, `speed=${s.speed.toFixed(1)}`);
await evaluate(`window.__hold('KeyW', false); window.__hold('ShiftLeft', false)`);
await until(`!window.game.physics.sliding && window.game.physics.height > 1.7`, 3);
s = await state();
check('slide ends and the player stands', !s.sliding && s.height > 1.7, `h=${s.height.toFixed(2)}`);

// --- 5. vault ------------------------------------------------------------
// The tutorial vault barrier sits at z = -6, spanning x -3..3.
await evaluate(`window.__place(0, 40.1, -3); window.__hold('KeyW', true); window.__hold('ShiftLeft', true)`);
await until(`window.game.physics.position.z < -5.4`, 2);
await evaluate(`window.__tap('KeyE', 120)`);
await until(`window.game.physics.position.z < -6.6`, 2);
s = await state();
check('vault moves the player over the barrier', s.z < -6.5, `z=${s.z.toFixed(1)}`);
await evaluate(`window.__hold('KeyW', false); window.__hold('ShiftLeft', false)`);

// --- 6. wall run ---------------------------------------------------------
// The red fins run from z = -140 to -174 at x = -3.9.
await evaluate(`window.__place(-2.6, 40.1, -150); window.__hold('KeyW', true); window.__hold('ShiftLeft', true)`);
await until(`window.game.physics.horizontalSpeed > 8`, 3);
s = await state();
check('player runs beside the wall', s.speed > 8, `speed=${s.speed.toFixed(1)}`);
await evaluate(`window.__tap('Space', 200)`);
await until(`!!window.game.physics.wallRun`, 1.5);
s = await state();
check('wall run engages in the air', s.wall, `wall=${s.wall} z=${s.z.toFixed(1)}`);
const wallY = s.y;
await gameWait(0.4);
s = await state();
check('wall run keeps the player up', s.y > 39.5, `y=${s.y.toFixed(2)} (was ${wallY.toFixed(2)})`);
await evaluate(`window.__hold('KeyW', false); window.__hold('ShiftLeft', false)`);

// --- 7. falling and landing ---------------------------------------------
await evaluate(`window.__place(0, 60, 4)`);
await until(`window.game.physics.grounded && window.game.physics.position.y < 41`, 4);
s = await state();
check('player falls and lands on the roof', s.grounded && s.y > 39, `y=${s.y.toFixed(2)}`);

// --- 8. no tunnelling through the floor ---------------------------------
await evaluate(`window.__place(0, 40.1, 4); window.__hold('KeyW', true); window.__hold('ShiftLeft', true)`);
await gameWait(2);
s = await state();
check('player does not fall through the roof', s.y > 39, `y=${s.y.toFixed(2)}`);
await evaluate(`window.__hold('KeyW', false); window.__hold('ShiftLeft', false)`);

// --- 9. respawn resets velocity ------------------------------------------
await evaluate(`window.__place(0, 40.1, 4); window.__hold('KeyW', true); window.__hold('ShiftLeft', true)`);
await until(`window.game.physics.horizontalSpeed > 8`, 2);
await evaluate(`window.__hold('KeyW', false); window.__hold('ShiftLeft', false); window.__tap('KeyR', 120)`);
await until(`window.game.physics.horizontalSpeed < 0.5`, 2);
s = await state();
check('respawn clears the velocity', s.speed < 0.5 && s.grounded, `speed=${s.speed.toFixed(2)}`);

console.log('\nconsole errors:', errors.length ? errors : 'none');
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
ws.close();
chrome.kill();
process.exit(failed.length || errors.length ? 1 : 0);
