/**
 * All movement tuning in one place. Distances are metres, speeds m/s,
 * accelerations m/s², times seconds.
 *
 * Useful derived numbers (used when designing the level):
 *  - Jump apex:            JUMP_VELOCITY² / (2·GRAVITY)            ≈ 1.20 m
 *  - Flat jump air time:   rise 0.317 s + fall 0.289 s             ≈ 0.61 s
 *  - Flat sprint jump:     SPRINT_SPEED · 0.61                     ≈ 6.5 m
 *  - Flat run jump:        RUN_SPEED · 0.61                        ≈ 4.1 m
 *  - Ledge grab:           feet can be up to LEDGE_REACH below a roof edge
 *  - Wall run:             ~1.35 s at ≥ sprint speed               ≈ 14 m
 */
export const MOVE = {
  // --- Body -----------------------------------------------------------------
  HALF_WIDTH: 0.3,
  STAND_HEIGHT: 1.8,
  CROUCH_HEIGHT: 0.9,
  STAND_EYE: 1.62,
  CROUCH_EYE: 0.8,
  STEP_HEIGHT: 0.42,
  GROUND_SNAP: 0.3,

  // --- Gravity & jumping ----------------------------------------------------
  GRAVITY: 24,
  /** Extra gravity while falling – makes jumps feel snappy instead of floaty. */
  FALL_GRAVITY_MULT: 1.2,
  /** Extra gravity while rising after jump was released early (variable height). */
  JUMP_CUT_GRAVITY_MULT: 2.6,
  MAX_FALL_SPEED: 45,
  JUMP_VELOCITY: 7.6,
  COYOTE_TIME: 0.12,
  JUMP_BUFFER: 0.15,

  // --- Ground movement ------------------------------------------------------
  RUN_SPEED: 6.8,
  SPRINT_SPEED: 10.8,
  CROUCH_SPEED: 3.0,
  /** Acceleration from standstill up to run speed. */
  GROUND_ACCEL: 42,
  /** Slower acceleration from run speed up to sprint speed (momentum matters). */
  SPRINT_ACCEL: 8.5,
  /** Braking with no input. */
  GROUND_FRICTION: 26,
  /** Braking when actively pushing against the current direction. */
  REVERSE_BRAKE: 38,
  /** How fast speed above the current target bleeds away on the ground. */
  OVERSPEED_DECAY: 5,
  /** Velocity turn rate (rad/s) at low and at full sprint speed. */
  TURN_RATE_SLOW: 22,
  TURN_RATE_FAST: 7.5,
  /** Landing faster than this (vertical m/s) is a hard landing that costs speed. */
  HARD_LANDING_SPEED: 16,

  // --- Air ------------------------------------------------------------------
  AIR_ACCEL: 9,
  /** Air control may never push horizontal speed beyond this unless you already had more. */
  AIR_MAX_CONTROL_SPEED: 6.8,

  // --- Slide ----------------------------------------------------------------
  SLIDE_MIN_START_SPEED: 4.2,
  SLIDE_BOOST: 1.4,
  SLIDE_MAX_SPEED: 13.5,
  SLIDE_FRICTION: 2.6,
  /** Friction grows the longer you slide (m/s² per second of sliding). */
  SLIDE_FRICTION_GROWTH: 3.6,
  SLIDE_END_SPEED: 3.4,
  SLIDE_MIN_TIME: 0.3,
  SLIDE_STEER_RATE: 1.4,
  SLIDE_BUFFER: 0.2,

  // --- Wall run -------------------------------------------------------------
  WALLRUN_MIN_SPEED: 5.2,
  WALLRUN_MIN_SPEED_KEEP: 7.5,
  WALLRUN_MAX_SPEED: 13,
  WALLRUN_MAX_TIME: 1.35,
  WALLRUN_START_VY_MIN: 1.0,
  WALLRUN_START_VY_MAX: 3.3,
  /** Gravity during a wall run starts low and ramps up (gives a rising arc). */
  WALLRUN_GRAVITY_START: 4,
  WALLRUN_GRAVITY_RAMP: 6.5,
  WALLRUN_PROBE: 0.55,
  WALLRUN_MAX_FALL_SPEED_TO_START: 8,
  WALLRUN_COOLDOWN: 0.35,
  WALL_JUMP_VY: 7.2,
  WALL_JUMP_PUSH: 4.6,
  WALL_JUMP_GRACE: 0.15,

  // --- Vault & mantle -------------------------------------------------------
  VAULT_MIN_HEIGHT: 0.45,
  VAULT_MAX_HEIGHT: 1.35,
  VAULT_MAX_DEPTH: 2.2,
  VAULT_REACH: 1.5,
  VAULT_MIN_EXIT_SPEED: 6.5,
  LEDGE_MIN_HEIGHT: 0.35,
  LEDGE_REACH: 2.05,
  LEDGE_MAX_FALL_SPEED: 14,
} as const;

/** Fixed physics step (120 Hz). */
export const PHYSICS_DT = 1 / 120;
