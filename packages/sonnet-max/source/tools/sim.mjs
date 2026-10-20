// Headless movement regression tests.
// Runs the real PlayerController / CollisionWorld (TypeScript, via Node's native type stripping)
// against small synthetic worlds. Usage: `npm test`.
import { CollisionWorld, Flag } from '../src/world/CollisionWorld.ts';
import { PlayerController, createInput } from '../src/player/PlayerController.ts';
import { FIXED_DT, MOVE, PLAYER } from '../src/config.ts';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? '  (' + detail + ')' : ''}`);
  }
}
const f = (n, d = 2) => n.toFixed(d);

/** yaw 0 looks down -Z. */
function makeRig(boxes, start = [0, 0, 0], yaw = 0) {
  const world = new CollisionWorld();
  for (const b of boxes) world.addBox(...b);
  const ctrl = new PlayerController(world);
  ctrl.reset(...start);
  const input = createInput();
  input.yaw = yaw;
  const log = { events: [] };
  for (const k of ['jump', 'land', 'slideStart', 'slideEnd', 'wallRunStart', 'wallRunEnd', 'scriptedStart', 'scriptedEnd', 'bump']) {
    ctrl.events.on(k, (p) => log.events.push([k, p, ctrl.time]));
  }
  return { world, ctrl, input, log };
}

/** Advance `seconds` of simulated time; edge flags are cleared after the first tick. */
function run(rig, seconds, per = null) {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) {
    rig.ctrl.update(FIXED_DT, rig.input);
    rig.input.jumpPressed = false;
    rig.input.slidePressed = false;
    rig.input.vaultPressed = false;
    if (per) per(i);
  }
}
const press = (rig, key) => {
  rig.input[key] = true;
};

const FLOOR = (x0, x1, z0, z1, top = 0, depth = 20) => [x0, top - depth, z0, x1, top, z1, 0, 'floor'];

// ---------------------------------------------------------------------------------------------
console.log('Gravity / ground');
{
  const rig = makeRig([FLOOR(-20, 20, -20, 20)], [0, 6, 0]);
  run(rig, 2);
  check('falls onto the floor and stops exactly on top', Math.abs(rig.ctrl.body.y) < 1e-6 && rig.ctrl.body.onGround, `y=${f(rig.ctrl.body.y, 4)}`);
  check('lands in ground state', rig.ctrl.state === 'ground');
}
{
  // Terminal-velocity fall onto a thin (0.3 m) slab must not tunnel.
  const rig = makeRig([[-20, -0.3, -20, 20, 0, 20, 0, 'thin']], [0, 400, 0]);
  run(rig, 12);
  check('no tunnelling through a 0.3 m slab at terminal velocity', rig.ctrl.body.y > -0.01, `y=${f(rig.ctrl.body.y, 3)}`);
}

console.log('Walls');
{
  const rig = makeRig([FLOOR(-30, 30, -80, 20), [-30, 0, -40.0, 30, 10, -39.8, 0, 'thin wall']], [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  rig.ctrl.reset(0, 0, 0);
  rig.ctrl.body.vz = -40; // absurd speed to stress tunnelling
  run(rig, 3);
  check('cannot pass through a 0.2 m wall at 40 m/s', rig.ctrl.body.z > -39.8 + 0.2, `z=${f(rig.ctrl.body.z, 3)}`);
}
{
  // Wall slab spans z in [-21, -20]; moving toward -Z the player stops against its +Z face (z = -20).
  const rig = makeRig([FLOOR(-30, 30, -80, 20), [-30, 0, -21, 30, 6, -20, 0, 'wall']], [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  run(rig, 4);
  const z = rig.ctrl.body.z;
  check('player rests against the wall face', Math.abs(z - (-20 + PLAYER.halfWidth)) < 0.01, `z=${f(z, 4)} expected ${f(-20 + PLAYER.halfWidth, 4)}`);
}

console.log('Acceleration / momentum');
{
  const rig = makeRig([FLOOR(-30, 30, -300, 20)], [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  let t90 = -1;
  run(rig, 3, (i) => {
    if (t90 < 0 && rig.ctrl.speed >= MOVE.sprintSpeed * 0.98) t90 = (i + 1) * FIXED_DT;
  });
  check('reaches sprint speed in a sensible time', t90 > 0.3 && t90 < 1.2, `t=${f(t90)}s`);
  const sp = rig.ctrl.speed;
  rig.input.moveY = 0;
  rig.input.sprint = false;
  let tStop = -1;
  run(rig, 2, (i) => {
    if (tStop < 0 && rig.ctrl.speed < 0.1) tStop = (i + 1) * FIXED_DT;
  });
  check('decelerates smoothly to a stop', tStop > 0.2 && tStop < 0.9, `from ${f(sp)} in ${f(tStop)}s`);
}
{
  // Flow: top speed rises over a long sprint.
  const rig = makeRig([FLOOR(-30, 30, -600, 20)], [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  run(rig, 6);
  check('momentum bonus raises top speed', rig.ctrl.speed > MOVE.sprintSpeed + 1, `speed=${f(rig.ctrl.speed)} flow=${f(rig.ctrl.flow)}`);
}

console.log('Jumping');
{
  // Standing jump height, tap vs hold.
  const measure = (hold) => {
    const rig = makeRig([FLOOR(-30, 30, -30, 30)], [0, 0, 0]);
    rig.input.jumpPressed = true;
    rig.input.jumpHeld = true;
    let apex = 0;
    run(rig, 1.2, (i) => {
      if (!hold && i > 3) rig.input.jumpHeld = false;
      apex = Math.max(apex, rig.ctrl.body.y);
    });
    return apex;
  };
  const hold = measure(true);
  const tap = measure(false);
  check('held jump reaches ~1.3 m', hold > 1.15 && hold < 1.5, `apex=${f(hold)}`);
  check('tap jump is lower (variable height)', tap < hold * 0.6 && tap > 0.2, `apex=${f(tap)}`);
}
{
  // Horizontal jump distance at sprint speed across a gap (equal heights).
  const distance = (speedFlowTime) => {
    const rig = makeRig([FLOOR(-10, 10, -400, 10)], [0, 0, 0]);
    rig.input.moveY = 1;
    rig.input.sprint = true;
    run(rig, speedFlowTime);
    const z0 = rig.ctrl.body.z;
    const sp = rig.ctrl.speed;
    rig.input.jumpPressed = true;
    rig.input.jumpHeld = true;
    let landed = false;
    let tAir = 0;
    run(rig, 2, () => {
      if (!landed) {
        tAir += FIXED_DT;
        if (rig.ctrl.body.onGround && tAir > 0.1) landed = true;
      }
    });
    void z0;
    return { sp, tAir };
  };
  const a = distance(1.0);
  console.log(`  info jump airtime at speed ${f(a.sp)}: ${f(a.tAir)}s`);
}
console.log('Sliding');
{
  // Low duct: slide under at sprint speed.
  const boxes = [FLOOR(-10, 10, -200, 20), [-10, 1.0, -41, 10, 3.6, -39, Flag.NoGrab, 'duct']];
  const rig = makeRig(boxes, [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  let pressed = false;
  let minZ = 0;
  let passed = false;
  run(rig, 8, () => {
    const b = rig.ctrl.body;
    if (!pressed && b.z < -41 + 6.5) {
      rig.input.slidePressed = true;
      rig.input.slideHeld = true;
      pressed = true;
    }
    if (pressed && b.z < -41 - 1) rig.input.slideHeld = false;
    minZ = Math.min(minZ, b.z);
    if (b.z < -43) passed = true;
  });
  check('slides under a 1.0 m clearance duct', passed, `minZ=${f(minZ)}`);
  check('stands back up after the duct', rig.ctrl.body.height === PLAYER.standHeight, `h=${f(rig.ctrl.body.height)}`);
  const ev = rig.log.events.map((e) => e[0]).join(',');
  check('slide events fired', ev.includes('slideStart') && ev.includes('slideEnd'), ev);
}
{
  // Forced crouch: slide to a stop under a long low ceiling, then walk out (never stuck).
  const boxes = [FLOOR(-10, 10, -200, 20), [-10, 1.0, -60, 10, 3.6, -30, Flag.NoGrab, 'long duct']];
  const rig = makeRig(boxes, [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  let pressed = false;
  run(rig, 18, () => {
    const b = rig.ctrl.body;
    if (!pressed && b.z < -30 + 3) {
      rig.input.slidePressed = true;
      rig.input.slideHeld = true;
      pressed = true;
    }
    if (pressed && b.z < -35) rig.input.slideHeld = false; // release mid-tunnel
  });
  check('exits a 30 m low tunnel without getting stuck', rig.ctrl.body.z < -62, `z=${f(rig.ctrl.body.z)}`);
  check('stands after the tunnel', rig.ctrl.body.height === PLAYER.standHeight);
}
{
  // Slide jump keeps momentum.
  const rig = makeRig([FLOOR(-10, 10, -400, 20)], [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  run(rig, 2.5);
  const before = rig.ctrl.speed;
  rig.input.slidePressed = true;
  rig.input.slideHeld = true;
  run(rig, 0.02);
  const atStart = rig.ctrl.speed;
  run(rig, 0.38);
  const mid = rig.ctrl.speed;
  rig.input.jumpPressed = true;
  rig.input.jumpHeld = true;
  run(rig, 0.1);
  check('slide start preserves momentum (small boost)', atStart >= before * 0.99, `before=${f(before)} atStart=${f(atStart)}`);
  check('slide friction decays speed gradually', mid < atStart && mid > atStart * 0.7, `atStart=${f(atStart)} after0.4s=${f(mid)}`);
  check('can jump out of a slide', rig.ctrl.state === 'air' && rig.ctrl.body.height === PLAYER.standHeight, `state=${rig.ctrl.state}`);
}

console.log('Vault / mantle');
{
  const boxes = [FLOOR(-10, 10, -200, 20), [-3, 0, -31, 3, 1.0, -30, 0, 'crate']];
  const rig = makeRig(boxes, [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  let vaulted = false;
  run(rig, 6, () => {
    const b = rig.ctrl.body;
    if (!vaulted && b.z < -30 + 1.4) {
      rig.input.vaultPressed = true;
      vaulted = true;
    }
  });
  const ev = rig.log.events.filter((e) => e[0] === 'scriptedStart').length;
  check('E vaults a 1.0 m crate', ev === 1 && rig.ctrl.body.z < -32, `z=${f(rig.ctrl.body.z)} events=${ev}`);
  check('vault preserves forward momentum', rig.ctrl.speed > 7, `speed=${f(rig.ctrl.speed)}`);
}
{
  // Low crate (0.7 m): sprinting into it hops it automatically; a 1.1 m crate needs E.
  const hopTest = (h) => {
    const rig = makeRig([FLOOR(-10, 10, -200, 20), [-3, 0, -31, 3, h, -30, 0, 'crate']], [0, 0, 0]);
    rig.input.moveY = 1;
    rig.input.sprint = true;
    let minAfter = Infinity;
    run(rig, 4, () => {
      // Speed right after the hop (while airborne / just landed) must stay near sprint speed.
      if (rig.ctrl.body.z < -31.5 && rig.ctrl.body.z > -34) minAfter = Math.min(minAfter, rig.ctrl.speed);
    }); // no E pressed
    return { z: rig.ctrl.body.z, vaults: rig.log.events.filter((e) => e[0] === 'scriptedStart').length, minAfter };
  };
  const low = hopTest(0.7);
  const high = hopTest(1.1);
  check('sprinting into a 0.7 m crate auto-hops it', low.vaults === 1 && low.z < -32, `z=${f(low.z)} vaults=${low.vaults}`);
  check('the auto-hop preserves momentum', low.minAfter > 8, `speed after hop >= ${f(low.minAfter)}`);
  check('a 1.1 m crate still needs E', high.vaults === 0 && high.z > -30, `z=${f(high.z)} vaults=${high.vaults}`);
}
{
  // Large wall (3.5 m): cannot be vaulted or mantled from the ground.
  const boxes = [FLOOR(-10, 10, -200, 20), [-10, 0, -31, 10, 3.5, -30, 0, 'big wall']];
  const rig = makeRig(boxes, [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  run(rig, 4, () => {
    rig.input.vaultPressed = true;
  });
  check('cannot vault through a large wall', rig.ctrl.body.z > -30 + 0.2, `z=${f(rig.ctrl.body.z)}`);
}
{
  // Mantle: ledge 1.7 m up.
  const boxes = [FLOOR(-10, 10, -200, 20), [-10, -30, -60, 10, 1.7, -30, 0, 'ledge block']];
  const rig = makeRig(boxes, [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  run(rig, 6, () => {
    rig.input.vaultPressed = true;
  });
  const b = rig.ctrl.body;
  check('E mantles onto a 1.7 m ledge', Math.abs(b.y - 1.7) < 0.01 && b.z < -30.2, `y=${f(b.y)} z=${f(b.z)}`);
}
{
  // Ledge recovery: sprint-jump at a roof 1.2 m above take-off with a gap that is slightly too short.
  const boxes = [
    [-10, -30, -40, 10, 0, 0, 0, 'roofA'],
    [-10, -30, -80, 10, 1.4, -44.5, 0, 'roofB'],
  ];
  const rig = makeRig(boxes, [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  let jumped = false;
  run(rig, 8, () => {
    const b = rig.ctrl.body;
    if (!jumped && b.z < -40 + 0.35) {
      rig.input.jumpPressed = true;
      rig.input.jumpHeld = true;
      jumped = true;
    }
  });
  const b = rig.ctrl.body;
  const mant = rig.log.events.some((e) => e[0] === 'scriptedStart' && e[1].kind === 'mantle');
  check('near-miss jump recovers via auto mantle', mant && Math.abs(b.y - 1.4) < 0.02, `y=${f(b.y)} mantle=${mant}`);
}

console.log('Wall run');
{
  // Gap of 12 m with a red wall beside it on the right; sprint, jump at the edge, hold W.
  const roofY = 0;
  const boxes = [
    [-8, -50, -60, 2.0, roofY, 0, 0, 'roofA'], // z in [-60, 0]
    [-8, -50, -112, 2.0, roofY, -72, 0, 'roofB'], // gap z in [-72,-60]
    [2.0, -50, -140, 2.6, 20, 20, Flag.WallRun, 'wall panel'], // x>=2.0 face
  ];
  const rig = makeRig(boxes, [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  let jumped = false;
  let wr = false;
  let landedZ = null;
  run(rig, 14, (i) => {
    const b = rig.ctrl.body;
    // keep to the wall side: run along x = 1.5
    rig.input.yaw = 0;
    if (!jumped && b.onGround) {
      const dxTarget = 1.5 - b.x;
      rig.input.moveX = Math.max(-1, Math.min(1, dxTarget * 3));
    }
    if (!jumped && b.z < -60 + 0.3) {
      rig.input.jumpPressed = true;
      rig.input.jumpHeld = true;
      rig.input.moveX = 0.25;
      jumped = true;
    }
    if (jumped) rig.input.moveX = rig.ctrl.state === 'wallrun' ? 0 : 0.25;
    if (rig.ctrl.state === 'wallrun') wr = true;
    if (jumped && landedZ === null && b.onGround && b.z < -72) landedZ = b.z;
    void i;
  });
  const b = rig.ctrl.body;
  check('wall run engaged', wr);
  check('crosses a 12 m gap by wall running', landedZ !== null, `landedZ=${landedZ !== null ? f(landedZ) : 'none'} finalY=${f(b.y)}`);
  const ev = rig.log.events.map((e) => e[0]).join(',');
  console.log('  info events:', ev);
}
{
  // Anti-exploit: wall run time is limited; the player can not hover forever.
  const boxes = [
    [-8, -50, -400, 2.0, 0, 20, 0, 'long roof'],
    [2.0, -50, -400, 2.6, 60, 20, Flag.WallRun, 'long wall'],
  ];
  // Start high up beside the wall.
  const rig = makeRig(boxes, [1.5, 30, 0]);
  rig.ctrl.body.vz = -9;
  rig.input.moveY = 1;
  rig.input.sprint = true;
  rig.input.yaw = 0;
  run(rig, 0.1);
  let longest = 0;
  let cur = 0;
  run(rig, 8, () => {
    if (rig.ctrl.state === 'wallrun') {
      cur += FIXED_DT;
      longest = Math.max(longest, cur);
    } else cur = 0;
  });
  check('wall-run duration is capped', longest > 0.5 && longest < 2.5, `longest=${f(longest)}s`);
}

console.log('Jump forgiveness (coyote time + jump buffer)');
{
  // Walk off a ledge, press jump shortly after leaving the edge: coyote time allows it.
  const tryCoyote = (delay) => {
    const rig = makeRig([[-5, -20, -40, 5, 0, 0, 0, 'roof']], [0, 0, -28]);
    rig.input.moveY = 1;
    rig.input.sprint = true;
    let jumpedAt = -1;
    let leftAt = -1;
    let t = 0;
    run(rig, 3, () => {
      t += FIXED_DT;
      const b = rig.ctrl.body;
      if (leftAt < 0 && !b.onGround && rig.ctrl.state === 'air') leftAt = t;
      if (leftAt > 0 && jumpedAt < 0 && t - leftAt >= delay) {
        rig.input.jumpPressed = true;
        rig.input.jumpHeld = true;
        jumpedAt = t;
      }
    });
    return rig.log.events.some((e) => e[0] === 'jump' && e[1].kind === 'coyote');
  };
  check('jump works 60 ms after running off a ledge (coyote)', tryCoyote(0.06));
  check('jump rejected 250 ms after leaving the ledge', !tryCoyote(0.25));
}
{
  // Jump buffer: press jump 90 ms before landing -> jumps immediately on touchdown.
  const rig = makeRig([FLOOR(-20, 20, -60, 20)], [0, 3, 0]);
  rig.input.moveY = 1;
  let pressed = false;
  let jumpCount = 0;
  rig.ctrl.events.on('jump', () => jumpCount++);
  run(rig, 2, () => {
    const b = rig.ctrl.body;
    // ~ 0.09 s of fall remain when height <= 1.0 (falling at ~11 m/s)
    if (!pressed && !b.onGround && b.y <= 1.0) {
      rig.input.jumpPressed = true;
      pressed = true;
    }
  });
  check('jump pressed shortly before landing is buffered', jumpCount === 1, `jumps=${jumpCount}`);
}

console.log('Frame-rate independence (fixed 120 Hz step inside a variable-rate loop)');
{
  const simulate = (frameDt) => {
    const rig = makeRig([FLOOR(-20, 20, -300, 20)], [0, 0, 0]);
    rig.input.moveY = 1;
    rig.input.sprint = true;
    let acc = 0;
    let t = 0;
    let jumped = false;
    let apex = 0;
    while (t < 3) {
      acc += frameDt;
      t += frameDt;
      while (acc >= FIXED_DT) {
        if (!jumped && t > 1.5) {
          rig.input.jumpPressed = true;
          rig.input.jumpHeld = true;
          jumped = true;
        }
        rig.ctrl.update(FIXED_DT, rig.input);
        rig.input.jumpPressed = false;
        apex = Math.max(apex, rig.ctrl.body.y);
        acc -= FIXED_DT;
      }
    }
    return { apex, z: rig.ctrl.body.z };
  };
  const base = simulate(1 / 240);
  for (const fps of [20, 30, 60, 75, 144]) {
    const r = simulate(1 / fps);
    check(`${fps} fps loop gives the same jump (apex ${r.apex.toFixed(3)} vs ${base.apex.toFixed(3)})`, Math.abs(r.apex - base.apex) < 0.03 && Math.abs(r.z - base.z) < 1.2, `dz=${(r.z - base.z).toFixed(2)}`);
  }
}

console.log('Landing friction');
{
  // Landing from a jump with no input keeps momentum for a moment (friction ramps in) instead of scrubbing instantly.
  const rig = makeRig([FLOOR(-20, 20, -300, 20)], [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  run(rig, 2);
  rig.input.jumpPressed = true;
  rig.input.jumpHeld = true;
  run(rig, 0.05);
  rig.input.moveY = 0;
  rig.input.sprint = false;
  rig.input.jumpHeld = false;
  let landSpeed = 0;
  let tAfter = 0;
  let speedAfter = 0;
  let landed = false;
  run(rig, 1.2, () => {
    if (!landed && rig.ctrl.body.onGround && rig.ctrl.state === 'ground') {
      landed = true;
      landSpeed = rig.ctrl.speed;
    } else if (landed) {
      tAfter += FIXED_DT;
      if (Math.abs(tAfter - 0.1) < FIXED_DT / 2) speedAfter = rig.ctrl.speed;
    }
  });
  check('landing keeps most speed for the first 0.1 s (controlled friction)', landSpeed > 8 && speedAfter > landSpeed * 0.6, `land=${landSpeed.toFixed(1)} +0.1s=${speedAfter.toFixed(1)}`);
}

console.log('Respawn');
{
  const rig = makeRig([FLOOR(-30, 30, -30, 30)], [0, 0, 0]);
  rig.input.moveY = 1;
  rig.input.sprint = true;
  run(rig, 2);
  rig.input.slidePressed = true;
  rig.input.slideHeld = true;
  run(rig, 0.2);
  rig.ctrl.reset(0, 0, 0);
  check('reset clears velocity and slide state', rig.ctrl.speed === 0 && rig.ctrl.state === 'ground' && rig.ctrl.body.height === PLAYER.standHeight && rig.ctrl.flow === 0);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
