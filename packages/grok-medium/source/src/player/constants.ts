/** Tuned so a sprint jump clears about 6.4 m and a 1.25 m lip, not an 8 m gap. */
export const PHYS = {
  radius: 0.32,
  standH: 1.74,
  slideH: 0.62,
  eyeStand: 1.56,
  eyeSlide: 0.5,
  walk: 6.15,
  sprint: 10.9,
  groundAccel: 10,
  airAccel: 2.15,
  friction: 6.5,
  slideDecel: 1.25,
  crawl: 4.3,
  gravity: 27,
  jumpV: 8.2,
  coyote: 0.12,
  jumpBuffer: 0.14,
  stepHeight: 0.4,
  wallMinSpeed: 7.1,
  wallMaxTime: 1.85,
  wallStick: 0.46,
  fixedDt: 1 / 60,
};

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
