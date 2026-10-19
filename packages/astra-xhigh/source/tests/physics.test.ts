import assert from "node:assert/strict";
import { Vector3 } from "three";
import { PlayerController } from "../src/player/PlayerController";
import { CollisionWorld } from "../src/world/CollisionWorld";
import type { Input } from "../src/player/Input";

class TestInput {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  down(...keys: string[]) {
    return keys.some((k) => this.keys.has(k));
  }
  take(key: string) {
    const value = this.pressed.has(key);
    this.pressed.delete(key);
    return value;
  }
  clear() {
    this.keys.clear();
    this.clearTransient();
  }
  clearTransient() {
    this.pressed.clear();
    this.mouseX = 0;
    this.mouseY = 0;
  }
  press(key: string) {
    if (!this.keys.has(key)) this.pressed.add(key);
    this.keys.add(key);
  }
  release(key: string) {
    this.keys.delete(key);
  }
}
const dt = 1 / 120;
function fixture() {
  const world = new CollisionWorld();
  world.add(0, -1, 0, 100, 2, 150, "roof");
  const input = new TestInput();
  const p = new PlayerController(world, input as unknown as Input);
  p.position.set(0, 0, 0);
  return { world, input, p };
}
function tick(p: PlayerController, n: number) {
  for (let i = 0; i < n; i++) p.update(dt);
}
let checks = 0;
function test(name: string, fn: () => void) {
  fn();
  checks++;
  console.log(`✓ ${name}`);
}

