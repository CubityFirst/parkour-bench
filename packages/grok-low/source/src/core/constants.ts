/** Meters, seconds, and the one rig yaw the camera and the respawn points share. */

export const HW = 0.32;
export const STAND_H = 1.74;
export const SLIDE_H = 0.86;
export const EYE_STAND = 1.58;
export const EYE_SLIDE = 0.46;

export const WALK_SPEED = 6.1;
export const SPRINT_SPEED = 11.05;
export const CROUCH_SPEED = 3.45;
export const GROUND_ACCEL = 78;
export const GROUND_FRICTION = 18;
export const AIR_ACCEL = 13;
export const GRAVITY = 24;
export const JUMP_V = 8.75;
export const COYOTE = 0.13;
export const JUMP_BUFFER = 0.14;
/** A tap shorter than this trims the jump. A normal press gets full height. */
export const JUMP_CUT_WINDOW = 0.085;

export const SLIDE_FRICTION = 1.62;
export const SLIDE_ENTER = 5.5;
export const SLIDE_MIN = 3.5;
export const STEP_H = 0.28;
export const SKIN = 0.006;

export const WALL_MIN_SPEED = 6.4;
export const WALL_MAX_TIME = 3.05;
export const WALL_SINK = 0.38;
export const WALL_JUMP_OUT = 6.3;
export const WALL_JUMP_UP = 8.5;
export const WALL_PROBE = 0.85;
export const WALL_COOLDOWN = 0.28;

export const VAULT_DUR = 0.3;
export const MANTLE_DUR = 0.36;
export const FIXED_DT = 1 / 120;

/**
 * Player-rig `rotation.y` that looks along world +X.
 * Three.js local forward is −Z, and a negative yaw turns that axis toward +X.
 * Movement never re-derives this; it reads the camera after the rig applies it.
 */
export const LOOK_YAW = -Math.PI / 2;

export const KILL_Y = -28;

export const F_SOLID = 1;
export const F_WALLRUN = 2;

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Largest edge-to-edge gap a sprint jump can clear.
 * `drop` is positive when the landing roof is lower than the takeoff roof.
 * The 0.88 factor leaves room for a takeoff that is not pixel-perfect.
 */
export function sprintGapBudget(drop: number): number {
  const disc = JUMP_V * JUMP_V + 2 * GRAVITY * drop;
  if (disc <= 0) return 0;
  const t = (JUMP_V + Math.sqrt(disc)) / GRAVITY;
  const centerTravel = SPRINT_SPEED * t;
  return (centerTravel - 2 * HW - 0.28) * 0.88;
}
