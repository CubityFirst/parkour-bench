import { SLIDE_HEIGHT, STAND_HEIGHT } from '../player/constants';
import { blankInput, type PlayerInput } from '../player/types';
import { clearanceAbove } from '../world/CollisionWorld';
import { guideZ } from '../world/levelLayout';
import type { Simulation } from '../game/Simulation';

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** Distance along +X until the floor drops away. Null when the roof continues. */
function edgeAhead(sim: Simulation): number | null {
  const p = sim.player;
  for (let d = 0.18; d <= 2.4; d += 0.12) {
    const floor = sim.world.floorAt(p.x + d, p.z, p.y);
    if (floor === null || p.y - floor > 0.7) return d;
  }
  return null;
}

function lowCeiling(sim: Simulation, reach: number): boolean {
  const p = sim.player;
  for (let d = 0.4; d <= reach; d += 0.45) {
    const gap = clearanceAbove(sim.world, p.x + d, p.y, p.z, p.radius * 0.75);
    if (gap < STAND_HEIGHT - 0.05 && gap > SLIDE_HEIGHT + 0.05) return true;
  }
  return false;
}

function landingBeside(sim: Simulation): boolean {
  const p = sim.player;
  const nx = p.wallNx;
  const nz = p.wallNz;
  for (const dist of [0.9, 1.5, 2.2]) {
    const floor = sim.world.floorAt(p.x + nx * dist, p.z + nz * dist, p.y + 0.4);
    const below = sim.world.floorAt(p.x, p.z, p.y + 0.3);
    if (floor !== null && below === null && floor > p.y - 2.4 && floor < p.y + 0.45) return true;
  }
  return false;
}

/** Drives the authored route. Forward is +X and right is +Z, matching yaw −π/2. */
export function botInput(sim: Simulation): PlayerInput {
  const input = blankInput();
  const p = sim.player;
  input.sprint = true;
  input.forward = 1;

  const zTarget = guideZ(sim.layout.guide, p.x);
  const zErr = zTarget - p.z;
  const edge = edgeAhead(sim);
  const nearEdge = edge !== null && edge < 2.5;
  const maxStrafe = nearEdge ? 0.18 : 0.55;
  // Positive strafe moves +Z when the camera looks along +X.
  input.strafe = clamp(zErr * 1.35, -maxStrafe, maxStrafe);

  if (p.state === 'wallrun') {
    input.strafe = 0;
    input.forward = 1;
    if (landingBeside(sim) && p.wallTime > 0.28) input.jumpPressed = true;
    return input;
  }

  const vault = p.grounded ? sim.world.findVault(p, 1, 0) : null;
  if (vault) input.vaultPressed = true;

  if (lowCeiling(sim, 3.4) && p.horizontalSpeed > 5.2 && (p.grounded || p.state === 'slide')) {
    input.slide = true;
    input.slidePressed = true;
  }

  const slideBlockingJump = p.state === 'slide' && lowCeiling(sim, 1.6);
  if (!vault && !slideBlockingJump && edge !== null && edge < 0.42 && edge > 0.1 && p.grounded) {
    input.jumpPressed = true;
  }
  if (!slideBlockingJump && edge !== null && edge < 0.48 && p.state === 'slide') {
    input.jumpPressed = true;
  }
  return input;
}
