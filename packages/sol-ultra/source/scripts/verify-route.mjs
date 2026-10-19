import { chromium } from '@playwright/test';
import path from 'node:path';
import assert from 'node:assert/strict';

const context = await chromium.launchPersistentContext(path.resolve('.cache/physics-browser'), {
  headless: true, viewport: { width: 1440, height: 900 },
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
try {
  const page = await context.newPage();
  await page.route('**/__physics__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Physics verification</title>' }));
  await page.goto(new URL('/__physics__', process.env.STRIDE_URL ?? 'http://localhost:5173/').href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { Level } = await import('/src/world/Level.ts');
    const { PlayerController } = await import('/src/player/PlayerController.ts');
    const level = new Level(new THREE.Scene());
    const player = new PlayerController(new THREE.PerspectiveCamera(), level.world);
    player.respawn(level.start);
    player.enabled = true;
    const held = new Set(['KeyW', 'ShiftLeft']);
    const edges = new Set();
    player.input.down = key => held.has(key);
    player.input.pressed = key => edges.delete(key);
    const events = new Set();
    const floors = level.world.colliders.filter(c => c.box.max.y < 0.6 && c.box.max.x > 5 && c.box.min.x < -5 && c.box.max.z - c.box.min.z > 10);
    let frames = 0;
    let maximumSpeed = 0;
    let minimumY = 0;
    let currentJump = false;
    let lastZ = player.position.z;
    let stuckFrames = 0;
    const samples = [];
    for (; frames < 120 * 120; frames++) {
      const p = player.position;
      held.delete('KeyA'); held.delete('KeyD');
      if (player.grounded && p.x > 0.12) held.add('KeyA');
      if (player.grounded && p.x < -0.12) held.add('KeyD');
      if (player.grounded && currentJump) { currentJump = false; held.delete('Space'); }
      const floor = floors.find(c => p.z <= c.box.max.z + 0.3 && p.z >= c.box.min.z - 0.3);
      if (floor && player.grounded && !currentJump && p.z - floor.box.min.z < 1.3 && p.z > -680) {
        held.add('Space'); edges.add('Space'); currentJump = true;
      }
      const gate = level.world.colliders.find(c => c.kind === 'solid' && c.box.min.y > 0.8 && c.box.min.y < 1.2 && Math.abs(c.box.max.x + c.box.min.x) < 0.1 && p.z - c.box.max.z < 4.2 && p.z - c.box.min.z > -1);
      if (gate && player.grounded) {
        if (!held.has('KeyC')) edges.add('KeyC');
        held.add('KeyC');
      } else { held.delete('KeyC'); }
      const vault = level.world.colliders.find(c => c.kind === 'vault' && p.z - c.box.max.z < 1.5 && p.z - c.box.max.z > 0);
      if (vault) edges.add('KeyE');
      player.update(1 / 120);
      player.events.splice(0).forEach(e => events.add(e));
      maximumSpeed = Math.max(maximumSpeed, Math.hypot(player.velocity.x, player.velocity.z));
      minimumY = Math.min(minimumY, p.y);
      if (frames % 120 === 0) samples.push({ t: frames / 120, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), state: player.state });
      if (Math.abs(p.z - lastZ) < 0.001) stuckFrames++; else stuckFrames = 0;
      lastZ = p.z;
      if (p.y < -12 || stuckFrames > 360 || level.finish.containsPoint(p)) break;
    }
    return { complete: level.finish.containsPoint(player.position), time: frames / 120, position: player.position.toArray(), maximumSpeed, minimumY, events: [...events], samples, colliders: level.world.colliders.length };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.complete, true, 'The authored route must be completable using actual movement physics');
  for (const event of ['jump', 'slide', 'wallrun', 'vault', 'land']) assert(result.events.includes(event), `Course should exercise ${event}`);
  assert(result.time >= 50 && result.time <= 120, 'Course duration should be close to 60–120 seconds');
} finally {
  await context.close();
}
