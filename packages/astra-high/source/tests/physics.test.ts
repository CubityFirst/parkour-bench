import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { PlayerController } from '../src/player/PlayerController';
import type { MoveInput } from '../src/player/Input';

const idle: MoveInput = { forward: 0, strafe: 0, sprint: false, jump: false, jumpPressed: false, slidePressed: false, vaultPressed: false };
const run = { ...idle, forward: 1, sprint: true };
const dt = 1 / 120;
function step(p: PlayerController, frames: number, input = idle) { for (let i = 0; i < frames; i++) p.update(dt, { ...input, jumpPressed: i === 0 && input.jumpPressed, slidePressed: i === 0 && input.slidePressed, vaultPressed: i === 0 && input.vaultPressed }, 0); }
function floor(world: CollisionWorld, start: number, end: number, y = 0) { world.add(0, y - 1, -(start + end) / 2, 20, 2, end - start); }

test('fixed timestep landing cannot pass through rooftops', () => {
  const w = new CollisionWorld(); floor(w, -20, 20);
  const p = new PlayerController(w); p.reset(new Vector3(0, 12, 0));
  step(p, 240); assert.equal(p.position.y, 0); assert.equal(p.grounded, true);
});
test('solid walls block sprinting without tunnelling', () => {
  const w = new CollisionWorld(); floor(w, -20, 50); w.add(0, 2, -8, 20, 4, 0.3);
  const p = new PlayerController(w); p.reset(new Vector3(0, 0, 0)); step(p, 240, run);
  assert.ok(p.position.z >= -7.511); assert.equal(p.position.y, 0);
});
test('sprint jumps can span a seven meter gap and one meter rise', () => {
  const w = new CollisionWorld(); floor(w, -20, 20); floor(w, 27, 60, 1);
  const p = new PlayerController(w); p.reset(new Vector3(0, 0, -12));
  while (-p.position.z < 19.4) step(p, 1, run);
  step(p, 1, { ...run, jump: true, jumpPressed: true });
  step(p, 90, { ...run, jump: true });
  assert.ok(-p.position.z > 28); assert.equal(p.position.y, 1); assert.ok(p.grounded);
});
test('releasing jump early reduces the apex', () => {
  const w = new CollisionWorld(); floor(w, -20, 20);
  const apex = (held: boolean) => {
    const p = new PlayerController(w); p.reset(new Vector3(0, 0, 0)); step(p, 2);
    step(p, 1, { ...idle, jump: true, jumpPressed: true }); let max = 0;
    for (let i = 0; i < 60; i++) { step(p, 1, { ...idle, jump: held }); max = Math.max(max, p.position.y); }
    return max;
  };
  assert.ok(apex(true) > apex(false) + 0.8);
});
test('slide fits under duct and cannot stand inside it', () => {
  const w = new CollisionWorld(); floor(w, -20, 50); w.add(0, 1.7, -12, 18, 1.22, 8);
  const p = new PlayerController(w); p.reset(new Vector3(0, 0, 0));
  while (-p.position.z < 6) step(p, 1, run);
  step(p, 1, { ...run, slidePressed: true });
  let wasUnder = false;
  for (let i = 0; i < 180; i++) {
    step(p, 1, run);
    if (-p.position.z > 8 && -p.position.z < 16) { assert.ok(p.height < 1.1); wasUnder = true; }
  }
  assert.ok(wasUnder); assert.ok(-p.position.z > 18); assert.equal(p.height, 1.8);
});
test('wall run bridges a gap that exceeds normal jump range', () => {
  for (const side of [-1, 1]) {
    const w = new CollisionWorld(); floor(w, -20, 20); floor(w, 41, 65);
    w.add(side * 2.05, 2, -30.5, 0.7, 5.6, 28, 'wallrun');
    const p = new PlayerController(w); p.reset(new Vector3(0, 0, -12));
    while (-p.position.z < 19) step(p, 1, run);
    step(p, 1, { ...run, jump: true, jumpPressed: true });
    let wallSeen = false;
    for (let i = 0; i < 270; i++) { step(p, 1, { ...run, jump: true }); if (p.wall) wallSeen = true; }
    assert.ok(wallSeen); assert.ok(-p.position.z > 43); assert.equal(p.position.y, 0);
  }
});
test('vault traverses a short obstacle with preserved momentum', () => {
  const w = new CollisionWorld(); floor(w, -20, 50); w.add(0, 0.55, -10, 7, 1.1, 0.85, 'vault');
  const p = new PlayerController(w); p.reset(new Vector3(0, 0, -8.2)); p.velocity.z = -12; p.grounded = true;
  step(p, 1, { ...run, vaultPressed: true }); assert.ok(p.vault);
  step(p, 60, run); assert.ok(p.position.z < -11); assert.ok(p.speed > 8); assert.equal(p.height, 1.8);
});
test('respawn clears every movement state', () => {
  const w = new CollisionWorld(), p = new PlayerController(w);
  p.slideTime = 1; p.height = 0.82; p.velocity.set(8, -9, 12); p.wallTime = 2; p.usedWall = 5;
  p.reset(new Vector3(0, 32, -70));
  assert.equal(p.velocity.length(), 0); assert.equal(p.height, 1.8); assert.equal(p.slideTime, 0); assert.equal(p.usedWall, -1);
});

test('coyote time accepts a jump immediately after leaving a roof', () => {
  const w = new CollisionWorld(); floor(w, -20, 0);
  const p = new PlayerController(w); p.reset(new Vector3(0,0,1));
  p.velocity.z = -10; step(p, 1, run);
  while (p.grounded || p.position.z > -0.5) step(p, 1, run);
  step(p, 1, {...run, jump: true, jumpPressed: true});
  assert.ok(p.velocity.y > 8);
});

test('a buffered jump fires upon landing', () => {
  const w = new CollisionWorld(); floor(w,-20,20);
  const p = new PlayerController(w); p.reset(new Vector3(0,0.15,0)); p.velocity.y = -5;
  step(p,1,{...idle,jump:true,jumpPressed:true});
  step(p,6,{...idle,jump:true});
  assert.ok(p.velocity.y > 7); assert.ok(p.position.y > 0);
});

test('ledge recovery lifts above the collision face', () => {
  const w = new CollisionWorld(); w.add(0,-2,-10,20,4,20);
  const p = new PlayerController(w); p.reset(new Vector3(0,-1,0.75));
  p.airborneTime = 0.3; p.velocity.set(0,-2,-8);
  step(p,1,{...run,jump:true,vaultPressed:true});
  assert.ok(p.vault);
  step(p,70,run); assert.ok(p.position.z < -1); assert.equal(p.position.y,0);
});
