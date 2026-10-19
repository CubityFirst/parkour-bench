import * as THREE from 'three';

declare const process: { exit(code: number): never };
import type { InputFrame } from './game/types';
import { PHYS } from './player/constants';
import { findVault, slideCeilingAhead } from './player/ParkourSystem';
import { PlayerController } from './player/PlayerController';
import { floorNear, type Solid } from './world/CollisionWorld';
import { buildCourse, courseSolids } from './world/course';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures += 1;
    console.error(`FAIL ${msg}`);
  } else {
    console.log(`ok   ${msg}`);
  }
}

function neutral(): InputFrame {
  return {
    forward: 0,
    strafe: 0,
    sprint: false,
    jumpHeld: false,
    jumpPressed: false,
    slide: false,
    vaultPressed: false,
  };
}

function solid(
  id: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  flags: { vaultable?: boolean; wallRun?: boolean } = {},
): Solid {
  return {
    id,
    minX: x - w / 2,
    maxX: x + w / 2,
    minY: y - h / 2,
    maxY: y + h / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    vaultable: !!flags.vaultable,
    wallRun: !!flags.wallRun,
  };
}

function basisOf(view: THREE.Object3D): { fx: number; fz: number; rx: number; rz: number } {
  view.updateMatrixWorld(true);
  const fwd = new THREE.Vector3();
  view.getWorldDirection(fwd);
  // Match Camera: look direction is local -Z. Plain objects report +Z.
  if (!(view as THREE.Camera).isCamera) fwd.negate();
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
  else fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  return { fx: fwd.x, fz: fwd.z, rx: right.x, rz: right.z };
}

function testBasis(): void {
  const view = new THREE.Camera();
  view.rotation.order = 'YXZ';
  view.rotation.set(0, 0, 0);
  const b = basisOf(view);
  assert(Math.abs(b.fz + 1) < 1e-4 && Math.abs(b.fx) < 1e-4, `yaw 0 looks down -Z (${b.fx.toFixed(3)}, ${b.fz.toFixed(3)})`);
  assert(Math.abs(b.rx - 1) < 1e-4, `right is +X (${b.rx.toFixed(3)})`);

  const floor = solid(1, 0, 5, 0, 60, 10, 60);
  const p = new PlayerController([floor], [], { x: 0, y: 10, z: 0, yaw: 0 }, -40);
  const frame = neutral();
  frame.forward = 1;
  frame.sprint = true;
  const z0 = p.z;
  const x0 = p.x;
  for (let i = 0; i < 40; i++) p.update(PHYS.fixedDt, frame);
  assert(p.z < z0 - 0.4, `W moves toward -Z (dz ${(p.z - z0).toFixed(2)})`);
  assert(Math.abs(p.x - x0) < 0.08, `W does not slide sideways (dx ${(p.x - x0).toFixed(3)})`);

  p.respawn(0);
  const right = neutral();
  right.strafe = 1;
  const x1 = p.x;
  for (let i = 0; i < 40; i++) p.update(PHYS.fixedDt, right);
  assert(p.x > x1 + 0.4, `D moves toward +X (dx ${(p.x - x1).toFixed(2)})`);

  p.respawn(0);
  p.yaw = Math.PI / 2;
  const turn = neutral();
  turn.forward = 1;
  turn.sprint = true;
  const x2 = p.x;
  for (let i = 0; i < 40; i++) p.update(PHYS.fixedDt, turn);
  assert(p.x < x2 - 0.4, `facing left, W moves toward -X (dx ${(p.x - x2).toFixed(2)})`);
}

