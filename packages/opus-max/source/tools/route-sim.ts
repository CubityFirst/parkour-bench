/**
 * Headless route test: a scripted "bot" runs the whole level with the real player
 * controller, physics and collision code (no rendering), and reports checkpoint splits.
 * It proves the level is completable with the actual movement values.
 *
 *   npm run sim            (Node 22.18+ / 23.6+, which run TypeScript directly)
 *   npm run sim -- -v      verbose: log every movement event
 */
import { buildLevelDef, yawToward, type ZoneDef } from '../src/world/LevelData.ts';
import { buildCollisionWorld } from '../src/world/buildCollision.ts';
import { generateCity } from '../src/world/CityGenerator.ts';
import { PlayerController, emptyInput, MODE_NAMES } from '../src/player/PlayerController.ts';
import { makeZipline } from '../src/player/ParkourSystem.ts';

declare const process: { exit(code?: number): never; argv: string[] };

const DT = 1 / 120;
const verbose = process.argv.includes('-v');

type Action = 'jump' | 'slide' | 'unslide' | 'interact';
interface Waypoint {
  x: number;
  z: number;
  act?: Action;
  /** Reach radius (default 0.6 m). */
  r?: number;
  label?: string;
}

/** The racing line. Actions fire when the waypoint is reached (or passed). */
const ROUTE: Waypoint[] = [
  // 1. Tutorial
  { x: 0, z: -44.3, act: 'jump', label: 'vault barrier' },
  { x: 0, z: -52.5, act: 'slide', label: 'slide duct' },
  { x: 0, z: -59, act: 'unslide' },
  { x: 0, z: -65.5, act: 'jump', label: 'short gap' },
  // 2. Rooftop jumps
  { x: 0, z: -83.5, act: 'jump', label: 'A2 -> A3' },
  { x: 1, z: -103.5, act: 'jump', label: 'climb A4' },
  { x: 0, z: -122.5, act: 'jump', label: 'drop to A5' },
  { x: 8, z: -137 },
  { x: 16, z: -140 },
  { x: 26, z: -140, label: 'bridge' },
  // 3. Slide corridor
  { x: 31.5, z: -140, act: 'slide', label: 'ducts 1-2' },
  { x: 41.5, z: -140, act: 'unslide' },
  { x: 45, z: -140, act: 'slide', label: 'wide duct' },
  { x: 52.5, z: -140, act: 'unslide' },
  { x: 56, z: -140, act: 'slide', label: 'ducts 4-6' },
  { x: 68.5, z: -140, act: 'unslide' },
  // 4. Wall run on W1 (wall on the left)
  { x: 76, z: -146.5 },
  { x: 85.5, z: -148.3, act: 'jump', label: 'wall run W1' },
  { x: 99.5, z: -148.3, r: 1.2 },
  // 5. Combination
  { x: 104, z: -145 },
  { x: 109.0, z: -144.2, act: 'jump', label: 'vault C1 barrier' },
  { x: 120.6, z: -144, act: 'jump', label: 'jump to beam' },
  { x: 136.5, z: -144, label: 'beam end' },
  { x: 147, z: -134.5 },
  { x: 155.6, z: -132.3, act: 'jump', label: 'wall run W2' },
  { x: 169.5, z: -132.3, r: 1.2 },
  { x: 172, z: -140 },
  { x: 174.6, z: -140, act: 'slide', label: 'slide pipe' },
  { x: 179, z: -140, act: 'unslide' },
  { x: 189.4, z: -140, act: 'jump', label: 'climb E1' },
  { x: 197, z: -150 },
  { x: 202, z: -158.4, act: 'interact', r: 0.35, label: 'zipline' },
  // 6. Final sprint
  { x: 202, z: -228, r: 1.0 },
  { x: 202, z: -251.5, act: 'jump', label: 'F1 -> F2' },
  { x: 202, z: -261.6, act: 'jump', label: 'vault F2 barrier' },
  { x: 202, z: -268.5, act: 'jump', label: 'F2 -> F3' },
  { x: 202, z: -296, label: 'finish' },
];

const inZone = (z: ZoneDef, x: number, y: number, zz: number) =>
  x >= z.min[0] && x <= z.max[0] && y >= z.min[1] && y <= z.max[1] && zz >= z.min[2] && zz <= z.max[2];

