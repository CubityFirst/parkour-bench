import { Flag } from './CollisionWorld.ts';
import { Rng } from '../utils/Rng.ts';

/**
 * Pure-data level construction toolkit. Nothing in here touches Three.js or the DOM, so the same
 * layout feeds the renderer, the collision world and the headless route bot (tools/route-bot.mjs).
 */

export type V3 = [number, number, number];
export type Heading = 0 | 1 | 2 | 3; // 0 = -Z (north), 1 = +X (east), 2 = +Z (south), 3 = -X (west)
export type Facing = 0 | 1 | 2 | 3; // direction a prop's front faces: -Z, +X, +Z, -X

export type MatKey =
  | 'building'
  | 'white'
  | 'trim'
  | 'red'
  | 'redDark'
  | 'concrete'
  | 'metal'
  | 'dark'
  | 'glass'
  | 'orange'
  | 'grate'
  | 'panel';

export interface FacadeParams {
  /** 0 ribbon windows, 1 glass curtain wall, 2 punched windows, 3 plain panels, 4 roof trim band. */
  style: number;
  seed: number;
  /** 0 none, 1 red, 2 orange, 3 blue accent band under the roofline. */
  accent: number;
  tint: V3;
}

export interface SolidBox {
  min: V3;
  max: V3;
  mat: MatKey;
  collide: boolean;
  visible: boolean;
  flags: number;
  chunk: number;
  facade: FacadeParams | null;
  shadow: boolean;
  /** Draw a soft contact-shadow decal under this box. */
  ao: boolean;
  label: string;
}

export interface CylSpec {
  axis: 'x' | 'y' | 'z';
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  radiusTop: number;
  length: number;
  mat: MatKey;
  segments: number;
  chunk: number;
  shadow: boolean;
}

/** A straight bar (square section) between two points - diagonal braces, struts, cables. Visual only. */
export interface BarSpec {
  a: V3;
  b: V3;
  thickness: number;
  mat: MatKey;
  chunk: number;
  shadow: boolean;
}

export interface FlagSpec {
  x: number;
  y: number;
  z: number;
  height: number;
  /** Direction the flag streams toward (radians around Y). */
  angle: number;
  color: 'orange' | 'red';
  chunk: number;
}

export interface SignSpec {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  facing: Facing;
  variant: number;
  chunk: number;
}

export interface Aabb {
  min: V3;
  max: V3;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Roof height of the structure this rectangle belongs to (footprints only). */
  top?: number;
}

export const WHITE: V3 = [1, 1, 1];

const FWD: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const RIGHT: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * A local coordinate frame: `f` runs forward along the route direction, `r` to the right of it.
 * Lets every section be authored as "straight ahead" and rotated into place.
 */
export class Frame {
  readonly ox: number;
  readonly oz: number;
  readonly heading: Heading;
  private readonly fx: number;
  private readonly fz: number;
  private readonly rx: number;
  private readonly rz: number;

  constructor(ox: number, oz: number, heading: Heading) {
    this.ox = ox;
    this.oz = oz;
    this.heading = heading;
    this.fx = FWD[heading]![0];
    this.fz = FWD[heading]![1];
    this.rx = RIGHT[heading]![0];
    this.rz = RIGHT[heading]![1];
  }

  x(f: number, r: number): number {
    return this.ox + f * this.fx + r * this.rx;
  }

  z(f: number, r: number): number {
    return this.oz + f * this.fz + r * this.rz;
  }

  /** Camera yaw that looks along this frame's forward direction. */
  get yaw(): number {
    return -this.heading * (Math.PI / 2);
  }

  /** World direction of local forward / right. */
  get forward(): readonly [number, number] {
    return [this.fx, this.fz];
  }

  get right(): readonly [number, number] {
    return [this.rx, this.rz];
  }

  /** Facing value of a prop whose front looks toward local forward (dir=0), right (1), back (2) or left (3). */
  facing(dir: 0 | 1 | 2 | 3): Facing {
    return ((this.heading + dir) & 3) as Facing;
  }

  /** World AABB (as min/max) covering the local range. */
  aabb(f0: number, f1: number, r0: number, r1: number, y0: number, y1: number): Aabb {
    const xa = this.x(f0, r0);
    const xb = this.x(f1, r1);
    const za = this.z(f0, r0);
    const zb = this.z(f1, r1);
    return {
      min: [Math.min(xa, xb), Math.min(y0, y1), Math.min(za, zb)],
      max: [Math.max(xa, xb), Math.max(y0, y1), Math.max(za, zb)],
    };
  }
}

export interface BoxOpts {
  visible?: boolean;
  collide?: boolean;
  flags?: number;
  shadow?: boolean;
  facade?: FacadeParams | null;
  ao?: boolean;
  label?: string;
}

