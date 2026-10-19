import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Run the real controller in Node with only the browser input targets stubbed.
const threeUrl = pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href;
const THREE = await import(threeUrl);
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const inputUrl = asModule(compile('src/player/Input.ts'));
const worldUrl = asModule(compile('src/world/CollisionWorld.ts').replaceAll("from 'three'", `from ${JSON.stringify(threeUrl)}`));
const playerUrl = asModule(compile('src/player/PlayerController.ts')
  .replaceAll("from 'three'", `from ${JSON.stringify(threeUrl)}`)
  .replaceAll("from './Input'", `from ${JSON.stringify(inputUrl)}`)
  .replaceAll("from '../world/CollisionWorld'", `from ${JSON.stringify(worldUrl)}`));
globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
document.pointerLockElement = {};
const { PlayerController } = await import(playerUrl);
const { CollisionWorld } = await import(worldUrl);
const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const key = (code, down = true) => {
  const event = new Event(down ? 'keydown' : 'keyup');
  Object.defineProperty(event, 'code', { value: code });
  window.dispatchEvent(event);
};
const tick = (player, count) => {
  for (let i = 0; i < count; i++) player.update(1 / 120);
};
const make = () => {
  const world = new CollisionWorld();
  const player = new PlayerController(new THREE.PerspectiveCamera(), world);
  player.enabled = true;
  return { world, player };
};
const floor = (world) => world.addBox(vector(0, -1, 0), vector(30, 2, 200));

{
  const { world, player } = make();
  floor(world);
  player.respawn(vector(0, 0, 10));
  key('KeyW');
  key('ShiftLeft');
  tick(player, 120);
  assert.equal(player.velocity.z, -12, 'Sprint should reach 12 m/s');
  const startZ = player.position.z;
  key('Space');
  tick(player, 48);
  assert(player.position.y > 1.7, 'Held jump should reach an athletic jump height');
  tick(player, 48);
  assert(player.grounded, 'Jump should land consistently');
  assert(startZ - player.position.z >= 9.5, 'Held sprint jump should cover a 9 m gap');
  assert(Math.abs(player.position.y) < 0.01, 'Floor collision should hold feet on the roof');
  player.dispose();
}

{
  const { world, player } = make();
  floor(world);
  world.addBox(vector(0, 0.55, -2), vector(4, 1.1, 0.8), 'vault');
  player.respawn(vector(0, 0, -0.9));
  key('KeyE');
  tick(player, 1);
  assert.equal(player.state, 'VAULTING', 'E should start a clear vault');
  tick(player, 60);
  assert(player.position.z < -2.9, 'Vault should finish beyond the obstacle');
  assert(player.grounded, 'Vault should return to the supporting roof');
  player.dispose();
}

{
  const { world, player } = make();
  floor(world);
  world.addBox(vector(0, 1.6, -3), vector(8, 1.1, 2));
  player.respawn(vector(0, 0, 4));
  key('KeyW');
  key('ShiftLeft');
  tick(player, 50);
  key('ControlLeft');
  tick(player, 25);
  assert(player.position.z < -2, 'Slide should enter a 1.05 m opening');
  key('ControlLeft', false);
  tick(player, 3);
  assert.equal(player.state, 'SLIDING', 'Releasing slide below a ceiling should keep a safe collision height');
  tick(player, 50);
  assert(player.position.z < -4.4, 'Slide should clear the low structure');
  assert.notEqual(player.state, 'SLIDING', 'Player should stand after clearing the ceiling');
  player.dispose();
}

{
  const { world, player } = make();
  world.addBox(vector(0, -1, -3), vector(8, 2, 6));
  player.respawn(vector(0, -0.7, 0.6));
  player.velocity.set(0, -2, -5);
  key('KeyW');
  key('Space');
  tick(player, 1);
  assert.equal(player.state, 'VAULTING', 'A reachable ledge should recover a late jump');
  tick(player, 55);
  assert(player.position.z < 0 && player.grounded, 'Mantle should finish safely on the roof');
  player.dispose();
}

{
  const { world, player } = make();
  world.addBox(vector(0, -1, 3), vector(20, 2, 10));
  world.addBox(vector(0, -1, -25), vector(20, 2, 10));
  world.addBox(vector(1.1, 2.2, -11), vector(0.56, 4.4, 34), 'wallrun');
  player.respawn(vector(0, 0, 4));
  key('KeyW');
  key('ShiftLeft');
  tick(player, 40);
  key('Space');
  tick(player, 180);
  assert.equal(player.state, 'WALL RUN', 'Jumping alongside a red wall should start a wall run');
  tick(player, 90);
  assert(player.position.z < -24 && player.grounded, 'Wall run should cross an 18 m gap and land');
  assert(player.position.x < 0.52, 'Wall collision should prevent clipping into the runnable surface');
  player.dispose();
}

{
  const { world, player } = make();
  floor(world);
  world.addBox(vector(0, 2, -1), vector(8, 4, 0.1));
  player.respawn(vector(0, 0, 2));
  player.velocity.z = -80;
  tick(player, 12);
  assert(player.position.z >= -0.641, 'Substeps should prevent tunneling through thin walls');
  player.dispose();
}

console.log('Movement checks passed: sprint, held jump, vault, slide clearance, mantle, 18 m wall run, and collision substeps.');
