/** Shared game tunables. All units: meters, seconds, radians. */
export const PLAYER = {
  height: 1.75,
  crouchHeight: 0.95,
  radius: 0.3, // horizontal half-extent of the player AABB
  eyeRatio: 0.925, // eye height as a fraction of current height

  walkSpeed: 6.5,
  sprintSpeed: 12.0,
  accel: 60.0,
  airAccel: 14.0,
  friction: 11.0,
  airFriction: 0.08,

  gravity: 25.0,
  jumpSpeed: 8.8, // up-velocity: apex ~1.55m, enough to climb 1.4m ledges
  jumpDurationBoost: 0.92, // extra up-velocity scaled while the button is held
  coyoteTime: 0.13,
  jumpBuffer: 0.14,

  slideBoostSpeed: 3.0, // temporary speed added at slide start, decays
  slideFriction: 3.4,
  slideMinSpeed: 3.0, // slide ends below this speed

  wallRunGravityFactor: 0.15,
  wallRunDuration: 1.6, // seconds before being dropped off a wall
  wallRunMinSpeed: 6.0,
  wallJumpSpeed: 8.4,
  wallJumpPush: 6.5, // horizontal push away from the wall
  wallStickDistance: 0.85, // how close the player must be to register a wall

  vaultForward: 1.7,
  vaultUp: 4.6,
  ledgeUp: 10.5, // mantle impulse for ledge recovery
  fallRespawnY: -60.0,
} as const;

export const TIMING = {
  step: 1 / 120, // fixed physics timestep
  maxFrameDt: 0.1,
  maxSubSteps: 6,
} as const;

export const COLORS = {
  roof: 0xf2f2ee,
  roofDark: 0xd9dad6,
  concrete: 0xc2c4c1,
  wallGlass: 0x9fc2cf,
  glassSky: 0xbfdce4,
  red: 0xe4312b,
  redDark: 0xb82b26,
  gray: 0x8a8d90,
  darkGray: 0x55585c,
  yellow: 0xe8a33d,
} as const;
