/**
 * Central tuning values for the player controller. All distances are in metres,
 * speeds in m/s, accelerations in m/s^2 and times in seconds.
 *
 * The level layout is designed against exactly these numbers (see tools/route-bot.mjs, which
 * replays the whole course through the real controller to prove every jump is makeable).
 */

/** Fixed physics step. 120 Hz keeps per-step displacement well below any collider thickness. */
export const FIXED_DT = 1 / 120;
export const MAX_STEPS_PER_FRAME = 10;

export const PLAYER = {
  halfWidth: 0.3,
  standHeight: 1.8,
  slideHeight: 0.9,
  eyeStand: 1.65,
  eyeSlide: 0.6,
  /** Largest ledge that is walked over without jumping. */
  stepHeight: 0.36,
  /** Smaller auto step used while falling (corner forgiveness). */
  stepHeightAir: 0.28,
  /** Largest distance a single collision sub-step may travel (prevents tunnelling). */
  maxSubstep: 0.18,
} as const;

export const MOVE = {
  walkSpeed: 5.4,
  sprintSpeed: 9.0,
  /** Extra sprint speed unlocked by chaining moves without losing momentum (see `flow`). */
  sprintSpeedMax: 10.6,
  crouchSpeed: 3.0,
  /** Hard cap on horizontal speed from any source. */
  speedCap: 12.5,

  groundAccel: 17,
  /** Lateral grip: how fast the sideways part of the velocity is bled off (crisp turning). */
  groundGrip: 44,
  /** Deceleration when the player is faster than the current target speed (e.g. after a slide). */
  overspeedDecel: 7.5,
  /** Deceleration when no input is held. */
  stopDecel: 24,
  /** Acceleration when pushing against the current velocity (braking / reversing). */
  brakeAccel: 48,

  airAccel: 11,

  gravity: 28,
  /** Gravity multiplier while falling - makes the descent snappier than the ascent. */
  fallGravityMult: 1.18,
  /** Gravity multiplier while rising with the jump button released (variable jump height). */
  jumpCutMult: 2.6,
  terminalVelocity: 55,

  jumpSpeed: 8.6,
  coyoteTime: 0.11,
  jumpBufferTime: 0.13,
  vaultBufferTime: 0.3,

  /** After landing, friction ramps back in over this time ("controlled friction when landing"). */
  landFrictionTime: 0.22,
  landFrictionMin: 0.3,
  /** Fall speeds above this start to cost momentum unless the player rolls into a slide. */
  hardLandSpeed: 13,
} as const;

export const FLOW = {
  /** Flow (0..1) builds while sprinting without losing speed ... */
  riseRate: 0.38,
  /** ... and drains while not sprinting. */
  decayRate: 0.9,
  /** A hard wall bump resets it. */
  bumpPenalty: 1.0,
} as const;

export const SLIDE = {
  minSpeed: 5.0,
  /** Speed bonus multiplier applied when a slide starts (capped by `maxStartSpeed`). */
  startBoost: 1.06,
  maxStartSpeed: 11.2,
  friction: 4.4,
  /** Slide ends once it has slowed to this speed. */
  endSpeed: 2.9,
  minTime: 0.28,
  /** Steering rate while sliding (rad/s). */
  steerRate: 1.2,
  /** Roll the landing into a slide when the slide key is held within this window before touchdown. */
  rollWindow: 0.18,
} as const;

export const WALL = {
  minSpeed: 5.0,
  /** Wall must be within this distance of the player's side to latch on. */
  attachReach: 1.1,
  /** ... and within this distance to stay attached. */
  stickReach: 1.4,
  /** Steepest approach angle (sine of angle between velocity and wall plane). */
  maxApproach: 0.84,
  maxTime: 2.3,
  /** Total wall-run time allowed per airborne sequence (anti-exploit). */
  maxTimePerAir: 3.4,
  maxAttachesPerAir: 3,
  sameWallCooldown: 0.65,
  /** Fraction of normal gravity at the start / end of a wall run. */
  gravityStart: 0.1,
  gravityEnd: 0.65,
  maxFallSpeed: 7,
  pullSpeed: 1.6,
  runSpeedMin: 7.6,
  runSpeedMax: 11,
  jumpUp: 7.4,
  jumpOut: 5.4,
  /** Minimum time on a wall before jumping off is allowed to beat the attach check. */
  attachGrace: 0.05,
  /** Camera roll toward the wall (radians). */
  cameraRoll: 0.2,
} as const;

export const LEDGE = {
  vaultMinRise: 0.42,
  vaultMaxRise: 1.4,
  vaultMaxDepth: 2.6,
  /** Just above the air step height (0.28 m) so a near-miss never falls into a dead zone. */
  mantleMinRise: 0.35,
  mantleMaxRiseGround: 1.95,
  mantleMaxRiseAir: 2.05,
  mantleMinDepth: 0.8,
  reachBase: 0.75,
  reachPerSpeed: 0.1,
  vaultSpeedMin: 5.8,
  mantleExitSpeed: 4.8,
  /** Sprinting into an obstacle this low (m) hops it automatically; taller ones need E. */
  autoVaultMaxRise: 0.82,
  autoVaultMinSpeed: 6.5,
} as const;

export const CAMERA = {
  baseHFov: 90,
  maxFovBoost: 9,
  nearPlane: 0.05,
  farPlane: 4200,
  maxPitch: (Math.PI / 2) * 0.985,
  /** Default mouse sensitivity in radians per pixel at slider value 1.0. */
  radiansPerPixel: 0.0017,
} as const;
