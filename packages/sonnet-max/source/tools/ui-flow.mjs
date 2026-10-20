// UI / flow regression test in real Chrome: menu -> start -> pause -> controls -> resume -> respawn ->
// settings persistence -> drag-look -> keyboard movement. Usage: node tools/ui-flow.mjs [url] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://localhost:5173/?debug', outDir = 'tools/out'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const from = process.env.PLAYWRIGHT_FROM ?? path.resolve('package.json');
const require = createRequire(from);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});
const sleep = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__rooftop.state());
const visible = (id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
};

await page.goto(url, { waitUntil: 'load' });
await sleep(3000);
check('menu visible on load', await visible('menu'));
check('start button is the first start|play|run button', (await page.getByRole('button', { name: /start|play|run/i }).first().innerText()).toLowerCase().includes('start game'));
check('best time placeholder', (await page.textContent('#menu-best')) === '--:--.--');

// Controls panel from the main menu.
await page.click('#btn-controls');
check('controls panel opens', await visible('controls'));
await page.screenshot({ path: path.join(outDir, 'ui-controls.png') });
await page.click('#btn-controls-back');
check('back returns to menu', await visible('menu'));

// Settings: change sensitivity + camera motion, expect persistence.
await page.evaluate(() => {
  const el = document.querySelector('#menu-settings input[type=range]');
  el.value = '1.8';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.click('#menu-settings .seg button:nth-child(2)'); // Camera motion: Reduced
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rooftop-flow-settings')));
check('sensitivity saved', Math.abs(saved.sensitivity - 1.8) < 1e-6, JSON.stringify(saved));
check('camera motion saved', saved.motion > 0 && saved.motion < 1, `motion=${saved.motion}`);

// Start the game.
await page.click('#btn-start');
await sleep(800);
let s = await state();
check('game running after Start', s.phase === 'playing' && (await visible('hud')) && !(await visible('menu')));
check('player grounded on the start roof', s.onGround && Math.abs(s.y - 62) < 0.05, `y=${s.y}`);

// Movement via real key events.
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await sleep(1500);
s = await state();
check('W + Shift moves the player forward', s.z < 1 && s.speed > 6, `z=${s.z.toFixed(1)} speed=${s.speed.toFixed(1)}`);
await page.keyboard.press('Space');
await sleep(120);
s = await state();
check('Space jumps (airborne)', !s.onGround || s.vy > 0, `state=${s.state} vy=${s.vy.toFixed(1)}`);
await sleep(900);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await sleep(500);

// Drag-look fallback (no pointer lock in automation).
const before = (await state()).yaw;
await page.mouse.move(640, 360);
await page.mouse.down();
for (let i = 0; i < 12; i++) await page.mouse.move(640 + i * 25, 360, { steps: 1 });
await page.mouse.up();
await sleep(200);
const after = (await state()).yaw;
console.log(`  info yaw before=${before.toFixed(3)} after=${after.toFixed(3)} (drag look; real play uses pointer lock)`);

// Pause with Escape.
await page.keyboard.press('Escape');
await sleep(400);
check('Escape pauses', (await state()).phase === 'paused' && (await visible('pause')));
await page.screenshot({ path: path.join(outDir, 'ui-pause.png') });
await page.click('#btn-pause-controls');
check('controls reachable from pause', await visible('controls'));
await page.click('#btn-controls-back');
check('back returns to pause', await visible('pause'));
await page.click('#btn-resume');
await sleep(400);
check('Resume continues play', (await state()).phase === 'playing' && !(await visible('pause')));

// Respawn with R after wandering off.
await page.evaluate(() => window.__rooftop.place(0, 62, -10, 0));
await page.keyboard.press('KeyR');
await sleep(900);
s = await state();
check('R respawns at the start (no checkpoint yet)', Math.abs(s.z - 3) < 0.6 && s.onGround, `z=${s.z.toFixed(2)}`);

// Falling kills and respawns at the latest checkpoint.
await page.evaluate(() => window.__rooftop.place(20, 70, 3, 0));
await sleep(2200);
s = await state();
check('falling off the roof respawns on the start roof', s.y > 60 && s.falls >= 1, `y=${s.y.toFixed(1)} falls=${s.falls}`);

// Quit to menu.
await page.keyboard.press('Escape');
await sleep(300);
await page.click('#btn-pause-menu');
await sleep(400);
check('Main menu from pause', (await state()).phase === 'menu' && (await visible('menu')));

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