export interface RoofDef {
  name: string;
  f0: number;
  f1: number;
  r0: number;
  r1: number;
  top: number;
  bottom?: number;
  style?: number;
  tint?: V3;
  accent?: number;
  /** Sides without a curb (jump-off / landing edges, or sides abutting a tower). */
  open?: { f0?: boolean; f1?: boolean; r0?: boolean; r1?: boolean };
  /** Local r range kept clear of scattered clutter (the intended route). */
  lane?: [number, number];
  /** Extra clearance (m) in front of open f edges kept free of clutter. */
  edgeClear?: number;
}

export interface RoofInfo {
  fr: Frame;
  def: RoofDef;
  top: number;
  rect: Rect;
}

export interface CheckpointDef {
  id: number;
  name: string;
  /** Respawn position (feet) and facing. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Gate placement for visuals. */
  gate: { x: number; y: number; z: number; width: number; facing: Facing };
  trigger: Aabb;
  killY: number;
}

export interface HintDef {
  id: string;
  text: string;
  keys: string[];
  trigger: Aabb;
  duration: number;
}

export interface SectionDef {
  index: number;
  name: string;
  trigger: Aabb;
}

export type RouteAct =
  | 'run'
  | 'jump'
  | 'jumpWall'
  | 'wallEnd'
  | 'slide'
  | 'slideEnd'
  | 'vault'
  | 'finish';

export interface RouteNode {
  x: number;
  y: number;
  z: number;
  act: RouteAct;
  /** For jumpWall: -1 / +1 = steer toward the wall on the left / right (local sense of travel). */
  steer?: number;
  label?: string;
}

export interface LevelLayout {
  boxes: SolidBox[];
  cyls: CylSpec[];
  bars: BarSpec[];
  flags: FlagSpec[];
  signs: SignSpec[];
  checkpoints: CheckpointDef[];
  hints: HintDef[];
  sections: SectionDef[];
  route: RouteNode[];
  start: { x: number; y: number; z: number; yaw: number };
  finish: { x: number; y: number; z: number; yaw: number; width: number; facing: Facing; trigger: Aabb };
  /** XZ footprints of every route structure; the background city keeps clear of these. */
  footprints: Rect[];
  /** Highest / lowest roof heights, used by the city generator and kill planes. */
  roofTops: number[];
}

export class LevelBuilder {
  readonly boxes: SolidBox[] = [];
  readonly cyls: CylSpec[] = [];
  readonly bars: BarSpec[] = [];
  readonly flags: FlagSpec[] = [];
  readonly signs: SignSpec[] = [];
  readonly checkpoints: CheckpointDef[] = [];
  readonly hints: HintDef[] = [];
  readonly sections: SectionDef[] = [];
  readonly route: RouteNode[] = [];
  readonly footprints: Rect[] = [];
  readonly roofTops: number[] = [];
  readonly rng: Rng;
  /** World XZ rectangles where scattered clutter must not go. */
  readonly avoid: Rect[] = [];
  /** Clutter placed so far (world XZ), to avoid overlaps. */
  private readonly placed: Rect[] = [];
  chunk = 0;
  private seedCounter = 1;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  nextSeed(): number {
    this.seedCounter++;
    return (this.seedCounter * 0.6180339887) % 1;
  }

  // ------------------------------------------------------------------------------------------
  // Primitives
  // ------------------------------------------------------------------------------------------

  box(mat: MatKey, min: V3, max: V3, o: BoxOpts = {}): SolidBox {
    const b: SolidBox = {
      min,
      max,
      mat,
      collide: o.collide ?? true,
      visible: o.visible ?? true,
      flags: o.flags ?? Flag.None,
      chunk: this.chunk,
      facade: o.facade ?? null,
      shadow: o.shadow ?? true,
      ao: o.ao ?? false,
      label: o.label ?? '',
    };
    this.boxes.push(b);
    return b;
  }

  /** Box from local frame ranges. */
  fbox(
    fr: Frame,
    f0: number,
    f1: number,
    r0: number,
    r1: number,
    y0: number,
    y1: number,
    mat: MatKey,
    o: BoxOpts = {},
  ): SolidBox {
    const a = fr.aabb(f0, f1, r0, r1, y0, y1);
    return this.box(mat, a.min, a.max, o);
  }

  cyl(
    axis: 'x' | 'y' | 'z',
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    length: number,
    mat: MatKey,
    o: { radiusTop?: number; segments?: number; shadow?: boolean } = {},
  ): void {
    this.cyls.push({
      axis,
      cx,
      cy,
      cz,
      radius,
      radiusTop: o.radiusTop ?? radius,
      length,
      mat,
      segments: o.segments ?? 12,
      chunk: this.chunk,
      shadow: o.shadow ?? true,
    });
  }

