/** Tuning values for player movement. Units are metres and seconds. */
export const MOVE = {
  walkSpeed: 7.5,
  sprintSpeed: 12.5,
  /** Ground acceleration: velocity gain per second is roughly rate * targetSpeed. */
  groundAccel: 4.5,
  airAccel: 1.2,
  groundFriction: 3,
  slideFriction: 0.9,
  slideStartSpeed: 8.5,
  slideMinSpeed: 3.5,
  slideMaxTime: 1.6,
  /** Speed used when crawling under an overhead obstacle with no room to stand. */
  crouchSpeed: 4,
  gravity: 30,
  maxFall: 50,
  jumpVelocity: 9.2,
  /** Velocity multiplier applied when the jump button is released early. */
  jumpCut: 0.5,
  jumpBuffer: 0.12,
  coyoteTime: 0.1,
  standHeight: 1.8,
  slideHeight: 0.9,
  wallRunMinSpeed: 7,
  wallRunSpeed: 10.5,
  wallRunMaxTime: 1.6,
  wallRunGravityScale: 0.1,
  wallRunFallSpeed: 1,
  wallJumpPush: 7.5,
  vaultReach: 1.1,
  vaultMaxHeight: 1.3,
  vaultDuration: 0.4,
  mantleMaxHeight: 2,
  mantleDuration: 0.3,
};

export interface PlayerEvent {
  type: 'jump' | 'land' | 'slide' | 'step' | 'wallrun' | 'vault' | 'mantle';
  /** Land: impact strength 0..1. Other events ignore it. */
  value: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
