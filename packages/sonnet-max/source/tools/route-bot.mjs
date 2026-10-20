// Replays the whole course through the real PlayerController using the Autopilot (src/debug/Autopilot.ts).
// Proves every jump / slide / vault / wall run is physically makeable with the shipped movement constants,
// and measures how forgiving the course is by adding human-like error.
//
//   node tools/route-bot.mjs                      nominal full run + per-checkpoint stress test
//   node tools/route-bot.mjs --trials 300         more stress trials per segment
//   node tools/route-bot.mjs --verbose            print every route node as it is reached
//   node tools/route-bot.mjs --noflow             disable the momentum bonus (base 9 m/s sprint only)
//   node tools/route-bot.mjs --margins            per-jump "how early can I jump" analysis (mantle assist off)
//   node tools/route-bot.mjs --lead 0.6,0.4 --lat 0.7   harsher human error model
import { createLevelLayout } from '../src/world/LevelLayout.ts';
import { CollisionWorld } from '../src/world/CollisionWorld.ts';
import { PlayerController, createInput } from '../src/player/PlayerController.ts';
import { Autopilot } from '../src/debug/Autopilot.ts';
import { FIXED_DT } from '../src/config.ts';
import { Rng } from '../src/utils/Rng.ts';

export function buildWorld(layout) {
  const world = new CollisionWorld();
  for (const b of layout.boxes) {
    if (!b.collide) continue;
    world.addBox(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], b.flags, b.label);
  }
  return world;
}

/**
 * @param opts.fromCheckpoint  0 = start of level, n = respawn at checkpoint n
 * @param opts.jitter          { lead: [mean, sigma] metres early, lateral: sigma metres }
 * @param opts.stopAtCheckpoint  succeed as soon as this checkpoint is reached
 */
