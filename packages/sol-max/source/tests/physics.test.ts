import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { CollisionWorld } from "../src/world/CollisionWorld";
import { PlayerPhysics } from "../src/player/PlayerPhysics";
import type { Controls } from "../src/player/Input";

const dt = 1 / 120;
const neutral: Controls = {
  forward: 0,
  right: 0,
  sprint: false,
  slide: false,
  jump: false,
  jumpHeld: false,
  vault: false,
};
const running = { ...neutral, forward: 1, sprint: true };
function tick(
  player: PlayerPhysics,
  seconds: number,
  controls = neutral,
): void {
  for (let i = 0; i < Math.round(seconds / dt); i++)
    player.update(
      dt,
      {
        ...controls,
        jump: controls.jump && i === 0,
        vault: controls.vault && i === 0,
      },
      0,
    );
}
function floor(world: CollisionWorld, start = 60, end = -60, y = 0): void {
  world.add(0, y - 5, (start + end) / 2, 40, 10, start - end, "roof");
}
function playerAt(world: CollisionWorld, x = 0, y = 0, z = 0): PlayerPhysics {
  const player = new PlayerPhysics(world);
  player.reset(new Vector3(x, y, z));
  return player;
}

test("floors catch a fast fall and sprinting cannot tunnel through a thin wall", () => {
  const world = new CollisionWorld();
  floor(world);
  world.add(0, 2, -8, 30, 4, 0.2);
  const p = playerAt(world, 0, 18);
  p.grounded = false;
  p.velocity.y = -42;
  tick(p, 1);
  assert.equal(p.position.y, 0);
  assert.equal(p.grounded, true);
  tick(p, 3, running);
  assert.ok(p.position.z > -7.6);
  assert.ok(p.position.z < -7.3);
});

test("a held sprint jump clears a nine-metre gap to a higher roof", () => {
  const world = new CollisionWorld();
  floor(world, 50, -10);
  floor(world, -19, -80, 0.7);
  const p = playerAt(world, 0, 0, 4);
  tick(p, 0.88, running);
  tick(p, 0.72, { ...running, jump: true, jumpHeld: true });
  tick(p, 0.6, running);
  assert.ok(p.position.z < -20, `position ${p.position.toArray()}`);
  assert.ok(Math.abs(p.position.y - 0.7) < 1e-8);
  assert.equal(p.grounded, true);
});

test("jump height depends on how long jump is held", () => {
  const world = new CollisionWorld();
  floor(world);
  const held = playerAt(world),
    tapped = playerAt(world);
  let heldHeight = 0,
    tappedHeight = 0;
  for (let i = 0; i < 100; i++) {
    held.update(dt, { ...neutral, jump: i === 0, jumpHeld: true }, 0);
    tapped.update(dt, { ...neutral, jump: i === 0, jumpHeld: i < 3 }, 0);
    heldHeight = Math.max(heldHeight, held.position.y);
    tappedHeight = Math.max(tappedHeight, tapped.position.y);
  }
  assert.ok(heldHeight > tappedHeight + 0.3);
  assert.equal(held.grounded, true);
});

test("sliding passes a low ceiling and the player stays crouched until clear", () => {
  const world = new CollisionWorld();
  floor(world);
  world.add(0, 2.3, -8, 12, 2.3, 5);
  const p = playerAt(world);
  tick(p, 0.32, running);
  tick(p, 0.6, { ...running, slide: true });
  assert.ok(p.position.z < -8);
  assert.equal(p.crouching, true);
  tick(p, 2, running);
  assert.ok(p.position.z < -12);
  assert.equal(p.crouching, false);
  assert.equal(p.position.y, 0);
});

test("vault clears a small solid barrier, but refuses a tall wall", () => {
  const world = new CollisionWorld();
  floor(world);
  world.add(0, 0.6, -2, 8, 1.2, 1, "vault");
  const p = playerAt(world);
  p.update(dt, { ...running, vault: true }, 0);
  assert.ok(p.traversal);
  tick(p, 0.42, running);
  assert.ok(p.position.z < -3.2);
  assert.equal(world.overlaps(p.position, p.height, 0.34), false);
  const tallWorld = new CollisionWorld();
  floor(tallWorld);
  tallWorld.add(0, 3, -2, 8, 6, 1, "solid");
  const tallPlayer = playerAt(tallWorld);
  tallPlayer.update(dt, { ...running, vault: true }, 0);
  assert.equal(tallPlayer.traversal, null);
});

