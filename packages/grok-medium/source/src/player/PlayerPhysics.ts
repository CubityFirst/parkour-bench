import { PHYS } from './constants';

export function accelerate(
  vx: number,
  vz: number,
  wx: number,
  wz: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): { vx: number; vz: number } {
  const current = vx * wx + vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return { vx, vz };
  let a = accel * dt * wishSpeed;
  if (a > add) a = add;
  return { vx: vx + wx * a, vz: vz + wz * a };
}

export function applyFriction(
  vx: number,
  vz: number,
  dt: number,
  friction: number,
): { vx: number; vz: number } {
  const speed = Math.hypot(vx, vz);
  if (speed < 0.08) return { vx: 0, vz: 0 };
  const ns = Math.max(0, speed - speed * friction * dt);
  const k = ns / speed;
  return { vx: vx * k, vz: vz * k };
}

export function wishVector(
  fx: number,
  fz: number,
  rx: number,
  rz: number,
  forward: number,
  strafe: number,
): { wx: number; wz: number; mag: number } {
  let wx = fx * forward + rx * strafe;
  let wz = fz * forward + rz * strafe;
  const mag = Math.hypot(wx, wz);
  if (mag > 1) {
    wx /= mag;
    wz /= mag;
    return { wx, wz, mag: 1 };
  }
  if (mag < 1e-5) return { wx: 0, wz: 0, mag: 0 };
  return { wx: wx / mag, wz: wz / mag, mag };
}

export function sprinting(forward: number, sprint: boolean, grounded: boolean, sliding: boolean): boolean {
  return sprint && forward > 0.2 && grounded && !sliding;
}

export const SPEED = PHYS;
