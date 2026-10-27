/**
 * The rooftop route, as plain data.
 *
 * This module has no rendering or DOM dependencies: the same definition builds the
 * collision world, the visuals (world/Level.ts) and the headless route test.
 *
 * Coordinate system: metres, +Y up. The run starts heading north (-Z), turns east (+X)
 * for the slide / wall-run / combination sections, then rides a zipline north into the
 * final sprint.
 *
 * Section overview
 *  1. Tutorial      A1            run, sprint, vault, slide, short gap
 *  2. Rooftop jumps A2..A5        sprint jumps, a ledge climb, a big drop, a narrow bridge
 *  3. Slide         B1            a corridor of red ducts to slide under
 *  4. Wall run      B1 -> C1      13 m gap beside the red wall of tower W1 (wall on the left)
 *  5. Combination   C1..E1        vault, jump to a red beam, wall run (right), slide, climb
 *  6. Final sprint  E1 -> F3      zipline down, two sprint jumps, a vault, the finish gate
 */
import { ColliderFlags, PROP_FLAGS } from './CollisionWorld.ts';

export type Vec3 = readonly [number, number, number];

/** Visual styles. Facade styles texture the sides; their top face uses the roof material. */
export type Style =
  | 'facadeWhite'
  | 'facadeGlass'
  | 'facadeConcrete'
  | 'roof'
  | 'white'
  | 'grey'
  | 'dark'
  | 'red'
  | 'metal'
  | 'glass'
  | 'orange'
  | 'blue';

export interface SolidDef {
  min: Vec3;
  max: Vec3;
  style: Style;
  /** Style of the top face (defaults to `style`). */
  top?: Style;
  flags: number;
  collide: boolean;
  visible: boolean;
  /** Render the bottom face (floating objects such as ducts). */
  bottom: boolean;
  /** Darken the lower part of the sides (cheap contact shadow for props). */
  ao: boolean;
}

export type DecorDef =
  | { kind: 'cylinder'; x: number; y: number; z: number; radius: number; height: number; style: Style }
  | { kind: 'pipe'; a: Vec3; b: Vec3; radius: number; style: Style }
  | { kind: 'railing'; a: Vec3; b: Vec3; height: number }
  | { kind: 'flag'; x: number; y: number; z: number; pole: number; color: 'red' | 'orange'; yaw: number }
  | { kind: 'fan'; x: number; y: number; z: number; radius: number }
  | { kind: 'antenna'; x: number; y: number; z: number; height: number }
  | { kind: 'tower'; x: number; y: number; z: number; w: number; d: number; h: number }
  | { kind: 'grate'; min: Vec3; max: Vec3 }
  | { kind: 'banner'; x: number; y: number; z: number; w: number; h: number; text: string; yaw: number };

export interface ZoneDef {
  min: Vec3;
  max: Vec3;
}

export interface CheckpointDef {
  name: string;
  spawn: Vec3;
  yaw: number;
  zone: ZoneDef;
  /** Floor position of the beacon marker. */
  marker: Vec3;
}

export interface HintDef {
  text: string;
  zone: ZoneDef;
}

export interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  top: number;
}

