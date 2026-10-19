import { chromium } from '@playwright/test';
import path from 'node:path';
import assert from 'node:assert/strict';

const context = await chromium.launchPersistentContext(path.resolve('.cache/smoke-browser'), {
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.clear());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.STRIDE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => Boolean(window.__stride));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'artifacts/menu.png' });
  await page.locator('.how-button').click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  assert.match(await page.getByRole('dialog').innerText(), /Jump \/ wall jump/);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('slider', { name: 'Mouse sensitivity' }).fill('1.25');
  await page.getByRole('dialog').getByText('Reduced camera motion', { exact: true }).click();
  assert.equal(await page.evaluate(() => window.__stride.player.reducedMotion), true);
  assert.equal(await page.evaluate(() => window.__stride.player.sensitivity), 1.25);
  await page.getByRole('button', { name: 'READY TO GO' }).click();
  await page.getByRole('button', { name: 'START RUN', exact: true }).click();
  await page.waitForFunction(() => window.__stride.state === 'playing');
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await page.waitForTimeout(1000);
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  const moved = await page.evaluate(() => ({ z: window.__stride.player.position.z, time: window.__stride.elapsed, speed: window.__stride.player.velocity.length(), state:window.__stride.state, locked:!!document.pointerLockElement, frames:window.__stride.renderer.info.render.frame }));
  console.log('Keyboard movement:', JSON.stringify(moved));
  assert(moved.z < 10 && moved.time > 0.8, 'Start button enables real keyboard movement and timer');
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  assert(await page.evaluate(() => window.__stride.player.position.y > 0.1), 'Space produces a jump');
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'artifacts/playing.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__stride.state === 'paused');
  const pausedTime = await page.evaluate(() => window.__stride.elapsed);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__stride.elapsed), pausedTime, 'Pause freezes the timer');
  await page.screenshot({ path: 'artifacts/paused.png' });
  await page.getByRole('button', { name: 'RESUME RUN' }).click();
  await page.waitForFunction(() => window.__stride.state === 'playing');
  await page.evaluate(() => { window.__stride.player.position.set(0, 0.1, -212); });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__stride.section), 2, 'Checkpoints activate');
  await page.evaluate(() => { window.__stride.player.position.y = -23; });
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => window.__stride.player.position.z === -211 && window.__stride.player.position.y >= -0.01), 'Falling returns to the latest checkpoint');
  await page.keyboard.press('r');
  assert(await page.evaluate(() => window.__stride.player.velocity.length() < 0.3), 'Restart checkpoint resets momentum');
  await page.evaluate(() => { window.__stride.player.position.set(0, 0.1, -693); window.__stride.elapsed = 91.25; });
  await page.waitForFunction(() => window.__stride.state === 'finished');
  assert(await page.getByText('LEVEL', { exact: false }).count() > 0);
  assert(await page.evaluate(() => Number(localStorage.getItem('stride-best')) > 90), 'Finish saves the best time');
  await page.screenshot({ path: 'artifacts/finished.png' });
  await page.getByRole('button', { name: 'RUN IT AGAIN' }).click();
  await page.waitForFunction(() => window.__stride.state === 'playing');
  assert.equal(await page.evaluate(() => window.__stride.section), 0, 'Restart resets course progress');
  const performance = await page.evaluate(() => ({ drawCalls: window.__stride.renderer.info.render.calls, triangles: window.__stride.renderer.info.render.triangles }));
  assert.deepEqual(errors, [], 'No runtime or browser console errors');
  console.log(JSON.stringify({ status: 'passed', errors, moved, rendering: performance, checks: ['menu', 'controls', 'settings', 'keyboard movement', 'jump', 'pause', 'resume', 'checkpoints', 'fall respawn', 'finish persistence', 'restart'] }, null, 2));
} finally { await context.close(); }
