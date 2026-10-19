export type MatId =
  | 'white'
  | 'concrete'
  | 'red'
  | 'metal'
  | 'glass'
  | 'dark'
  | 'skirt'
  | 'orange'

export interface Solid {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  mat: MatId
  wallRun?: boolean
  vault?: boolean
  mantle?: boolean
  ceiling?: boolean
}

export interface Platform {
  id: string
  x0: number
  x1: number
  z0: number
  z1: number
  y: number
  hug?: 'left' | 'right'
  props?: boolean
  flag?: boolean
}

export interface WallDef {
  side: 'left' | 'right'
  face: number
  hangX: number
  z0: number
  z1: number
  y0: number
  y1: number
  fromId: string
  toId: string
}

export interface Checkpoint {
  id: number
  name: string
  x: number
  y: number
  z: number
  yaw: number
  zone: Aabb | null
}

export interface HintZone {
  id: string
  text: string
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface Aabb {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export interface MoveBasis {
  forwardX: number
  forwardZ: number
  rightX: number
  rightZ: number
}

export interface MoveInput {
  forward: number
  strafe: number
  sprint: boolean
  jumpHeld: boolean
  jumpPressed: boolean
  slide: boolean
  vaultPressed: boolean
}

export const LOOK_YAW = Math.PI
