import type { Point3 } from './Geometry';

/**
 * Level data. Units are metres. The route runs from the spawn towards -Z, through six sections.
 *
 * Conventions:
 * - Rooftops have their top surface at `top` and extend down to BOTTOM so the buildings read
 *   as solid masses.
 * - Red is reserved for things the player should read as traversal: vault blocks, duct tunnels,
 *   wall-run walls, the finish arch, and jump markers.
 * - Wall-run walls are longer along Z than along X, so their face normal points along X.
 */

/** What a box is for. Each kind maps to a material and, for wall runs, a collision flag. */
export type SurfaceKind = 'roof' | 'trim' | 'machine' | 'vent' | 'red' | 'wallrun' | 'redGlow';

export interface BoxSpec {
  min: Point3;
  max: Point3;
  kind: SurfaceKind;
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Zone {
  name: string;
  min: Point3;
  max: Point3;
}

export interface Checkpoint extends Zone {
  spawn: Spawn;
}

export interface LevelLayout {
  spawn: Spawn;
  /** Collidable boxes. */
  solids: BoxSpec[];
  /** Visual-only boxes. Nothing collides with these. */
  decor: BoxSpec[];
  checkpoints: Checkpoint[];
  finish: Zone;
}

const BOTTOM = -14;

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: SurfaceKind): BoxSpec {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind };
}

/** A rooftop. z0 is the nearer edge (larger Z) and z1 the farther one. */
function roof(x0: number, x1: number, z1: number, z0: number, top: number): BoxSpec {
  return box(x0, BOTTOM, z1, x1, top, z0, 'roof');
}

/** Waist-high railings along both edges of a rooftop. */
function railings(z1: number, z0: number): BoxSpec[] {
  return [box(-8, 0, z1, -7.86, 1, z0, 'trim'), box(7.86, 0, z1, 8, 1, z0, 'trim')];
}

/** A red ventilation duct spanning the roof. The gap under it is the slide. */
function duct(zCentre: number): BoxSpec[] {
  return [
    box(-8, 1.15, zCentre - 1.25, 8, 2.2, zCentre + 1.25, 'red'),
    box(-8, 0, zCentre - 1.25, -7.6, 2.2, zCentre + 1.25, 'red'),
    box(7.6, 0, zCentre - 1.25, 8, 2.2, zCentre + 1.25, 'red'),
  ];
}

/** A red marker pillar that shows where a jump is launched from. */
function jumpMarker(x: number, z: number): BoxSpec {
  return box(x - 0.12, 0, z - 0.12, x + 0.12, 2.6, z + 0.12, 'redGlow');
}

/** A rooftop access box with a red door on the face that looks down the route. */
function penthouse(x0: number, x1: number, z0: number, z1: number, height: number, doorFace: number): BoxSpec[] {
  const zCentre = (z0 + z1) / 2;
  return [
    box(x0, 0, z0, x1, height, z1, 'machine'),
    box(doorFace - 0.06, 0, zCentre - 0.6, doorFace + 0.06, 2, zCentre + 0.6, 'red'),
  ];
}

const solids: BoxSpec[] = [
  // Section 1: movement tutorial. Start roof, a small obstacle, then a short gap.
  roof(-8, 8, -30, 14, 0),
  ...railings(-30, 14),
  box(-1.6, 0, -6, 1.6, 1, -4.6, 'red'),
  box(5, 0, 4, 7.2, 1.1, 6.2, 'machine'),
  box(-7.2, 0, -12, -5, 1.1, -10, 'machine'),
  ...penthouse(-7.5, -4.5, -24, -20.5, 2.6, -4.5),
  // Gap 1: 3.6 m, the easy one.
  roof(-8, 8, -52, -33.6, 0),
  ...railings(-52, -33.6),
  box(5.5, 0, -41, 7.5, 1.6, -38, 'machine'),
  ...penthouse(4.5, 7, -49, -46, 2.4, 4.5),

  // Section 2: rooftop jumps, with a raised roof in the middle.
  roof(-7, 7, -64, -56.6, 0), // gap 4.6
  roof(-6, 6, -78, -68, 0.9), // gap 4.0, climbs 0.9 m
  roof(-7, 7, -92, -82.8, 0), // gap 4.8, drops back down

  // Sections 3 and 4 share one long roof. Gap 4.8 before it.
  roof(-8, 8, -158, -96.8, 0),
  ...railings(-158, -96.8),
  ...penthouse(-7.4, -4.8, -102, -99.2, 2.8, -4.8),
  ...duct(-116),
  ...duct(-126),
  ...duct(-136),
  box(-8, 0, -123.2, -2, 0.9, -122, 'vent'),
  box(2, 0, -132.2, 8, 0.9, -131, 'vent'),
  box(-8, 0, -142.2, -2, 0.9, -141, 'vent'),

  // Section 4: a 9 m gap that a normal jump cannot cross. The red wall beside it is the way over.
  box(2, BOTTOM, -167, 2.5, 3.6, -155, 'wallrun'),
  roof(-8, 8, -182, -167, 0), // gap 9.0 is crossed by wall running
  ...railings(-182, -167),
  ...penthouse(4.4, 7.2, -172, -169, 2.4, 4.4),

  // Section 5: a vault barrier, a narrow bridge, a slide duct and a second wall run.
  box(-8, 0, -176.3, 8, 1, -175, 'red'),
  roof(-1.5, 1.5, -196, -186.5, 0), // gap 4.5 onto a 3 m bridge
  roof(-8, 8, -204, -196, 0),
  ...railings(-204, -196),
  ...duct(-200.25),
  box(-1.1, BOTTOM, -216, -0.6, 3.6, -203.5, 'wallrun'), // left-hand wall beside the centre lane, gap 6.5
  roof(-8, 8, -222, -210.5, 0),
  ...railings(-222, -210.5),
  ...penthouse(4.6, 7, -218, -215.2, 2.6, 4.6),

  // Section 6: final sprint across four jumps, then the finish roof.
  roof(-6, 6, -233, -226.5, 0.6), // gap 4.5
  roof(-6, 6, -244, -237.4, 0), // gap 4.4
  roof(-7, 7, -258, -248.8, 0.6), // gap 4.8
  roof(-8, 8, -284, -262.2, 0), // gap 4.2

  // Finish arch. The top beam is high enough to run under.
  box(-8, 0, -269.1, -7.4, 4.6, -268.5, 'red'),
  box(7.4, 0, -269.1, 8, 4.6, -268.5, 'red'),
  box(-8, 4, -269.1, 8, 4.6, -268.5, 'red'),

  // Machines stay off the main lane (|x| > 2) so the route is never blocked by clutter.
];

