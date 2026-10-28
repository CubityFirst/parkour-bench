export const CONST = {
  // ---- physics ----
  gravity: 24,
  terminalFall: -45,
  playerRadius: 0.35,
  heightStand: 1.8,
  heightSlide: 0.85,
  eyeStand: 1.62,
  eyeSlide: 0.72,

  // ---- locomotion ----
  walkSpeed: 7.0,
  sprintSpeed: 11.2,
  groundAccel: 55,
  airAccel: 8,
  groundFriction: 14,
  airFriction: 0.4,

  // ---- jumping ----
  jumpVelocity: 9.0,
  jumpCutMultiplier: 0.45,
  jumpCutGravityScale: 2.6,
  coyoteTime: 0.12,
  jumpBufferTime: 0.14,

  // ---- sliding ----
  slideMinSpeed: 6.0,
  slideDecel: 3.4,
  slideEnterBoost: 1.05,

  // ---- wall running ----
  wallRunMinSpeed: 7.0,
  wallRunSpeed: 9.8,
  wallRunDuration: 1.4,
  wallRunCooldown: 0.28,
  wallDetectDist: 0.72,
  wallRunJumpAway: 4.6,
  wallRunJumpUp: 7.6,

  // ---- vaulting ----
  vaultDistance: 1.8,
  vaultDuration: 0.3,
  vaultMinHeight: 0.35,
  vaultMaxHeight: 1.35,
  vaultDetectDist: 0.95,

  // ---- mantle / ledge recovery ----
  mantleMinHeight: 0.4,
  mantleMaxHeight: 1.6,
  mantleDuration: 0.4,

  // ---- camera ----
  fovBase: 74,
  fovMax: 92,
  fovSpeedRef: 11.2,

  // ---- level ----
  killY: -45,
} as const;

export const COLORS = {
  white: 0xf4f6f8,
  whiteRoof: 0xedf0f4,
  concrete: 0xc0c7cf,
  concreteDark: 0x9aa1a9,
  red: 0xe5343b,
  redDark: 0xb0242b,
  glass: 0x9fd0ef,
  glassDark: 0x5f9fcc,
  skyTop: 0x4f9fe0,
  skyHorizon: 0xd6e9f8,
  fog: 0xd6e9f7,
  accentBlue: 0x2f80ed,
} as const;
