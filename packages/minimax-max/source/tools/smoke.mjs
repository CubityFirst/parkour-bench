/**
 * Headless smoke test.
 *
 * Boots ROOFTOP FLOW in headless Chrome, drives the player with a scripted
 * bot and reports console errors, gameplay state and screenshots.
 *
 *   node tools/smoke.mjs [--url=http://127.0.0.1:5174/] [--shots]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith('--url='));
const URL = urlArg ? urlArg.slice(6) : 'http://127.0.0.1:5174/';
const WANT_SHOTS = args.includes('--shots');
const OUT_DIR = join(process.cwd(), 'tools', 'shots');
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'rooftop-flow-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1280,720',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error('Chrome did not start');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }
}

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new Cdp(ws);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `${result.exceptionDetails.text ?? 'evaluation failed'} ${JSON.stringify(
        result.exceptionDetails.exception?.description ?? '',
      )}`,
    );
  }
  return result.result.value;
}

async function screenshot(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

function reportErrors(events) {
  const problems = [];
  for (const event of events) {
    if (event.method === 'Runtime.exceptionThrown') {
      const d = event.params.exceptionDetails;
      problems.push(`EXCEPTION: ${d.exception?.description ?? d.text}`);
    }
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
      problems.push(`CONSOLE ERROR: ${event.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
    if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
      problems.push(`LOG ERROR: ${event.params.entry.text}`);
    }
  }
  return problems;
}

/** The scripted runner: sprints the route, jumps the gaps, slides, vaults. */
const BOT = `(() => {
  const g = window.game;
  const jumps = [19.0, 29.0, 45.0, 61.0, 79.0, 98.0, 107.0, 120.0, 147.0, 163.0, 179.0, 199.0, 212.0, 227.0];
  const vaults = [6.0, 152.0];
  const slideZones = [[11.2, 15.6], [84.0, 99.2], [155.0, 161.6]];
  const done = { jumps: {}, vaults: {} };
  const holding = {};
  const lane = (x) => {
    if (x < 105) return 0;
    if (x < 122) return 4.6;
    if (x < 145) return 0;
    if (x < 163) return -6;
    if (x < 181) return -12.4;
    return 0;
  };
  let t = 0;
  let lastX = -999;
  const trace = [];
  const maxT = 150;
  while (t < maxT) {
    const s = g.debugState;
    if (s.phase === 'complete' || s.phase === 'menu') break;
    const x = s.position.x;
    const z = s.position.z;
    if (x + 5 < lastX) {
      for (const k in done.jumps) delete done.jumps[k];
      for (const k in done.vaults) delete done.vaults[k];
      for (const k in holding) delete holding[k];
    }
    lastX = x;
    let jump = false;
    let vault = false;
    for (const j of jumps) {
      if (!done.jumps[j] && x >= j) { done.jumps[j] = true; holding[j] = 0.35; }
      if (holding[j] > 0) { holding[j] -= 0.05; jump = true; }
    }
    for (const v of vaults) { if (!done.vaults[v] && x >= v) { done.vaults[v] = true; vault = true; } }
    let slide = false;
    for (const [a, b] of slideZones) { if (x >= a && x <= b) slide = true; }
    const target = lane(x);
    let strafe = 0;
    if (target - z > 0.35) strafe = 1;
    else if (target - z < -0.35) strafe = -1;
    g.debugSimulate(0.05, { forward: 1, strafe, sprint: true, jump, vault, slide });
    t += 0.05;
    if (trace.length === 0 || t - trace[trace.length - 1].t > 0.5) {
      trace.push({ t: +t.toFixed(2), x: +x.toFixed(2), y: +s.position.y.toFixed(2), z: +z.toFixed(2), st: s.state, gr: s.grounded, sp: +s.speed.toFixed(1) });
    }
  }
  const final = g.debugState;
  return { t: +t.toFixed(2), phase: final.phase, x: +final.position.x.toFixed(2), y: +final.position.y.toFixed(2), z: +final.position.z.toFixed(2), trace };
})()`;

