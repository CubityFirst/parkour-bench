/**
 * Tunable gameplay constants. All distances are metres, times seconds.
 *
 * Jump reference numbers (used when designing level gaps):
 *  - apex height  ≈ 1.5 m
 *  - flat sprint jump distance ≈ 6.5 m (at 10.5 m/s), walk jump ≈ 3.5 m
 *  - wall run covers ≈ 15 m before gravity wins
 */
export const PHYS = {
  fixedDt: 1 / 120,
  gravity: 28,
  /** Extra gravity multiplier when falling, makes jumps feel less floaty. */
  fallGravityMul: 1.15,
  maxFallSpeed: 42,

  walkSpeed: 5.5,
  sprintSpeed: 10.5,
  crouchSpeed: 3,
  groundAccel: 42,
  groundDecel: 32,
  airAccel: 13,

  jumpVelocity: 9.2,
  /** Vertical velocity multiplier applied when jump is released early. */
  jumpCutMul: 0.55,
  coyoteTime: 0.12,
  jumpBuffer: 0.13,

  radius: 0.3,
  standHeight: 1.8,
  slideHeight: 0.9,
  standEye: 1.65,
  slideEye: 0.78,
  stepHeight: 0.42,

  slideMinSpeed: 5.0,
  slideBoost: 1.6,
  slideMaxSpeed: 13.5,
  slideFriction: 3.6,
  slideEndSpeed: 3.2,
  slideSteer: 1.6,

  wallRunMinSpeed: 5.0,
  wallRunMaxTime: 1.5,
  wallRunGravity: 6,
  wallRunUpBoost: 3.6,
  wallRunMinAlongSpeed: 10.5,
  wallRunProbe: 0.55,
  wallJumpOut: 6.5,
  wallJumpUp: 8.4,

  vaultDuration: 0.36,
  vaultMinHeight: 0.3,
  vaultMaxHeight: 1.35,
  vaultReach: 1.6,
  vaultMaxDepth: 2.6,

  mantleDuration: 0.34,
  mantleMinHeight: 0.42,
  mantleMaxHeight: 2.15,

  /** Falling below this world height respawns the player. */
  killY: 30,
};

export const CAMERA = {
  baseFov: 78,
  maxFovBoost: 14,
  defaultSensitivity: 1.0,
};
