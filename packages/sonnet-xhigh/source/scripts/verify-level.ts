/**
 * Headless level verifier.
 *
 * Replays the level's annotated `route` (see LevelSpec.ts) through the *real* player
 * controller and physics at the game's fixed time step, and reports whether the level
 * can be completed. It also measures how forgiving each jump is (how early the player may
 * press jump and still make it) and proves that the wall-run gaps cannot be crossed
 * with a plain jump.
 *
 *   npm run verify
 */

import { MOVE } from '../src/player/MovementConfig';
import { makePlayerInput, PlayerController } from '../src/player/PlayerController';
import { buildLevelSpec, type LevelSpec, type RouteWaypoint } from '../src/world/LevelSpec';
import { createCollisionWorld } from '../src/world/buildWorld';

// Minimal typing for the Node globals used here (keeps the project free of @types/node).
declare const process: { argv: string[]; exit(code: number): never };

const DT = 1 / 120;

interface RunOptions {
  /** Per-waypoint extra "early" distance for jump-type actions. */
  early?: Map<number, number>;
  /** Replace wall-run waypoints with plain jumps from the lane centre. */
  noWallRun?: boolean;
  verbose?: boolean;
  maxTime?: number;
}

interface RunResult {
  ok: boolean;
  time: number;
  failedAt: number;
  reason: string;
  log: string[];
  checkpointsPassed: number;
  finalPos: [number, number, number];
}

function inside(x: number, y: number, z: number, min: number[], max: number[]): boolean {
  return x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2];
}

function run(spec: LevelSpec, opts: RunOptions = {}): RunResult {
  const world = createCollisionWorld(spec);
  if (opts.noWallRun) {
    // Make every wall non-runnable: the level must then be impossible to finish.
    for (const b of world.boxes) if (b.flags.wallRun) b.flags = { ...b.flags, wallRun: false };
  }
  const player = new PlayerController(world);
  const p = player.physics;
  const log: string[] = [];
  const input = makePlayerInput();

  player.respawn(spec.spawn.pos[0], spec.spawn.pos[1], spec.spawn.pos[2]);
  let yaw = spec.spawn.yaw;

  const route: RouteWaypoint[] = spec.route.map((w) => ({ ...w }));

  let idx = 0;
  let t = 0;
  let jumpHoldUntil = 0;
  let slideHoldUntil = 0;
  let pendingJump = false;
  let pendingSlide = false;
  let pendingInteract = false;
  let cps = 0;
  const cpHit = new Set<number>();
  const maxTime = opts.maxTime ?? 240;
  let lastIdxChange = 0;

  player.listener = {
    onLand: (impact) => { if (opts.verbose && impact > 6) log.push(`t=${t.toFixed(2)} land impact=${impact.toFixed(1)} at (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) speed=${p.horizontalSpeed.toFixed(1)}`); },
    onVault: () => { if (opts.verbose) log.push(`t=${t.toFixed(2)} vault`); },
    onMantle: () => { if (opts.verbose) log.push(`t=${t.toFixed(2)} mantle`); },
    onWallRunStart: (side) => { if (opts.verbose) log.push(`t=${t.toFixed(2)} wallrun start side=${side} speed=${p.horizontalSpeed.toFixed(1)}`); },
    onWallRunEnd: () => { if (opts.verbose) log.push(`t=${t.toFixed(2)} wallrun end at (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) vy=${p.vy.toFixed(1)}`); },
    onSlideStart: () => { if (opts.verbose) log.push(`t=${t.toFixed(2)} slide start speed=${p.horizontalSpeed.toFixed(1)}`); },
  };

  let prevWp: [number, number, number] = [p.x, p.y, p.z];
  const result = (ok: boolean, reason: string): RunResult => ({
    ok, time: t, failedAt: idx, reason, log, checkpointsPassed: cps, finalPos: [p.x, p.y, p.z],
  });

  while (t < maxTime) {
    const wp = route[idx];
    if (!wp) break;

    // steer towards the waypoint
    const dx = wp.pos[0] - p.x;
    const dz = wp.pos[2] - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) yaw = Math.atan2(-dx, -dz);

    // progress along the approach direction (prev waypoint -> this waypoint)
    let ax = wp.pos[0] - prevWp[0];
    let az = wp.pos[2] - prevWp[2];
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const remaining = dx * ax + dz * az;
    const early = (wp.action === 'jump' || wp.action === 'wallrun') ? (opts.early?.get(idx) ?? 0) : 0;
    const vaultLead = wp.action === 'vault' || wp.action === 'slide' ? 0.0 : 0;
    const reached = remaining <= early + vaultLead || dist < 0.35;

    if (reached) {
      if (wp.action === 'jump' || wp.action === 'wallrun') {
        pendingJump = true;
        jumpHoldUntil = t + (wp.hold ?? 0.7);
      } else if (wp.action === 'slide') {
        pendingSlide = true;
        slideHoldUntil = t + 1.15;
      } else if (wp.action === 'vault') {
        pendingInteract = true;
      }
      if (opts.verbose) log.push(`t=${t.toFixed(2)} wp#${idx} ${wp.action}${wp.note ? ' (' + wp.note + ')' : ''} pos=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) speed=${p.horizontalSpeed.toFixed(1)}`);
      prevWp = wp.pos;
      idx++;
      lastIdxChange = t;
    }

    input.moveX = 0;
    input.moveZ = 1;
    input.sprint = true;
    input.jumpPressed = pendingJump;
    input.slidePressed = pendingSlide;
    input.interactPressed = pendingInteract;
    input.jumpHeld = t < jumpHoldUntil;
    input.slideHeld = t < slideHoldUntil;
    pendingJump = pendingSlide = pendingInteract = false;

    player.update(DT, input, yaw);
    t += DT;

    // checkpoints
    for (const cp of spec.checkpoints) {
      if (!cpHit.has(cp.index) && inside(p.x, p.y + 0.5, p.z, cp.triggerMin, cp.triggerMax)) {
        cpHit.add(cp.index);
        cps++;
      }
    }
    if (p.y < MOVE.killHeight) return result(false, `fell at wp#${idx - 1}/${idx} (${route[Math.max(0, idx - 1)]?.note ?? route[Math.max(0, idx - 1)]?.action}) near (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
    if (t - lastIdxChange > 12) return result(false, `stuck before wp#${idx} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
    if (inside(p.x, p.y + 0.5, p.z, spec.finish.triggerMin, spec.finish.triggerMax)) {
      return result(true, 'finished');
    }
  }
  return result(false, 'timeout');
}

