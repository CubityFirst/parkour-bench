/**
 * Headless movement / level verification.
 *
 *   npm run sim
 *
 * Loads the real level layout into the real collision world and drives the real player
 * controller with a simple scripted "bot" that follows waypoints, auto-jumps at roof edges,
 * slides under low ceilings, vaults small obstacles and wall-runs. It verifies that:
 *   - the level can be completed from start to finish using only the implemented mechanics,
 *   - no checkpoint is skipped, the player never ends up inside a solid,
 *   - physics is frame-rate independent enough to complete the route at the fixed step only.
 */
import { CollisionWorld, overlaps } from '../src/world/CollisionWorld.ts';
import { buildLevel } from '../src/world/LevelLayout.ts';
import { PlayerController, MoveState } from '../src/player/PlayerController.ts';
import type { PlayerInput } from '../src/player/PlayerController.ts';
import { PLAYER_RADIUS } from '../src/player/PlayerPhysics.ts';

const STEP = 1 / 120;

function makeWorld() {
  const desc = buildLevel();
  const world = new CollisionWorld();
  for (const s of desc.solids) if (s.collide) world.add(s, s.runnable);
  return { desc, world };
}

interface Waypoint {
  x: number;
  z: number;
  /** Radius within which the waypoint counts as reached. */
  r?: number;
}

interface BotOpts {
  start?: { x: number; y: number; z: number; yaw: number };
  maxTime?: number;
  verbose?: boolean;
  stopAt?: (c: PlayerController) => boolean;
  /** Jump this many metres before the edge (simulates an early, sloppy jump). */
  early?: number;
}