function testCollision(): void {
  const floor = solid(1, 0, 1, 0, 30, 2, 30);
  const wall = solid(2, 0, 3, -4, 8, 6, 0.3);
  const p = new PlayerController([floor, wall], [], { x: 0, y: 2, z: 0, yaw: 0 }, -20);
  const frame = neutral();
  frame.forward = 1;
  frame.sprint = true;
  for (let i = 0; i < 240; i++) p.update(PHYS.fixedDt, frame);
  assert(p.z > wall.maxZ, `thin wall stops a sprint (z ${p.z.toFixed(2)} wall ${wall.maxZ.toFixed(2)})`);
  assert(p.y > 1.5, `player stays on the floor (y ${p.y.toFixed(2)})`);

  const p2 = new PlayerController([floor], [], { x: 0, y: 2, z: 0, yaw: 0 }, -20);
  const idle = neutral();
  for (let i = 0; i < 120; i++) p2.update(PHYS.fixedDt, idle);
  assert(Math.abs(p2.y - 2) < 0.05 && p2.grounded, `idle player remains grounded (y ${p2.y.toFixed(3)})`);
}

function testSlideClearance(): void {
  const floor = solid(1, 0, 1, -6, 16, 2, 24);
  const duct = solid(2, 0, 2 + 1.04 + 0.2, -4, 10, 0.4, 2.4);
  const solids = [floor, duct];
  const runner = new PlayerController(solids, [], { x: 0, y: 2, z: 0, yaw: 0 }, -20);
  const frame = neutral();
  frame.forward = 1;
  frame.sprint = true;
  frame.slide = true;
  let minClear = 99;
  for (let i = 0; i < 200; i++) {
    runner.update(PHYS.fixedDt, frame);
    if (runner.z < -2 && runner.z > -6) minClear = Math.min(minClear, runner.h);
  }
  assert(runner.z < duct.minZ - 0.3, `slide passes under the duct (z ${runner.z.toFixed(2)})`);
  assert(minClear < 1, `collision height drops while sliding (${minClear.toFixed(2)})`);

  const walker = new PlayerController(solids, [], { x: 0, y: 2, z: -1, yaw: 0 }, -20);
  const walk = neutral();
  walk.forward = 1;
  walk.sprint = true;
  for (let i = 0; i < 180; i++) walker.update(PHYS.fixedDt, walk);
  assert(walker.z > duct.maxZ - 0.2, `standing body is blocked by the duct (z ${walker.z.toFixed(2)})`);
}

function testJumpDistance(): void {
  const floor = solid(1, 0, 5, -20, 16, 10, 80);
  const p = new PlayerController([floor], [], { x: 0, y: 10, z: 8, yaw: 0 }, -30);
  const frame = neutral();
  frame.forward = 1;
  frame.sprint = true;
  frame.jumpHeld = true;
  let jumpedZ: number | null = null;
  let landedZ: number | null = null;
  for (let i = 0; i < 240; i++) {
    const t = i * PHYS.fixedDt;
    frame.jumpPressed = t > 1.15 && t < 1.15 + PHYS.fixedDt * 1.5;
    const ev = p.update(PHYS.fixedDt, frame);
    if (ev.jumped && jumpedZ === null) jumpedZ = p.z;
    if (jumpedZ !== null && ev.landed && landedZ === null) landedZ = p.z;
  }
  const dist = jumpedZ !== null && landedZ !== null ? jumpedZ - landedZ : -1;
  assert(dist > 5.7 && dist < 7.3, `flat sprint jump covers ${dist.toFixed(2)} m`);
}

