/**
 * All movement tuning lives here so the level design (gap widths, wall lengths, duct heights)
 * can be checked against the numbers in one place. Units: metres, seconds.
 */
export const MOVE = {
  // --- ground locomotion -------------------------------------------------------------
  walkSpeed: 5.5,
  sprintSpeed: 9.6,
  backwardMultiplier: 0.8,
  crouchSpeed: 3.4,
  groundAccel: 30,
  /** Extra acceleration when changing direction sharply, so turns feel crisp. */
  turnAccelBoost: 1.5,
  groundDecel: 26,
  /** Deceleration applied when above the speed cap (momentum from slides / jumps bleeds off slowly). */
  overspeedFriction: 4.5,

  // --- air ---------------------------------------------------------------------------
  gravity: 28,
  fallGravityMultiplier: 1.15,
  terminalVelocity: 50,
  jumpSpeed: 9.0,
  /** Releasing jump early caps upward speed at this value (variable jump height). */
  jumpCutSpeed: 3.6,
  airAccel: 9,
  coyoteTime: 0.11,
  jumpBufferTime: 0.13,
  /** Landing faster than this scrubs horizontal speed. */
  hardLandImpact: 17,

  // --- slide -------------------------------------------------------------------------
  slideMinSpeed: 4.0,
  slideBoost: 1.12,
  slideMinStartSpeed: 7.0,
  slideMaxStartSpeed: 11.5,
  slideFriction: 4.2,
  slideEndSpeed: 3.2,
  /** Minimum forward speed kept while sliding under a ceiling so the player can never get stuck. */
  slideStuckSpeed: 3.4,
  slideSteerRate: 1.1,
  slideMinTime: 0.25,
  slideCooldown: 0.2,

  // --- wall run ----------------------------------------------------------------------
  wallRunMinSpeed: 6.0,
  wallRunSpeed: 8.8,
  wallDetectDistance: 1.45,
  wallRunMaxTime: 2.1,
  /** Total wall-run seconds allowed per airborne period (reset on landing). */
  wallRunBudget: 3.2,
  wallGravityScale: 0.09,
  wallMaxFall: 3.0,
  wallMinAttachVy: 1.2,
  wallMaxAttachVy: 3.0,
  wallFriction: 0.7,
  wallJumpOut: 5.2,
  wallJumpUp: 8.6,
  wallReattachCooldown: 0.3,

  // --- vault / mantle ----------------------------------------------------------------
  vaultReach: 1.8,
  vaultMinRise: 0.33,
  vaultMaxRise: 1.5,
  vaultMaxDepth: 2.4,
  vaultBufferTime: 0.3,
  mantleReach: 0.6,
  mantleMinRise: 0.5,
  mantleMaxRise: 2.0,
  mantleCooldown: 0.35,

  // --- misc --------------------------------------------------------------------------
  maxSpeed: 16,
} as const;