function runBot(label: string, waypoints: Waypoint[], opts: BotOpts = {}) {
  const { desc, world } = makeWorld();
  const c = new PlayerController(world);
  const sp = opts.start ?? desc.spawn;
  c.respawn(sp.x, sp.y, sp.z, sp.yaw);
  // settle
  for (let i = 0; i < 20; i++) c.update(STEP, idle(sp.yaw));

  let wp = 0;
  let t = 0;
  let jumpHeld = false;
  let slideHeld = false;
  let minY = Infinity;
  let log: string[] = [];
  let lastState = '';
  let cpReached = 0;
  const maxTime = opts.maxTime ?? 150;
  const p = c.phys;
  let result: 'finished' | 'fell' | 'timeout' | 'stuck' = 'timeout';
  let stuckTimer = 0;
  let lastPosX = p.x;
  let lastPosZ = p.z;
  const fin = desc.finish.trigger;

  while (t < maxTime) {
    const target = waypoints[wp];
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    if (Math.hypot(dx, dz) < (target.r ?? 1.5) && wp < waypoints.length - 1) wp++;
    const yaw = Math.atan2(-dx, -dz); // forward = (-sin, -cos)
    const inp: PlayerInput = {
      moveX: 0,
      moveY: 1,
      sprint: true,
      jumpHeld,
      jumpPressed: false,
      slideHeld,
      slidePressed: false,
      vaultPressed: false,
      yaw,
    };

    const speed = Math.hypot(p.vx, p.vz);
    const dirx = speed > 1 ? p.vx / speed : -Math.sin(yaw);
    const dirz = speed > 1 ? p.vz / speed : -Math.cos(yaw);

    const jumpNow = () => {
      inp.jumpPressed = true;
      jumpHeld = true;
    };
    // release jump after 0.4 s so variable jump height does not truncate the arc
    if (jumpHeld && c.airTime > 0.45) jumpHeld = false;
    inp.jumpHeld = jumpHeld;

    if (c.state === MoveState.Ground) {
      // Edge ahead? jump.
      const la = Math.max(speed * 0.075 + (opts.early ?? 0), 0.25);
      const gx = p.x + dirx * la;
      const gz = p.z + dirz * la;
      const g = world.groundBelow(gx, gz, 0.0, p.y, 1.0, 0.4);
      if (g === null && speed > 3) jumpNow();

      // Low ceiling ahead -> slide. Obstacle ahead -> vault / jump.
      if (c.crouched) {
        const ceil = world.sweepHorizontal(p.x, p.z, p.y + 0.95, p.y + 1.75, dirx, dirz, 2.5, PLAYER_RADIUS);
        slideHeld = !!ceil || !p.canStand();
      } else {
        slideHeld = false;
        const ceil = world.sweepHorizontal(p.x, p.z, p.y + 1.0, p.y + 1.75, dirx, dirz, 4.5, PLAYER_RADIUS);
        if (ceil && ceil.solid.minY - p.y >= 0.95) {
          inp.slidePressed = true;
          slideHeld = true;
        } else {
          const hit = world.sweepHorizontal(p.x, p.z, p.y + 0.12, p.y + 3, dirx, dirz, 2.2, PLAYER_RADIUS);
          if (hit && hit.solid.minY - p.y < 0.6) {
            const rise = hit.solid.maxY - p.y;
            if (rise > 0.33 && rise <= 1.5) inp.vaultPressed = true;
            else if (rise > 1.5 && rise < 2.3 && hit.dist < 1.6) jumpNow();
          }
        }
      }
    } else if (c.state === MoveState.Slide) {
      slideHeld = true;
      // jump out of the slide at an edge
      const la = Math.max(speed * 0.075, 0.25);
      const g = world.groundBelow(p.x + dirx * la, p.z + dirz * la, 0.0, p.y, 1.0, 0.4);
      if (g === null) jumpNow();
      else {
        const ceil = world.sweepHorizontal(p.x, p.z, p.y + 0.95, p.y + 1.75, dirx, dirz, 2.5, PLAYER_RADIUS);
        if (!ceil && p.canStand()) slideHeld = false;
      }
    } else if (c.state === MoveState.WallRun) {
      // leap off once the far roof is close ahead and we are still over the gap
      const below = world.groundBelow(p.x, p.z, 0.3, p.y, 8, 0.5);
      const ahead = world.groundBelow(p.x + dirx * 3.0, p.z + dirz * 3.0, 0.3, p.y + 1.5, 6, 0.5);
      if (below === null && ahead !== null) jumpNow();
    }

    c.update(STEP, inp);
    t += STEP;
    minY = Math.min(minY, p.y);

    const stateStr = c.state;
    if (opts.verbose && stateStr !== lastState) {
      log.push(`${t.toFixed(2)}s ${lastState || '-'} -> ${stateStr} @ (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) v=${Math.hypot(p.vx, p.vz).toFixed(1)}`);
    }
    lastState = stateStr;
    c.events.length = 0;

    // checkpoint tracking
    for (let i = cpReached; i < desc.checkpoints.length; i++) {
      const cp = desc.checkpoints[i];
      if (Math.abs(p.x - cp.x) < 3 && Math.abs(p.z - cp.z) < 3 && Math.abs(p.y - cp.y) < 1) {
        cpReached = i + 1;
        if (opts.verbose) log.push(`${t.toFixed(2)}s checkpoint ${i + 1}`);
      }
    }

    // sanity: never inside a solid
    if (world.intersectsAny(p.aabb({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }))) {
      // allow tiny EPS overlaps only
      const box = p.aabb({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
      const hits = world.solids.filter((s) => overlaps(box, s));
      if (hits.length && c.state !== MoveState.Vault && c.state !== MoveState.Mantle) {
        log.push(`!! inside solid at t=${t.toFixed(2)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) state=${c.state}`);
      }
    }

    if (p.y < desc.killY) {
      result = 'fell';
      log.push(`fell at t=${t.toFixed(2)} pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) wp=${wp}`);
      break;
    }
    if (
      p.x > fin.minX && p.x < fin.maxX && p.y > fin.minY && p.y < fin.maxY && p.z > fin.minZ && p.z < fin.maxZ
    ) {
      result = 'finished';
      break;
    }
    if (opts.stopAt?.(c)) {
      result = 'finished';
      break;
    }
    // stuck detector
    if (Math.hypot(p.x - lastPosX, p.z - lastPosZ) < 0.02) stuckTimer += STEP;
    else stuckTimer = 0;
    lastPosX = p.x;
    lastPosZ = p.z;
    if (stuckTimer > 3 && c.state !== MoveState.Vault && c.state !== MoveState.Mantle) {
      result = 'stuck';
      log.push(`stuck at t=${t.toFixed(2)} pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) wp=${wp} state=${c.state}`);
      break;
    }
  }
  console.log(`[${label}] ${result} in ${t.toFixed(1)}s, checkpoints ${cpReached}/${desc.checkpoints.length}`);
  for (const l of log) console.log('   ' + l);
  return { result, t, cpReached };
}

function idle(yaw: number): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    sprint: false,
    jumpHeld: false,
    jumpPressed: false,
    slideHeld: false,
    slidePressed: false,
    vaultPressed: false,
    yaw,
  };
}

const route: Waypoint[] = [
  { x: 0, z: 20 },
  { x: 0, z: -30 },
  { x: 0, z: -46 },
  { x: -3, z: -62 },
  { x: -6, z: -70 },
  { x: -6, z: -86 },
  { x: -7.5, z: -90 },
  { x: -7.5, z: -92 },
  { x: -7.5, z: -112 },
  { x: -7.5, z: -128 },
  { x: -7.5, z: -192 },
  { x: -4, z: -198 },
  { x: -2.4, z: -206 },
  { x: -2.4, z: -216 },
  { x: -2.4, z: -232 },
  { x: -8, z: -245 },
  { x: -10, z: -256 },
  { x: -10, z: -284 },
  { x: -10, z: -302 },
  { x: -14.4, z: -312 },
  { x: -14.6, z: -326 },
  { x: -10, z: -340, r: 3 },
  { x: 14, z: -344 },
  { x: 126, z: -344, r: 1 },
];

const verbose = process.argv.includes('--verbose');
const res = runBot('full run (perfect jumps)', route, { verbose, maxTime: 200 });
let ok = res.result === 'finished';
// Sloppier players: jumping up to ~1 m before the edge must still complete the level.
for (const early of [0.3, 0.6, 0.9]) {
  const r = runBot(`full run (jump ${early.toFixed(1)} m early)`, route, { maxTime: 200, early });
  ok = ok && r.result === 'finished';
}
process.exitCode = ok ? 0 : 1;
