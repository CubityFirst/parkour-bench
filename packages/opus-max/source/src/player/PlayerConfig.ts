/**
 * All movement tuning in one place. Units are metres, seconds and radians.
 *
 * Reference numbers the level is designed around (flat ground, no coyote time):
 *  - sprint jump: ~1.15 m apex, ~0.6 s airtime, ~6 m horizontal distance
 *  - run jump:    ~3.8 m horizontal distance
 *  - mantle reach: ledges up to 2.25 m above the feet can be climbed
 * Gaps that must be wall-run are 13 m or more, well beyond any normal jump.
 */
export const PlayerConfig = {
  // Body
  RADIUS: 0.35,
  STAND_HEIGHT: 1.8,
  CROUCH_HEIGHT: 0.9,
  EYE_STAND: 1.62,
  EYE_CROUCH: 0.82,
  EYE_SLIDE: 0.74,

  // Ground locomotion
  RUN_SPEED: 6.4,
  SPRINT_SPEED: 10.0,
  CROUCH_SPEED: 2.8,
  /** Acceleration from standstill up to run speed. */
  GROUND_ACCEL: 42,
  /** Slower acceleration between run and sprint speed: the "build-up" of a sprint. */
  SPRINT_ACCEL: 7.5,
  /** Deceleration with no input. */
  GROUND_FRICTION: 30,
  /** How quickly sideways (off-direction) velocity is removed: grip when turning. */
  GROUND_GRIP: 40,
  /** Deceleration when moving faster than the target speed (momentum is kept for a while). */
  OVERSPEED_DECAY: 5,

  // Air
  AIR_ACCEL: 6,
  AIR_TARGET_SPEED: 5.5,
  AIR_GRIP: 3,

  // Gravity and jumping
  GRAVITY: 24,
  FALL_GRAVITY_MULT: 1.15,
  /** Gravity multiplier while rising after the jump key was released (variable jump height). */
  JUMP_CUT_GRAVITY_MULT: 2.4,
  JUMP_VELOCITY: 7.4,
  MAX_FALL_SPEED: 45,
  COYOTE_TIME: 0.12,
  JUMP_BUFFER: 0.13,

  // Collision helpers
  STEP_HEIGHT: 0.45,
  AIR_STEP_HEIGHT: 0.32,
  SNAP_DOWN: 0.4,

  // Landing
  HARD_LANDING_SPEED: 18,
  HARD_LANDING_SPEED_KEEP: 0.55,

  // Slide
  SLIDE_MIN_SPEED: 4.5,
  SLIDE_BOOST: 1.3,
  SLIDE_BOOST_COOLDOWN: 0.75,
  SLIDE_MAX_SPEED: 12.5,
  SLIDE_FRICTION: 3.9,
  SLIDE_BRAKE: 9,
  SLIDE_END_SPEED: 3.2,
  SLIDE_MIN_TIME: 0.3,
  /** Max steering rate while sliding (rad/s). */
  SLIDE_STEER: 0.9,

  // Wall run
  WALLRUN_MIN_SPEED: 5.2,
  WALLRUN_ENTRY_MIN_SPEED: 7.5,
  WALLRUN_SPEED: 9.6,
  WALLRUN_MAX_SPEED: 12.5,
  WALLRUN_MAX_TIME: 1.45,
  WALLRUN_PROBE: 0.62,
  WALLRUN_VY_MIN: 1.0,
  WALLRUN_VY_MAX: 3.8,
  WALLRUN_ENTRY_MAX_FALL: -5.5,
  /** Gravity scale at the start and end of a wall run (eased in between). */
  WALLRUN_GRAVITY_START: 0.12,
  WALLRUN_GRAVITY_END: 0.85,
  WALLRUN_MAX_DOWN_SPEED: 7,
  WALLRUN_MAX_CHAIN: 3,
  WALLJUMP_UP: 7.2,
  WALLJUMP_MIN_SPEED: 8.5,
  WALLJUMP_COYOTE: 0.18,

  // Vault
  VAULT_MIN_HEIGHT: 0.4,
  VAULT_MAX_HEIGHT: 1.35,
  VAULT_MAX_DEPTH: 2.4,
  VAULT_MIN_EXIT_SPEED: 6.2,

  // Mantle / ledge recovery
  MANTLE_MIN_HEIGHT: 0.3,
  MANTLE_REACH: 2.25,

  // Zipline
  ZIP_HANG: 2.05,
  ZIP_MIN_SPEED: 5,
  ZIP_MAX_SPEED: 17,
  ZIP_DRAG: 0.004,
  ZIP_END_MARGIN: 5,
} as const;