function testWallRun(): void {
  // 10 m gap. A sprint jump covers about 6.2 m, so the far roof requires the wall.
  const roofA = solid(1, 0, 5, -6, 16, 10, 12);
  const roofB = solid(2, 0, 5, -33, 16, 10, 18);
  const wall = solid(3, 8.1 + 1.2, 15, -20, 2.4, 30, 40, { wallRun: true });
  const solids = [roofA, roofB, wall];
  const p = new PlayerController(solids, [], { x: 2, y: 10, z: -1, yaw: 0 }, -20);
  const frame = neutral();
  frame.forward = 1;
  frame.sprint = true;
  frame.jumpHeld = true;
  let sawWall = false;
  for (let i = 0; i < 500; i++) {
    p.syncView();
    const b = basisOf(p.view);
    const edge = distanceToEdge(solids, p.x, p.y, p.z, b.fx, b.fz);
    frame.strafe = p.x < wall.minX - 0.55 ? 1 : 0;
    frame.jumpPressed = p.grounded && edge < 1.3 && edge > 0 && wall.minX - p.x < 1.15;
    const ev = p.update(PHYS.fixedDt, frame);
    if (ev.wall || p.wallSide !== 0) sawWall = true;
    if (p.z < roofB.maxZ - 1 && p.y > 9) break;
  }
  assert(sawWall, 'wall run attaches');
  assert(
    p.z < roofB.maxZ - 1 && p.y > 9.4,
    `wall run reaches the far roof (x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} z ${p.z.toFixed(2)})`,
  );
}

function testVaultAndMantle(): void {
  const floor = solid(1, 0, 5, -8, 14, 10, 28);
  const bar = solid(2, 0, 10 + 0.44, -4, 8, 0.88, 0.7, { vaultable: true });
  const p = new PlayerController([floor, bar], [], { x: 0, y: 10, z: -3.15, yaw: 0 }, -5);
  const ahead = findVault([floor, bar], p.x, p.y, p.z, p.r, 0, -1, 10);
  assert(!!ahead, 'vault detector finds the red bar');
  const frame = neutral();
  frame.forward = 1;
  frame.sprint = true;
  frame.vaultPressed = true;
  for (let i = 0; i < 50; i++) {
    p.update(PHYS.fixedDt, frame);
    frame.vaultPressed = false;
  }
  assert(p.z < bar.minZ - 0.2, `vault clears the bar (z ${p.z.toFixed(2)})`);

  const low = solid(10, 0, 5, -4, 10, 10, 8);
  const high = solid(11, 0, 5.75, -24, 12, 11.5, 30);
  const climber = new PlayerController([low, high], [], { x: 0, y: 10.4, z: -8.35, yaw: 0 }, -5);
  climber.y = 10.4;
  climber.z = -8.35;
  climber.vy = 2;
  climber.vz = -6;
  climber.grounded = false;
  let mantled = false;
  let peak = climber.y;
  const air = neutral();
  air.forward = 1;
  air.sprint = true;
  for (let i = 0; i < 90; i++) {
    const ev = climber.update(PHYS.fixedDt, air);
    if (ev.mantle) mantled = true;
    peak = Math.max(peak, climber.y);
  }
  assert(
    mantled && climber.y > 11.2 && climber.z < high.maxZ,
    `mantle climbs the ledge (y ${climber.y.toFixed(2)} peak ${peak.toFixed(2)} z ${climber.z.toFixed(2)} mantle ${mantled})`,
  );
}

function distanceToEdge(solids: Solid[], x: number, y: number, z: number, fx: number, fz: number): number {
  for (let d = 0.25; d < 16; d += 0.25) {
    const hit = floorNear(solids, x + fx * d, z + fz * d, y, 0.55, 0.4);
    if (!hit) return d;
  }
  return 99;
}

function gapBeyond(solids: Solid[], x: number, y: number, z: number, fx: number, fz: number, edge: number): number {
  let gap = 0;
  for (let d = edge; d < edge + 16; d += 0.25) {
    const hit = floorNear(solids, x + fx * d, z + fz * d, y, 3.2, 2.5);
    if (hit) return gap;
    gap += 0.25;
  }
  return gap;
}

function nearestWall(solids: Solid[], x: number, z: number): { sign: number; dist: number } | null {
  let best: { sign: number; dist: number } | null = null;
  for (const s of solids) {
    if (!s.wallRun) continue;
    if (z < s.minZ - 2 || z > s.maxZ + 2) continue;
    const face = x <= s.minX ? s.minX : s.maxX;
    if (x > s.minX && x < s.maxX) continue;
    const dist = Math.abs(face - x);
    const sign = Math.sign(face - x);
    if (!best || dist < best.dist) best = { sign, dist };
  }
  return best;
}