// ------------------------------------------------------------------------------------

const spec = buildLevelSpec();
const jumpIdx: number[] = [];
spec.route.forEach((w, i) => { if (w.action === 'jump' || w.action === 'wallrun') jumpIdx.push(i); });

console.log('=== ROOFTOP FLOW level verification ===');
console.log(`parts: ${spec.parts.length}, colliders: ${spec.parts.filter((p) => p.collide).length}, route points: ${spec.route.length}, checkpoints: ${spec.checkpoints.length}`);

const main = run(spec, { verbose: process.argv.includes('-v') });
if (process.argv.includes('-v')) console.log(main.log.join('\n'));
console.log(`\nFull route: ${main.ok ? 'PASS' : 'FAIL'}  time=${main.time.toFixed(1)}s  checkpoints=${main.checkpointsPassed}/${spec.checkpoints.length}  ${main.reason}`);

let failures = main.ok ? 0 : 1;

// Wall-run necessity: replacing the wall-run take-offs by plain jumps must fail at the first one.
const noWall = run(spec, { noWallRun: true });
console.log(`Without wall-running: ${noWall.ok ? 'PASS (WALL RUN NOT REQUIRED!)' : 'blocked as intended'} -> ${noWall.reason}`);
if (noWall.ok) failures++;

if (main.ok) {
  console.log('\nJump forgiveness (max metres early the jump key can be pressed, and metres late via coyote time):');
  for (const i of jumpIdx) {
    const w = spec.route[i];
    const test = (early: number): boolean => run(spec, { early: new Map([[i, early]]) }).ok;
    let early = 0;
    if (test(0)) {
      let lo = 0, hi = 4;
      if (test(hi)) lo = hi;
      else {
        for (let k = 0; k < 7; k++) {
          const mid = (lo + hi) / 2;
          if (test(mid)) lo = mid; else hi = mid;
        }
      }
      early = lo;
    } else { early = -1; }
    let late = 0;
    for (const l of [0.3, 0.6, 0.9, 1.2]) { if (test(-l)) late = l; else break; }
    const tag = `#${i} ${w.action}${w.note ? ' [' + w.note + ']' : ''} @(${w.pos[0].toFixed(0)},${w.pos[1].toFixed(1)},${w.pos[2].toFixed(0)})`;
    const status = early < 0 ? 'FAILS' : `early ${early.toFixed(2)} m, late ${late.toFixed(1)} m`;
    console.log(`  ${tag.padEnd(58)} ${status}`);
    if (early < 0.5) failures++;
  }
}