const decor: BoxSpec[] = [
  // Jump markers at launch edges.
  jumpMarker(-7.4, -51.4),
  jumpMarker(7.4, -51.4),
  jumpMarker(-6.4, -63.4),
  jumpMarker(6.4, -63.4),
  jumpMarker(-5.4, -77.4),
  jumpMarker(5.4, -77.4),
  jumpMarker(-6.4, -91.4),
  jumpMarker(6.4, -91.4),
  jumpMarker(-7.4, -157.4),
  jumpMarker(7.4, -157.4),
  jumpMarker(-7.4, -181.4),
  jumpMarker(7.4, -181.4),
  jumpMarker(-7.4, -203.4),
  jumpMarker(7.4, -203.4),
  jumpMarker(-7.4, -221.4),
  jumpMarker(7.4, -221.4),
  jumpMarker(-5.4, -232.4),
  jumpMarker(5.4, -232.4),
  jumpMarker(-5.4, -243.4),
  jumpMarker(5.4, -243.4),
  jumpMarker(-6.4, -257.4),
  jumpMarker(6.4, -257.4),

  // Checkpoint beacons at the roof edges, clear of the lane.
  jumpMarker(-7.4, -35.4),
  jumpMarker(-7.4, -98.2),
  jumpMarker(-7.4, -145),
  jumpMarker(-7.4, -169.5),
  jumpMarker(-1.6, -191.8),
  jumpMarker(-7.4, -213),
  jumpMarker(-6.4, -239.9),

  // Red lane strip that shows the launch line for the right-hand wall run.
  box(1.05, 0, -158, 1.75, 0.03, -150, 'redGlow'),

  // Red pipes running up the corners of three penthouses, clear of their doors.
  box(4.22, 0, -46.4, 4.36, 3.2, -46.26, 'redGlow'),
  box(4.22, 0, -171.5, 4.36, 3.2, -171.36, 'redGlow'),
  box(4.22, 0, -218.3, 4.36, 3.2, -218.16, 'redGlow'),

  // Tall red columns marking the finish.
  box(-7.2, 0, -280, -6.8, 12, -279.6, 'redGlow'),
  box(6.8, 0, -280, 7.2, 12, -279.6, 'redGlow'),

  // Flat grates on the roofs.
  box(-6.5, 0, -20, -4.5, 0.03, -18.5, 'vent'),
  box(5, 0, -44, 6.8, 0.03, -42.5, 'vent'),
  box(4.5, 0, -181, 6.5, 0.03, -179.5, 'vent'),
  box(-6.5, 0, -214, -5, 0.03, -212.5, 'vent'),
];

export const LEVEL_LAYOUT: LevelLayout = {
  spawn: { x: 0, y: 0, z: 8, yaw: 0 },
  solids,
  decor,
  checkpoints: [
    {
      name: 'Section 1 · Movement',
      min: { x: -8, y: -2, z: -36.5 },
      max: { x: 8, y: 3, z: -34.2 },
      spawn: { x: 0, y: 0, z: -35.4, yaw: 0 },
    },
    {
      name: 'Section 2 · Rooftop jumps',
      min: { x: -8, y: -2, z: -99.6 },
      max: { x: 8, y: 3, z: -96.8 },
      spawn: { x: 0, y: 0, z: -98.2, yaw: 0 },
    },
    {
      name: 'Section 3 · Sliding',
      min: { x: -8, y: -2, z: -146.5 },
      max: { x: 8, y: 3, z: -143.5 },
      spawn: { x: 0, y: 0, z: -145, yaw: 0 },
    },
    {
      name: 'Section 4 · Wall run',
      min: { x: -8, y: -2, z: -171 },
      max: { x: 8, y: 3, z: -168 },
      spawn: { x: 0, y: 0, z: -169.5, yaw: 0 },
    },
    {
      name: 'Section 5 · Bridge',
      min: { x: -1.6, y: -2, z: -193 },
      max: { x: 1.6, y: 3, z: -190.5 },
      spawn: { x: 0, y: 0, z: -191.8, yaw: 0 },
    },
    {
      name: 'Section 5 · Wall run',
      min: { x: -8, y: -2, z: -214.5 },
      max: { x: 8, y: 3, z: -211.5 },
      spawn: { x: 0, y: 0, z: -213, yaw: 0 },
    },
    {
      name: 'Section 6 · Final sprint',
      min: { x: -6, y: -2, z: -241.2 },
      max: { x: 6, y: 3, z: -238.6 },
      spawn: { x: 0, y: 0, z: -239.9, yaw: 0 },
    },
  ],
  finish: {
    name: 'Finish',
    min: { x: -7.3, y: -2, z: -272 },
    max: { x: 7.3, y: 3.5, z: -269.3 },
  },
};