function testCourse(): void {
  const course = buildCourse();
  const solids = courseSolids(course);
  console.log(`course platforms ${course.platforms.length} solids ${solids.length} kill ${course.killY}`);
  for (const p of course.platforms) {
    console.log(
      `  ${p.id.padEnd(8)} top ${p.top.toFixed(2)} x ${p.minX.toFixed(1)}..${p.maxX.toFixed(1)} z ${p.nearZ.toFixed(1)}..${p.farZ.toFixed(1)}`,
    );
  }

  const bot = new PlayerController(solids, course.triggers, course.spawn, course.killY);
  let deaths = 0;
  let finished = false;
  let stuck = 0;
  let lastZ = bot.z;
  const history: string[] = [];

  for (let i = 0; i < 60 * 130; i++) {
    bot.syncView();
    const b = basisOf(bot.view);
    const edge = distanceToEdge(solids, bot.x, bot.y, bot.z, b.fx, b.fz);
    const gap = edge < 90 ? gapBeyond(solids, bot.x, bot.y, bot.z, b.fx, b.fz, edge) : 0;
    const wall = nearestWall(solids, bot.x, bot.z);
    const frame = neutral();
    frame.forward = 1;
    frame.sprint = true;
    frame.jumpHeld = true;
    if (slideCeilingAhead(solids, bot.x, bot.y, bot.z, bot.r, b.fx, b.fz)) frame.slide = true;
    const vault = findVault(solids, bot.x, bot.y, bot.z, bot.r, b.fx, b.fz, bot.speed);
    if (vault && (bot.grounded || true)) frame.vaultPressed = true;

    const wallGap = gap > 6.3 && wall && edge < 26;
    if (wallGap && wall) {
      if (wall.dist > 0.7) {
        frame.strafe = wall.sign;
        frame.forward = wall.dist > 2 ? 0.45 : 1;
      }
      if (bot.grounded && edge < 1.15 && wall.dist < 1.35) frame.jumpPressed = true;
    } else if (bot.grounded && edge < 1.0 && gap > 1.2 && gap < 6.3) {
      frame.jumpPressed = true;
      if (Math.abs(bot.x) > 3) frame.strafe = bot.x > 0 ? -1 : 1;
    } else if (Math.abs(bot.x) > 3) {
      frame.strafe = bot.x > 0 ? -1 : 1;
    }

    if (stuck > 90 && bot.grounded) {
      frame.jumpPressed = true;
      frame.strafe = i % 120 < 60 ? 1 : -1;
      frame.slide = false;
    }

    const ev = bot.update(PHYS.fixedDt, frame);
    if (ev.respawn) deaths += 1;
    if (ev.finish) {
      finished = true;
      break;
    }
    if (Math.abs(bot.z - lastZ) < 0.02 && Math.abs(bot.vx) + Math.abs(bot.vz) < 1.5) stuck += 1;
    else stuck = 0;
    lastZ = bot.z;
    if (i % 120 === 0) {
      history.push(
        `${(i / 60).toFixed(0)}s z ${bot.z.toFixed(1)} x ${bot.x.toFixed(1)} y ${bot.y.toFixed(1)} v ${bot.speed.toFixed(1)} cp ${bot.checkpoint} deaths ${deaths}`,
      );
    }
    if (deaths > 8) break;
  }

  console.log(history.join('\n'));
  console.log(`end x ${bot.x.toFixed(2)} y ${bot.y.toFixed(2)} z ${bot.z.toFixed(2)} deaths ${deaths} finished ${finished}`);
  assert(finished, 'course bot reaches the finish');
  assert(deaths <= 4, `course bot deaths ${deaths}`);
}

testBasis();
testCollision();
testSlideClearance();
testJumpDistance();
testWallRun();
testVaultAndMantle();
testCourse();

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log('all checks passed');
