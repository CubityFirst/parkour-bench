import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = `${workspace}.playwright`;
process.env.TMPDIR = `${workspace}.test-tmp`;
await mkdir(process.env.TMPDIR, { recursive: true });
await mkdir(`${workspace}.test-results`, { recursive: true });
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const runtimeErrors = [];
const results = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
const pass = (name, details = '') => { results.push({ name, pass: true, details }); console.log(`PASS ${name}${details ? `: ${details}` : ''}`); };

try {
  await page.goto(process.env.REDLINE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__REDLINE__));
  // Render once at normal resolution, then reduce only this test's GPU cost.
  // Visual review is separate; these checks exercise input and simulation.
  await page.evaluate(() => window.__REDLINE__.renderer.setPixelRatio(0.4));
  assert.equal(await page.locator('#start').isVisible(), true);
  assert.equal(await page.locator('#world').count(), 1);
  pass('WebGL game loads with the start menu');

  await page.locator('#controls').click();
  assert.equal(await page.locator('#controls-content').isVisible(), true);
  await page.locator('#settings-tab').click();
  await page.locator('#sensitivity').fill('1.35');
  await page.locator('#volume').fill('0.25');
  await page.locator('#reduced-motion').check();
  const settings = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('redline.settings')),
    sensitivity: window.__REDLINE__.player.sensitivity,
    motion: window.__REDLINE__.player.reducedMotion,
  }));
  assert.equal(settings.sensitivity, 1.35);
  assert.equal(settings.motion, true);
  assert.equal(settings.saved.volume, 0.25);
  pass('Controls and settings update the player and local storage');
  await page.locator('#help-done').click();

  await page.locator('#start').click();
  console.log('Start click state', await page.evaluate(() => ({ state: window.__REDLINE__.state, pointer: document.pointerLockElement?.id, mode: document.body.dataset.mode })));
  await page.waitForFunction(() => window.__REDLINE__.state === 'playing');
  const captured = await page.evaluate(() => document.pointerLockElement?.id === 'world');
  if (captured) {
    pass('Start Run enters gameplay and captures pointer lock');
  } else {
    await page.mouse.move(720, 450);
    const yaw = await page.evaluate(() => window.__REDLINE__.player.yaw);
    await page.mouse.down();
    await page.mouse.move(800, 465, { steps: 4 });
    await page.mouse.up();
    assert.notEqual(await page.evaluate(() => window.__REDLINE__.player.yaw), yaw);
    pass('Start Run enters gameplay; drag look works when headless pointer lock is denied');
  }
  await page.keyboard.down('w');
  await page.waitForTimeout(180);
  await page.keyboard.up('w');
  assert.ok(await page.evaluate(() => window.__REDLINE__.player.position.z < window.__REDLINE__.level.spawn.z - 0.1));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__REDLINE__.state === 'paused');
  assert.equal(await page.locator('#pause-modal').isVisible(), true);
  assert.equal(await page.evaluate(() => document.pointerLockElement), null);
  const before = await page.evaluate(() => window.__REDLINE__.elapsed);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__REDLINE__.elapsed), before);
  pass('Real keyboard movement works; Escape unlocks and freezes the timer');

  const physicsResults = await page.evaluate(() => {
    const game = window.__REDLINE__;
    const player = game.player;
    const colliders = game.level.world.colliders;
    const roofs = colliders.filter(c => c.name?.startsWith('Roof slab ')).sort((a, b) => b.max.z - a.max.z);
    const checks = [];
    const dt = 1 / 120;
    const originalEvent = player.onEvent;
    let events = [];
    player.onEvent = event => events.push(event);
    game.audio.enabled = false;
    game.state = 'paused';
    player.enabled = true;

    const key = (code, down) => {
      if (player.input.held.has(code) === down) return;
      document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
    };
    const advance = (seconds, sample) => {
      for (let i = 0; i < Math.ceil(seconds / dt); i++) { player.update(dt); sample?.(); }
    };
    const reset = (x, y, z, yaw = 0) => {
      player.reset(player.position.clone().set(x, y, z), yaw);
      player.enabled = true;
      events = [];
    };
    const check = (name, condition, details) => checks.push({ name, pass: !!condition, details });

    reset(0, 40, 12);
    advance(3);
    check('Standing remains stable on the actual spawn roof', player.grounded && Math.abs(player.position.y - 40) < 0.001 && player.velocity.y === 0, { position: player.position.toArray(), grounded: player.grounded });

    key('KeyW', true);
    advance(0.55);
    const walk = player.speed;
    reset(0, 40, 12);
    key('KeyW', true); key('ShiftLeft', true);
    advance(0.55);
    const sprint = player.speed;
    check('Sprinting is faster than running with responsive acceleration', walk > 6 && walk < 7 && sprint > 11 && sprint > walk * 1.6, { walk, sprint });
    key('KeyW', false); key('ShiftLeft', false);
    advance(0.5);
    check('Releasing movement decelerates to a stop', player.speed < 0.12, { speed: player.speed });

    const barrier = colliders.find(c => c.name === 'Vault barrier');
    reset(0, 40, -4);
    key('KeyW', true); key('ShiftLeft', true);
    advance(1.2);
    check('A solid vault barrier blocks sprinting without clipping', player.position.z >= barrier.max.z + 0.30 && player.position.z < barrier.max.z + 0.4 && Math.abs(player.position.y - 40) < 0.01, { z: player.position.z, barrierFront: barrier.max.z });
    key('KeyE', true);
    advance(0.75);
    check('E vault crosses the barrier and preserves forward motion', events.includes('vault') && player.position.z < barrier.min.z - 0.31 && player.speed > 5 && player.grounded, { position: player.position.toArray(), speed: player.speed, events });

    const duct = colliders.find(c => c.name === 'Low ventilation duct');
    reset(0, 40.15, -49);
    key('KeyW', true); key('ShiftLeft', true);
    advance(0.9);
    check('Low duct blocks a standing runner', player.position.z >= duct.max.z + 0.30, { z: player.position.z, ductFront: duct.max.z });
    reset(0, 40.15, -49);
    key('KeyW', true); key('ShiftLeft', true);
    advance(0.28);
    key('KeyC', true);
    advance(0.95);
    check('Sliding passes under the actual low duct', events.includes('slide') && player.position.z < duct.min.z - 0.31 && player.position.y > 40 && player.isCrouched, { position: player.position.toArray(), events });
    key('KeyC', false);
    advance(0.2);
    check('Runner stands back up after leaving the duct', !player.isCrouched, { crouched: player.isCrouched });

    reset(0, 40.15, -55);
    key('KeyC', true); advance(0.1); key('KeyC', false);
    advance(1.2);
    check('Ceiling prevents standing inside a low duct', player.isCrouched && player.grounded && Math.abs(player.position.y - 40.15) < 0.01, { position: player.position.toArray(), crouched: player.isCrouched });
    key('KeyW', true); advance(0.8);
    check('Crouched runner exits a duct without becoming stuck', player.position.z < duct.min.z - 0.31 && !player.isCrouched, { position: player.position.toArray(), crouched: player.isCrouched });

    const jumpHeight = hold => {
      reset(0, 40, 12);
      key('Space', true); player.update(dt);
      if (!hold) key('Space', false);
      let peak = player.position.y;
      advance(1.2, () => { peak = Math.max(peak, player.position.y); });
      return peak - 40;
    };
    const high = jumpHeight(true), low = jumpHeight(false);
    check('Holding jump produces a higher arc than tapping', high > 1.5 && low < high * 0.65 && low > 0.3, { high, low });

    for (let i = 0; i < roofs.length - 1; i++) {
      const from = roofs[i], to = roofs[i + 1];
      const gap = from.min.z - to.max.z;
      if (gap > 8) continue;
      // Begin beyond any roof obstacle; the acceleration test above independently
      // establishes that sprint speed is achievable before the takeoff marker.
      reset(0, from.max.y, from.min.z + 4);
      player.velocity.z = -12;
      key('KeyW', true); key('ShiftLeft', true);
      for (let step = 0; step < 120 && player.position.z > from.min.z + 2; step++) player.update(dt);
      key('Space', true);
      let landed = false;
      let ceiling = 0;
      for (let step = 0; step < 240; step++) {
        player.update(dt);
        ceiling = Math.max(ceiling, player.position.y - from.max.y);
        if (player.grounded && player.position.z < to.max.z) { landed = true; break; }
      }
      check(`Running jump clears rooftop gap ${i + 1} (${gap.toFixed(1)}m)`, landed && player.position.y >= to.max.y - 0.01, { position: player.position.toArray(), landed, ceiling });
    }

    for (const [side, departure, landing, y] of [[1, -330, -346, 40.15], [-1, -449, -465, 40]]) {
      const label = side > 0 ? 'Right' : 'Left';
      reset(side * 2.3, y, departure + 7);
      key('KeyW', true); key('ShiftLeft', true);
      for (let step = 0; step < 240 && player.position.z > departure + 1.8; step++) player.update(dt);
      key('Space', true);
      let wallSeen = false;
      let landed = false;
      for (let step = 0; step < 420; step++) {
        player.update(dt);
        wallSeen ||= player.wallRunning;
        if (player.grounded && player.position.z < landing - 0.5) { landed = true; break; }
      }
      check(`${label} wall run crosses its 16m gap`, wallSeen && landed && player.position.y >= y - 0.1, { position: player.position.toArray(), landed, wallSeen });

      reset(side * 2.3, y, departure + 7);
      key('KeyW', true); key('ShiftLeft', true);
      advance(0.45); key('Space', true); advance(0.25);
      const wasRunning = player.wallRunning;
      key('Space', false); player.update(dt); key('Space', true); player.update(dt);
      check(`${label} wall jump kicks away from the wall`, wasRunning && !player.wallRunning && player.velocity.y > 7 && player.velocity.x * side < -2, { velocity: player.velocity.toArray(), wasRunning });
    }

    reset(1, 40.15, -324, -Math.PI / 2);
    key('KeyW', true); key('ShiftLeft', true); advance(1);
    check('Grounded movement cannot pass through a wall-run wall', player.position.x < 2.62 && player.position.x > 2.5 && player.grounded, { position: player.position.toArray() });

    reset(0, 40.15, -366);
    key('KeyW', true); key('ShiftLeft', true);
    let lowestBridgeY = 100;
    advance(1.7, () => { lowestBridgeY = Math.min(lowestBridgeY, player.position.y); });
    check('Narrow bridge supports a continuous sprint between roofs', player.position.z < -382 && player.grounded && lowestBridgeY > 40, { position: player.position.toArray(), lowestBridgeY });

    // Exercise gameplay transitions separately from the movement tests. These setup
    // teleports do not claim to establish that the entire course is completable.
    game.state = 'playing';
    game.checkpointIndex = 0;
    game.elapsed = 20;
    const checkpoint = game.level.checkpoints[1];
    reset(checkpoint.position.x, checkpoint.position.y, checkpoint.position.z - 0.25);
    game.tick(dt);
    check('Checkpoint activates on the target rooftop', game.checkpointIndex === 1, { checkpointIndex: game.checkpointIndex });
    player.velocity.set(8, -12, -10); player.position.y = 5;
    game.tick(dt);
    check('Falling respawns at checkpoint and resets motion', player.position.distanceTo(checkpoint.position) < 0.01 && player.speed === 0 && player.velocity.y === 0 && !player.isCrouched && !player.wallRunning, { position: player.position.toArray(), velocity: player.velocity.toArray() });
    player.velocity.set(5, 0, -6);
    key('KeyR', true);
    check('R restarts the current checkpoint', player.position.distanceTo(checkpoint.position) < 0.01 && player.speed === 0, { position: player.position.toArray(), speed: player.speed });

    game.checkpointIndex = game.level.checkpoints.length - 1;
    game.elapsed = 79.25;
    reset(game.level.finish.x, game.level.finish.y, game.level.finish.z + 0.01);
    player.velocity.z = -6;
    game.tick(dt);
    check('Finish gate completes the run and saves best time', game.state === 'finished' && Number(localStorage.getItem('redline.best')) > 79 && Number(localStorage.getItem('redline.best')) < 80, { state: game.state, elapsed: game.elapsed, storedBest: localStorage.getItem('redline.best') });
    player.onEvent = originalEvent;
    return checks;
  });
  for (const result of physicsResults) {
    results.push(result);
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${JSON.stringify(result.details)}`);
  }
  assert.equal(await page.locator('#finish-modal').isVisible(), true);
  const best = await page.evaluate(() => localStorage.getItem('redline.best'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__REDLINE__));
  assert.equal(await page.evaluate(() => localStorage.getItem('redline.best')), best);
  assert.equal(await page.locator('#menu-best').innerText(), '01:19.26');
  assert.equal(await page.evaluate(() => window.__REDLINE__.player.sensitivity), 1.35);
  pass('Best time and settings survive reload');

  assert.deepEqual(runtimeErrors, [], 'Browser should not emit uncaught errors');
  pass('No browser runtime errors');
  assert.equal(physicsResults.filter(result => !result.pass).length, 0, 'All movement and lifecycle checks should pass');
} catch (error) {
  results.push({ name: 'Verification completion', pass: false, details: error.message });
  await page.screenshot({ path: `${workspace}.test-results/verification-failure.png` }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(`${workspace}.test-results/verification.json`, JSON.stringify({ results, runtimeErrors }, null, 2));
  await browser.close();
}
