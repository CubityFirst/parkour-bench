/**
 * All movement tunables in one place. Units: metres, seconds.
 *
 * The level is designed against these numbers (see scripts/verify-level.ts, which
 * replays the intended route through the real physics code to prove every jump,
 * slide, vault and wall-run is achievable).
 */
export const MOVE = {
  // ---- ground locomotion
  runSpeed: 6.2,
  sprintSpeed: 9.8,
  backwardFactor: 0.72,
  /** m/s^2 towards the wish velocity (reaches sprint speed in ~0.28 s). */
  groundAccel: 36,
  /** m/s^2 of friction when no key is held. */
  groundDecel: 44,
  /** m/s^2 used to kill velocity that is not aligned with the wish direction (turning grip). */
  turnGrip: 60,
  /** m/s^2 bleed-off of speed above the current top speed (slide exits, landings). */
  overspeedDecel: 5.0,
  /** Same, but while the landing friction window is active. */
  landingOverspeedDecel: 11,
  landingFrictionTime: 0.22,

  // ---- air
  gravity: 27,
  fallGravityMultiplier: 1.15,
  /** Gravity multiplier while rising and the jump button is released (variable jump height). */
  jumpCutGravityMultiplier: 2.7,
  terminalVelocity: 52,
  jumpSpeed: 8.8,
  airAccel: 15,
  /** Air steering never accelerates beyond max(current speed, this). */
  airSpeedFloor: 6.2,
  coyoteTime: 0.11,
  jumpBufferTime: 0.13,

  // ---- slide
  slideMinEntrySpeed: 5.2,
  slideBoost: 1.06,
  slideMinSpeed: 7.4,
  slideFriction: 4.0,
  slideEndSpeed: 2.9,
  /** Slide is committed for this long even if the key is released early. */
  slideMinTime: 0.5,
  /** Slow crawl speed enforced when sliding under a low ceiling (never get stuck). */
  slideCrawlSpeed: 3.4,
  slideSteerRate: 1.1,
  slideBufferTime: 0.18,

  // ---- wall run
  wallRunMinSpeed: 6.2,
  wallRunSpeedFloor: 7.6,
  /** Max gap between the body and a wall for a wall run to *start* (generous: the red wall is a magnet). */
  wallRunAttachReach: 0.95,
  /** Max gap while already running (the body is pulled in against the wall). */
  wallRunReach: 0.5,
  wallRunPull: 3.5,
  wallRunMaxTime: 1.9,
  /** Total wall-run time allowed between two ground contacts (anti infinite wall run). */
  wallRunBudget: 2.6,
  wallRunGravity: 4.2,
  wallRunMaxFall: 4.0,
  wallRunEntryLift: 1.8,
  wallRunDecel: 0.9,
  wallJumpPush: 5.6,
  wallJumpUp: 8.4,
  wallRunCooldown: 0.4,

  // ---- vault / mantle
  vaultMinHeight: 0.4,
  vaultMaxHeight: 1.4,
  vaultMaxDepth: 1.5,
  vaultLookahead: 0.75,
  mantleMinHeight: 0.3,
  mantleMaxHeight: 1.8,
  /** Reach when already falling fast (vy < -6): only a ledge about hand height is caught. */
  mantleMaxHeightFalling: 1.1,
  interactBufferTime: 0.3,

  // ---- misc
  /** Falling below this height respawns the player. */
  killHeight: -28,
} as const;

/** Eye height above the feet. */
export const EYE = {
  stand: 1.62,
  slide: 0.62,
  vault: 1.25,
} as const;
