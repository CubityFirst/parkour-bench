import * as THREE from 'three';
import { applyLook, readPlanarBasis } from '../player/basis';
import { FIXED_DT, JUMP_SPEED, GRAVITY, SPRINT_SPEED, RADIUS } from '../player/constants';
import { PlayerController } from '../player/PlayerController';
import { blankInput } from '../player/types';
import type { Solid } from '../player/types';
import { CollisionWorld } from '../world/CollisionWorld';
import { Simulation } from '../game/Simulation';
import { botInput } from './bot';

let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
}

function approx(v: number, target: number, eps: number): boolean {
  return Math.abs(v - target) <= eps;
}

function basisContract(): void {
  const rig = new THREE.Object3D();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  applyLook(rig, 0, 0);
  readPlanarBasis(rig, fwd, right);
  check('yaw 0 looks down -Z', approx(fwd.x, 0, 0.02) && approx(fwd.z, -1, 0.02), `fwd ${fwd.x.toFixed(3)},${fwd.z.toFixed(3)}`);
  check('yaw 0 right is +X', approx(right.x, 1, 0.02) && approx(right.z, 0, 0.02), `right ${right.x.toFixed(3)},${right.z.toFixed(3)}`);
  applyLook(rig, -Math.PI / 2, 0);
  readPlanarBasis(rig, fwd, right);
  check('yaw -π/2 looks +X', fwd.x > 0.98 && Math.abs(fwd.z) < 0.05, `fwd ${fwd.x.toFixed(3)},${fwd.z.toFixed(3)}`);
  check('yaw -π/2 right is +Z', right.z > 0.98 && Math.abs(right.x) < 0.05, `right ${right.x.toFixed(3)},${right.z.toFixed(3)}`);
}

function solid(
  id: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  surface: Solid['surface'] = 'roof',
  accent?: Solid['accent'],
): Solid {
  return { id, minX, minY, minZ, maxX, maxY, maxZ, surface, accent };
}

function stand(world: CollisionWorld, x: number, z: number): PlayerController {
  const p = new PlayerController(world);
  p.reset({ x, y: 0, z, yaw: -Math.PI / 2, label: 'test' });
  return p;
}

function step(p: PlayerController, input = blankInput(), n = 1): void {
  for (let i = 0; i < n; i++) p.update(FIXED_DT, input, 1, 0, 0, 1);
}

function floorStay(): void {
  const world = new CollisionWorld([solid(1, -8, -2, -8, 8, 0, 8)]);
  const p = stand(world, 0, 0);
  const input = blankInput();
  step(p, input, 240);
  check('stands on a floor', p.grounded && p.y >= -0.02 && p.y <= 0.05, `y=${p.y.toFixed(3)}`);
}

function wallBlocks(): void {
  const world = new CollisionWorld([
    solid(1, -8, -2, -4, 8, 0, 4),
    solid(2, 2, -2, -4, 2.6, 4, 4, 'concrete'),
  ]);
  const p = stand(world, 0, 0);
  const input = blankInput();
  input.forward = 1;
  input.sprint = true;
  step(p, input, 360);
  check('wall stops a sprint', p.x < 2 - RADIUS + 0.08, `x=${p.x.toFixed(3)}`);
}

function jumpHeight(): void {
  const world = new CollisionWorld([solid(1, -6, -2, -6, 6, 0, 6)]);
  const p = stand(world, 0, 0);
  const input = blankInput();
  input.jump = true;
  input.jumpPressed = true;
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    p.update(FIXED_DT, input, 1, 0, 0, 1);
    input.jumpPressed = false;
    if (p.y > peak) peak = p.y;
  }
  const expected = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
  check('jump height', peak > expected * 0.85 && peak < expected * 1.08, `peak ${peak.toFixed(2)} expected ${expected.toFixed(2)}`);
}

function sprintGap(): void {
  // 5.2 m edge gap. Takeoff slab ends at x=2, landing starts at 7.2.
  const world = new CollisionWorld([
    solid(1, -12, -2, -4, 2, 0, 4),
    solid(2, 7.2, -2, -4, 18, 0, 4),
  ]);
  const p = stand(world, -6, 0);
  const input = blankInput();
  input.forward = 1;
  input.sprint = true;
  let landed = false;
  for (let i = 0; i < 700; i++) {
    const press = p.grounded && p.x > 1.55 && p.x < 2.05;
    input.jump = press;
    input.jumpPressed = press;
    p.update(FIXED_DT, input, 1, 0, 0, 1);
    if (p.x > 8 && p.grounded && p.y >= -0.05) landed = true;
    if (p.y < -4) break;
  }
  check('sprint clears a 5.2 m gap', landed, `x=${p.x.toFixed(2)} y=${p.y.toFixed(2)}`);
}

