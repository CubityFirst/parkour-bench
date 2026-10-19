import {
  SLIDE_BOOST,
  SLIDE_FRICTION,
  SLIDE_HEIGHT,
  SLIDE_MIN_ENTRY,
  SPRINT_SPEED,
  STAND_HEIGHT,
  WALL_COOLDOWN,
  WALL_GRAVITY_SCALE,
  WALL_MAX_TIME,
  WALL_MIN_SPEED,
  GRAVITY,
} from './constants';
import type { PlayerController } from './PlayerController';
import type { PlayerInput } from './types';

function smooth(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
}

export function horizontalDir(a: PlayerController, fallbackX: number, fallbackZ: number): { x: number; z: number } {
  const sp = Math.hypot(a.vx, a.vz);
  if (sp > 1.2) return { x: a.vx / sp, z: a.vz / sp };
  const fl = Math.hypot(fallbackX, fallbackZ) || 1;
  return { x: fallbackX / fl, z: fallbackZ / fl };
}

export function trySlide(a: PlayerController, input: PlayerInput): boolean {
  if (a.state === 'slide' || a.state === 'vault' || a.state === 'mantle' || a.state === 'wallrun') return false;
  if (!a.grounded) return false;
  if (!input.slidePressed && !input.slide) return false;
  const sp = Math.hypot(a.vx, a.vz);
  if (sp < SLIDE_MIN_ENTRY) return false;
  a.slideDirX = a.vx / sp;
  a.slideDirZ = a.vz / sp;
  a.slideSpeed = Math.min(12.4, sp * SLIDE_BOOST);
  a.slideTime = 0;
  a.height = SLIDE_HEIGHT;
  a.state = 'slide';
  a.slideLatch = true;
  a.onSlide?.(true);
  return true;
}

export function tickSlide(
  a: PlayerController,
  input: PlayerInput,
  rightX: number,
  rightZ: number,
  dt: number,
): void {
  if (!a.grounded) {
    const jammed = a.world.blocked(a.x, a.y + 0.02, a.z, a.radius * 0.92, STAND_HEIGHT);
    a.height = jammed ? SLIDE_HEIGHT : STAND_HEIGHT;
    a.state = 'air';
    a.onSlide?.(false);
    return;
  }
  a.slideTime += dt;
  const steer = input.strafe * 0.55 * dt;
  let dx = a.slideDirX + rightX * steer;
  let dz = a.slideDirZ + rightZ * steer;
  const mag = Math.hypot(dx, dz) || 1;
  a.slideDirX = dx / mag;
  a.slideDirZ = dz / mag;
  a.slideSpeed = Math.max(0, a.slideSpeed - SLIDE_FRICTION * dt);
  const canStand = !a.world.blocked(a.x, a.y + 0.02, a.z, a.radius * 0.92, STAND_HEIGHT);
  if (!canStand && a.slideSpeed < 4.3) a.slideSpeed = 4.3;
  a.vx = a.slideDirX * a.slideSpeed;
  a.vz = a.slideDirZ * a.slideSpeed;
  a.vy = 0;

  const keepAbove = input.slide ? 2.5 : 4.8;
  const wantOut = a.slideTime > 0.32 && a.slideSpeed < keepAbove && canStand;
  if (wantOut) endSlide(a);
}

export function endSlide(a: PlayerController): void {
  if (a.state !== 'slide') return;
  const canStand = !a.world.blocked(a.x, a.y + 0.02, a.z, a.radius * 0.92, STAND_HEIGHT);
  a.height = canStand ? STAND_HEIGHT : SLIDE_HEIGHT;
  a.state = a.grounded ? 'ground' : 'air';
  if (!canStand) a.state = 'slide';
  if (a.state !== 'slide') a.onSlide?.(false);
}

export function tryWall(a: PlayerController): boolean {
  if (a.state !== 'air' || a.grounded) return false;
  if (a.wallCooldown > 0) return false;
  if (a.vy < -10) return false;
  const sp = Math.hypot(a.vx, a.vz);
  if (sp < WALL_MIN_SPEED) return false;
  const wall = a.world.findWall(a, a.lastWallId);
  if (!wall) return false;
  const tx = -wall.nz;
  const tz = wall.nx;
  let along = a.vx * tx + a.vz * tz;
  let dirX = tx;
  let dirZ = tz;
  if (along < 0) {
    dirX = -tx;
    dirZ = -tz;
    along = -along;
  }
  if (along < WALL_MIN_SPEED * 0.82) return false;
  const into = a.vx * -wall.nx + a.vz * -wall.nz;
  if (into < -3) return false;
  a.state = 'wallrun';
  a.grounded = false;
  a.wallTime = 0;
  a.wallNx = wall.nx;
  a.wallNz = wall.nz;
  a.wallDirX = dirX;
  a.wallDirZ = dirZ;
  a.wallSpeed = Math.max(along, 8.6);
  a.wallId = wall.solid.id;
  a.vy = Math.max(0.6, Math.min(a.vy, 2.5));
  a.height = STAND_HEIGHT;
  snapToWall(a);
  a.onWall?.(true);
  return true;
}

export function tickWall(a: PlayerController, dt: number): void {
  a.wallTime += dt;
  const wall = a.world.findWall(a);
  const same = wall && wall.solid.id === a.wallId;
  if (!same || a.wallTime > WALL_MAX_TIME || a.wallSpeed < 5) {
    exitWall(a, false);
    return;
  }
  a.wallNx = wall.nx;
  a.wallNz = wall.nz;
  a.wallSpeed = Math.max(5, a.wallSpeed - 0.35 * dt);
  a.vx = a.wallDirX * a.wallSpeed;
  a.vz = a.wallDirZ * a.wallSpeed;
  a.vy += -GRAVITY * WALL_GRAVITY_SCALE * dt;
  if (a.vy < -2.4) a.vy = -2.4;
  snapToWall(a);
}

