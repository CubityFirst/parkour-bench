/**
 * Tuning values for the player. Units are metres and seconds.
 *
 * Derived numbers worth knowing when editing:
 * - Jump apex = jumpSpeed² / (2 * gravity) ≈ 1.19 m.
 * - A flat sprint jump covers roughly 6 m before landing back at roof height,
 *   so level gaps are kept at or below ~5 m unless they are meant to be wall-run.
 */
export const MOVE = {
  /** Physics always advances in fixed steps so behaviour is identical at any frame rate. */
  fixedStep: 1 / 120,
  /** Largest real frame time fed into the simulation (avoids a spiral of death). */
  maxFrameTime: 0.1,

  gravity: 27,
  maxFallSpeed: 46,

  /** Half of the player's horizontal footprint (the body is a box). */
  bodyHalfWidth: 0.32,
  standHeight: 1.8,
  crouchHeight: 0.9,
  standEye: 1.62,
  crouchEye: 0.86,
  /** How quickly the camera height follows the crouch / stand transition (1/s). */
  eyeLerp: 14,
  /** Falling below this height respawns the player at the latest checkpoint. */
  deathY: -24,

  walkSpeed: 7.0,
  sprintSpeed: 10.5,
  crouchWalkSpeed: 4.0,
  /** Ground acceleration toward the wished velocity (m/s²). */
  groundAccel: 48,
  /** Deceleration when no movement key is held (m/s²). */
  groundFriction: 22,
  /** Removes sideways velocity while on the ground so turns stay crisp (1/s). */
  lateralGrip: 16,
  /** Bleeds speed above the walk/sprint cap slowly, so slides and wall runs keep momentum (m/s²). */
  overspeedBleed: 4.0,
  /** Seconds of halved acceleration after touching down. */
  landingControl: 0.12,
  /** Fraction of horizontal speed lost on a hard landing. */
  landingLoss: 0.05,
  /** Downward speed (m/s) above which a landing counts as hard. */
  hardLandingSpeed: 9,

  /** Air steering acceleration (m/s²). Momentum is never removed in the air. */
  airAccel: 10,
  /** Steering cannot push speed along the wish direction above this. */
  airSteerCap: 11.5,

  jumpSpeed: 8.0,
  /** Vertical velocity multiplier applied when jump is released early (variable height). */
  jumpCut: 0.5,
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  slideBuffer: 0.15,

  slideMinSpeed: 4.5,
  /** Friction while sliding (m/s²). Speed falls gradually instead of stopping dead. */
  slideFriction: 2.2,
  slideMaxTime: 0.95,
  slideEndSpeed: 2.5,

  wallMinSpeed: 6.0,
  wallMaxTime: 1.6,
  /** Speed lost per second along a wall. */
  wallDecay: 0.6,
  /** Share of gravity applied while wall running. */
  wallGravity: 0.14,
  /** Pulls vertical speed toward zero so the runner holds height (1/s). */
  wallHoverDamp: 6,
  /** How far from a wall the body can be and still latch on (m). */
  wallProbe: 0.45,
  /** Gentle push into the wall that keeps the runner in contact (m/s). */
  wallStick: 2.5,
  wallJumpUp: 7.4,
  wallJumpOut: 6.5,
  /** Time after a wall jump before a wall can be latched again. */
  wallCooldown: 0.25,

  /** Obstacle top height above the feet that can be vaulted. */
  vaultMinHeight: 0.3,
  vaultMaxHeight: 1.25,
  /** How far in front of the body an obstacle face may be (m). */
  vaultReach: 0.8,
  /** Maximum depth of an obstacle that can be vaulted over (m). */
  vaultMaxDepth: 2.4,

  /** Ledge heights above the feet that can be mantled while airborne. */
  mantleMinHeight: 0.8,
  mantleMaxHeight: 1.75,
  mantleReach: 0.45,
} as const;