  bar(mat: MatKey, a: V3, b: V3, thickness: number, shadow = true): void {
    this.bars.push({ a, b, thickness, mat, chunk: this.chunk, shadow });
  }

  private addFootprint(a: Aabb, pad = 0): void {
    this.footprints.push({ x0: a.min[0] - pad, x1: a.max[0] + pad, z0: a.min[2] - pad, z1: a.max[2] + pad, top: a.max[1] });
  }

  // ------------------------------------------------------------------------------------------
  // Buildings
  // ------------------------------------------------------------------------------------------

  /**
   * A walkable rooftop: one invisible collider covering the whole building plus visual body, cap and
   * low curbs on the sides that are not jump-off / landing edges.
   */
  roof(fr: Frame, d: RoofDef): RoofInfo {
    const bottom = d.bottom ?? 0;
    const top = d.top;
    const tint = d.tint ?? WHITE;
    const facade: FacadeParams = { style: d.style ?? 0, seed: this.nextSeed(), accent: d.accent ?? 0, tint };
    const capFacade: FacadeParams = { style: 4, seed: facade.seed, accent: 0, tint: [0.97, 0.98, 1] };
    const open = d.open ?? {};

    this.fbox(fr, d.f0, d.f1, d.r0, d.r1, bottom, top, 'building', { visible: false, label: d.name });
    this.fbox(fr, d.f0, d.f1, d.r0, d.r1, bottom, top - 0.4, 'building', { collide: false, facade });
    const o = 0.2;
    this.fbox(fr, d.f0 - o, d.f1 + o, d.r0 - o, d.r1 + o, top - 0.4, top, 'building', {
      collide: false,
      facade: capFacade,
    });

    const ch = 0.28;
    const ct = 0.32;
    const curb = (f0: number, f1: number, r0: number, r1: number) =>
      this.fbox(fr, f0, f1, r0, r1, top, top + ch, 'trim', { label: 'curb' });
    if (!open.r0) curb(d.f0, d.f1, d.r0, d.r0 + ct);
    if (!open.r1) curb(d.f0, d.f1, d.r1 - ct, d.r1);
    if (!open.f0) curb(d.f0, d.f0 + ct, d.r0, d.r1);
    if (!open.f1) curb(d.f1 - ct, d.f1, d.r0, d.r1);

    const a = fr.aabb(d.f0, d.f1, d.r0, d.r1, bottom, top);
    this.addFootprint(a);
    this.roofTops.push(top);
    const rect: Rect = { x0: a.min[0], x1: a.max[0], z0: a.min[2], z1: a.max[2] };

    // Keep clutter off the intended route.
    const lane = d.lane ?? [-3.4, 3.4];
    const la = fr.aabb(d.f0, d.f1, lane[0], lane[1], 0, 1);
    this.avoid.push({ x0: la.min[0], x1: la.max[0], z0: la.min[2], z1: la.max[2] });
    const ec = d.edgeClear ?? 3.2;
    if (open.f1) {
      const e = fr.aabb(d.f1 - ec, d.f1, d.r0, d.r1, 0, 1);
      this.avoid.push({ x0: e.min[0], x1: e.max[0], z0: e.min[2], z1: e.max[2] });
    }
    if (open.f0) {
      const e = fr.aabb(d.f0, d.f0 + ec, d.r0, d.r1, 0, 1);
      this.avoid.push({ x0: e.min[0], x1: e.max[0], z0: e.min[2], z1: e.max[2] });
    }
    return { fr, def: d, top, rect };
  }

  /** A building that is only scenery / walls for the route (e.g. the towers flanking an alley). */
  tower(
    fr: Frame,
    name: string,
    f0: number,
    f1: number,
    r0: number,
    r1: number,
    top: number,
    style: number,
    tint: V3 = WHITE,
    accent = 0,
    bottom = 0,
  ): void {
    const facade: FacadeParams = { style, seed: this.nextSeed(), accent, tint };
    this.fbox(fr, f0, f1, r0, r1, bottom, top, 'building', { facade, label: name });
    const o = 0.15;
    const capFacade: FacadeParams = { style: 4, seed: facade.seed, accent: 0, tint: [0.97, 0.98, 1] };
    this.fbox(fr, f0 - o, f1 + o, r0 - o, r1 + o, top - 0.5, top, 'building', {
      collide: false,
      facade: capFacade,
    });
    this.addFootprint(fr.aabb(f0, f1, r0, r1, bottom, top));
  }