test("Stable ground and smooth acceleration to sprint speed", () => {
  const { p, input } = fixture();
  tick(p, 120);
  assert(p.grounded);
  assert.equal(p.position.y, 0);
  input.press("KeyW");
  input.press("ShiftLeft");
  tick(p, 1);
  assert(p.speed < 1);
  tick(p, 120);
  assert(Math.abs(p.speed - 13.5) < 0.01);
});
test("Held jumps rise higher than released jumps", () => {
  function jump(release: boolean) {
    const { p, input } = fixture();
    tick(p, 2);
    input.press("Space");
    let apex = 0;
    for (let i = 0; i < 100; i++) {
      if (release && i === 8) input.release("Space");
      p.update(dt);
      apex = Math.max(apex, p.position.y);
    }
    return apex;
  }
  assert(jump(false) > jump(true) + 0.5);
});
test("A buffered jump fires on landing", () => {
  const { p, input } = fixture();
  p.position.y = 0.12;
  p.velocity.y = -3;
  input.press("Space");
  tick(p, 6);
  assert(p.velocity.y > 7);
});
test("Coyote time permits a jump just after leaving an edge", () => {
  const world = new CollisionWorld();
  world.add(0, -1, 3, 20, 2, 10, "roof");
  const input = new TestInput(),
    p = new PlayerController(world, input as unknown as Input);
  p.position.set(0, 0, 0);
  input.press("KeyW");
  input.press("ShiftLeft");
  while (p.position.z > -2.6) p.update(dt);
  input.press("Space");
  p.update(dt);
  assert(p.velocity.y > 8);
});
test("High-speed movement cannot tunnel through a thin wall", () => {
  const { p, input, world } = fixture();
  world.add(0, 2, -5, 10, 4, 0.2, "wall");
  input.press("KeyW");
  input.press("ShiftLeft");
  tick(p, 180);
  assert(p.position.z >= -4.581);
});
test("Slides pass a low ceiling and cannot stand up inside it", () => {
  const { p, input, world } = fixture();
  world.add(0, 1.75, -8, 10, 1.3, 3, "ceiling");
  input.press("KeyW");
  input.press("ShiftLeft");
  tick(p, 45);
  input.press("KeyC");
  tick(p, 30);
  input.release("KeyC");
  tick(p, 8);
  assert(p.height < 1.1);
  tick(p, 70);
  assert(p.position.z < -12);
  assert.equal(p.height, 1.8);
});
test("Vaulting moves over a low barrier and preserves momentum", () => {
  const { p, input, world } = fixture();
  world.add(0, 0.6, -3, 6, 1.2, 0.9);
  p.position.z = -1.6;
  p.velocity.z = -12;
  input.press("KeyW");
  input.press("ShiftLeft");
  input.press("KeyE");
  tick(p, 60);
  assert(p.position.z < -5);
  assert(p.speed > 8);
});
test("Wall running spans a gap that exceeds a normal jump", () => {
  const world = new CollisionWorld();
  world.add(0, -1, 3, 10, 2, 10, "roof");
  world.add(0, -1, -32, 10, 2, 14, "roof");
  world.add(-1.65, 3, -14, 0.65, 6, 30, "wall", true);
  const input = new TestInput(),
    p = new PlayerController(world, input as unknown as Input);
  p.position.set(0, 0, 3);
  input.press("KeyW");
  input.press("ShiftLeft");
  let wallSeen = false;
  for (let i = 0; i < 370; i++) {
    if (p.position.z < -0.5 && !input.keys.has("Space")) input.press("Space");
    p.update(dt);
    wallSeen ||= !!p.wallSide;
  }
  assert(wallSeen);
  assert(p.position.z < -26);
  assert(p.position.y >= -0.01);
});
test("Vaulting from contact clears the barrier throughout the animation", () => {
  const { p, input, world } = fixture();
  world.add(0, 0.6, -3, 6, 1.2, 0.9);
  p.position.z = -2.23;
  input.press("KeyE");
  for (let i = 0; i < 49; i++) {
    p.update(dt);
    assert(
      !world.overlaps(p.position, p.height),
      `Clipped at vault frame ${i}`,
    );
  }
  assert(p.position.z < -4);
});
test("Vaulting rejects tall walls and blocked landing areas", () => {
  const { p, input, world } = fixture();
  world.add(0, 2, -3, 6, 4, 0.9, "wall");
  p.position.z = -1.6;
  input.press("KeyE");
  tick(p, 2);
  assert.notEqual(p.state, "VAULT");
});
test("A reachable ledge recovers onto the rooftop", () => {
  const world = new CollisionWorld();
  world.add(0, -1, -5, 10, 2, 10, "roof");
  const input = new TestInput(),
    p = new PlayerController(world, input as unknown as Input);
  p.position.set(0, -0.7, 0.35);
  p.velocity.set(0, -1, -5);
  input.press("KeyW");
  tick(p, 45);
  assert(p.position.y >= 0);
  assert(p.position.z < 0);
});
test("Wall-running also works on the right side and wall jumps push away", () => {
  const world = new CollisionWorld();
  world.add(1.65, 3, -10, 0.65, 6, 30, "wall", true);
  const input = new TestInput(),
    p = new PlayerController(world, input as unknown as Input);
  p.position.set(0, 1, -2);
  p.velocity.set(0, 0, -12);
  input.press("KeyW");
  tick(p, 2);
  assert.equal(p.wallSide, -1);
  input.press("Space");
  p.update(dt);
  assert(p.velocity.x < -5);
  assert(p.velocity.y > 8);
});
test("Wall running expires without a landing", () => {
  const world = new CollisionWorld();
  world.add(-1.65, 3, -50, 0.65, 6, 150, "wall", true);
  const input = new TestInput(),
    p = new PlayerController(world, input as unknown as Input);
  p.position.set(0, 2, 0);
  p.velocity.set(0, 0, -12);
  input.press("KeyW");
  tick(p, 260);
  assert.equal(p.wallSide, 0);
  const initialY = p.position.y;
  tick(p, 120);
  assert(p.position.y < initialY - 5);
});
test("Respawning clears every transient movement state", () => {
  const { p, input } = fixture();
  p.velocity.set(5, -20, -12);
  p.sliding = true;
  p.wallSide = 1;
  p.height = 0.86;
  input.press("Space");
  p.reset(new Vector3(2, 42, -291));
  assert.equal(p.speed, 0);
  assert.equal(p.velocity.y, 0);
  assert.equal(p.height, 1.8);
  assert.equal(p.wallSide, 0);
  assert(!p.sliding);
  assert.equal(input.keys.size, 0);
});
test("Held sprint clears the assisted warm-up without E or C", () => {
  const { p, input, world } = fixture();
  world.add(0, 0.62, -12, 6, 1.24, 0.9).tutorialAssist = true;
  world.add(0, 1.72, -29, 8, 1.3, 2.4, "ceiling").tutorialAssist = true;
  p.position.z = 18;
  const events: string[] = [];
  p.onEvent = (event) => events.push(event);
  // A physical keydown occurs once, exactly like the production harness.
  input.press("KeyW");
  input.press("ShiftLeft");
  for (let i = 0; i < 600; i++) {
    p.update(dt);
    assert(!world.overlaps(p.position, p.height), `Clipped at frame ${i}`);
  }
  assert.deepEqual(events, ["vault", "slide"]);
  assert(p.position.z < -40);
  assert(p.speed > 12);
  assert.equal(p.state, "SPRINTING");
});
test("Later barriers still require manual vault input", () => {
  const { p, input, world } = fixture();
  world.add(0, 0.62, -12, 6, 1.24, 0.9);
  const events: string[] = [];
  p.onEvent = (event) => events.push(event);
  input.press("KeyW");
  input.press("ShiftLeft");
  tick(p, 300);
  assert(p.position.z > -12);
  assert(!events.includes("vault"));
  input.press("KeyE");
  tick(p, 100);
  assert(p.position.z < -15);
  assert(events.includes("vault"));
});
test("Checkpoint respawns preserve held movement without replaying actions", () => {
  const { p, input } = fixture();
  input.press("KeyW");
  input.press("ShiftLeft");
  input.press("Space");
  input.press("KeyE");
  p.reset(new Vector3(0, 0, 8), { preserveHeldInput: true });
  assert(input.down("KeyW") && input.down("ShiftLeft"));
  assert.equal(input.pressed.size, 0);
  tick(p, 120);
  assert(p.position.z < 0);
  assert.equal(p.position.y, 0);
  assert.equal(p.state, "SPRINTING");
});
console.log(`\n${checks} physics checks passed.`);
