/** Wishdir acceleration. Overspeed (current > wishSpeed) is kept, so jumps carry momentum. */
export function accelerate(
  vx: number,
  vz: number,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): { vx: number; vz: number } {
  const current = vx * wishX + vz * wishZ;
  const add = wishSpeed - current;
  if (add <= 0) return { vx, vz };
  let a = accel * dt;
  if (a > add) a = add;
  return { vx: vx + wishX * a, vz: vz + wishZ * a };
}

export function applyFriction(
  vx: number,
  vz: number,
  decel: number,
  dt: number,
): { vx: number; vz: number } {
  const sp = Math.hypot(vx, vz);
  if (sp < 0.0001) return { vx: 0, vz: 0 };
  const next = Math.max(0, sp - decel * dt);
  const k = next / sp;
  return { vx: vx * k, vz: vz * k };
}

/** Bleed horizontal speed down toward a floor, never below it. */
export function bleedTo(
  vx: number,
  vz: number,
  floor: number,
  decel: number,
  dt: number,
): { vx: number; vz: number } {
  const sp = Math.hypot(vx, vz);
  if (sp <= floor + 0.02) return { vx, vz };
  const next = Math.max(floor, sp - decel * dt);
  const k = next / sp;
  return { vx: vx * k, vz: vz * k };
}

/** Shed the part of velocity perpendicular to the wish direction. */
export function shedLateral(
  vx: number,
  vz: number,
  wishX: number,
  wishZ: number,
  rate: number,
  dt: number,
): { vx: number; vz: number } {
  const along = vx * wishX + vz * wishZ;
  const px = vx - wishX * along;
  const pz = vz - wishZ * along;
  const keep = Math.max(0, 1 - rate * dt);
  return { vx: wishX * along + px * keep, vz: wishZ * along + pz * keep };
}
