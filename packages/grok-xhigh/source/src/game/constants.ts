/** Metres, seconds, and the jump model the course is validated against. */
export const PHYS = {
  radius: 0.32,
  standHeight: 1.74,
  slideHeight: 0.64,
  standEye: 1.52,
  slideEye: 0.42,
  walkSpeed: 6.5,
  sprintSpeed: 12,
  groundAccel: 88,
  groundDecel: 15,
  airAccel: 16,
  slideFriction: 1.2,
  gravity: 26,
  jumpSpeed: 8.9,
  coyote: 0.13,
  jumpBuffer: 0.13,
  stepHeight: 0.42,
  wallProbe: 0.95,
  wallSkin: 0.08,
  wallFaceGap: 0.9,
  wallGravity: 0.2,
  wallMaxTime: 2.4,
  wallMinSpeed: 6,
  wallBoost: 10.5,
  wallJumpUp: 7.4,
  wallJumpOff: 6.3,
  fallY: 6,
  fixedDt: 1 / 120,
  maxFrameDt: 0.05,
  vaultDuration: 0.42,
  mantleDuration: 0.34,
  maxSpeed: 14,
} as const

/** Later root of y = vt - ½gt². Zero when the height is above the jump apex. */
export function airtimeToHeight(dy: number): number {
  const v = PHYS.jumpSpeed
  const g = PHYS.gravity
  const disc = v * v - 2 * g * dy
  if (disc < 0) return 0
  return (v + Math.sqrt(disc)) / g
}

/**
 * Longest roof-to-roof gap a straight sprint jump can clear comfortably.
 * The body is an AABB: support holds until the back foot leaves, and the
 * next roof catches the front foot, so the centre travels `gap - 2r`.
 * `early` is how far before the lip a real jump tends to happen.
 */
export function maxComfortGap(speed: number, dy: number, early = 1): number {
  const t = airtimeToHeight(dy)
  if (t <= 0) return 0
  return speed * t - early + 2 * PHYS.radius - 0.45
}

/** Gap that remains impossible even with a perfect late jump and full overhang. */
export function impossibleGap(dy: number): number {
  const t = airtimeToHeight(dy)
  return PHYS.sprintSpeed * t + 2 * PHYS.radius + 0.35
}
