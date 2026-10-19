/** Tunable movement. Jump math (full hold):
 *  height = JUMP_SPEED^2 / (2 * GRAVITY) ≈ 1.36 m
 *  air time ≈ 0.64 s
 *  sprint travel ≈ 7.1 m (center). Edge gaps up to ~5.2 m are intended.
 */
export const GRAVITY = 26.5;
export const JUMP_SPEED = 8.5;
export const WALK_SPEED = 6.3;
export const SPRINT_SPEED = 11;
export const GROUND_ACCEL = 38;
export const AIR_ACCEL = 14;
export const GROUND_FRICTION = 16;
export const PERP_FRICTION = 10;
export const SPRINT_BLEED = 7;
export const COYOTE = 0.12;
export const JUMP_BUFFER = 0.14;
export const JUMP_CUT = 0.48;
export const RADIUS = 0.32;
export const STAND_HEIGHT = 1.76;
export const SLIDE_HEIGHT = 0.64;
export const EYE_STAND = 1.58;
export const EYE_SLIDE = 0.42;
export const SLIDE_MIN_ENTRY = 6.4;
export const SLIDE_FRICTION = 1.85;
export const SLIDE_BOOST = 1.06;
export const WALL_MIN_SPEED = 6.6;
export const WALL_MAX_TIME = 1.65;
export const WALL_GRAVITY_SCALE = 0.18;
export const WALL_DETECT = 1.05;
export const WALL_COOLDOWN = 0.55;
export const STEP_UP = 0.36;
export const FIXED_DT = 1 / 120;
export const KILL_Y = 28;
export const BASE_SENS = 0.00215;
