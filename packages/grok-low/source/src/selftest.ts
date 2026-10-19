import * as THREE from "three";
import { F_WALLRUN, HW, JUMP_V, LOOK_YAW, SPRINT_SPEED } from "./core/constants";
import { freshBot, botInput } from "./player/bot";
import { spawnPlayer, stepPlayer } from "./player/PlayerPhysics";
import { type PlayerInput } from "./player/types";
import { planarBasis } from "./player/basis";
import { CollisionWorld } from "./world/CollisionWorld";
import { sampleTriggers } from "./world/Checkpoints";
import { buildCollisionWorld, buildLevelSpec, solidToAabb, type Solid } from "./world/levelSpec";
import { validateLevel } from "./world/validateLevel";

const DT = 1 / 120;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

function near(v: number, target: number, eps: number, msg: string): void {
  assert(Math.abs(v - target) < eps, `${msg} (${v.toFixed(3)} vs ${target})`);
}

function floorSolid(x0: number, x1: number, z0: number, z1: number, y: number): Solid {
  const sx = x1 - x0;
  const sz = z1 - z0;
  return {
    x: (x0 + x1) / 2,
    y: y - 1,
    z: (z0 + z1) / 2,
    sx,
    sy: 1,
    sz,
    mat: "concrete",
    flags: 1,
  };
}

function run(inputAt: (t: number, s: ReturnType<typeof spawnPlayer>) => PlayerInput, s: ReturnType<typeof spawnPlayer>, world: CollisionWorld, seconds: number) {
  let t = 0;
  while (t < seconds) {
    stepPlayer(s, inputAt(t, s), world, DT);
    t += DT;
  }
}

function testBasis(): void {
  const yaw = new THREE.Object3D();
  const pitch = new THREE.Object3D();
  const roll = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera(78, 1, 0.08, 100);
  yaw.add(pitch);
  pitch.add(roll);
  roll.add(camera);

  // Canonical pose: rotation.y = 0 looks down −Z, and forward × up = +X.
  yaw.rotation.y = 0;
  yaw.updateMatrixWorld(true);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  planarBasis(camera, fwd, right);
  near(fwd.z, -1, 1e-4, "yaw 0 forward is −Z");
  near(fwd.x, 0, 1e-4, "yaw 0 forward has no X");
  near(right.x, 1, 1e-4, "yaw 0 right is +X");

  yaw.rotation.y = LOOK_YAW;
  yaw.updateMatrixWorld(true);
  planarBasis(camera, fwd, right);
  near(fwd.x, 1, 1e-4, "LOOK_YAW forward is +X");
  near(fwd.z, 0, 1e-4, "LOOK_YAW forward has no Z");
  near(right.z, 1, 1e-4, "LOOK_YAW right is +Z");

  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(-4, 30, -8, 8, 0), 1));
  const s = spawnPlayer(0, 0, 0);
  // Wish along the basis, the same numbers the game will pass in.
  run(() => ({ wishX: fwd.x, wishZ: fwd.z, sprint: true, jump: false, jumpHeld: false, slide: false, vault: false }), s, world, 0.6);
  assert(s.x > 4, `W along LOOK_YAW moves +X (x=${s.x.toFixed(2)})`);

  const s2 = spawnPlayer(0, 0, 0);
  run(() => ({ wishX: right.x, wishZ: right.z, sprint: false, jump: false, jumpHeld: false, slide: false, vault: false }), s2, world, 0.6);
  assert(s2.z > 2, `D along LOOK_YAW moves +Z (z=${s2.z.toFixed(2)})`);
}

function testFloorAndWall(): void {
  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(-2, 8, -4, 4, 0), 1));
  world.add(
    solidToAabb(
      { x: 5, y: 0, z: 0, sx: 0.4, sy: 3, sz: 4, mat: "white", flags: 1 },
      2,
    ),
  );
  const s = spawnPlayer(0, 0, 0);
  run(() => ({ wishX: 1, wishZ: 0, sprint: true, jump: false, jumpHeld: false, slide: false, vault: false }), s, world, 1.2);
  assert(s.x < 5 - HW + 0.05, `wall stops the player (x=${s.x.toFixed(2)})`);
  near(s.y, 0, 0.08, "feet stay on the floor");
  assert(Math.abs(s.vy) < 0.2, "not falling through the floor");
}