const def = buildLevelDef();
const city = generateCity(def);
const world = buildCollisionWorld(def, city.colliders);
const player = new PlayerController(world);
player.ziplines = def.ziplines.map((z) => makeZipline(z.a, z.b));
player.respawn(def.spawn.pos[0], def.spawn.pos[1], def.spawn.pos[2]);

const input = emptyInput();
let yaw = def.spawn.yaw;
let wi = 0;
let crouchHeld = false;
let jumpHold = 0;
let nextCheckpoint = 0;
let t = 0;
let prevX = player.position.x;
let prevZ = player.position.z;
let maxSpeed = 0;
let failed = '';

const fmt = (s: number) => s.toFixed(2).padStart(6);
const where = () => {
  const p = player.position;
  return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) v=${player.horizontalSpeed.toFixed(2)} vy=${player.velocity.y.toFixed(2)} ${MODE_NAMES[player.mode]}`;
};

console.log(`Route sim: ${def.solids.length} level solids, ${city.colliders.length} city colliders, ${world.colliders.length} colliders total`);

for (let step = 0; step < 240 / DT; step++) {
  t += DT;
  const p = player.position;
  input.jumpPressed = false;
  input.crouchPressed = false;
  input.interactPressed = false;

  const wp = ROUTE[wi];
  if (wp) {
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    // "Passed" test against the segment from the previous waypoint.
    const prev = wi > 0 ? ROUTE[wi - 1] : { x: def.spawn.pos[0], z: def.spawn.pos[2] };
    const sx = wp.x - prev.x;
    const sz = wp.z - prev.z;
    const passed = (p.x - wp.x) * sx + (p.z - wp.z) * sz > 0;
    if (d < (wp.r ?? 0.6) || (passed && wp.act !== 'interact')) {
      if (wp.label && verbose) console.log(`${fmt(t)}s  reached "${wp.label}" at ${where()}`);
      switch (wp.act) {
        case 'jump':
          input.jumpPressed = true;
          jumpHold = 0.3;
          break;
        case 'slide':
          input.crouchPressed = true;
          crouchHeld = true;
          break;
        case 'unslide':
          crouchHeld = false;
          break;
        case 'interact':
          input.interactPressed = true;
          break;
      }
      wi++;
    } else if (d > 0.05) {
      yaw = yawToward(dx, dz);
    }
  }

  input.yaw = yaw;
  input.moveZ = 1;
  input.sprint = true;
  input.crouchHeld = crouchHeld;
  input.jumpHeld = jumpHold > 0;
  jumpHold -= DT;

  player.step(input, DT);
  maxSpeed = Math.max(maxSpeed, player.horizontalSpeed);

  for (const e of player.events) {
    if (!verbose && e.type !== 'land') continue;
    if (e.type === 'footstep') continue;
    const extra = e.type === 'land' ? ` impact=${e.impact.toFixed(1)}${e.hard ? ' HARD' : ''}` : '';
    if (verbose || (e.type === 'land' && e.hard)) console.log(`${fmt(t)}s    ${e.type}${extra}  ${where()}`);
  }
  player.events.length = 0;

  const cp = def.checkpoints[nextCheckpoint];
  if (cp && inZone(cp.zone, p.x, p.y, p.z)) {
    console.log(`${fmt(t)}s  CHECKPOINT ${nextCheckpoint + 1}/${def.checkpoints.length} "${cp.name}"`);
    nextCheckpoint++;
  }
  if (inZone(def.finish.zone, p.x, p.y, p.z)) {
    console.log(`${fmt(t)}s  FINISH  (max speed ${maxSpeed.toFixed(1)} m/s)`);
    break;
  }
  if (p.y < def.killY) {
    failed = `fell at ${where()} heading for waypoint #${wi} ${ROUTE[wi]?.label ?? ''}`;
    break;
  }
  // Stuck detection: no progress for 3 s.
  if (step % 360 === 0 && step > 0) {
    if (Math.hypot(p.x - prevX, p.z - prevZ) < 0.5 && player.mode !== 6) {
      failed = `stuck at ${where()} heading for waypoint #${wi} ${ROUTE[wi]?.label ?? ''}`;
      break;
    }
    prevX = p.x;
    prevZ = p.z;
  }
}

if (failed || nextCheckpoint < def.checkpoints.length) {
  console.log(`FAILED after ${t.toFixed(2)}s: ${failed || 'timed out'}`);
  process.exit(1);
}
console.log(`OK: route completed in ${t.toFixed(2)}s`);