  /** Narrow bridge beam between two roofs. */
  beam(fr: Frame, name: string, f0: number, f1: number, r0: number, r1: number, top: number): void {
    const thick = 0.5;
    this.fbox(fr, f0, f1, r0, r1, top - thick, top, 'white', { visible: false, label: name });
    // Deck sits a hair lower than the collider so it never z-fights with the roofs it connects.
    this.fbox(fr, f0, f1, r0, r1, top - thick, top - 0.02, 'trim', { collide: false });
    // Red edge stripes along the beam.
    const sw = 0.28;
    this.fbox(fr, f0, f1, r0, r0 + sw, top - 0.02, top + 0.01, 'red', { collide: false, shadow: false });
    this.fbox(fr, f0, f1, r1 - sw, r1, top - 0.02, top + 0.01, 'red', { collide: false, shadow: false });
    // Underslung web + flanges so the beam reads as steel, not a floating plank.
    const mid = (r0 + r1) / 2;
    this.fbox(fr, f0, f1, mid - 0.12, mid + 0.12, top - thick - 1.3, top - thick, 'metal', { collide: false });
    this.fbox(fr, f0, f1, mid - 0.6, mid + 0.6, top - thick - 1.4, top - thick - 1.25, 'metal', { collide: false });
    // Cross braces every few metres.
    for (let f = f0 + 1.2; f < f1 - 0.6; f += 2.4) {
      this.fbox(fr, f, f + 0.1, r0 + 0.2, r1 - 0.2, top - thick - 0.6, top - thick, 'metal', { collide: false });
    }
    this.addFootprint(fr.aabb(f0, f1, r0, r1, 0, top));
    this.roofTops.push(top);
  }

  /** Red edge marker painted on the roof surface at a jump-off line. */
  edgeMarker(fr: Frame, f: number, r0: number, r1: number, top: number, depth = 0.9): void {
    this.fbox(fr, f - depth, f, r0, r1, top, top + 0.03, 'red', { collide: false, shadow: false });
    // Matching red coping on the cap face so the edge reads from a distance.
    this.fbox(fr, f + 0.2, f + 0.235, r0, r1, top - 0.4, top, 'red', { collide: false, shadow: false });
  }

  // ------------------------------------------------------------------------------------------
  // Route furniture
  // ------------------------------------------------------------------------------------------

  /** Solid red crate-style vault obstacle. */
  crate(fr: Frame, f0: number, f1: number, r0: number, r1: number, floor: number, h: number): void {
    this.fbox(fr, f0, f1, r0, r1, floor, floor + h, 'red', { ao: true, label: 'vault crate' });
    // White stripe on top so it reads as a deliberate object, not a random red block.
    const c = (r0 + r1) / 2;
    this.fbox(fr, f0 + 0.1, f1 - 0.1, c - 0.18, c + 0.18, floor + h, floor + h + 0.015, 'white', {
      collide: false,
      shadow: false,
    });
  }

  /**
   * Ventilation bulkhead spanning wall to wall: solid above a low slot the player has to slide under.
   * `slot` is the clearance above the floor.
   */
  bulkhead(
    fr: Frame,
    name: string,
    f0: number,
    f1: number,
    r0: number,
    r1: number,
    floor: number,
    slot: number,
    height: number,
  ): void {
    this.fbox(fr, f0, f1, r0, r1, floor + slot, floor + height, 'white', { flags: Flag.NoGrab, label: name });
    // Red lip along the underside edge so the slot is unmistakable.
    const lip = 0.22;
    this.fbox(fr, f0 - 0.04, f1 + 0.04, r0, r1, floor + slot, floor + slot + lip, 'red', {
      collide: false,
      shadow: false,
    });
    // Louvres / panel lines on both faces.
    for (let k = 0; k < 4; k++) {
      const y = floor + slot + 0.7 + k * 0.5;
      if (y + 0.1 > floor + height - 0.2) break;
      this.fbox(fr, f0 - 0.03, f1 + 0.03, r0 + 0.3, r1 - 0.3, y, y + 0.1, 'metal', { collide: false, shadow: false });
    }
    // Red band along the top.
    this.fbox(fr, f0 - 0.04, f1 + 0.04, r0, r1, floor + height - 0.3, floor + height - 0.1, 'red', {
      collide: false,
      shadow: false,
    });
  }