function testJump(): void {
  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(-2, 4, -3, 3, 0), 1));
  const s = spawnPlayer(0, 0, 0);
  let t = 0;
  let peak = 0;
  while (t < 1.2) {
    const jumping = t < 0.25;
    stepPlayer(
      s,
      { wishX: 0, wishZ: 0, sprint: false, jump: jumping, jumpHeld: jumping, slide: false, vault: false },
      world,
      DT,
    );
    peak = Math.max(peak, s.y);
    t += DT;
  }
  const expected = (JUMP_V * JUMP_V) / (2 * 24);
  near(peak, expected, 0.12, "jump height");
}

function testGap(): void {
  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(0, 6, -2, 2, 0), 1));
  world.add(solidToAabb(floorSolid(10.6, 40, -2, 2, 0), 2)); // 4.6 m gap
  const s = spawnPlayer(2, 0, 0);
  const mem = { jumped: false };
  run((_t, body) => {
    const edge = body.x > 5.5 && body.grounded && body.speed > 6;
    if (edge) mem.jumped = true;
    const hold = edge || (mem.jumped && body.mode === "air" && body.jumpAir < 0.2);
    return { wishX: 1, wishZ: 0, sprint: true, jump: hold, jumpHeld: hold, slide: false, vault: false };
  }, s, world, 2.5);
  assert(s.x > 12 && s.y > -0.2 && s.y < 0.4, `sprint clears a 4.6m gap (x=${s.x.toFixed(2)} y=${s.y.toFixed(2)})`);
}

function testNoTunnel(): void {
  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(-2, 20, -3, 3, 0), 1));
  world.add(solidToAabb({ x: 6, y: 0, z: 0, sx: 0.18, sy: 3, sz: 4, mat: "white", flags: 1 }, 2));
  const s = spawnPlayer(2, 0, 0);
  s.vx = 28;
  stepPlayer(s, { wishX: 1, wishZ: 0, sprint: true, jump: false, jumpHeld: false, slide: false, vault: false }, world, DT);
  assert(s.x < 6, `fast move does not tunnel a thin wall (x=${s.x.toFixed(2)})`);
}

function testSlide(): void {
  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(0, 30, -3, 3, 0), 1));
  world.add(solidToAabb({ x: 12, y: 1.05, z: 0, sx: 6, sy: 0.7, sz: 5, mat: "vent", flags: 1 }, 2));
  const standing = spawnPlayer(2, 0, 0);
  standing.vx = SPRINT_SPEED;
  run(() => ({ wishX: 1, wishZ: 0, sprint: true, jump: false, jumpHeld: false, slide: false, vault: false }), standing, world, 1.4);
  assert(standing.x < 12, `standing player is stopped by the duct (x=${standing.x.toFixed(2)})`);

  const sliding = spawnPlayer(2, 0, 0);
  sliding.vx = SPRINT_SPEED;
  run(() => ({ wishX: 1, wishZ: 0, sprint: true, jump: false, jumpHeld: false, slide: true, vault: false }), sliding, world, 2);
  assert(sliding.x > 16, `slide passes under the duct (x=${sliding.x.toFixed(2)} mode=${sliding.mode})`);
}

function testVault(): void {
  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(0, 16, -3, 3, 0), 1));
  world.add(solidToAabb({ x: 6, y: 0, z: 0, sx: 1.1, sy: 0.86, sz: 3, mat: "red", flags: 1 }, 2));
  const s = spawnPlayer(3.5, 0, 0);
  s.vx = 8;
  let vaulted = false;
  let t = 0;
  while (t < 2) {
    const ev = stepPlayer(
      s,
      { wishX: 1, wishZ: 0, sprint: true, jump: false, jumpHeld: false, slide: false, vault: s.x > 4.6 && s.x < 7.2 },
      world,
      DT,
    );
    if (ev.vault) vaulted = true;
    t += DT;
  }
  assert(vaulted, "vault started");
  assert(s.x > 8, `vault clears the block (x=${s.x.toFixed(2)})`);
}

