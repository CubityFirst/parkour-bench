/**
 * Central tuning table. Every number that shapes how the game *feels* lives here
 * so that level geometry and movement stay in sync.
 *
 * Units are metres and seconds. The player is 1.8 m tall with a 0.35 m radius.
 */
export const PLAYER = {
  // ---- body -------------------------------------------------------------
  radius: 0.35,
  height: 1.8,
  crouchHeight: 0.95,
  eyeInset: 0.17, // distance from the top of the head down to the eyes
  stepHeight: 0.45, // obstacles below this are stepped over instead of blocking

  // ---- movement ---------------------------------------------------------
  walkSpeed: 6.0,
  sprintSpeed: 9.6,
  groundAccel: 78,
  airAccel: 17,
  groundFriction: 12.5,
  airDrag: 0.05,

  // ---- jumping ----------------------------------------------------------
  gravity: 22,
  maxFallSpeed: 48,
  jumpVelocity: 9.8,
  jumpCutFactor: 0.42, // velocity kept when the jump button is released early
  coyoteTime: 0.12,
  jumpBufferTime: 0.16,

  // ---- sliding ----------------------------------------------------------
  slideMinSpeed: 4.0,
  slideFriction: 0.9, // linear deceleration while sliding
  slideMaxTime: 5.0,
  slideEndSpeed: 3.2,
  slideHeightLerp: 34, // how quickly the body shrinks / grows

  // ---- wall running -----------------------------------------------------
  wallRunMinSpeed: 4.2,
  wallRunMaxTime: 2.2,
  wallRunGravity: 8, // heavily reduced gravity while attached
  wallRunCooldown: 0.45,
  wallRunRange: 0.62, // extra reach beyond the body radius
  wallRunSpeedDecay: 0.22,
  wallJumpSpeed: 7.2,
  wallJumpUp: 9.0,

  // ---- vaulting ---------------------------------------------------------
  vaultMinHeight: 0.45,
  vaultMaxHeight: 1.45,
  vaultDuration: 0.38,

  // ---- mantling ---------------------------------------------------------
  mantleMinHeight: 0.2,
  mantleMaxHeight: 1.75,
  mantleDuration: 0.46,
  mantleMinDepth: 0.55,

  // ---- simulation -------------------------------------------------------
  stepTime: 1 / 120,
  maxSubSteps: 6,
  fallLimit: -26, // below this the player has fallen out of the level
};

export const CAMERA = {
  fovBase: 78,
  fovSprint: 90,
  fovSlide: 84,
  fovLerp: 7,
  bobFrequency: 1.85,
  bobVertical: 0.036,
  bobLateral: 0.028,
  strafeRoll: 1.7, // degrees
  wallRoll: 8.5, // degrees
  landDipScale: 0.026,
  landDipMax: 0.34,
  landSpring: 190,
  landDamp: 22,
  vaultDip: 0.16,
  mouseSensitivity: 0.0021,
  pitchLimit: 1.48,
};

export const TIMING = {
  checkpointToast: 2.2,
  hintDisplay: 4.5,
} as const;
