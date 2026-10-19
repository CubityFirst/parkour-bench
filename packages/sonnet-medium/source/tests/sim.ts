/**
 * Headless simulation: a scripted bot plays the level through the real PlayerController +
 * CollisionWorld at several fixed-step rates. Fails (exit 1) if the finish is not reached.
 * Run with: npm run sim
 */
import { Level } from '../src/world/Level';
import { PlayerController, emptyInput } from '../src/player/PlayerController';
import { KILL_Y } from '../src/world/Level';

interface Result { ok: boolean; time: number; log: string[]; }

function runBot(stepHz: number, verbose: boolean): Result {
  const level = new Level();
  const pc = new PlayerController(level.world);
  const log: string[] = [];
  const ev = (s: string, t: number) => log.push(`${t.toFixed(2)}s ${s} @ z=${pc.phys.z.toFixed(1)} x=${pc.phys.x.toFixed(1)}`);
  let t = 0;
  pc.events = {
    jump: () => ev('jump', t), land: (i) => { if (i > 6) ev(`land ${i.toFixed(1)}`, t); },
    slideStart: () => ev('slide', t), wallRunStart: () => ev('wallrun', t), wallJump: () => ev('walljump', t),
    vault: () => ev('vault', t), mantle: () => ev('mantle', t),
  };
  pc.respawn(level.spawn.x, level.spawn.y, level.spawn.z);
  const dt = 1 / stepHz;
  let cp = 0;
  let vaultDone = new Set<number>();
  let slideKey = false;
  const vaultZ = [-16, -42, -62, -228.5, -268.5];
  const ductZ: [number, number][] = [[-30, -33.2], [-149, -152.5], [-159.5, -163], [-170, -173.5], [-233.5, -237]];

  for (let i = 0; i < stepHz * 200; i++) {
    const p = pc.phys;
    const input = emptyInput();
    input.moveZ = 1;
    input.sprint = true;
    // lateral target
    let tx = 0;
    if (p.z < -90) tx = -1.5;
    if (p.z < -143) tx = 0;
    if (p.z < -174) tx = 6.55;
    if (p.z < -200) tx = 0;
    if (p.z < -234) tx = -6.55;
    if (p.z < -258) tx = 0;
    if (p.z < -295) tx = 1;
    if (p.z < -312) tx = -1;
    if (p.z < -329) tx = 1;
    if (p.z < -346) tx = 0;
    input.moveX = Math.max(-1, Math.min(1, (tx - p.x) * 2));

    // vaults
    for (let k = 0; k < vaultZ.length; k++) {
      if (!vaultDone.has(k) && p.z < vaultZ[k] + 1.3 && p.z > vaultZ[k] + 0.2 && p.grounded) {
        input.vaultPressed = true; vaultDone.add(k);
      }
    }
    // slides
    let wantSlide = false;
    for (const [z1, z0] of ductZ) if (p.z < z1 + 2.8 && p.z > z0 - 0.3) wantSlide = true;
    input.slideHeld = wantSlide;
    input.slidePressed = wantSlide && !slideKey;
    slideKey = wantSlide;
    // wall runs: jump when hugging the wall at the start of each section
    if (p.grounded && p.z < -181 && p.z > -186 && p.x > 6.2) input.jumpPressed = true;
    if (p.grounded && p.z < -241.5 && p.z > -246 && p.x < -6.2) input.jumpPressed = true;
    input.jumpHeld = true;
    // edge jump
    if (p.grounded && pc.mode === 'ground') {
      const sp = p.hSpeed;
      const dirx = sp > 1 ? p.v[0] / sp : 0, dirz = sp > 1 ? p.v[2] / sp : -1;
      const look = 0.12 + sp * dt * 1.5;
      if (!p.overlapsAt(p.x + dirx * look, p.y - 0.3, p.z + dirz * look, 0.25) && sp > 4) input.jumpPressed = true;
    }
    pc.update(dt, input);
    t += dt;
    for (const c of level.checkpoints) {
      if (c.id > cp && p.x > c.minX && p.x < c.maxX && p.y > c.minY && p.y < c.maxY && p.z > c.minZ && p.z < c.maxZ) {
        cp = c.id; ev(`checkpoint ${c.id}`, t);
      }
    }
    const f = level.finish;
    if (p.x > f.minX && p.x < f.maxX && p.y > f.minY && p.y < f.maxY && p.z > f.minZ && p.z < f.maxZ) {
      ev('FINISH', t);
      if (verbose) console.log(log.join('\n'));
      return { ok: true, time: t, log };
    }
    if (p.y < KILL_Y) {
      ev('FELL', t);
      if (verbose) console.log(log.join('\n'));
      return { ok: false, time: t, log };
    }
  }
  ev('TIMEOUT', t);
  if (verbose) console.log(log.join('\n'));
  return { ok: false, time: t, log };
}

let failed = false;
for (const hz of [120, 60, 240]) {
  const r = runBot(hz, hz === 120);
  console.log(`[${hz} Hz] ${r.ok ? 'FINISHED' : 'FAILED'} in ${r.time.toFixed(1)}s`);
  if (!r.ok) { failed = true; if (hz !== 120) console.log(r.log.slice(-6).join('\n')); }
}
process.exit(failed ? 1 : 0);