function slideClearsDuct(): void {
  const world = new CollisionWorld([
    solid(1, -4, -2, -3, 16, 0, 3),
    solid(2, 4, 1.02, -3, 6.4, 2.4, 3, 'metal'),
  ]);
  const p = stand(world, 0, 0);
  p.vx = SPRINT_SPEED;
  const input = blankInput();
  input.forward = 1;
  input.sprint = true;
  input.slide = true;
  input.slidePressed = true;
  let crossed = false;
  for (let i = 0; i < 500; i++) {
    p.update(FIXED_DT, input, 1, 0, 0, 1);
    input.slidePressed = false;
    if (p.x > 7 && p.y >= -0.05) crossed = true;
  }
  check('slide passes under a 1.02 m duct', crossed, `x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} h=${p.height.toFixed(2)}`);
}

function wallRunFixture(): void {
  const world = new CollisionWorld([
    solid(1, 0, -2, -5.45, 10, 0, 6),
    solid(2, 6, -6, -6.95, 24, 18, -6.15, 'wall', 'maxZ'),
    solid(3, 18, -3.2, -5.05, 30, -1.2, 6),
  ]);
  const p = stand(world, 1, -4.9);
  const input = blankInput();
  input.sprint = true;
  input.forward = 1;
  let sawWall = false;
  let landed = false;
  for (let i = 0; i < 900; i++) {
    input.jumpPressed = false;
    input.strafe = Math.max(-0.4, Math.min(0.4, (-5.0 - p.z) * 1.4));
    if (p.grounded && p.x > 9.2 && p.x < 10.05) input.jumpPressed = true;
    if (p.state === 'wallrun') {
      sawWall = true;
      input.strafe = 0;
      if (p.x > 18.4 && p.wallTime > 0.25) input.jumpPressed = true;
    }
    p.update(FIXED_DT, input, 1, 0, 0, 1);
    if (p.x > 20 && p.y > -1.5 && p.grounded) landed = true;
    if (p.y < -6) break;
  }
  check('wall run attaches', sawWall, `state=${p.state}`);
  check('wall run reaches the far roof', landed, `x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
}

function mantleFixture(): void {
  const world = new CollisionWorld([
    solid(1, -2, -2, -3, 5, 0, 3),
    solid(2, 5, -2, -3, 12, 1.48, 3, 'concrete'),
  ]);
  const p = stand(world, 1, 0);
  const input = blankInput();
  input.forward = 1;
  input.sprint = true;
  let climbed = false;
  for (let i = 0; i < 600; i++) {
    input.jumpPressed = false;
    if (p.grounded && p.x > 4.5 && p.x < 5.05) input.jumpPressed = true;
    p.update(FIXED_DT, input, 1, 0, 0, 1);
    if (p.y > 1.3 && p.x > 5.4 && p.grounded) climbed = true;
  }
  check('mantle climbs a 1.48 m ledge', climbed, `x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} state=${p.state}`);
}

function fullRoute(): void {
  const sim = new Simulation();
  const rig = new THREE.Object3D();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  applyLook(rig, -Math.PI / 2, 0);
  readPlanarBasis(rig, fwd, right);

  let lastX = sim.player.x;
  let stuck = 0;
  const trace: string[] = [];
  const maxSteps = Math.round(100 / FIXED_DT);
  let finished = false;
  for (let i = 0; i < maxSteps; i++) {
    const input = botInput(sim);
    // Recovery pulse if the run has not moved for a third of a second.
    if (stuck > 40 && stuck % 20 === 0) {
      input.jumpPressed = true;
      input.vaultPressed = true;
      input.slidePressed = true;
      input.slide = true;
    }
    sim.step(FIXED_DT, input, fwd.x, fwd.z, right.x, right.z);
    if (i % 120 === 0) {
      const p = sim.player;
      trace.push(
        `${(i * FIXED_DT).toFixed(1)}s x=${p.x.toFixed(1)} z=${p.z.toFixed(2)} y=${p.y.toFixed(2)} ${p.state} v=${p.horizontalSpeed.toFixed(1)} cp=${sim.flags.checkpoint} falls=${sim.flags.falls}`,
      );
    }
    if (sim.player.x > lastX + 0.05) {
      lastX = sim.player.x;
      stuck = 0;
    } else stuck += 1;
    if (sim.flags.finished) {
      finished = true;
      trace.push(`finish at ${(i * FIXED_DT).toFixed(2)}s falls=${sim.flags.falls}`);
      break;
    }
    if (sim.flags.falls > 6) break;
  }
  console.log(trace.join('\n'));
  check('route is finished', finished, `x=${sim.player.x.toFixed(1)} falls=${sim.flags.falls} cp=${sim.flags.checkpoint}`);
  check('route finishes with few falls', finished && sim.flags.falls <= 2, `falls=${sim.flags.falls}`);
}

basisContract();
floorStay();
wallBlocks();
jumpHeight();
sprintGap();
slideClearsDuct();
wallRunFixture();
mantleFixture();
fullRoute();

if (failed > 0) {
  throw new Error(`${failed} check(s) failed`);
}
console.log('\nAll checks passed');
