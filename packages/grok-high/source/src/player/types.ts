export type ParkourMode = 'ground' | 'air' | 'slide' | 'wallrun' | 'vault' | 'mantle';

export interface PlayerInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
  jumpPressed: boolean;
  slide: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
  restart: boolean;
}

export function blankInput(): PlayerInput {
  return {
    forward: 0,
    strafe: 0,
    sprint: false,
    jump: false,
    jumpPressed: false,
    slide: false,
    slidePressed: false,
    vaultPressed: false,
    restart: false,
  };
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  label: string;
}

export type Surface = 'roof' | 'concrete' | 'red' | 'metal' | 'dark' | 'wall';
export type AccentFace = 'minX' | 'maxX' | 'minZ' | 'maxZ';

export interface Solid {
  id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  surface: Surface;
  accent?: AccentFace;
}

export interface Trigger {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  type: 'checkpoint' | 'finish' | 'hint';
  index?: number;
  hint?: string;
}

export interface Carpet {
  x: number;
  y: number;
  z: number;
  length: number;
  width: number;
}

export interface RoofMeta {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  rails: 'both' | '+z' | '-z' | 'none';
}

export interface GuidePoint {
  x: number;
  z: number;
}

export interface Layout {
  solids: Solid[];
  triggers: Trigger[];
  checkpoints: SpawnPoint[];
  carpets: Carpet[];
  roofs: RoofMeta[];
  guide: GuidePoint[];
  finish: { x: number; y: number; z: number };
}

export interface WallHit {
  solid: Solid;
  nx: number;
  nz: number;
  dist: number;
}

export interface VaultHit {
  top: number;
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  dirX: number;
  dirZ: number;
  peak: number;
}

export interface LedgeHit {
  top: number;
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  dirX: number;
  dirZ: number;
}
