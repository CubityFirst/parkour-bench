/**
 * Central tuning values for the player movement system.
 *
 * All units are metric (metres, seconds). The numbers below were chosen so
 * that the level geometry in `world/Level.ts` stays comfortably inside the
 * limits of the movement system: a full-speed sprint jump clears roughly
 * 8 m of horizontal distance, and a jump lifts the player ~2 m.
 */
export const PHYS = {
  /* --- body --- */
  radius: 0.35,
  standHeight: 1.8,
  slideHeight: 0.85,
  eyeStand: 1.62,
  eyeSlide: 0.6,

  /* --- gravity & jumping --- */
  gravity: 22,
  jumpVelocity: 9.4,
  jumpCutFactor: 0.42,
  coyoteTime: 0.12,
  jumpBuffer: 0.15,
  maxStepHeight: 0.45,

  /* --- running --- */
  walkSpeed: 5.6,
  sprintSpeed: 9.6,
  groundAccel: 78,
  groundFriction: 11.5,
  stopFriction: 16,
  airAccel: 46,
  airDrag: 0.04,

  /* --- sliding --- */
  slideMinSpeed: 4.2,
  slideFriction: 2.6,
  slideExitSpeed: 3.1,
  slideMinDuration: 0.28,
  /** Acceleration used when a stopped player crawls out of a slide. */
  slideCrawl: 9,

  /* --- wall running --- */
  wallMinSpeed: 4.6,
  wallReach: 1.05,
  /** Marked (red) wall-run surfaces are grabbed from further away. */
  wallAssistReach: 5.5,
  wallPullRate: 11,
  wallMinHeight: 2.2,
  wallVerticalTarget: -0.5,
  wallMaxTime: 2.4,
  wallMinSpeedAlong: 6.4,
  wallSpeedDecay: 0.9,
  wallJumpUp: 8.6,
  wallJumpPush: 5.4,
  wallCooldown: 0.28,

  /* --- vaulting / mantling --- */
  vaultMinHeight: 0.25,
  vaultMaxHeight: 1.35,
  vaultReach: 1.25,
  vaultDuration: 0.3,
  mantleMaxHeight: 1.7,
  mantleReach: 0.85,
  mantleDuration: 0.36,
};

export const CAM = {
  fovBase: 76,
  fovSprintBonus: 14,
  fovLerp: 6,
  bobFrequency: 10.5,
  bobAmplitude: 0.035,
  bobLateral: 0.022,
  strafeRoll: 1.6,
  wallRoll: 12,
  rollLerp: 8,
  landingDip: 0.16,
  landingSpring: 14,
  /** Pitch kick during a vault, in radians. */
  vaultPitch: 0.085,
  /** Downward impulse of the camera on landing. */
  landingKick: 1.9,
};

export const RENDER = {
  fov: 76,
  near: 0.05,
  far: 2600,
  pixelRatioCap: 1.75,
  fogNear: 220,
  fogFar: 1600,
  shadowMapSize: 2048,
  shadowRadius: 42,
};

/** Height of the sun (direction is computed in `world/Sky.ts`). */
export const SUN = {
  azimuth: 2.42,
  elevation: 0.72,
};