export interface LevelDef {
  solids: SolidDef[];
  decor: DecorDef[];
  spawn: { pos: Vec3; yaw: number };
  checkpoints: CheckpointDef[];
  finish: { zone: ZoneDef; beacon: Vec3 };
  hints: HintDef[];
  ziplines: { a: Vec3; b: Vec3 }[];
  /** Falling below this height respawns the player. */
  killY: number;
  /** Plan-view rectangles of every route building (the city generator keeps clear of them). */
  footprints: Footprint[];
  /** Areas where background buildings must stay low (under the zipline, etc). */
  lowCorridors: Footprint[];
  /** Points of interest the menu camera looks across. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Yaw that looks along the direction (dx, dz). Yaw 0 looks down -Z. */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

const { NO_WALLRUN, NO_GRAB, NO_STEP, METAL } = ColliderFlags;
const RAIL_FLAGS = NO_WALLRUN | NO_GRAB | NO_STEP;
const PARAPET_H = 0.55;
const RAIL_H = 1.1;

export function buildLevelDef(): LevelDef {
  const solids: SolidDef[] = [];
  const decor: DecorDef[] = [];
  const footprints: Footprint[] = [];
  const hints: HintDef[] = [];
  const checkpoints: CheckpointDef[] = [];

  // ------------------------------------------------------------------ helpers

  const solid = (min: Vec3, max: Vec3, style: Style, flags = 0, extra: Partial<SolidDef> = {}): void => {
    solids.push({ min, max, style, flags, collide: true, visible: true, bottom: false, ao: false, ...extra });
  };
  /** Visual-only box. */
  const visual = (min: Vec3, max: Vec3, style: Style, extra: Partial<SolidDef> = {}): void => {
    solids.push({ min, max, style, flags: 0, collide: false, visible: true, bottom: false, ao: false, ...extra });
  };
  /** A building from street level up to its roof. */
  const building = (x0: number, z0: number, x1: number, z1: number, top: number, facade: Style = 'facadeWhite'): void => {
    solid([x0, 0, z0], [x1, top, z1], facade, 0, { top: 'roof' });
    footprints.push({ x0, z0, x1, z1, top });
  };
  /** Roof edge: plain parapet, parapet with a railing on top, or a bare railing. */
  const edge = (x0: number, z0: number, x1: number, z1: number, base: number, kind: 'parapet' | 'parapetRail' | 'rail' = 'parapetRail'): void => {
    const alongX = x1 - x0 >= z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (kind === 'parapet') {
      solid([x0, base, z0], [x1, base + PARAPET_H, z1], 'white', NO_WALLRUN | NO_STEP, { ao: true });
      return;
    }
    const railBase = kind === 'parapetRail' ? base + PARAPET_H : base;
    if (kind === 'parapetRail') visual([x0, base, z0], [x1, railBase, z1], 'white', { ao: true });
    // Collision covers the parapet and the (see-through) railing above it.
    solids.push({ min: [x0, base, z0], max: [x1, base + RAIL_H, z1], style: 'metal', flags: RAIL_FLAGS, collide: true, visible: false, bottom: false, ao: false });
    const a: Vec3 = alongX ? [x0 + 0.1, railBase, cz] : [cx, railBase, z0 + 0.1];
    const b: Vec3 = alongX ? [x1 - 0.1, railBase, cz] : [cx, railBase, z1 - 0.1];
    decor.push({ kind: 'railing', a, b, height: base + RAIL_H - railBase });
  };
  /** Red "runner vision" strip marking a take-off edge. */
  const strip = (x0: number, z0: number, x1: number, z1: number, y: number): void => {
    visual([x0, y, z0], [x1, y + 0.025, z1], 'red', { });
  };
  /** Rooftop machinery: solid, can't be climbed or wall-run. */
  const prop = (min: Vec3, max: Vec3, style: Style = 'white', fan = false): void => {
    solid(min, max, style, PROP_FLAGS, { ao: true });
    if (fan) {
      const fx = (min[0] + max[0]) / 2;
      const fz = (min[2] + max[2]) / 2;
      const r = Math.min(max[0] - min[0], max[2] - min[2]) * 0.32;
      decor.push({ kind: 'fan', x: fx, y: max[1], z: fz, radius: r });
    }
  };
  const hint = (text: string, min: Vec3, max: Vec3): void => {
    hints.push({ text, zone: { min, max } });
  };
  const flag = (x: number, y: number, z: number, color: 'red' | 'orange' = 'red', yaw = 0, pole = 3.2): void => {
    decor.push({ kind: 'flag', x, y, z, pole, color, yaw });
  };
  const tank = (x: number, y: number, z: number, r: number, h: number): void => {
    // Water tank on a low steel base. Collision is the inscribed box (no invisible corners).
    const s = r * 0.82;
    prop([x - s, y, z - s], [x + s, y + h + 0.6, z + s], 'white');
    visual([x - r * 0.9, y, z - r * 0.9], [x + r * 0.9, y + 0.6, z + r * 0.9], 'dark');
    decor.push({ kind: 'cylinder', x, y: y + 0.6, z, radius: r, height: h, style: 'white' });
    decor.push({ kind: 'cylinder', x, y: y + 0.6 + h, z, radius: r * 0.25, height: 0.35, style: 'grey' });
  };
  const ventPipe = (x: number, y: number, z: number, h = 1.3): void => {
    decor.push({ kind: 'cylinder', x, y, z, radius: 0.16, height: h, style: 'grey' });
    decor.push({ kind: 'cylinder', x, y: y + h, z, radius: 0.26, height: 0.12, style: 'grey' });
  };
  const door = (x0: number, x1: number, z: number, y: number, facing: 1 | -1): void => {
    // A red rooftop door set into a wall whose face lies at `z` (facing +Z or -Z).
    const t = 0.05 * facing;
    visual([x0 - 0.12, y, Math.min(z, z + t * 1.6)], [x1 + 0.12, y + 2.36, Math.max(z, z + t * 1.6)], 'dark');
    visual([x0, y, Math.min(z, z + t * 2.2)], [x1, y + 2.22, Math.max(z, z + t * 2.2)], 'red');
  };

  // ------------------------------------------------------------------ 1. Tutorial: start roof A1

  const A1 = 40;
  building(-11, -66, 11, 8, A1, 'facadeWhite');
  edge(-11, 7.7, 11, 8, A1);
  edge(-11, -66, -10.7, 7.7, A1);
  edge(10.7, -66, 11, 7.7, A1);
  edge(-10.7, -66, -5, -65.7, A1, 'parapet');
  edge(5, -66, 10.7, -65.7, A1, 'parapet');
  strip(-5, -66, 5, -65.65, A1);
  flag(-9.8, A1 + PARAPET_H, -65.85, 'red', Math.PI / 2);
  flag(9.8, A1 + PARAPET_H, -65.85, 'red', Math.PI / 2);

  // Stairwell the runner steps out of, with a red door facing the route.
  solid([-3.2, A1, 2.6], [3.2, A1 + 3.4, 7.7], 'white', 0, { ao: true });
  visual([-3.4, A1 + 3.4, 2.4], [3.4, A1 + 3.6, 7.8], 'grey');
  visual([-1.2, A1 + 2.55, 1.7], [1.2, A1 + 2.7, 2.6], 'white');
  door(-0.7, 0.7, 2.6, A1, -1);
  prop([-2.4, A1 + 3.6, 4.2], [-0.4, A1 + 4.6, 6.6], 'grey', true);
  decor.push({ kind: 'antenna', x: 2.3, y: A1 + 3.6, z: 6.6, height: 6.5 });

  // Machinery along the sides; the central lane (|x| < 5) stays clear.
  prop([6.2, A1, -14.5], [9.4, A1 + 1.5, -11.5], 'white', true);
  prop([-9.4, A1, -20], [-6.4, A1 + 1.3, -17.5], 'white', true);
  prop([6.6, A1, -24], [9.6, A1 + 1.2, -21.2], 'grey', true);
  tank(8.3, A1, -33, 1.4, 3.0);
  solid([-9.6, A1, -36], [-6.8, A1 + 0.4, -24], 'white', NO_WALLRUN, { top: 'glass', ao: true });
  ventPipe(-8.6, A1, -8);
  ventPipe(-8.6, A1, -9.3, 1.0);
  ventPipe(8.9, A1, -40, 1.5);
  decor.push({ kind: 'grate', min: [-3.5, A1, -18], max: [-1.5, A1 + 0.03, -15.5] });
  decor.push({ kind: 'grate', min: [1.8, A1, -30], max: [3.8, A1 + 0.03, -27.5] });

  // Tutorial obstacle 1: a red barrier to vault, flanked by machinery.
  solid([-5, A1, -46.6], [5, A1 + 1.0, -45.8], 'red', NO_WALLRUN, { ao: true });
  prop([-10.7, A1, -47.6], [-5, A1 + 1.8, -44.8], 'white', true);
  prop([5, A1, -47.6], [10.7, A1 + 1.8, -44.8], 'white', true);

  // Tutorial obstacle 2: a red duct to slide under.
  solid([-5.2, A1 + 1.05, -56.8], [5.2, A1 + 1.95, -55.6], 'red', PROP_FLAGS | NO_STEP, { bottom: true });
  prop([-10.7, A1, -57.6], [-5, A1 + 2.6, -54.8], 'white', true);
  prop([5, A1, -57.6], [10.7, A1 + 2.6, -54.8], 'white', true);
  decor.push({ kind: 'pipe', a: [-10.4, A1 + 2.75, -56.2], b: [10.4, A1 + 2.75, -56.2], radius: 0.12, style: 'grey' });

  hint('WASD to move  \u00b7  hold SHIFT to sprint  \u00b7  mouse to look', [-11, 39, -16], [11, 46, 8]);
  hint('Low obstacle: press SPACE or E while running to vault it', [-11, 39, -44.6], [11, 46, -31]);
  hint('Sprint, then press C or CTRL to slide under the duct', [-11, 39, -54.6], [11, 46, -47.8]);
  hint('Jump the gap. Hold SPACE longer to jump higher', [-11, 39, -66], [11, 46, -57.8]);

  // ------------------------------------------------------------------ 2. Rooftop jumps

  const A2 = 40;
  building(-9, -84, 9, -69, A2, 'facadeConcrete');
  edge(-9, -84, -8.7, -69, A2);
  edge(8.7, -84, 9, -69, A2);
  edge(-8.7, -84, -4, -83.7, A2, 'parapet');
  edge(4, -84, 8.7, -83.7, A2, 'parapet');
  strip(-4, -84, 4, -83.65, A2);
  solid([4.6, A2, -81], [7.8, A2 + 0.42, -73], 'white', NO_WALLRUN, { top: 'glass', ao: true });
  ventPipe(-7.6, A2, -71.5, 1.1);
  ventPipe(-7.0, A2, -71.5, 0.8);
  checkpoints.push({
    name: 'Rooftop jumps',
    spawn: [0, A2, -72],
    yaw: 0,
    zone: { min: [-9, A2 - 1, -84], max: [9, A2 + 6, -69] },
    marker: [-6.4, A2, -76.5],
  });
  hint('Checkpoint saved. Press R any time to return to it', [-9, 39, -77], [9, 46, -69]);
  hint('Sprint before the edge: momentum carries you further', [-9, 39, -84], [9, 46, -77]);

  const A3 = 39;
  building(-8, -104, 10, -88.5, A3, 'facadeWhite');
  edge(-8, -104, -7.7, -88.5, A3);
  edge(9.7, -104, 10, -88.5, A3);
  edge(-7.7, -104, -3, -103.7, A3, 'parapet');
  edge(5, -104, 9.7, -103.7, A3, 'parapet');
  strip(-3, -104, 5, -103.65, A3);
  prop([6.2, A3, -99.5], [9.4, A3 + 1.3, -95], 'white', true);
  prop([-7.4, A3, -96], [-5, A3 + 1.1, -92], 'grey', true);
  flag(-7.2, A3 + PARAPET_H, -103.85, 'orange', Math.PI / 2);
  hint('Too high to land on? Jump at the ledge and hold W to climb', [-8, 38, -104], [10, 45, -94]);

  const A4 = 41.2;
  building(-9, -123, 9, -108, A4, 'facadeGlass');
  // Red lip on the ledge to climb.
  // (Wraps the white cornice band so the red reads from the lower roof.)
  visual([-4.5, A4 - 0.8, -108.0], [4.5, A4 + 0.035, -107.8], 'red', { bottom: true });
  edge(-9, -123, -8.7, -108, A4);
  edge(8.7, -123, 9, -108, A4);
  edge(-8.7, -123, -4, -122.7, A4, 'parapet');
  edge(4, -123, 8.7, -122.7, A4, 'parapet');
  strip(-4, -123, 4, -122.65, A4);
  prop([-8.2, A4, -119], [-5.6, A4 + 1.2, -114.5], 'white', true);
  decor.push({ kind: 'antenna', x: 7.6, y: A4, z: -110, height: 4.5 });
  hint('Big drop ahead: keep sprinting and jump', [-9, 40, -123], [9, 48, -112]);

  const A5 = 38.2;
  building(-12, -151, 16, -129, A5, 'facadeWhite');
  edge(-12, -151, -11.7, -129, A5);
  edge(-11.7, -151, 16, -150.7, A5);
  edge(15.7, -150.7, 16, -141, A5);
  edge(15.7, -139, 16, -129, A5);
  tank(-7.5, A5, -146, 1.7, 3.4);
  solid([-10.8, A5, -141], [-6.2, A5 + 3.2, -134.5], 'white', 0, { ao: true });
  visual([-11, A5 + 3.2, -141.2], [-6, A5 + 3.4, -134.3], 'grey');
  door(-9.4, -8.0, -134.5, A5, 1);
  prop([4, A5, -150.5], [8, A5 + 1.4, -147.5], 'white', true);
  prop([9, A5, -150.5], [12.5, A5 + 1.6, -147.5], 'grey', true);
  decor.push({ kind: 'grate', min: [2, A5, -145], max: [5, A5 + 0.03, -142.5] });
  // Red posts frame the bridge entrance.
  visual([15.6, A5, -141.6], [16.0, A5 + 1.9, -141.2], 'red');
  visual([15.6, A5, -138.8], [16.0, A5 + 1.9, -138.4], 'red');
  checkpoints.push({
    name: 'The bridge',
    spawn: [1, A5, -136],
    yaw: yawToward(1, -0.2),
    zone: { min: [-12, A5 - 1, -151], max: [16, A5 + 6, -129] },
    marker: [-2, A5, -147],
  });
  hint('Cross the bridge to the east', [-12, 37, -151], [16, 45, -129]);

  // Narrow steel bridge to B1.
  solid([16, A5 - 0.35, -141], [26, A5, -139], 'metal', NO_WALLRUN | METAL, { bottom: true });
  visual([16, A5 - 0.85, -140.3], [26, A5 - 0.35, -139.7], 'dark', { bottom: true });
  edge(16, -141, 26, -140.92, A5, 'rail');
  edge(16, -139.08, 26, -139, A5, 'rail');

  // ------------------------------------------------------------------ 3. Slide corridor on B1

  const B1 = 38.2;
  building(26, -149, 86, -131, B1, 'facadeConcrete');
  edge(26, -149, 26.3, -141, B1);
  edge(26, -139, 26.3, -131, B1);
  edge(26.3, -131.3, 86, -131, B1);
  edge(26.3, -149, 76, -148.7, B1);
  edge(85.7, -142.5, 86, -131.3, B1);
  strip(85.65, -149, 86, -142.5, B1);

  // Corridor walls of machinery (z -144 .. -136 stays open).
  const northWall: [number, number, number][] = [[30, 38, 2.6], [38, 47, 3.0], [47, 56, 2.4], [56, 63, 3.2], [63, 70, 2.6]];
  const southWall: [number, number, number][] = [[30, 36, 2.8], [36, 44, 2.4], [44, 53, 3.1], [53, 61, 2.5], [61, 70, 2.9]];
  northWall.forEach(([x0, x1, h], i) => prop([x0, B1, -148.7], [x1, B1 + h, -144], i % 2 ? 'grey' : 'white', true));
  southWall.forEach(([x0, x1, h], i) => prop([x0, B1, -136], [x1, B1 + h, -131.3], i % 2 ? 'white' : 'grey', true));
  // Red ducts across the corridor: bottom 1.05 m above the roof (slide height is 0.9 m).
  const ducts: [number, number, number][] = [[34.0, 35.2, 1.0], [38.6, 39.8, 1.0], [47.0, 51.0, 0.7], [58.0, 59.2, 1.0], [61.8, 63.0, 1.0], [66.4, 67.6, 1.0]];
  for (const [x0, x1, h] of ducts) {
    solid([x0, B1 + 1.05, -144.2], [x1, B1 + 1.05 + h, -135.8], 'red', PROP_FLAGS | NO_STEP, { bottom: true });
  }
  decor.push({ kind: 'pipe', a: [30.2, B1 + 2.9, -146.2], b: [69.8, B1 + 2.9, -146.2], radius: 0.18, style: 'grey' });
  decor.push({ kind: 'pipe', a: [30.2, B1 + 3.1, -133.4], b: [69.8, B1 + 3.1, -133.4], radius: 0.14, style: 'grey' });
  prop([72, B1, -134.5], [75.5, B1 + 1.3, -131.3], 'white', true);
  ventPipe(80.5, B1, -132.2, 1.4);
  flag(85.3, B1 + PARAPET_H, -142.3, 'red', 0);
  hint('Slide under the red ducts (C / CTRL). Chain slides to keep your speed', [26, 37, -144], [34, 45, -136]);

  checkpoints.push({
    name: 'Wall run',
    spawn: [72.5, B1, -141],
    yaw: yawToward(1, -0.25),
    zone: { min: [70, B1 - 1, -149], max: [86, B1 + 6, -131] },
    marker: [78, B1, -134.6],
  });
  hint('Run along the red wall, jump, and hold W to wall-run. SPACE jumps off', [70, 37, -149], [86, 45, -131]);

  // ------------------------------------------------------------------ 4. Wall run: tower W1 beside a 13 m gap

  building(76, -162, 104, -149, 62, 'facadeWhite');
  visual([79, B1 + 0.35, -148.95], [101, B1 + 3.8, -148.9], 'red');
  visual([79, B1 + 3.95, -148.95], [101, B1 + 4.1, -148.9], 'red');

  const C1 = 37.5;
  building(99, -149, 121, -131, C1, 'facadeWhite');
  edge(99, -141, 99.3, -131, C1);
  edge(104, -149, 121, -148.7, C1);
  edge(99.3, -131.3, 121, -131, C1);
  edge(120.7, -148.7, 121, -147, C1, 'parapet');
  edge(120.7, -141, 121, -131.3, C1, 'parapet');
  strip(120.65, -147, 121, -141, C1);
  checkpoints.push({
    name: 'Combination',
    spawn: [102.5, C1, -144],
    yaw: yawToward(1, 0),
    zone: { min: [99, C1 - 1, -149], max: [121, C1 + 6, -131] },
    marker: [103, C1, -134.5],
  });

  // ------------------------------------------------------------------ 5. Combination

  // Vault barrier, then the jump onto a narrow red beam.
  solid([110, C1, -148.7], [110.8, C1 + 1.0, -139], 'red', NO_WALLRUN, { ao: true });
  prop([109.4, C1, -139], [112.4, C1 + 1.8, -131.3], 'white', true);
  prop([115, C1, -136], [118.5, C1 + 1.3, -131.3], 'grey', true);
  hint('Vault the barrier, then jump onto the red beam', [99, 36.5, -149], [112, 44, -131]);

  solid([124, C1 - 0.4, -145], [137, C1, -143], 'red', NO_WALLRUN | METAL, { bottom: true });
  visual([124, C1 - 1.0, -144.3], [137, C1 - 0.4, -143.7], 'dark', { bottom: true });
  flag(123.2, C1 - 0.4, -145.6, 'red', 0, 2.6);

  const D2 = 37.5;
  building(137, -153, 156, -131.6, D2, 'facadeConcrete');
  edge(137, -153, 137.3, -145.2, D2);
  edge(137, -142.8, 137.3, -131.6, D2);
  edge(137.3, -153, 156, -152.7, D2);
  edge(137.3, -131.9, 150, -131.6, D2);
  edge(155.7, -152.7, 156, -138, D2, 'parapet');
  strip(155.65, -138, 156, -131.6, D2);
  prop([140.5, D2, -152.7], [145.5, D2 + 1.5, -148], 'white', true);
  solid([147, D2, -152.7], [154, D2 + 3.2, -147], 'white', 0, { ao: true });
  visual([146.8, D2 + 3.2, -152.9], [154.2, D2 + 3.4, -146.8], 'grey');
  door(149.5, 150.9, -147, D2, 1);
  hint('Same again, wall on the right this time', [137, 36.5, -153], [156, 44, -131.6]);

  // Glass tower W2: its north face is the second wall-run surface.
  building(150, -131.6, 176, -118, 66, 'facadeGlass');
  visual([153, D2 + 0.4, -131.66], [173, D2 + 3.8, -131.6], 'red');
  visual([153, D2 + 3.95, -131.66], [173, D2 + 4.1, -131.6], 'red');

  const D3 = 37.0;
  building(169, -153, 190, -131.6, D3, 'facadeWhite');
  edge(169, -153, 190, -152.7, D3);
  edge(176, -131.9, 190, -131.6, D3);
  // Red pipe to slide under (round visual, box collider), resting on two supports.
  solid([176.6, D3 + 1.05, -152.7], [177.4, D3 + 1.75, -131.9], 'red', PROP_FLAGS | NO_STEP, { visible: false });
  decor.push({ kind: 'pipe', a: [177, D3 + 1.4, -152.9], b: [177, D3 + 1.4, -131.7], radius: 0.35, style: 'red' });
  prop([176.4, D3, -152.7], [177.6, D3 + 1.05, -152.3], 'dark');
  prop([176.4, D3, -132.3], [177.6, D3 + 1.05, -131.9], 'dark');
  prop([182, D3, -152.7], [186, D3 + 1.2, -149.5], 'grey', true);
  hint('Slide under the pipe, then jump and climb the red ledge', [169, 36, -153], [190, 44, -131.6]);

  // E1 is 2 m higher than D3: its west wall (red lip) is the climb. The north edge is
  // left open where the zipline cable leaves the roof.
  const E1 = 39.0;
  building(190, -160, 214, -128, E1, 'facadeWhite');
  visual([189.8, E1 - 0.8, -152.5], [190.0, E1 + 0.035, -132.5], 'red', { bottom: true });
  edge(190, -160, 190.3, -153, E1);
  edge(190, -131.6, 190.3, -128.3, E1, 'parapet');
  edge(190.3, -128.3, 214, -128, E1);
  edge(213.7, -160, 214, -128.3, E1);
  edge(190.3, -160, 199, -159.7, E1);
  edge(205, -160, 213.7, -159.7, E1);
  prop([206, E1, -136], [210, E1 + 1.4, -131], 'white', true);
  prop([193, E1, -131.6], [197, E1 + 1.2, -128.4], 'grey', true);
  solid([207, E1, -150], [213.6, E1 + 3.2, -143], 'white', 0, { ao: true });
  visual([206.8, E1 + 3.2, -150.2], [213.8, E1 + 3.4, -142.8], 'grey');

  // Zipline tower (like a crane mast) and the cable down to F1.
  const ZIP_A: Vec3 = [202, 42.2, -157];
  const ZIP_B: Vec3 = [202, 34.0, -217];
  solid([200.6, E1, -157], [203.4, E1 + 7.4, -154.2], 'red', PROP_FLAGS, { visible: false });
  decor.push({ kind: 'tower', x: 202, y: E1, z: -155.6, w: 2.8, d: 2.8, h: 7.4 });
  visual([200.2, E1 + 1.0, -157.35], [201.2, E1 + 2.4, -156.95], 'red');
  flag(199.6, E1 + PARAPET_H, -159.85, 'orange', 0);
  flag(204.4, E1 + PARAPET_H, -159.85, 'orange', 0);
  checkpoints.push({
    name: 'Final sprint',
    spawn: [196, E1, -148],
    yaw: yawToward(6, -9),
    zone: { min: [190.3, E1 - 1, -160], max: [214, E1 + 6, -128] },
    marker: [194, E1, -137],
  });
  hint('Stand under the cable and press E to ride the zipline', [190, 38, -160], [214, 46, -138]);

  // ------------------------------------------------------------------ 6. Final sprint

  const F1 = 31.5;
  building(190, -252, 214, -208, F1, 'facadeGlass');
  edge(190, -208.3, 198, -208, F1);
  edge(206, -208.3, 214, -208, F1);
  edge(190, -252, 190.3, -208.3, F1);
  edge(213.7, -252, 214, -208.3, F1);
  edge(190.3, -252, 196, -251.7, F1, 'parapet');
  edge(208, -252, 213.7, -251.7, F1, 'parapet');
  strip(196, -252, 208, -251.65, F1);
  // End gantry of the zipline: the rider passes under the cross beam.
  prop([199.3, F1, -217.2], [199.7, 34.4, -216.8], 'red');
  prop([204.3, F1, -217.2], [204.7, 34.4, -216.8], 'red');
  solid([199.3, 34.0, -217.2], [204.7, 34.4, -216.8], 'red', PROP_FLAGS | NO_STEP, { bottom: true });
  prop([192, F1, -240], [195.5, F1 + 1.4, -235], 'white', true);
  prop([209, F1, -230], [212.5, F1 + 1.2, -226], 'grey', true);
  flag(196.6, F1 + PARAPET_H, -251.85, 'red', 0);
  flag(207.4, F1 + PARAPET_H, -251.85, 'red', 0);
  hint('Final sprint! Keep your speed and jump at the red edges', [190, 30, -252], [214, 40, -222]);

  const F2 = 30.0;
  building(193, -269, 211, -257, F2, 'facadeWhite');
  edge(193, -269, 193.3, -257, F2);
  edge(210.7, -269, 211, -257, F2);
  edge(193.3, -269, 196, -268.7, F2, 'parapet');
  edge(208, -269, 210.7, -268.7, F2, 'parapet');
  strip(196, -269, 208, -268.65, F2);
  solid([196, F2, -263.4], [208, F2 + 0.95, -262.6], 'red', NO_WALLRUN, { ao: true });
  prop([193.3, F2, -263.6], [196, F2 + 1.8, -262.4], 'white');
  prop([208, F2, -263.6], [210.7, F2 + 1.8, -262.4], 'white');

  const F3 = 28.5;
  building(186, -308, 218, -273.5, F3, 'facadeWhite');
  edge(186, -308, 186.3, -273.5, F3);
  edge(217.7, -308, 218, -273.5, F3);
  edge(186.3, -308, 217.7, -307.7, F3);
  // Finish gate.
  solid([195, F3, -290.6], [196.2, F3 + 6.2, -289.4], 'red', PROP_FLAGS, { ao: true });
  solid([207.8, F3, -290.6], [209, F3 + 6.2, -289.4], 'red', PROP_FLAGS, { ao: true });
  visual([195, F3 + 5.2, -290.6], [209, F3 + 6.2, -289.4], 'red', { bottom: true });
  decor.push({ kind: 'banner', x: 202, y: F3 + 5.7, z: -289.38, w: 11.6, h: 0.9, text: 'FINISH', yaw: 0 });
  decor.push({ kind: 'banner', x: 202, y: F3 + 5.7, z: -290.62, w: 11.6, h: 0.9, text: 'FINISH', yaw: Math.PI });
  visual([196.2, F3, -290.1], [207.8, F3 + 0.02, -289.9], 'red');
  prop([188, F3, -300], [192, F3 + 1.4, -295], 'white', true);
  prop([212, F3, -284], [216, F3 + 1.2, -279], 'grey', true);
  flag(187, F3 + PARAPET_H, -290, 'red', Math.PI / 2, 4);
  flag(217, F3 + PARAPET_H, -290, 'red', Math.PI / 2, 4);

  return {
    solids,
    decor,
    spawn: { pos: [0, A1, 0.8], yaw: 0 },
    checkpoints,
    finish: { zone: { min: [186, 26, -291], max: [218, 40, -289] }, beacon: [202, F3, -290] },
    hints,
    ziplines: [{ a: ZIP_A, b: ZIP_B }],
    killY: 18,
    footprints,
    lowCorridors: [
      { x0: 196, z0: -217, x1: 208, z1: -157, top: 14 },
      { x0: 86, z0: -149, x1: 99, z1: -131, top: 14 },
      { x0: 156, z0: -153, x1: 169, z1: -131.6, top: 14 },
    ],
    bounds: { minX: -12, maxX: 218, minZ: -308, maxZ: 8 },
  };
}