export function stickWall(a: PlayerController): void {
  snapToWall(a);
}

function snapToWall(a: PlayerController): void {
  const wall = a.world.findWall(a);
  if (!wall || wall.solid.id !== a.wallId) return;
  const skin = a.radius + 0.06;
  if (Math.abs(wall.nz) > 0.8) {
    const face = wall.nz > 0 ? wall.solid.maxZ : wall.solid.minZ;
    a.z = face + wall.nz * skin;
  } else if (Math.abs(wall.nx) > 0.8) {
    const face = wall.nx > 0 ? wall.solid.maxX : wall.solid.minX;
    a.x = face + wall.nx * skin;
  }
}

export function exitWall(a: PlayerController, jumped: boolean): void {
  if (a.state !== 'wallrun') return;
  a.lastWallId = a.wallId;
  a.wallCooldown = jumped ? WALL_COOLDOWN : 0.35;
  a.state = 'air';
  a.grounded = false;
  a.onWall?.(false);
}

export function wallJump(a: PlayerController): void {
  const nx = a.wallNx;
  const nz = a.wallNz;
  const sp = a.wallSpeed;
  exitWall(a, true);
  a.vx = a.wallDirX * sp + nx * 6.3;
  a.vz = a.wallDirZ * sp + nz * 6.3;
  a.vy = 7.7;
  a.jumpLock = 0.1;
  a.jumpBuffer = 0;
  a.grounded = false;
  a.onJump?.();
}

export function tryVault(a: PlayerController, dirX: number, dirZ: number): boolean {
  if (a.state === 'vault' || a.state === 'mantle' || a.state === 'wallrun') return false;
  const hit = a.world.findVault(a, dirX, dirZ);
  if (!hit) return false;
  a.state = 'vault';
  a.grounded = false;
  a.kinT = 0;
  a.kinDur = 0.36;
  a.kinKind = 'vault';
  a.kinSx = a.x;
  a.kinSy = a.y;
  a.kinSz = a.z;
  a.kinEx = hit.ex;
  a.kinEy = hit.ey;
  a.kinEz = hit.ez;
  a.kinPeak = hit.peak;
  a.kinDirX = hit.dirX;
  a.kinDirZ = hit.dirZ;
  a.kinSpeed = Math.max(SPRINT_SPEED * 0.82, Math.hypot(a.vx, a.vz));
  a.height = STAND_HEIGHT;
  a.onVault?.();
  return true;
}

export function tryMantle(a: PlayerController): boolean {
  if (a.state !== 'air' || a.grounded) return false;
  if (a.vy < -7.5) return false;
  const hit = a.world.findLedge(a, a.vx, a.vz);
  if (!hit) return false;
  a.state = 'mantle';
  a.kinT = 0;
  a.kinDur = 0.4;
  a.kinKind = 'mantle';
  a.kinSx = a.x;
  a.kinSy = a.y;
  a.kinSz = a.z;
  a.kinEx = hit.ex;
  a.kinEy = hit.ey;
  a.kinEz = hit.ez;
  a.kinPeak = hit.top;
  a.kinDirX = hit.dirX;
  a.kinDirZ = hit.dirZ;
  a.kinSpeed = Math.max(4.5, Math.hypot(a.vx, a.vz) * 0.45);
  a.height = STAND_HEIGHT;
  a.onMantle?.();
  return true;
}

export function tickKinematic(a: PlayerController, dt: number): boolean {
  a.kinT += dt;
  const u = Math.max(0, Math.min(1, a.kinT / a.kinDur));
  a.actionBlend = Math.sin(Math.PI * u);
  if (a.kinKind === 'vault') {
    const s = smooth(u);
    const baseY = a.kinSy + (a.kinEy - a.kinSy) * s;
    const extra = Math.sin(Math.PI * u) * Math.max(0.08, a.kinPeak - Math.max(a.kinSy, a.kinEy));
    a.x = a.kinSx + (a.kinEx - a.kinSx) * s;
    a.z = a.kinSz + (a.kinEz - a.kinSz) * s;
    a.y = baseY + extra;
  } else if (u < 0.52) {
    const k = smooth(u / 0.52);
    a.x = a.kinSx;
    a.z = a.kinSz;
    a.y = a.kinSy + (a.kinEy - a.kinSy) * k;
  } else {
    const k = smooth((u - 0.52) / 0.48);
    a.y = a.kinEy;
    a.x = a.kinSx + (a.kinEx - a.kinSx) * k;
    a.z = a.kinSz + (a.kinEz - a.kinSz) * k;
  }
  a.vx = a.kinDirX * a.kinSpeed;
  a.vz = a.kinDirZ * a.kinSpeed;
  a.vy = 0;
  if (u >= 1) {
    a.x = a.kinEx;
    a.y = a.kinEy;
    a.z = a.kinEz;
    a.vx = a.kinDirX * a.kinSpeed;
    a.vz = a.kinDirZ * a.kinSpeed;
    a.vy = 0;
    a.state = 'ground';
    a.grounded = true;
    a.height = STAND_HEIGHT;
    a.jumpLock = 0.06;
    a.actionBlend = 0;
    return true;
  }
  return false;
}