  /**
   * Wall-run panel: a red slab bolted to a tall wall. `rFace` is the wall plane, `away` (+1/-1) the
   * direction pointing into the wall, so the panel protrudes toward the route by 0.35 m.
   */
  wallPanel(fr: Frame, name: string, f0: number, f1: number, rFace: number, away: 1 | -1, y0: number, y1: number): void {
    const proud = 0.35;
    const ra = rFace - away * proud;
    const rb = rFace + away * 0.1;
    this.fbox(fr, f0, f1, Math.min(ra, rb), Math.max(ra, rb), y0, y1, 'panel', {
      flags: Flag.WallRun | Flag.NoGrab,
      label: name,
    });
    // White guide lines along the run direction.
    const face = ra;
    const lineR0 = Math.min(face, face - away * 0.03);
    const lineR1 = Math.max(face, face - away * 0.03);
    const yMid = (y0 + y1) / 2;
    for (const dy of [-1.6, 0, 1.6]) {
      this.fbox(fr, f0 + 0.5, f1 - 0.5, lineR0, lineR1, yMid + dy - 0.05, yMid + dy + 0.05, 'white', {
        collide: false,
        shadow: false,
      });
    }
  }

  /** Waist-high railing: thin collider (vaultable) with posts and two rails. */
  railing(fr: Frame, f0: number, f1: number, r: number, floor: number, height = 1.05): void {
    const t = 0.05;
    this.fbox(fr, f0, f1, r - t, r + t, floor, floor + height, 'metal', { visible: false, label: 'railing' });
    const len = Math.abs(f1 - f0);
    const n = Math.max(1, Math.round(len / 2));
    const lo = Math.min(f0, f1);
    for (let i = 0; i <= n; i++) {
      const f = lo + (len * i) / n;
      this.fbox(fr, f - 0.04, f + 0.04, r - 0.04, r + 0.04, floor, floor + height, 'metal', {
        collide: false,
        shadow: true,
      });
    }
    this.fbox(fr, lo, lo + len, r - 0.035, r + 0.035, floor + height - 0.06, floor + height, 'metal', {
      collide: false,
    });
    this.fbox(fr, lo, lo + len, r - 0.025, r + 0.025, floor + height * 0.5, floor + height * 0.5 + 0.05, 'metal', {
      collide: false,
    });
  }

  /** Horizontal red pipe run lying on supports (low enough to step over). */
  pipeRun(fr: Frame, f0: number, f1: number, r: number, floor: number, radius = 0.15, mat: MatKey = 'red'): void {
    const lo = Math.min(f0, f1);
    const hi = Math.max(f0, f1);
    const cy = floor + radius + 0.06;
    // Collider box (step-over height).
    this.fbox(fr, lo, hi, r - radius, r + radius, floor, floor + 2 * radius + 0.06, mat, { visible: false, label: 'pipe' });
    const a = fr.aabb(lo, hi, r, r, 0, 0);
    const x = (a.min[0] + a.max[0]) / 2;
    const z = (a.min[2] + a.max[2]) / 2;
    const alongX = Math.abs(fr.forward[0]) > 0.5;
    const length = hi - lo;
    this.cyl(alongX ? 'x' : 'z', x, cy, z, radius, length, mat, { segments: 10 });
    // Supports.
    for (let f = lo + 0.6; f < hi; f += 2.6) {
      this.fbox(fr, f - 0.06, f + 0.06, r - radius * 0.7, r + radius * 0.7, floor, cy - radius * 0.4, 'metal', {
        collide: false,
      });
    }
    // Flanges.
    for (let f = lo + 1.9; f < hi - 0.3; f += 3.8) {
      const fa = fr.aabb(f, f, r, r, 0, 0);
      this.cyl(alongX ? 'x' : 'z', fa.min[0], cy, fa.min[2], radius * 1.25, 0.12, 'redDark', { segments: 10 });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Rooftop clutter
  // ------------------------------------------------------------------------------------------

  private free(rect: Rect, pad: number): boolean {
    for (const a of this.avoid) {
      if (rect.x0 - pad < a.x1 && rect.x1 + pad > a.x0 && rect.z0 - pad < a.z1 && rect.z1 + pad > a.z0) return false;
    }
    for (const p of this.placed) {
      if (rect.x0 - 0.8 < p.x1 && rect.x1 + 0.8 > p.x0 && rect.z0 - 0.8 < p.z1 && rect.z1 + 0.8 > p.z0) return false;
    }
    return true;
  }

  /** Reserve world area (e.g. around a hand-placed prop) so scattering skips it. */
  reserve(rect: Rect): void {
    this.placed.push(rect);
  }

  acUnit(x: number, z: number, top: number, w: number, d: number, h: number, facing: Facing): void {
    this.box('white', [x - w / 2, top, z - d / 2], [x + w / 2, top + h, z + d / 2], { ao: true, label: 'ac' });
    // Fan grille on top.
    const rad = Math.min(w, d) * 0.34;
    this.cyl('y', x, top + h + 0.02, z, rad, 0.04, 'dark', { segments: 14, shadow: false });
    this.cyl('y', x, top + h + 0.045, z, rad * 0.25, 0.05, 'metal', { segments: 8, shadow: false });
    // Louvres on the front.
    const fd = facing === 0 ? [0, -1] : facing === 1 ? [1, 0] : facing === 2 ? [0, 1] : [-1, 0];
    const lx = x + fd[0]! * (w / 2 + 0.01);
    const lz = z + fd[1]! * (d / 2 + 0.01);
    const alongX = fd[0] === 0;
    for (let k = 0; k < 4; k++) {
      const y = top + h * 0.25 + k * (h * 0.16);
      if (alongX) this.box('dark', [lx - w * 0.32, y, lz - 0.015], [lx + w * 0.32, y + 0.05, lz + 0.015], { collide: false, shadow: false });
      else this.box('dark', [lx - 0.015, y, lz - d * 0.32], [lx + 0.015, y + 0.05, lz + d * 0.32], { collide: false, shadow: false });
    }
  }

  vent(x: number, z: number, top: number, radius: number, h: number): void {
    this.box('metal', [x - radius, top, z - radius], [x + radius, top + h, z + radius], { visible: false, label: 'vent' });
    this.cyl('y', x, top + h / 2, z, radius, h, 'metal', { segments: 12 });
    this.cyl('y', x, top + h + 0.05, z, radius * 1.45, 0.1, 'white', { segments: 12 });
    this.cyl('y', x, top + 0.12, z, radius * 1.2, 0.24, 'concrete', { segments: 12, shadow: false });
  }

  waterTank(x: number, z: number, top: number, radius: number, h: number): void {
    const legH = 1.1;
    this.box('metal', [x - radius, top, z - radius], [x + radius, top + legH + h, z + radius], { visible: false, label: 'tank' });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = x + sx * radius * 0.7;
        const lz = z + sz * radius * 0.7;
        this.box('metal', [lx - 0.08, top, lz - 0.08], [lx + 0.08, top + legH, lz + 0.08], { collide: false });
      }
    }
    this.cyl('y', x, top + legH + h / 2, z, radius, h, 'concrete', { segments: 18 });
    this.cyl('y', x, top + legH + h + 0.2, z, radius, 0.4, 'white', { radiusTop: radius * 0.15, segments: 18 });
    // Red band.
    this.cyl('y', x, top + legH + h * 0.5, z, radius * 1.015, 0.25, 'red', { segments: 18, shadow: false });
  }

