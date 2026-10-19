export interface InputFrame {
  forward: number;
  strafe: number;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  slide: boolean;
  vaultPressed: boolean;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface StepEvents {
  jumped: boolean;
  landed: boolean;
  impact: number;
  footstep: boolean;
  slideOn: boolean;
  checkpointId: string | null;
  checkpointName: string | null;
  finish: boolean;
  respawn: boolean;
  vault: boolean;
  mantle: boolean;
  wall: boolean;
}

export function emptyEvents(): StepEvents {
  return {
    jumped: false,
    landed: false,
    impact: 0,
    footstep: false,
    slideOn: false,
    checkpointId: null,
    checkpointName: null,
    finish: false,
    respawn: false,
    vault: false,
    mantle: false,
    wall: false,
  };
}

export interface Settings {
  sensitivity: number;
  motion: number;
}

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, motion: 1 };
