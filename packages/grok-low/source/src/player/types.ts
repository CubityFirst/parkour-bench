export type MoveMode =
  | "ground"
  | "crouch"
  | "air"
  | "slide"
  | "wallrun"
  | "vault"
  | "mantle";

export type ActionPrompt = "vault" | "slide" | "wall" | null;

export interface PlayerInput {
  /** World-space wish direction on the horizontal plane. Length ≤ 1. */
  wishX: number;
  wishZ: number;
  sprint: boolean;
  /** True while the jump buffer is active. */
  jump: boolean;
  jumpHeld: boolean;
  slide: boolean;
  vault: boolean;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  vaultBuffer: number;
  jumpLatched: boolean;
  jumpCut: boolean;
  jumpAir: number;
  height: number;
  mode: MoveMode;
  slideT: number;
  wallT: number;
  wallId: number;
  wallNx: number;
  wallNz: number;
  /** +1 when the wall is on the player's right. */
  wallSide: number;
  wallBaseY: number;
  /** True until jump is released, so the hop onto the wall does not bounce straight off. */
  wallJumpLock: boolean;
  banWall: number;
  wallCd: number;
  airWall: number;
  scriptT: number;
  scriptDur: number;
  s0x: number;
  s0y: number;
  s0z: number;
  s1x: number;
  s1y: number;
  s1z: number;
  sArc: number;
  sVx: number;
  sVz: number;
  stepAcc: number;
  landKick: number;
  vaultBlend: number;
  speed: number;
  prompt: ActionPrompt;
}

export interface StepEvents {
  jump: boolean;
  land: boolean;
  landImpact: number;
  footstep: boolean;
  slideOn: boolean;
  slideOff: boolean;
  wallOn: boolean;
  wallOff: boolean;
  vault: boolean;
  mantle: boolean;
}

export function createPlayerState(x: number, y: number, z: number): PlayerState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    coyote: 0,
    jumpBuffer: 0,
    vaultBuffer: 0,
    jumpLatched: false,
    jumpCut: false,
    jumpAir: 0,
    height: 1.74, // STAND_H
    mode: "air",
    slideT: 0,
    wallT: 0,
    wallId: 0,
    wallNx: 0,
    wallNz: 0,
    wallSide: 0,
    wallBaseY: y,
    wallJumpLock: false,
    banWall: 0,
    wallCd: 0,
    airWall: 0,
    scriptT: 0,
    scriptDur: 0,
    s0x: x,
    s0y: y,
    s0z: z,
    s1x: x,
    s1y: y,
    s1z: z,
    sArc: 0,
    sVx: 0,
    sVz: 0,
    stepAcc: 0,
    landKick: 0,
    vaultBlend: 0,
    speed: 0,
    prompt: null,
  };
}

export function emptyEvents(): StepEvents {
  return {
    jump: false,
    land: false,
    landImpact: 0,
    footstep: false,
    slideOn: false,
    slideOff: false,
    wallOn: false,
    wallOff: false,
    vault: false,
    mantle: false,
  };
}