  penthouse(x: number, z: number, top: number, w: number, d: number, h: number, facing: Facing, redDoor: boolean): void {
    const facade: FacadeParams = { style: 3, seed: this.nextSeed(), accent: 0, tint: [0.96, 0.97, 0.99] };
    this.box('building', [x - w / 2, top, z - d / 2], [x + w / 2, top + h, z + d / 2], {
      facade,
      ao: true,
      label: 'penthouse',
    });
    this.box('trim', [x - w / 2 - 0.15, top + h, z - d / 2 - 0.15], [x + w / 2 + 0.15, top + h + 0.22, z + d / 2 + 0.15], {
      collide: false,
    });
    // Door on the front.
    const fd = facing === 0 ? [0, -1] : facing === 1 ? [1, 0] : facing === 2 ? [0, 1] : [-1, 0];
    const dw = 1.1;
    const dh = 2.1;
    const px = x + fd[0]! * (w / 2 + 0.03);
    const pz = z + fd[1]! * (d / 2 + 0.03);
    const mat: MatKey = redDoor ? 'red' : 'metal';
    if (fd[0] === 0) {
      this.box(mat, [px - dw / 2, top, pz - 0.04], [px + dw / 2, top + dh, pz + 0.04], { collide: false, shadow: false });
      this.box('dark', [px - dw / 2 + 0.2, top + 1.4, pz - 0.05 * fd[1]!], [px + dw / 2 - 0.2, top + 1.8, pz + 0.05 * fd[1]!], { collide: false, shadow: false });
    } else {
      this.box(mat, [px - 0.04, top, pz - dw / 2], [px + 0.04, top + dh, pz + dw / 2], { collide: false, shadow: false });
      this.box('dark', [px - 0.05 * fd[0]!, top + 1.4, pz - dw / 2 + 0.2], [px + 0.05 * fd[0]!, top + 1.8, pz + dw / 2 - 0.2], { collide: false, shadow: false });
    }
    // A vent on top.
    this.cyl('y', x - w * 0.2, top + h + 0.55, z + d * 0.15, 0.3, 0.7, 'metal', { segments: 10 });
  }

  skylight(x: number, z: number, top: number, w: number, d: number): void {
    this.box('white', [x - w / 2, top, z - d / 2], [x + w / 2, top + 0.6, z + d / 2], { ao: true, label: 'skylight' });
    this.box('glass', [x - w / 2 + 0.15, top + 0.6, z - d / 2 + 0.15], [x + w / 2 - 0.15, top + 0.66, z + d / 2 - 0.15], {
      collide: false,
      shadow: false,
    });
  }

