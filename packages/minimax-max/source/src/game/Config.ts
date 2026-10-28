/**
 * Central tuning table for the whole game.
 *
 * Every number that influences how the game feels lives here so that the
 * movement code stays readable and the values can be balanced in one place.
 */
export const PHYSICS = {
  /** Downward acceleration (m/s^2). */
  gravity: 24,
  /** Ground speed while walking (m/s). */
  walkSpeed: 5.4,
  /** Ground speed while sprinting (m/s). */
  sprintSpeed: 8.7,
  /** How quickly the player reaches the target speed on the ground. */
  groundAccel: 78,
  /** Friction applied on the ground when there is no input. */
  groundFriction: 12,
  /** Acceleration available while airborne. */
  airAccel: 26,
  /** Very light air drag so momentum survives long jumps. */
  airDrag: 0.12,

  /** Upward velocity of a jump (m/s). */
  jumpVelocity: 9.7,
  /** Velocity multiplier applied when the jump button is released early. */
  jumpCut: 0.42,
  /** Grace period after leaving a ledge where a jump still works. */
  coyoteTime: 0.12,
  /** Time a jump press is remembered before landing. */
  jumpBuffer: 0.16,

  /** Half width of the player collision box. */
  playerRadius: 0.34,
  /** Height while standing. */
  standHeight: 1.78,
  /** Height while sliding. */
  slideHeight: 0.85,
  /** Eye offset above the feet while standing / sliding. */
  eyeStand: 1.6,
  eyeSlide: 0.62,

  /** Maximum height the player can walk over without jumping. */
  stepHeight: 0.46,

  /** Minimum horizontal speed required to start a slide. */
  slideMinSpeed: 3.2,
  /** Speed granted when a slide starts. */
  slideBoost: 9.4,
  /** Friction applied while sliding. */
  slideFriction: 2.6,
  /** A slide never ends before this time (seconds). */
  slideMinDuration: 0.2,
  /** Steering authority while sliding. */
  slideSteer: 9,

  /** Obstacles between these heights (relative to the feet) can be vaulted. */
  vaultMin: 0.45,
  vaultMax: 1.4,
  /** Maximum thickness of a vaultable obstacle. */
  vaultMaxDepth: 2.2,
  vaultDuration: 0.34,

  /** Highest ledge the player can pull themself up over. */
  mantleMax: 1.75,
  mantleMin: 0.35,
  mantleDuration: 0.42,

  /** Minimum speed needed to attach to a wall. */
  wallRunMinSpeed: 4.2,
  /** Hard limit of a single wall run (seconds). */
  wallRunMaxTime: 1.75,
  /** Gravity multiplier while running on a wall. */
  wallRunGravity: 0.1,
  /** Upward kick applied when a wall run starts. */
  wallRunLift: 2.2,
  /** Pull towards the wall that keeps the player attached. */
  wallRunStick: 4.2,
  /** Search radius for a runnable wall. */
  wallRunRange: 1.8,
  /** Cooldown before another wall may be attached. */
  wallRunCooldown: 0.22,
  /** Velocity added away from the wall when jumping off it. */
  wallJumpOut: 5.4,
  wallJumpUp: 7.4,

  /** Below this height the player is considered to have fallen. */
  fallY: -18,
} as const;

export const CAMERA = {
  fovBase: 74,
  fovSprint: 84,
  fovWall: 88,
  fovLerp: 6,
  /** Vertical head bob amplitude while sprinting (m). */
  bobAmount: 0.055,
  bobFrequency: 2.1,
  /** Horizontal head bob amplitude (m). */
  bobLateral: 0.035,
  /** Camera roll while strafing (radians). */
  strafeRoll: 0.028,
  /** Camera roll while wall running (radians). */
  wallRoll: 0.16,
  /** How quickly the camera catches up with the body. */
  positionLerp: 18,
  pitchLimit: Math.PI / 2 - 0.02,
} as const;

export const COLORS = {
  white: 0xf3f4f2,
  whiteWarm: 0xe9e9e4,
  concrete: 0xd6d9db,
  gray: 0xa8aeb4,
  dark: 0x4a4f55,
  red: 0xe8251c,
  redBright: 0xff3b30,
  orange: 0xe2761f,
  glass: 0x8fc4e0,
  skyTop: 0x2b80d6,
  skyHorizon: 0xe2f0f9,
  sun: 0xfff3dc,
} as const;
