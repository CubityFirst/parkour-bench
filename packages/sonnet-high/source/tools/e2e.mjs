// Browser smoke test: drives the real game in headless Chrome through the DevTools protocol.
//   npm run dev   (in another terminal)   then   node tools/e2e.mjs [chrome-path]
// Starts the game, holds W+Shift, jumps, slides, vaults and checks for runtime errors.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.argv[2] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.env.GAME_URL ?? 'http://localhost:5173/';
const port = 9333;
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rf-'))}`,
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--window-size=960,540', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ }
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(6000);

const key = (type, code) => evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', {code:'${code}', bubbles:true, cancelable:true}))`);
const state = () => evaluate(`(() => { const c = window.__game.debug().controller; const p = c.phys; return {state:c.state, x:+p.x.toFixed(1), y:+p.y.toFixed(1), z:+p.z.toFixed(1), v:+c.speedH.toFixed(1)}; })()`);

await evaluate('document.getElementById("btn-start").click()');
await sleep(1500);
console.log('after start', await state());
console.log('diag', await evaluate(`JSON.stringify({phase: window.__game.phase, vis: document.visibilityState, active: window.__game.input.active, menu: document.getElementById('menu').className, frames: window.__game.time})`));
await key('keydown', 'KeyW'); await key('keydown', 'ShiftLeft');
await sleep(2500);
console.log('sprinting', await state());
await key('keydown', 'KeyE'); await key('keyup', 'KeyE');
await sleep(1200);
console.log('after vault', await state());
await key('keydown', 'Space'); await sleep(100); await key('keyup', 'Space');
await sleep(300);
console.log('jump', await state());
await sleep(1500);
await key('keydown', 'KeyC'); await sleep(400);
console.log('slide', await state());
await key('keyup', 'KeyC');
await sleep(3000);
console.log('later', await state());
console.log('errors:', errors.length ? errors : 'none');
ws.close();
proc.kill();
process.exit(errors.length ? 1 : 0);