function testWallRun(): void {
  const world = new CollisionWorld();
  world.add(solidToAabb(floorSolid(0, 10, -1, 5.4, 0), 1));
  world.add(
    solidToAabb(
      { x: 14, y: -8, z: 5.7 + 0.7, sx: 18, sy: 16, sz: 1.4, mat: "red", flags: F_WALLRUN },
      2,
    ),
  );
  world.add(solidToAabb(floorSolid(16, 80, -1, 5.5, -1.2), 3));
  const s = spawnPlayer(2, 0, 2);
  let t = 0;
  let attached = false;
  while (t < 4.5) {
    const nearEdge = s.x > 8.2 && s.grounded;
    const hold = nearEdge || (s.mode === "air" && s.jumpAir < 0.18);
    const ev = stepPlayer(
      s,
      {
        wishX: Math.abs(5.1 - s.z) > 0.8 ? 0.45 : 1,
        wishZ: 5.1 - s.z,
        sprint: true,
        jump: hold,
        jumpHeld: hold,
        slide: false,
        vault: false,
      },
      world,
      DT,
    );
    if (ev.wallOn) attached = true;
    t += DT;
    if (s.y < -6) break;
  }
  assert(attached, "wall run attached");
  assert(s.x > 18 && s.y > -1.6 && s.y < 0.5, `wall run lands on the far roof (x=${s.x.toFixed(2)} y=${s.y.toFixed(2)} z=${s.z.toFixed(2)} mode=${s.mode})`);
}

function testLevelAndBot(): void {
  const spec = buildLevelSpec();
  const world = buildCollisionWorld(spec);
  const problems = validateLevel(spec, world);
  for (const p of problems) console.error("LEVEL:", p);
  assert(problems.length === 0, `level validation (${problems.length} problems)`);

  console.log("gap budget:");
  for (let i = 0; i < spec.platforms.length - 1; i++) {
    const a = spec.platforms[i];
    const b = spec.platforms[i + 1];
    const gap = b.x0 - a.x1;
    console.log(
      `  ${a.id.padEnd(10)} ${gap.toFixed(2)}m  dy ${(b.y - a.y).toFixed(2)}  ${a.toNext}`,
    );
  }

  const s = spawnPlayer(spec.start.x, spec.start.y, spec.start.z);
  const mem = freshBot();
  let cp = 0;
  let t = 0;
  let deaths = 0;
  const trace: string[] = [];
  const limit = 110;
  while (t < limit && s.x < spec.finish.minX) {
    const input = botInput(s, spec, world, mem, DT);
    stepPlayer(s, input, world, DT);
    const trig = sampleTriggers(spec, s.x, s.y, s.z, cp);
    if (trig.checkpoint && trig.checkpoint.index > cp) cp = trig.checkpoint.index;
    if (s.y < -28) {
      deaths++;
      const c = spec.checkpoints[cp];
      const next = spawnPlayer(c.x, c.y, c.z);
      Object.assign(s, next);
      mem.hold = 0;
      mem.still = 0;
    }
    if (Math.floor(t / 0.25) !== Math.floor((t + DT) / 0.25)) {
      trace.push(
        `t=${t.toFixed(1)} x=${s.x.toFixed(1)} z=${s.z.toFixed(2)} y=${s.y.toFixed(2)} v=${s.speed.toFixed(1)} ${s.mode} cp=${cp} deaths=${deaths}`,
      );
      if (trace.length > 40) trace.shift();
    }
    t += DT;
  }
  const trig = sampleTriggers(spec, s.x, s.y, s.z, cp);
  const finished = s.x >= spec.finish.minX || trig.finish;
  if (!finished) {
    console.error("bot trace:");
    for (const line of trace) console.error(line);
  }
  assert(finished, `bot finishes the route in ${t.toFixed(1)}s, deaths=${deaths}, x=${s.x.toFixed(1)}`);
  assert(deaths <= 3, `bot deaths stay low (${deaths})`);
  assert(t < 100, `clean run is under 100s (${t.toFixed(1)})`);
}

function main(): void {
  testBasis();
  testFloorAndWall();
  testJump();
  testGap();
  testNoTunnel();
  testSlide();
  testVault();
  testWallRun();
  testLevelAndBot();
  if (failed > 0) {
    throw new Error(`${failed} assertion(s) failed`);
  }
  console.log("\nall self-tests passed");
}

main();