export function runBot(layout, world, opts = {}) {
  const rng = new Rng(opts.seed ?? 1);
  const jit = opts.jitter ?? null;
  const route = layout.route;
  const ctrl = new PlayerController(world);
  let startPos = layout.start;
  let ni = 0;
  let cpIndex = 0;
  if (opts.fromCheckpoint) {
    const cp = layout.checkpoints.find((c) => c.id === opts.fromCheckpoint);
    startPos = { x: cp.x, y: cp.y, z: cp.z, yaw: cp.yaw };
    ni = route.findIndex((n) => n.label === `cp${cp.id}`) + 1;
    cpIndex = cp.id;
  }
  ctrl.reset(startPos.x, startPos.y, startPos.z);

  // Per-node random errors (human-like).
  const lead = route.map(() => 0);
  const lateral = route.map(() => 0);
  route.forEach((n, i) => {
    if (opts.leadOverride && opts.leadOverride.index === i) lead[i] = opts.leadOverride.value;
    else if (jit && (n.act === 'jump' || n.act === 'jumpWall')) {
      lead[i] = Math.max(-0.15, jit.lead[0] + (rng.next() + rng.next() + rng.next() - 1.5) * 2 * jit.lead[1]);
    }
    if (jit && (n.act === 'run' || n.act === 'jump')) {
      lateral[i] = Math.max(-0.7, Math.min(0.7, (rng.next() + rng.next() + rng.next() - 1.5) * 2 * (jit.lateral ?? 0)));
    }
  });

  const ap = new Autopilot(layout, { lead, lateral });
  ap.start(startPos.x, startPos.z, startPos.yaw, ni);
  const input = createInput();
  const b = ctrl.body;
  const events = [];
  for (const k of ['jump', 'land', 'slideStart', 'slideEnd', 'wallRunStart', 'wallRunEnd', 'scriptedStart', 'scriptedEnd', 'bump']) {
    ctrl.events.on(k, (p) => events.push({ t: ctrl.time, k, p }));
  }
  let mantleWindowStart = -1;
  let t = 0;
  const maxT = opts.maxTime ?? 240;
  let result = null;
  let progressX = b.x;
  let progressZ = b.z;
  let progressT = 0;
  let lastIndex = ap.index;

  ap.onJumpTriggered = (idx) => {
    // Margin analysis: turn the mid-air ledge grab off for exactly the jump under test.
    if (opts.noMantle && opts.leadOverride && opts.leadOverride.index === idx) {
      ctrl.autoLedge = false;
      mantleWindowStart = t;
    }
  };

  while (t < maxT) {
    ap.update(ctrl, input, FIXED_DT);
    if (opts.verbose && ap.index !== lastIndex) {
      const n = route[lastIndex];
      console.log(
        `  t=${t.toFixed(2)}s node ${lastIndex} ${n.act}${n.label ? ' (' + n.label + ')' : ''} pos=(${b.x.toFixed(1)}, ${b.y.toFixed(2)}, ${b.z.toFixed(1)}) speed=${ctrl.speed.toFixed(2)} state=${ctrl.state}`,
      );
      lastIndex = ap.index;
    }
    ctrl.update(FIXED_DT, input);
    if (mantleWindowStart >= 0 && t > mantleWindowStart + 0.25 && ctrl.state === 'ground') {
      ctrl.autoLedge = true;
      mantleWindowStart = -1;
    }
    if (opts.noFlow) ctrl.flow = 0;
    t += FIXED_DT;

    for (const cp of layout.checkpoints) {
      if (cp.id > cpIndex && Autopilot.overlaps(b, cp.trigger)) {
        cpIndex = cp.id;
        if (opts.verbose) console.log(`  t=${t.toFixed(2)}s checkpoint ${cp.id}`);
      }
    }
    if (opts.stopAtCheckpoint && cpIndex >= opts.stopAtCheckpoint) {
      result = { ok: true, time: t, node: ap.index, events };
      break;
    }
    if (Autopilot.overlaps(b, layout.finish.trigger)) {
      result = { ok: true, time: t, node: ap.index, events };
      break;
    }
    const killY = cpIndex > 0 ? layout.checkpoints.find((c) => c.id === cpIndex).killY : 41;
    const label = () => route[Math.max(0, ap.index - 1)]?.label ?? route[Math.max(0, ap.index - 1)]?.act;
    if (b.y < killY) {
      result = { ok: false, reason: 'fell', time: t, node: ap.index, nodeLabel: label(), pos: [b.x, b.y, b.z], state: ctrl.state, events };
      break;
    }
    if (Math.hypot(b.x - progressX, b.z - progressZ) > 2) {
      progressX = b.x;
      progressZ = b.z;
      progressT = t;
    } else if (t - progressT > 6) {
      result = { ok: false, reason: 'stuck', time: t, node: ap.index, nodeLabel: label(), pos: [b.x, b.y, b.z], state: ctrl.state, events };
      break;
    }
  }
  if (!result) result = { ok: false, reason: 'timeout', time: t, node: ap.index, pos: [b.x, b.y, b.z], events };
  result.rescues = b.rescues;
  return result;
}