// ------------------------------------------------------------------------------------
// Collision fuzz test: random inputs from every checkpoint. The player must never end up
// inside geometry, never produce NaNs and never exceed a sane speed.
// ------------------------------------------------------------------------------------
function fuzz(spec: LevelSpec, seed: number, seconds: number): string | null {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const world = createCollisionWorld(spec);
  const player = new PlayerController(world);
  const p = player.physics;
  const input = makePlayerInput();
  const cps = spec.checkpoints;
  const cp = cps[Math.floor(rnd() * cps.length)];
  player.respawn(cp.pos[0], cp.pos[1], cp.pos[2]);
  let yaw = cp.yaw;
  let hold = 0;
  const steps = Math.round(seconds / DT);
  const hits: import('../src/world/CollisionWorld').Box[] = [];
  for (let i = 0; i < steps; i++) {
    if (hold <= 0) {
      hold = Math.floor(rnd() * 90) + 10;
      input.moveZ = rnd() < 0.8 ? 1 : (rnd() < 0.5 ? 0 : -1);
      input.moveX = rnd() < 0.6 ? 0 : (rnd() < 0.5 ? -1 : 1);
      input.sprint = rnd() < 0.8;
      input.jumpHeld = rnd() < 0.5;
      input.slideHeld = rnd() < 0.2;
      yaw += (rnd() - 0.5) * 1.6;
    }
    hold--;
    input.jumpPressed = rnd() < 0.015;
    if (input.jumpPressed) input.jumpHeld = true;
    input.slidePressed = rnd() < 0.01;
    if (input.slidePressed) input.slideHeld = true;
    input.interactPressed = rnd() < 0.02;
    player.update(DT, input, yaw);
    if (p.y < MOVE.killHeight) return null; // fell off: a legitimate outcome
    if (![p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite)) return `NaN at step ${i}`;
    if (p.horizontalSpeed > 20) return `speed ${p.horizontalSpeed.toFixed(1)} at step ${i}`;
    const r = p.radius;
    world.query(p.x - r + 0.006, p.y + 0.006, p.z - r + 0.006, p.x + r - 0.006, p.y + p.height - 0.006, p.z + r - 0.006, hits);
    if (hits.length > 0) {
      return `inside geometry (${hits[0].flags.label ?? hits[0].id}) at step ${i} state=${player.state} pos=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`;
    }
  }
  return null;
}

console.log('\nCollision fuzz test (random input from random checkpoints):');
let fuzzFailures = 0;
const fuzzArg = process.argv.find((a) => a.startsWith('--fuzz='));
const FUZZ_RUNS = fuzzArg ? Number(fuzzArg.slice(7)) : 60;
for (let i = 0; i < FUZZ_RUNS; i++) {
  const err = fuzz(spec, 1000 + i * 7919, 40);
  if (err) {
    fuzzFailures++;
    console.log(`  run ${i}: ${err}`);
  }
}
console.log(`  ${FUZZ_RUNS - fuzzFailures}/${FUZZ_RUNS} runs clean`);
failures += fuzzFailures;

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
