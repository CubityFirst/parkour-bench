/**
 * Reproducible full-game route check. Start `npm run dev` first, then run:
 *   node scripts/route-check.mjs
 * Requires the local Playwright browser (`PLAYWRIGHT_BROWSERS_PATH=.playwright`).
 * This drives real keyboard/mouse listeners and Game.tick from start to finish.
 * It never teleports the runner or changes checkpoints, velocity, or game state.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const artifacts = new URL('artifacts/', root);
const temporary = new URL('.playwright/tmp/', root);
await Promise.all([mkdir(artifacts, { recursive: true }), mkdir(temporary, { recursive: true })]);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('.playwright/', root));
process.env.TMPDIR = fileURLToPath(temporary);
const { chromium } = await import('@playwright/test');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));

try {
  await page.goto(process.env.REDLINE_URL || 'http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__REDLINE__);
  await page.locator('#start').click();
  await page.waitForFunction(() => window.__REDLINE__.state === 'playing');

  const result = await page.evaluate(() => {
    const game = window.__REDLINE__;
    const player = game.player;
    const dt = 1 / 120;
    const pressed = new Set();
    const jumpEdges = new Set();
    const checkpoints = [{ number: 1, time: game.elapsed, z: player.position.z }];
    const actions = {};
    const jumps = [];
    const initialPosition = player.position.toArray();
    const pointerLocked = document.pointerLockElement === game.renderer.domElement;
    if (!pointerLocked) game.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, bubbles: true }));
    const audioPlay = game.audio.play.bind(game.audio);
    game.audio.setVolume(0);
    game.audio.play = event => { actions[event] = (actions[event] || 0) + 1; audioPlay(event); };

    function key(code, down) {
      if (pressed.has(code) === down) return;
      if (down) pressed.add(code); else pressed.delete(code);
      document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    }

    // Course landmarks are a scripted input plan, not changes to level geometry.
    const roofEnds = [-26, -76, -118, -160, -198, -286, -330, -422, -449, -504, -550, -588];
    const vaults = [-8, -104, -405];
    const slides = [-55, -237, -259, -278, -487];
    let jumpUntil = 0;
    let minimumHeight = player.position.y;
    let maximumStepDistance = 0;
    let simulationSteps = 0;
    key('KeyW', true);
    key('ShiftLeft', true);

    // One synchronous evaluation prevents requestAnimationFrame from advancing time
    // between these fixed ticks. The same production Game.tick handles all objectives.
    for (let time = 0; time < 95 && game.state === 'playing'; time += dt) {
      const z = player.position.z;
      const targetX = z < -305 && z > -350 ? 2.3 : z < -431 && z > -478 ? -2.3 : 0;
      const targetYaw = -Math.atan2((targetX - player.position.x) / 7, 1);
      document.dispatchEvent(new MouseEvent('mousemove', {
        movementX: (player.yaw - targetYaw) / (0.002 * player.sensitivity),
        movementY: 0,
        buttons: 1,
        bubbles: true,
      }));

      const nextEdge = roofEnds.find(edge => !jumpEdges.has(edge) && z - edge < 1.6 && z - edge > -0.3);
      if (nextEdge !== undefined && player.grounded) {
        jumpEdges.add(nextEdge);
        jumpUntil = time + 0.9;
        jumps.push({ time: game.elapsed, edge: nextEdge, position: player.position.toArray(), speed: player.speed });
      }
      key('Space', time < jumpUntil);
      key('KeyE', vaults.some(center => z > center + 0.42 && z < center + 1.9) && player.action !== 'vault');
      key('KeyC', slides.some(center => z < center + 4.2 && z > center - 1.85));

      const previous = player.position.clone();
      const checkpoint = game.checkpointIndex;
      game.tick(dt);
      simulationSteps++;
      maximumStepDistance = Math.max(maximumStepDistance, player.position.distanceTo(previous));
      minimumHeight = Math.min(minimumHeight, player.position.y);
      if (checkpoint !== game.checkpointIndex) checkpoints.push({ number: game.checkpointIndex + 1, time: game.elapsed, z: player.position.z });
      if (game.falls > 0 || player.position.y < 35) {
        throw new Error(`The continuous run fell at ${player.position.toArray()} after ${game.elapsed.toFixed(2)}s`);
      }
    }

    for (const code of [...pressed]) key(code, false);
    if (!pointerLocked) document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    player.render(1 / 60, game.elapsed);
    game.ui.update(game.elapsed, player.speed, player.action, player.position.z - game.level.finish.z);
    return {
      state: game.state,
      elapsed: game.elapsed,
      falls: game.falls,
      checkpointIndex: game.checkpointIndex,
      checkpoints,
      actions,
      jumps,
      initialPosition,
      finalPosition: player.position.toArray(),
      minimumHeight,
      maximumStepDistance,
      simulationSteps,
      mouseMode: pointerLocked ? 'pointer lock' : 'drag fallback',
      persistedBest: Number(localStorage.getItem('redline.best')),
      finishVisible: !document.querySelector('#finish-modal').classList.contains('hidden'),
      finishTime: document.querySelector('#finish-time').textContent,
      finishBest: document.querySelector('#finish-best').textContent,
      caption: document.querySelector('#finish-caption').textContent,
    };
  });

  assert.equal(result.state, 'finished', 'The real Game completion transition must run');
  assert.equal(result.falls, 0, 'The course must be traversed continuously without respawning');
  assert.equal(result.checkpointIndex, 5);
  assert.deepEqual(result.checkpoints.map(checkpoint => checkpoint.number), [1, 2, 3, 4, 5, 6]);
  assert.equal(result.actions.checkpoint, 5);
  assert.equal(result.actions.finish, 1);
  assert.equal(result.actions.wallrun, 2);
  assert.ok(result.actions.vault >= 3 && result.actions.slide >= 5 && result.actions.jump >= 12);
  assert.ok(result.maximumStepDistance < 0.35, 'No physics tick may teleport the runner');
  assert.ok(result.elapsed > 50 && result.elapsed < 65, 'The clean scripted run should take approximately 54 seconds');
  assert.ok(result.finalPosition[2] <= -625);
  assert.equal(result.persistedBest, result.elapsed, 'Completing the level must save the best time');
  assert.equal(result.finishVisible, true);
  assert.equal(result.finishTime, result.finishBest);
  assert.match(result.caption, /NEW PERSONAL BEST.*A CLEAN RUN/);
  assert.deepEqual(runtimeErrors, [], 'No uncaught browser errors');

  await page.screenshot({ path: fileURLToPath(new URL('route-finish.png', artifacts)) });
  await writeFile(new URL('route-check.json', artifacts), `${JSON.stringify({ ...result, runtimeErrors }, null, 2)}\n`);
  console.log(`PASS: complete continuous course in ${result.elapsed.toFixed(2)}s; 6 checkpoints, ${result.actions.jump} jumps, ${result.actions.vault} vaults, ${result.actions.slide} slides, ${result.actions.wallrun} wall runs, 0 falls.`);
  console.log('Finish UI and saved personal best verified. Report: artifacts/route-check.json');
} finally {
  await browser.close();
}