  antenna(x: number, z: number, top: number, h: number): void {
    this.cyl('y', x, top + h / 2, z, 0.05, h, 'metal', { segments: 6, radiusTop: 0.025 });
    for (let k = 1; k <= 3; k++) {
      const y = top + h * (0.3 + k * 0.17);
      this.box('metal', [x - 0.5 + k * 0.1, y, z - 0.015], [x + 0.5 - k * 0.1, y + 0.03, z + 0.015], { collide: false });
    }
    this.cyl('y', x, top + h + 0.1, z, 0.07, 0.2, 'red', { segments: 6 });
  }

  flagPole(x: number, z: number, top: number, h: number, color: 'orange' | 'red', angle: number): void {
    this.cyl('y', x, top + h / 2, z, 0.04, h, 'metal', { segments: 6 });
    this.flags.push({ x, y: top + h, z, height: h, angle, color, chunk: this.chunk });
  }

  sign(x: number, z: number, top: number, w: number, h: number, facing: Facing, variant: number): void {
    this.signs.push({ x, y: top, z, width: w, height: h, facing, variant, chunk: this.chunk });
  }

  /**
   * Red steel scaffold tower with a top platform and an electrical cabinet at its foot (cf. the red
   * crane / cabinet motifs of the reference rooftops). Only the four legs and the cabinet collide, and
   * the first cross-ring sits above head height, so the space underneath stays walkable.
   */
  scaffoldTower(x: number, z: number, top: number, w: number, h: number): void {
    const hw = w / 2;
    const leg = 0.24;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.box('red', [x + sx * hw - leg / 2, top, z + sz * hw - leg / 2], [x + sx * hw + leg / 2, top + h, z + sz * hw + leg / 2], {
          label: 'scaffold leg',
        });
      }
    }
    for (let y = 2.5; y < h - 0.2; y += 2.1) {
      const t = 0.12;
      this.box('red', [x - hw, top + y, z - hw], [x + hw, top + y + t, z - hw + t], { collide: false });
      this.box('red', [x - hw, top + y, z + hw - t], [x + hw, top + y + t, z + hw], { collide: false });
      this.box('red', [x - hw, top + y, z - hw], [x - hw + t, top + y + t, z + hw], { collide: false });
      this.box('red', [x + hw - t, top + y, z - hw], [x + hw, top + y + t, z + hw], { collide: false });
    }
    // Lattice bracing: one diagonal per bay and face, alternating direction.
    let bay = 0;
    for (let y = 2.5; y + 2.1 < h; y += 2.1, bay++) {
      const y0 = top + y + 0.12;
      const y1 = top + y + 2.1;
      const flip = bay % 2 === 0;
      const lo = flip ? -hw : hw;
      const hi = flip ? hw : -hw;
      this.bar('red', [x + lo, y0, z - hw], [x + hi, y1, z - hw], 0.1, false);
      this.bar('red', [x + hi, y0, z + hw], [x + lo, y1, z + hw], 0.1, false);
      this.bar('red', [x - hw, y0, z + lo], [x - hw, y1, z + hi], 0.1, false);
      this.bar('red', [x + hw, y0, z + hi], [x + hw, y1, z + lo], 0.1, false);
    }
    this.box('metal', [x - hw - 0.3, top + h, z - hw - 0.3], [x + hw + 0.3, top + h + 0.18, z + hw + 0.3], { collide: false });
    this.box('red', [x - hw - 0.3, top + h + 0.18, z - hw - 0.3], [x + hw + 0.3, top + h + 1.0, z - hw - 0.24], { collide: false });
    // Electrical cabinet at the foot with louvre slots (the red box in the reference).
    const cw = 1.5;
    const cd = 0.65;
    const ch = 1.9;
    const cx = x + hw + cw / 2 + 0.5;
    this.box('red', [cx - cw / 2, top, z - cd / 2], [cx + cw / 2, top + ch, z + cd / 2], { ao: true, label: 'cabinet' });
    for (let k = 0; k < 7; k++) {
      const y = top + 0.85 + k * 0.12;
      this.box('dark', [cx - 0.42, y, z + cd / 2 - 0.01], [cx + 0.42, y + 0.045, z + cd / 2 + 0.012], { collide: false, shadow: false });
    }
  }

  /** Dark floor grating (flat decal with a lighter grid), like the vent grille in the reference rooftop. */
  grate(x: number, z: number, top: number, w: number, d: number): void {
    this.box('grate', [x - w / 2, top, z - d / 2], [x + w / 2, top + 0.05, z + d / 2], { collide: false, shadow: false });
    const step = 0.4;
    for (let u = -w / 2 + step; u < w / 2 - 0.05; u += step) {
      this.box('trim', [x + u - 0.012, top + 0.05, z - d / 2 + 0.05], [x + u + 0.012, top + 0.058, z + d / 2 - 0.05], { collide: false, shadow: false });
    }
    for (let v = -d / 2 + step; v < d / 2 - 0.05; v += step) {
      this.box('trim', [x - w / 2 + 0.05, top + 0.05, z + v - 0.012], [x + w / 2 - 0.05, top + 0.058, z + v + 0.012], { collide: false, shadow: false });
    }
    this.box('metal', [x - w / 2 - 0.06, top, z - d / 2 - 0.06], [x + w / 2 + 0.06, top + 0.06, z - d / 2], { collide: false, shadow: false });
    this.box('metal', [x - w / 2 - 0.06, top, z + d / 2], [x + w / 2 + 0.06, top + 0.06, z + d / 2 + 0.06], { collide: false, shadow: false });
    this.box('metal', [x - w / 2 - 0.06, top, z - d / 2], [x - w / 2, top + 0.06, z + d / 2], { collide: false, shadow: false });
    this.box('metal', [x + w / 2, top, z - d / 2], [x + w / 2 + 0.06, top + 0.06, z + d / 2], { collide: false, shadow: false });
  }

  /**
   * Scatter clutter on a roof. Nothing lands in reserved / lane areas and everything keeps its distance
   * from the roof edges. `count` is the number of placement attempts that succeed at most.
   */
  scatter(roof: RoofInfo, count: number, kinds: ReadonlyArray<'ac' | 'acBig' | 'vent' | 'tank' | 'penthouse' | 'skylight' | 'antenna' | 'flag'>): void {
    const { rect, top } = roof;
    const margin = 1.6;
    let placedCount = 0;
    for (let attempt = 0; attempt < count * 14 && placedCount < count; attempt++) {
      const kind = this.rng.pick(kinds);
      let w = 1.6;
      let d = 1.1;
      let h = 1;
      switch (kind) {
        case 'ac':
          w = this.rng.range(1.5, 2.3);
          d = this.rng.range(0.9, 1.3);
          h = this.rng.range(0.85, 1.25);
          break;
        case 'acBig':
          w = this.rng.range(3, 4.2);
          d = this.rng.range(1.7, 2.3);
          h = this.rng.range(1.5, 2);
          break;
        case 'vent':
          w = d = this.rng.range(0.7, 1.0);
          h = this.rng.range(0.9, 1.7);
          break;
        case 'tank':
          w = d = this.rng.range(2.6, 3.2);
          h = 2.6;
          break;
        case 'penthouse':
          w = this.rng.range(3.2, 5);
          d = this.rng.range(3, 4.4);
          h = this.rng.range(2.7, 3.3);
          break;
        case 'skylight':
          w = this.rng.range(2.4, 3.6);
          d = this.rng.range(1.4, 2.2);
          h = 0.6;
          break;
        case 'antenna':
        case 'flag':
          w = d = 0.6;
          h = 1;
          break;
      }
      const span = (a: number, b: number, size: number) => a + margin + size / 2 + this.rng.next() * Math.max(0, b - a - 2 * margin - size);
      if (rect.x1 - rect.x0 < w + 2 * margin || rect.z1 - rect.z0 < d + 2 * margin) continue;
      const x = span(rect.x0, rect.x1, w);
      const z = span(rect.z0, rect.z1, d);
      const r: Rect = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
      if (!this.free(r, 0.5)) continue;
      // Face the roof centre so louvres and doors look toward open space.
      const cx = (rect.x0 + rect.x1) / 2;
      const cz = (rect.z0 + rect.z1) / 2;
      const dx = cx - x;
      const dz = cz - z;
      const facing: Facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
      switch (kind) {
        case 'ac':
        case 'acBig':
          this.acUnit(x, z, top, w, d, h, facing);
          break;
        case 'vent':
          this.vent(x, z, top, w / 2, h);
          break;
        case 'tank':
          this.waterTank(x, z, top, w / 2, h);
          break;
        case 'penthouse':
          this.penthouse(x, z, top, w, d, h, facing, this.rng.chance(0.4));
          break;
        case 'skylight':
          this.skylight(x, z, top, w, d);
          break;
        case 'antenna':
          this.antenna(x, z, top, this.rng.range(5, 11));
          break;
        case 'flag':
          this.flagPole(x, z, top, this.rng.range(3.5, 5.5), this.rng.chance(0.65) ? 'orange' : 'red', this.rng.range(-0.6, 0.6));
          break;
      }
      this.placed.push(r);
      placedCount++;
    }
  }
}