test("wall running crosses a gap too long for a normal sprint jump", () => {
  const world = new CollisionWorld();
  floor(world, 30, -10);
  floor(world, -30, -70);
  world.add(-1.5, 3.2, -20, 0.7, 6.4, 34, "wallrun");
  const p = playerAt(world, 0, 0, 4);
  tick(p, 0.9, running);
  let ran = false;
  for (let i = 0; i < 400; i++) {
    p.update(dt, { ...running, jump: i === 0, jumpHeld: true }, 0);
    ran ||= !!p.activeWall;
  }
  assert.ok(ran);
  assert.ok(p.position.z < -30);
  assert.equal(p.position.y, 0);
  assert.equal(p.grounded, true);
});

test("respawn clears every transient movement state and momentum", () => {
  const world = new CollisionWorld();
  floor(world);
  const p = playerAt(world);
  tick(p, 0.5, running);
  tick(p, 0.2, { ...running, slide: true });
  p.reset(new Vector3(3, 0, 12));
  assert.deepEqual(p.position.toArray(), [3, 0, 12]);
  assert.equal(p.speed, 0);
  assert.equal(p.velocity.y, 0);
  assert.equal(p.sliding, false);
  assert.equal(p.crouching, false);
  assert.equal(p.activeWall, null);
  assert.equal(p.traversal, null);
});

test("coyote time accepts a jump just after leaving an edge", () => {
  const world = new CollisionWorld();
  floor(world, 20, -5);
  const p = playerAt(world, 0, 0, -4.9);
  p.velocity.z = -14;
  tick(p, 0.07, running);
  assert.equal(p.grounded, false);
  const takeoff = p.position.y;
  p.update(dt, { ...running, jump: true, jumpHeld: true }, 0);
  assert.ok(p.velocity.y > 9);
  assert.ok(p.position.y > takeoff);
});

test("a jump pressed just before landing is buffered until the floor", () => {
  const world = new CollisionWorld();
  floor(world);
  const p = playerAt(world, 0, 2.4);
  p.grounded = false;
  for (let i = 0; i < 100 && p.position.y > 0.22; i++) p.update(dt, neutral, 0);
  assert.equal(p.grounded, false);
  p.update(dt, { ...neutral, jump: true, jumpHeld: true }, 0);
  for (let i = 0; i < 15; i++) p.update(dt, { ...neutral, jumpHeld: true }, 0);
  assert.ok(p.velocity.y > 6);
  assert.ok(p.position.y > 0.4);
});

test("a reachable ledge is mantled without intersecting the solid roof", () => {
  const world = new CollisionWorld();
  floor(world, 20, -3);
  floor(world, -4, -25, 1.2);
  const p = playerAt(world, 0, 0.7, -3.5);
  p.grounded = false;
  p.velocity.set(0, -1, -6);
  p.update(dt, running, 0);
  assert.equal(p.traversal?.name, "MANTLE");
  for (let i = 0; i < 50; i++) {
    p.update(dt, running, 0);
    assert.equal(
      world.overlaps(p.position, p.height, 0.34),
      false,
      `clipped at ${p.position.toArray()}`,
    );
  }
  assert.ok(p.position.z < -4.5);
  assert.ok(Math.abs(p.position.y - 1.2) < 1e-8);
  assert.equal(p.grounded, true);
});

test("vaulting refuses a ceiling over the initial lift", () => {
  const world = new CollisionWorld();
  floor(world);
  world.add(0, 0.6, -2, 8, 1.2, 1, "vault");
  world.add(0, 2.8, 0, 3, 0.3, 1.3);
  const p = playerAt(world);
  p.update(dt, { ...running, vault: true }, 0);
  assert.equal(p.traversal, null);
});

test("right-side wall runs also work and cannot be extended indefinitely", () => {
  const world = new CollisionWorld();
  floor(world, 30, -10);
  world.add(1.5, 3.2, -45, 0.7, 6.4, 100, "wallrun");
  const p = playerAt(world, 0, 0, 4);
  tick(p, 0.9, running);
  let rightSide = false;
  for (let i = 0; i < 450; i++) {
    p.update(dt, { ...running, jump: i === 0, jumpHeld: true }, 0);
    rightSide ||= p.wallSide === 1;
  }
  assert.ok(rightSide);
  assert.equal(p.activeWall, null);
  assert.ok(p.position.y < -1);
});