// ------------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------------
if (process.argv[1]?.endsWith('route-bot.mjs')) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const trials = Number(arg('--trials', 120));
  const leadArg = String(arg('--lead', '0.3,0.25')).split(',').map(Number);
  const latArg = Number(arg('--lat', 0.4));
  const noFlow = args.includes('--noflow');

  const layout = createLevelLayout();
  const world = buildWorld(layout);
  console.log(`Layout: ${layout.boxes.length} boxes (${world.colliders.length} colliders), ${layout.route.length} route nodes, ${layout.checkpoints.length} checkpoints`);

  // Pre-flight: the start and every checkpoint respawn must be on solid ground and not inside a collider.
  let preflightOk = true;
  const probe = new PlayerController(world);
  const spots = [['start', layout.start], ...layout.checkpoints.map((c) => [`cp${c.id}`, c])];
  for (const [name, p] of spots) {
    probe.reset(p.x, p.y, p.z);
    const ok = probe.body.onGround && Math.abs(probe.body.y - p.y) < 0.05 && probe.body.rescues === 0;
    if (!ok) {
      preflightOk = false;
      console.log(`  PRE-FLIGHT FAIL ${name}: onGround=${probe.body.onGround} y=${probe.body.y.toFixed(2)} wanted ${p.y} rescues=${probe.body.rescues}`);
    }
  }
  console.log(preflightOk ? 'Pre-flight: start + checkpoint spawns are grounded' : 'Pre-flight FAILED');

  if (args.includes('--margins')) {
    console.log(`\nJump margins with mid-air ledge grab DISABLED (m early before the nominal take-off point, ${noFlow ? 'base sprint 9.0 m/s' : 'with momentum bonus'}):`);
    layout.route.forEach((n, idx) => {
      if (n.act !== 'jump' && n.act !== 'jumpWall') return;
      if (/climb|R6c/.test(n.label ?? '')) return; // the two climbs are meant to be grabbed
      let lo = 0;
      let hi = 4;
      const okAt = (v) => runBot(layout, world, { noFlow, noMantle: true, leadOverride: { index: idx, value: v }, maxTime: 120 }).ok;
      if (!okAt(0)) {
        console.log(`  node ${String(idx).padStart(2)} ${(n.label ?? n.act).padEnd(16)} FAILS even with a perfect jump`);
        return;
      }
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (okAt(mid)) lo = mid;
        else hi = mid;
      }
      console.log(`  node ${String(idx).padStart(2)} ${(n.label ?? n.act).padEnd(16)} margin ${lo.toFixed(2)} m`);
    });
    process.exit(0);
  }

  console.log('\nNominal run (no error):');
  const nominal = runBot(layout, world, { verbose, seed: 1, noFlow });
  if (nominal.ok) console.log(`  FINISHED in ${nominal.time.toFixed(1)} s`);
  else console.log(`  FAILED (${nominal.reason}) after ${nominal.time.toFixed(1)} s at node ${nominal.node} [${nominal.nodeLabel}] pos=(${nominal.pos.map((v) => v.toFixed(1)).join(', ')}) state=${nominal.state}`);

  console.log(`\nStress test: ${trials} trials per segment, jump ${leadArg[0]} m early (+-${leadArg[1]}), lateral +-${latArg} m${noFlow ? ', momentum bonus disabled (base sprint 9.0 m/s)' : ''}`);
  const segs = [0, ...layout.checkpoints.map((c) => c.id)];
  let worst = 1;
  for (const cpId of segs) {
    let ok = 0;
    const fails = new Map();
    let sumT = 0;
    for (let i = 0; i < trials; i++) {
      const r = runBot(layout, world, {
        fromCheckpoint: cpId,
        seed: 1000 + i * 7 + cpId,
        jitter: { lead: leadArg, lateral: latArg },
        noFlow,
        stopAtCheckpoint: cpId + 1 <= layout.checkpoints.length ? cpId + 1 : 0,
      });
      if (r.ok) {
        ok++;
        sumT += r.time;
      } else {
        const key = `${r.reason} @ node ${r.node - 1} ${r.nodeLabel ?? ''}`;
        fails.set(key, (fails.get(key) ?? 0) + 1);
      }
    }
    const rate = ok / trials;
    worst = Math.min(worst, rate);
    console.log(`  from ${cpId === 0 ? 'start' : 'checkpoint ' + cpId}: ${(rate * 100).toFixed(1)}% of runs complete this segment${ok ? ` (avg ${(sumT / ok).toFixed(1)} s)` : ''}`);
    for (const [k, v] of [...fails.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 4)) console.log(`      ${v}x ${k}`);
  }
  process.exit(nominal.ok && preflightOk && worst >= 0.8 ? 0 : 1);
}
