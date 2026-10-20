// Random-input fuzz test of the movement + collision code on the real level geometry.
// Asserts, on every simulated tick: finite state, the body never overlaps a collider (outside scripted
// vault / mantle curves), the depenetration safety net is never needed, and tunnelling never happens.
//   node tools/fuzz.mjs [trials=300] [secondsPerTrial=40] [seed=1]
import { createLevelLayout } from '../src/world/LevelLayout.ts';
import { PlayerController, createInput } from '../src/player/PlayerController.ts';
import { FIXED_DT, PLAYER } from '../src/config.ts';
import { Rng } from '../src/utils/Rng.ts';
import { buildWorld } from './route-bot.mjs';

const trials = Number(process.argv[2] ?? 300);
const seconds = Number(process.argv[3] ?? 40);
const baseSeed = Number(process.argv[4] ?? 1);

const layout = createLevelLayout();
const world = buildWorld(layout);

// Candidate spawn spots: the middle of every walkable roof (named R*/roof colliders), a little above the top.
const spawns = world.colliders
  .filter((c) => /^R\d|runway|plaza|landing|climb|pillar|alley|finish|service|start/i.test(c.label) && c.maxX - c.minX > 3 && c.maxZ - c.minZ > 3)
  .map((c) => ({ x: (c.minX + c.maxX) / 2, y: c.maxY, z: (c.minZ + c.maxZ) / 2, hx: (c.maxX - c.minX) / 2, hz: (c.maxZ - c.minZ) / 2, label: c.label }));
if (spawns.length < 10) throw new Error(`only ${spawns.length} spawn spots found`);

const hw = PLAYER.halfWidth;
let failures = 0;
const totals = { ticks: 0, jumps: 0, slides: 0, vaults: 0, mantles: 0, wallRuns: 0, lands: 0, respawns: 0, bumps: 0 };

function overlapping(b) {
  return world.firstOverlap(b.x - hw + 1e-6, b.y + 1e-6, b.z - hw + 1e-6, b.x + hw - 1e-6, b.y + b.height - 1e-6, b.z + hw - 1e-6);
}

for (let trial = 0; trial < trials; trial++) {
  const rng = new Rng(baseSeed * 100003 + trial);
  const spot = spawns[Math.floor(rng.next() * spawns.length)];
  const sx = spot.x + (rng.next() - 0.5) * spot.hx;
  const sz = spot.z + (rng.next() - 0.5) * spot.hz;
  const ctrl = new PlayerController(world);
  ctrl.reset(sx, spot.y, sz);
  const b = ctrl.body;
  const input = createInput();
  input.yaw = rng.next() * Math.PI * 2;
  const ev = (name, key) => ctrl.events.on(name, () => (totals[key] += 1));
  ev('jump', 'jumps');
  ev('slideStart', 'slides');
  ev('wallRunStart', 'wallRuns');
  ev('land', 'lands');
  ev('bump', 'bumps');
  ctrl.events.on('scriptedStart', (p) => (totals[p.kind === 'vault' ? 'vaults' : 'mantles'] += 1));

  // Random "player intent" that changes every 0.1 - 1.2 s.
  let hold = 0;
  let turnRate = 0;
  const n = Math.round(seconds / FIXED_DT);
  let rescuesAtStart = b.rescues;
  for (let i = 0; i < n; i++) {
    if (hold <= 0) {
      hold = rng.range(0.1, 1.2) / FIXED_DT;
      input.moveY = rng.chance(0.78) ? 1 : rng.chance(0.5) ? 0 : -1;
      input.moveX = rng.chance(0.7) ? 0 : rng.chance(0.5) ? 1 : -1;
      input.sprint = rng.chance(0.8);
      input.slideHeld = rng.chance(0.18);
      input.jumpHeld = rng.chance(0.5);
      turnRate = rng.chance(0.5) ? 0 : rng.range(-3, 3);
    }
    hold--;
    input.yaw += turnRate * FIXED_DT;
    input.jumpPressed = rng.chance(0.012);
    if (input.jumpPressed) input.jumpHeld = true;
    input.slidePressed = rng.chance(0.006);
    input.vaultPressed = rng.chance(0.01);
    ctrl.update(FIXED_DT, input);
    totals.ticks++;

    const bad = (what) => {
      failures++;
      console.log(`FAIL trial ${trial} tick ${i} (${what}) at ${spot.label}: pos=(${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.z.toFixed(3)}) v=(${b.vx.toFixed(2)}, ${b.vy.toFixed(2)}, ${b.vz.toFixed(2)}) state=${ctrl.state}`);
    };
    if (![b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite)) {
      bad('non-finite state');
      break;
    }
    if (ctrl.state !== 'scripted') {
      const o = overlapping(b);
      if (o) {
        bad(`body overlaps collider "${o.label}"`);
        break;
      }
    }
    if (b.rescues > rescuesAtStart) {
      bad('depenetration safety net was needed');
      break;
    }
    // Fell out of the world: count a respawn and put the player back (what the game does).
    if (b.y < 20) {
      totals.respawns++;
      ctrl.reset(sx, spot.y, sz);
      rescuesAtStart = b.rescues;
    }
  }
}

console.log(
  `\nFuzz: ${trials} trials x ${seconds}s = ${(totals.ticks * FIXED_DT / 60).toFixed(0)} simulated minutes, ${totals.ticks.toLocaleString()} ticks`,
);
console.log(`Coverage: ${totals.jumps} jumps, ${totals.lands} landings, ${totals.slides} slides, ${totals.vaults} vaults, ${totals.mantles} mantles, ${totals.wallRuns} wall runs, ${totals.bumps} hard bumps, ${totals.respawns} falls`);
console.log(failures ? `${failures} FAILURES` : 'No collision / state violations found.');
process.exit(failures ? 1 : 0);