const child = await launch();
const cdp = await connect();
let failures = 0;

try {
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: URL });
  await sleep(4000);

  let events = cdp.drain();
  const problems = reportErrors(events);
  if (problems.length) {
    failures += problems.length;
    console.log('--- page errors ---');
    for (const problem of problems) console.log(problem);
  }

  const menuVisible = await evaluate(
    cdp,
    `!document.getElementById('menu').classList.contains('is-hidden')`,
  );
  console.log('menu visible:', menuVisible);
  if (!menuVisible) {
    failures++;
    console.log('FAIL: main menu did not appear');
  }
  if (WANT_SHOTS) {
    await sleep(400);
    console.log('shot:', await screenshot(cdp, '00-menu'));
  }

  await evaluate(cdp, `document.getElementById('btnStart').click()`);
  await sleep(800);
  // Freeze the live loop so the scripted simulations are deterministic.
  await evaluate(cdp, `window.game.debugFreeze = true`);

  const state0 = await evaluate(
    cdp,
    `(() => { const s = window.game.debugState; return {phase: s.phase, x: s.position.x, y: s.position.y, z: s.position.z, yaw: s.yaw}; })()`,
  );
  console.log('after start:', state0);
  if (state0.phase !== 'playing') {
    failures++;
    console.log('FAIL: game did not enter the playing phase');
  }
  if (WANT_SHOTS) console.log('shot:', await screenshot(cdp, '01-start'));

  // --- sprint ------------------------------------------------------------
  const sprint = await evaluate(
    cdp,
    `(() => { window.game.debugTeleport(35, 0.05, 0, -Math.PI / 2); const s = window.game.debugSimulate(1.2, {forward: 1, sprint: true}); return {x: s.position.x, z: s.position.z, speed: s.speed, grounded: s.grounded}; })()`,
  );
  console.log('sprint:', sprint);
  if (sprint.speed < 8) {
    failures++;
    console.log('FAIL: sprint speed too low');
  }
  if (sprint.x < 40) {
    failures++;
    console.log('FAIL: player did not run forward');
  }

  // --- jump --------------------------------------------------------------
  const jump = await evaluate(
    cdp,
    `(() => { const s = window.game.debugSimulate(0.15, {forward: 1, sprint: true, jump: true}); return {y: s.position.y, grounded: s.grounded}; })()`,
  );
  console.log('jump:', jump);
  if (jump.grounded || jump.y < 0.4) {
    failures++;
    console.log('FAIL: jump did not lift the player');
  }
  const landed = await evaluate(
    cdp,
    `(() => { const s = window.game.debugSimulate(1.2, {forward: 1, sprint: true}); return {y: s.position.y, grounded: s.grounded}; })()`,
  );
  console.log('landed:', landed);
  if (!landed.grounded) {
    failures++;
    console.log('FAIL: player did not land');
  }

  // --- slide -------------------------------------------------------------
  const slide = await evaluate(
    cdp,
    `(() => { const s = window.game.debugSimulate(0.2, {forward: 1, sprint: true, slide: true}); return {state: s.state, speed: s.speed}; })()`,
  );
  console.log('slide:', slide);
  if (slide.state !== 'slide') {
    failures++;
    console.log('FAIL: slide did not start');
  }

  // --- vault -------------------------------------------------------------
  await evaluate(cdp, `window.game.debugTeleport(4, 0.05, 0, -Math.PI / 2)`);
  const vault = await evaluate(
    cdp,
    `(() => {
       const g = window.game;
       g.debugSimulate(0.6, {forward: 1, sprint: true});
       const before = g.debugState.position.x;
       g.debugSimulate(0.05, {forward: 1, sprint: true, vault: true});
       const during = g.debugState.state;
       g.debugSimulate(0.6, {forward: 1, sprint: true});
       const after = g.debugState;
       return { before, during, after: after.position.x, y: after.position.y, state: after.state };
     })()`,
  );
  console.log('vault:', vault);
  if (vault.during !== 'vault') {
    failures++;
    console.log('FAIL: vault did not trigger');
  }
  if (vault.after <= vault.before) {
    failures++;
    console.log('FAIL: vault did not move the player forward');
  }

  // --- wall run ----------------------------------------------------------
  const wallRun = await evaluate(
    cdp,
    `(() => {
       const g = window.game;
       g.debugTeleport(112, 1.05, 4.6, -Math.PI / 2);
       g.debugSimulate(0.8, {forward: 1, sprint: true});
       g.debugSimulate(0.1, {forward: 1, sprint: true, jump: true});
       let sawWallRun = false;
       let minY = 99;
       for (let i = 0; i < 40; i++) {
         const s = g.debugSimulate(0.05, {forward: 1, sprint: true});
         if (s.state === 'wallrun') sawWallRun = true;
         minY = Math.min(minY, s.position.y);
       }
       const s = g.debugState;
       return { sawWallRun, x: s.position.x, y: s.position.y, grounded: s.grounded, minY };
     })()`,
  );
  console.log('wall run:', wallRun);
  if (!wallRun.sawWallRun) {
    failures++;
    console.log('FAIL: wall run never triggered');
  }
  if (wallRun.x < 128 || !wallRun.grounded) {
    failures++;
    console.log('FAIL: wall run did not cross the gap');
  }
  if (WANT_SHOTS) console.log('shot:', await screenshot(cdp, '02-wallrun'));

  // --- scenic shots ------------------------------------------------------
  if (WANT_SHOTS) {
    const views = [
      { name: '10-vista', x: 36, y: 1.05, z: 0, yaw: -Math.PI / 2, pitch: -0.12 },
      { name: '11-city', x: 36, y: 1.05, z: 0, yaw: -Math.PI * 0.75, pitch: -0.3 },
      { name: '12-facade', x: 116, y: 1.05, z: 4.4, yaw: -Math.PI / 2, pitch: 0.05 },
      { name: '13-finish', x: 233, y: 0.55, z: 0, yaw: -Math.PI / 2, pitch: 0.02 },
    ];
    for (const view of views) {
      await evaluate(
        cdp,
        `window.game.debugTeleport(${view.x}, ${view.y}, ${view.z}, ${view.yaw});
         window.game.debugSimulate(0.05, {pitch: ${view.pitch}});
         window.game.debugSimulate(0.2, {});`,
      );
      await sleep(600);
      console.log('shot:', await screenshot(cdp, view.name));
    }

    // Sprinting with the view model visible.
    await evaluate(
      cdp,
      `window.game.debugTeleport(36, 0.05, 0, -Math.PI / 2);
       window.game.debugSimulate(0.9, {forward: 1, sprint: true, pitch: -0.05});`,
    );
    await sleep(600);
    console.log('shot:', await screenshot(cdp, '14-sprint'));
  }

  // --- interface flow ----------------------------------------------------
  // Unfreeze so the live loop reacts to the keyboard again.
  await evaluate(cdp, `window.game.debugFreeze = false`);
  const ui = { hudVisible: false, pauseVisible: false, pauseHidden: false };
  ui.hudVisible = await evaluate(cdp, `!document.getElementById('hud').classList.contains('is-hidden')`);

  // Pause via the escape key (the game loop processes it on the next frame).
  await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
  await sleep(2500);
  ui.pauseVisible = await evaluate(cdp, `!document.getElementById('pause').classList.contains('is-hidden')`);

  await evaluate(cdp, `document.getElementById('btnResume').click()`);
  await sleep(1500);
  ui.pauseHidden = await evaluate(cdp, `document.getElementById('pause').classList.contains('is-hidden')`);

  // Controls screen from the main menu.
  await evaluate(cdp, `window.game.debugQuitToMenu()`);
  await sleep(1200);
  await evaluate(cdp, `document.getElementById('btnControls').click()`);
  await sleep(800);
  const controlsVisible = await evaluate(
    cdp,
    `!document.getElementById('controls').classList.contains('is-hidden')`,
  );
  await evaluate(cdp, `document.getElementById('btnControlsBack').click()`);
  await sleep(800);
  const controlsHidden = await evaluate(
    cdp,
    `document.getElementById('controls').classList.contains('is-hidden')`,
  );

  // Restart from checkpoint.
  await evaluate(cdp, `window.game.debugStartRun()`);
  await sleep(1500);
  await evaluate(cdp, `window.game.debugTeleport(113, 1.05, 4.5, -Math.PI / 2)`);
  await sleep(2000);
  await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }))`);
  await sleep(2000);
  const restart = await evaluate(
    cdp,
    `(() => { const s = window.game.debugState; return {x: s.position.x, phase: s.phase}; })()`,
  );
  await evaluate(cdp, `window.game.debugFreeze = true`);

  console.log('interface:', { ...ui, controlsVisible, controlsHidden, restart });
  if (!ui.hudVisible) {
    failures++;
    console.log('FAIL: HUD not visible while playing');
  }
  if (!ui.pauseVisible) {
    failures++;
    console.log('FAIL: pause menu did not open');
  }
  if (!ui.pauseHidden) {
    failures++;
    console.log('FAIL: pause menu did not close');
  }
  if (!controlsVisible || !controlsHidden) {
    failures++;
    console.log('FAIL: controls screen did not toggle');
  }
  if (Math.abs(restart.x - 113) > 4) {
    failures++;
    console.log(`FAIL: checkpoint restart did not work (x=${restart.x})`);
  }

  // --- full route --------------------------------------------------------
  await evaluate(cdp, `window.game.debugTeleport(0, 0.05, 0, -Math.PI / 2)`);
  const route = await evaluate(cdp, BOT);
  console.log('route result:', { t: route.t, phase: route.phase, x: route.x, y: route.y, z: route.z });

  const rendererInfo = await evaluate(
    cdp,
    `(() => {
      const canvas = document.getElementById('scene');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return {
        width: canvas.width,
        height: canvas.height,
        hasContext: !!gl,
        render: window.game.debugRenderInfo,
      };
    })()`,
  );
  console.log('canvas:', rendererInfo);
  if (!rendererInfo.hasContext) {
    failures++;
    console.log('FAIL: no WebGL context');
  }
  if (rendererInfo.render.meshes > 120) {
    failures++;
    console.log('FAIL: too many scene meshes');
  }

  console.log('route trace:');
  for (const entry of route.trace) {
    console.log(
      `  t=${String(entry.t).padStart(6)} x=${String(entry.x).padStart(7)} y=${String(entry.y).padStart(7)} z=${String(entry.z).padStart(7)} ${entry.st.padEnd(8)} grounded=${entry.gr} speed=${entry.sp}`,
    );
  }
  if (route.phase !== 'complete') {
    failures++;
    console.log('FAIL: the level was not completed by the bot');
  }

  const completeVisible = await evaluate(
    cdp,
    `!document.getElementById('complete').classList.contains('is-hidden')`,
  );
  console.log('complete screen visible:', completeVisible);
  if (!completeVisible) {
    failures++;
    console.log('FAIL: finish screen not shown');
  }
  if (WANT_SHOTS) console.log('shot:', await screenshot(cdp, '03-complete'));

  events = cdp.drain();
  const lateProblems = reportErrors(events);
  if (lateProblems.length) {
    failures += lateProblems.length;
    console.log('--- late errors ---');
    for (const problem of lateProblems) console.log(problem);
  }
} catch (error) {
  failures++;
  console.error('smoke test crashed:', error);
} finally {
  child.kill();
}

console.log(failures === 0 ? '\nSMOKE TEST PASSED' : `\nSMOKE TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
