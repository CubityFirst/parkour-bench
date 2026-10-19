/**
 * LevelSpec - the pure-data description of the rooftop level.
 *
 * The level is authored with a small "turtle" builder: platforms are laid out one after
 * another along a heading with explicit gaps and height changes, and every feature
 * (obstacles, props, markers, checkpoints) is placed in the platform's local frame
 * (s = distance along the heading, t = lateral offset, positive to the right).
 *
 * This file has no Three.js / DOM dependency; Level.ts turns it into meshes and
 * colliders, and scripts/verify-level.ts replays the annotated `route` through the
 * real player physics to prove the level is completable.
 */

import { type BoxFlags } from './CollisionWorld';

export type V3 = [number, number, number];
export type Mat = 'arch' | 'glass' | 'prop' | 'red' | 'dark';

export interface PartSpec {
  min: V3;
  max: V3;
  mat: Mat;
  collide: boolean;
  visible: boolean;
  castShadow: boolean;
  flags?: BoxFlags;
  /** sRGB hex tint multiplied into the material colour. */
  color: number;
}

export interface CylinderSpec {
  /** Centre. */
  pos: V3;
  radius: number;
  length: number;
  axis: 'x' | 'y' | 'z';
  mat: Mat;
  color: number;
}

export interface CheckpointSpec {
  index: number;
  label: string;
  /** Respawn position (feet) and facing. */
  pos: V3;
  yaw: number;
  /** Axis-aligned trigger volume. */
  triggerMin: V3;
  triggerMax: V3;
  /** Where the marker is drawn (base centre) and its lateral direction. */
  markerPos: V3;
  markerAxis: 'x' | 'z';
}

export interface HintSpec {
  min: V3;
  max: V3;
  text: string;
}

export interface FinishSpec {
  triggerMin: V3;
  triggerMax: V3;
  pos: V3;
  /** Heading unit vector of the final run. */
  heading: [number, number];
  width: number;
}

export type RouteAction = 'run' | 'jump' | 'slide' | 'vault' | 'wallrun';

export interface RouteWaypoint {
  pos: V3;
  action: RouteAction;
  /** Seconds to keep the jump key held (jump / wallrun). */
  hold?: number;
  note?: string;
}

export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export interface LevelSpec {
  parts: PartSpec[];
  cylinders: CylinderSpec[];
  /** Red flags on poles: base position + height. */
  flags: V3[];
  checkpoints: CheckpointSpec[];
  hints: HintSpec[];
  finish: FinishSpec;
  spawn: { pos: V3; yaw: number };
  route: RouteWaypoint[];
  footprints: Footprint[];
}

// ---------------------------------------------------------------------------------
// Small deterministic PRNG so dressing is stable between runs.
// ---------------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHITE = 0xffffff;
const LIGHT_GRAY = 0xd9dde2;
const MID_GRAY = 0xa9afb7;
const DARK_GRAY = 0x3a3f47;
const RED = 0xe0231c;

interface AddOpts {
  collide?: boolean;
  visible?: boolean;
  castShadow?: boolean;
  flags?: BoxFlags;
  color?: number;
}

type Heading = [number, number];

class Plat {
  /** Top surface height. */
  constructor(
    private readonly b: LevelBuilder,
    readonly name: string,
    /** Start-edge centre (world XZ). */
    readonly ox: number,
    readonly oz: number,
    readonly hx: number,
    readonly hz: number,
    readonly len: number,
    readonly width: number,
    readonly top: number,
  ) {}

  /** Right-hand unit vector. */
  get rx(): number { return -this.hz; }
  get rz(): number { return this.hx; }

  world(s: number, t: number): [number, number] {
    return [this.ox + this.hx * s + this.rx * t, this.oz + this.hz * s + this.rz * t];
  }

  /** Adds an axis-aligned box given in platform-local coordinates (y relative to the roof top). */
  add(s0: number, s1: number, t0: number, t1: number, y0: number, y1: number, mat: Mat, o: AddOpts = {}): void {
    const [ax, az] = this.world(s0, t0);
    const [bx, bz] = this.world(s1, t1);
    this.b.parts.push({
      min: [Math.min(ax, bx), this.top + y0, Math.min(az, bz)],
      max: [Math.max(ax, bx), this.top + y1, Math.max(az, bz)],
      mat,
      collide: o.collide ?? false,
      visible: o.visible ?? true,
      castShadow: o.castShadow ?? true,
      flags: o.flags,
      color: o.color ?? WHITE,
    });
  }

  /** Solid prop: visible and collidable. */
  solid(s0: number, s1: number, t0: number, t1: number, y0: number, y1: number, mat: Mat, color = WHITE, flags?: BoxFlags): void {
    this.add(s0, s1, t0, t1, y0, y1, mat, { collide: true, color, flags });
  }

  /** Flat decal lying on the roof (no collision). */
  decal(s0: number, s1: number, t0: number, t1: number, color: number, mat: Mat = 'red'): void {
    this.add(s0, s1, t0, t1, 0.0, 0.035, mat, { collide: false, castShadow: false, color });
  }

  cylinder(s: number, t: number, y: number, radius: number, length: number, axis: 'x' | 'y' | 'z', mat: Mat, color = WHITE): void {
    const [x, z] = this.world(s, t);
    this.b.cylinders.push({ pos: [x, this.top + y, z], radius, length, axis, mat, color });
  }

  /** Lateral cylinder along the heading etc. is expressed in world axes by the caller via `axisAlong`. */
  axisAlong(): 'x' | 'z' { return this.hx !== 0 ? 'x' : 'z'; }
  axisAcross(): 'x' | 'z' { return this.hx !== 0 ? 'z' : 'x'; }

  route(s: number, t: number, action: RouteAction, hold?: number, note?: string): void {
    const [x, z] = this.world(s, t);
    this.b.route.push({ pos: [x, this.top, z], action, hold, note });
  }

  // ----------------------------------------------------------------------- dressing

  /** Low curbs around the roof edge. Edges can be disabled (e.g. next to a tower). */
  curbs(edges: { front?: boolean; back?: boolean; left?: boolean; right?: boolean } = {}, redFront = false): void {
    const hw = this.width / 2;
    const c = 0.35;
    const h = 0.25;
    const { front = true, back = true, left = true, right = true } = edges;
    if (front) this.solid(0, c, -hw, hw, 0, h, 'prop', LIGHT_GRAY);
    if (back) {
      if (redFront) {
        this.solid(this.len - c, this.len, -hw, hw, 0, h, 'prop', LIGHT_GRAY);
        // Red take-off strip on the central part of the edge.
        this.add(this.len - c - 0.01, this.len + 0.01, -hw * 0.55, hw * 0.55, h, h + 0.02, 'red', { castShadow: false });
      } else {
        this.solid(this.len - c, this.len, -hw, hw, 0, h, 'prop', LIGHT_GRAY);
      }
    }
    if (left) this.solid(0, this.len, -hw, -hw + c, 0, h, 'prop', LIGHT_GRAY);
    if (right) this.solid(0, this.len, hw - c, hw, 0, h, 'prop', LIGHT_GRAY);
  }

  /** Red "jump here" markings: a stripe on the roof and a row of chevron bars before the edge. */
  takeoffMarker(width = 0.55): void {
    const hw = this.width / 2;
    const span = hw * width;
    this.decal(this.len - 1.7, this.len - 1.35, -span, span, RED);
    this.decal(this.len - 3.1, this.len - 2.85, -span * 0.7, span * 0.7, RED);
    this.decal(this.len - 4.2, this.len - 4.0, -span * 0.45, span * 0.45, RED);
  }

  /** Solid railing (collider hidden) with posts and two rails as visuals. */
  railing(side: 'left' | 'right', s0 = 0.6, s1 = this.len - 0.6): void {
    const hw = this.width / 2;
    const t = side === 'left' ? -hw + 0.06 : hw - 0.06;
    this.add(s0, s1, t - 0.04, t + 0.04, 0.25, 1.05, 'prop', { collide: true, visible: false, flags: { noVault: true } });
    this.add(s0, s1, t - 0.025, t + 0.025, 0.96, 1.02, 'prop', { color: LIGHT_GRAY });
    this.add(s0, s1, t - 0.02, t + 0.02, 0.55, 0.59, 'prop', { color: LIGHT_GRAY });
    const n = Math.max(2, Math.round((s1 - s0) / 2.2));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      this.add(s - 0.03, s + 0.03, t - 0.03, t + 0.03, 0.25, 1.02, 'prop', { color: MID_GRAY });
    }
  }

  /** Rooftop air-conditioning unit with a fan grille. */
  ac(s: number, t: number, w = 2.4, d = 1.7, h = 1.25, color = LIGHT_GRAY): void {
    this.solid(s - d / 2, s + d / 2, t - w / 2, t + w / 2, 0, h, 'prop', color);
    // Darker louvre band + fan disc on top.
    this.add(s - d / 2 - 0.01, s + d / 2 + 0.01, t - w / 2 + 0.15, t + w / 2 - 0.15, 0.2, 0.55, 'prop', { color: MID_GRAY });
    this.cylinder(s, t, h + 0.03, Math.min(w, d) * 0.38, 0.06, 'y', 'dark', DARK_GRAY);
  }

  /**
   * Narrow catwalk bridge across the gap that follows this platform: a light steel deck
   * with red pipe handrails. Rails are solid (hidden colliders), the deck top is flush
   * with the roof so it can be sprinted across.
   */
  bridge(gapLen: number, width = 1.9): void {
    const s0 = this.len - 0.01;
    const s1 = this.len + gapLen + 0.01;
    const hw = width / 2;
    // deck + under-trusses
    this.add(s0, s1, -hw, hw, -0.3, 0, 'prop', { collide: true, color: 0xcfd5dc });
    this.add(s0, s1, -hw - 0.04, -hw + 0.1, -0.9, -0.3, 'prop', { color: MID_GRAY });
    this.add(s0, s1, hw - 0.1, hw + 0.04, -0.9, -0.3, 'prop', { color: MID_GRAY });
    const n = Math.max(2, Math.round((s1 - s0) / 1.4));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      this.add(s - 0.04, s + 0.04, -hw, hw, -0.6, -0.3, 'prop', { color: MID_GRAY });
    }
    // red deck stripe down the middle: "run this way"
    this.add(s0, s1, -0.06, 0.06, 0, 0.03, 'red', { color: RED, castShadow: false });
    for (const side of [-1, 1]) {
      const t = side * (hw - 0.05);
      this.add(s0, s1, t - 0.04, t + 0.04, 0, 1.05, 'prop', { collide: true, visible: false, flags: { noVault: true } });
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n;
        this.add(s - 0.035, s + 0.035, t - 0.035, t + 0.035, 0, 1.02, 'prop', { color: MID_GRAY });
      }
      this.cylinder((s0 + s1) / 2, t, 1.0, 0.045, s1 - s0, this.axisAlong(), 'red', RED);
      this.cylinder((s0 + s1) / 2, t, 0.55, 0.03, s1 - s0, this.axisAlong(), 'prop', MID_GRAY);
    }
  }

  /** Red pipe lying along the heading (visual cylinder + low invisible collider so it is never walked through). */
  pipeRun(s0: number, s1: number, t: number, r = 0.13): void {
    const [x0, z0] = this.world(s0, t);
    const [x1, z1] = this.world(s1, t);
    this.b.cylinders.push({
      pos: [(x0 + x1) / 2, this.top + r + 0.12, (z0 + z1) / 2],
      radius: r,
      length: Math.abs(s1 - s0),
      axis: this.axisAlong(),
      mat: 'red',
      color: RED,
    });
    const n = Math.max(1, Math.round(Math.abs(s1 - s0) / 2.6));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      this.add(s - 0.06, s + 0.06, t - 0.09, t + 0.09, 0, 0.14, 'prop', { color: MID_GRAY });
    }
    this.add(Math.min(s0, s1), Math.max(s0, s1), t - r, t + r, 0, r * 2 + 0.12, 'prop', { collide: true, visible: false });
  }

  /** Low glass skylight. */
  skylight(s: number, t: number, w = 2.6, d = 1.8): void {
    this.solid(s - d / 2, s + d / 2, t - w / 2, t + w / 2, 0, 0.26, 'prop', LIGHT_GRAY);
    this.add(s - d / 2 + 0.12, s + d / 2 - 0.12, t - w / 2 + 0.12, t + w / 2 - 0.12, 0.26, 0.3, 'prop', { color: 0x203a5a });
  }

  /** Dark floor grate (visual only, like a roof hatch). */
  grate(s: number, t: number, w = 2.4, d = 1.8): void {
    this.add(s - d / 2, s + d / 2, t - w / 2, t + w / 2, 0, 0.045, 'prop', { color: 0x2c3138, castShadow: false });
    for (let i = 1; i < 6; i++) {
      const ss = s - d / 2 + (d * i) / 6;
      this.add(ss - 0.012, ss + 0.012, t - w / 2, t + w / 2, 0.045, 0.052, 'prop', { color: 0x8d949e, castShadow: false });
    }
    for (let i = 1; i < 8; i++) {
      const tt = t - w / 2 + (w * i) / 8;
      this.add(s - d / 2, s + d / 2, tt - 0.012, tt + 0.012, 0.045, 0.052, 'prop', { color: 0x8d949e, castShadow: false });
    }
  }

  /** Small vent / box obstacle. */
  box(s: number, t: number, w: number, d: number, h: number, color = LIGHT_GRAY): void {
    this.solid(s - d / 2, s + d / 2, t - w / 2, t + w / 2, 0, h, 'prop', color);
  }

  /** Stairwell penthouse with a red door on its +s face. */
  penthouse(s: number, t: number, w = 4, d = 3.4, h = 3.4): void {
    this.solid(s - d / 2, s + d / 2, t - w / 2, t + w / 2, 0, h, 'prop', WHITE);
    this.add(s - d / 2 - 0.02, s + d / 2 + 0.02, t - w / 2 - 0.02, t + w / 2 + 0.02, h, h + 0.18, 'prop', { color: LIGHT_GRAY });
    // Door on the face towards -s (towards the player running along +s).
    this.add(s + d / 2, s + d / 2 + 0.04, t - 0.55, t + 0.55, 0, 2.15, 'red', { color: RED });
    this.add(s + d / 2, s + d / 2 + 0.05, t - 0.5, t + 0.5, 2.15, 2.22, 'prop', { color: DARK_GRAY });
  }

  /** Red lattice pylon like a small crane mast, with an electrical cabinet. Solid footprint. */
  pylon(s: number, t: number, h = 8): void {
    const half = 0.8;
    // collision core
    this.add(s - half, s + half, t - half, t + half, 0, h, 'red', { collide: true, visible: false });
    // base plate
    this.add(s - 1.2, s + 1.2, t - 1.2, t + 1.2, 0, 0.12, 'red', { color: RED });
    // four legs
    for (const [ds, dt] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      this.add(s + ds * half - 0.08, s + ds * half + 0.08, t + dt * half - 0.08, t + dt * half + 0.08, 0.12, h, 'red', { color: RED });
    }
    // cross bars
    for (let y = 1.0; y < h; y += 1.4) {
      this.add(s - half, s + half, t - half - 0.04, t - half + 0.04, y, y + 0.1, 'red', { color: RED });
      this.add(s - half, s + half, t + half - 0.04, t + half + 0.04, y, y + 0.1, 'red', { color: RED });
      this.add(s - half - 0.04, s - half + 0.04, t - half, t + half, y, y + 0.1, 'red', { color: RED });
      this.add(s + half - 0.04, s + half + 0.04, t - half, t + half, y, y + 0.1, 'red', { color: RED });
    }
    // electrical cabinet (white-hot red like the reference)
    this.add(s - 0.5, s + 0.5, t - half - 0.55, t - half + 0.05, 1.0, 2.6, 'red', { color: RED });
    this.add(s - 0.35, s + 0.35, t - half - 0.56, t - half - 0.5, 1.5, 2.2, 'dark', { color: DARK_GRAY });
  }

  /** Red slide gate: a duct spanning the whole width, with `clearance` metres underneath. */
  slideGate(s: number, depth: number, clearance = 1.05, topY = 2.7): void {
    const hw = this.width / 2;
    const sup = 1.5;
    // Duct body (red), collidable as one box.
    this.solid(s, s + depth, -hw, hw, clearance, topY, 'red', RED, { label: 'duct' });
    // White banding for readability
    this.add(s + depth * 0.5 - 0.15, s + depth * 0.5 + 0.15, -hw + sup, hw - sup, topY, topY + 0.02, 'prop', { color: WHITE, castShadow: false });
    // End supports (AC cabinets)
    this.solid(s - 0.15, s + depth + 0.15, -hw, -hw + sup, 0, topY, 'prop', LIGHT_GRAY);
    this.solid(s - 0.15, s + depth + 0.15, hw - sup, hw, 0, topY, 'prop', LIGHT_GRAY);
    // Red pipes dropping down the supports
    this.add(s + depth * 0.5 - 0.12, s + depth * 0.5 + 0.12, -hw + sup, -hw + sup + 0.12, 0, clearance, 'red', { color: RED });
    this.add(s + depth * 0.5 - 0.12, s + depth * 0.5 + 0.12, hw - sup - 0.12, hw - sup, 0, clearance, 'red', { color: RED });
    // Hazard-ish underside strip so the slot reads from far away
    this.add(s, s + depth, -hw + sup, hw - sup, clearance - 0.04, clearance, 'prop', { color: WHITE, castShadow: false });
  }

  /** Low full-width wall that can be vaulted (or jumped). Red top cap. */
  vaultWall(s: number, thickness = 0.6, height = 1.0): void {
    const hw = this.width / 2;
    this.add(s, s + thickness, -hw, hw, 0, height, 'prop', { collide: true, visible: false, flags: { label: 'vault' } });
    this.add(s, s + thickness, -hw, hw, 0, height - 0.08, 'prop', { color: WHITE });
    this.add(s - 0.03, s + thickness + 0.03, -hw, hw, height - 0.08, height, 'red', { color: RED });
  }

  /** Low red pipe bar that can be vaulted or jumped (collider = full height). */
  pipeBar(s: number, height = 0.95): void {
    const hw = this.width / 2;
    this.add(s - 0.2, s + 0.2, -hw, hw, 0, height, 'red', { collide: true, visible: false, flags: { label: 'pipe' } });
    this.add(s - 0.18, s + 0.18, -hw, hw, height - 0.36, height, 'red', { color: RED });
    for (const t of [-hw + 1.0, 0, hw - 1.0]) {
      this.add(s - 0.14, s + 0.14, t - 0.12, t + 0.12, 0, height - 0.36, 'prop', { color: MID_GRAY });
    }
  }

  /** Plain curb segment along a side edge. */
  sideCurb(side: 'left' | 'right', s0: number, s1: number): void {
    const hw = this.width / 2;
    if (side === 'left') this.solid(s0, s1, -hw, -hw + 0.35, 0, 0.25, 'prop', LIGHT_GRAY);
    else this.solid(s0, s1, hw - 0.35, hw, 0, 0.25, 'prop', LIGHT_GRAY);
  }

  /** Red marker along a side curb + roof stripes, for jumps that leave over a side edge (turns). */
  sideMarker(side: 'left' | 'right', sc: number, half = 4): void {
    const hw = this.width / 2;
    const e = side === 'left' ? -hw : hw;
    const dir = side === 'left' ? 1 : -1;
    this.add(sc - half, sc + half, Math.min(e, e + dir * 0.35), Math.max(e, e + dir * 0.35), 0, 0.25, 'red', { collide: true, color: RED });
    for (let i = 0; i < 3; i++) {
      const o = 1.35 + i * 1.3;
      const a = e + dir * o;
      const b = e + dir * (o + 0.28);
      this.decal(sc - half * (0.9 - i * 0.2), sc + half * (0.9 - i * 0.2), Math.min(a, b), Math.max(a, b), RED);
    }
  }

  /** Red painted band on a vertical wall face (visual only), for wall-run surfaces. */
  wallBand(side: 'left' | 'right', s0: number, s1: number, faceT: number, y0 = 1.3, y1 = 3.4): void {
    // The band sits 4 cm in front of the face, towards the free side.
    const dir = side === 'left' ? 1 : -1;
    const t0 = faceT;
    const t1 = faceT + dir * 0.045;
    this.add(s0, s1, Math.min(t0, t1), Math.max(t0, t1), y0, y1, 'red', { color: RED, castShadow: false });
    // thin white keylines
    this.add(s0, s1, Math.min(t0, t1 + dir * 0.005), Math.max(t0, t1 + dir * 0.005), y0 - 0.12, y0 - 0.04, 'prop', { color: WHITE, castShadow: false });
    this.add(s0, s1, Math.min(t0, t1 + dir * 0.005), Math.max(t0, t1 + dir * 0.005), y1 + 0.04, y1 + 0.12, 'prop', { color: WHITE, castShadow: false });
  }
}

export interface PlatformOpts {
  name: string;
  len: number;
  width: number;
  /** Gap (metres) between the previous platform's end and this platform's start. */
  gap?: number;
  /** Height change relative to the previous platform. */
  dy?: number;
  /** Lateral shift of the platform centre-line relative to the cursor. */
  shift?: number;
  /** How far the building body extends below the roof. */
  depth?: number;
  tint?: number;
  /** Reflective blue glass facade instead of white concrete (the roof stays concrete). */
  glass?: boolean;
}

class LevelBuilder {
  parts: PartSpec[] = [];
  cylinders: CylinderSpec[] = [];
  flags: V3[] = [];
  checkpoints: CheckpointSpec[] = [];
  hints: HintSpec[] = [];
  route: RouteWaypoint[] = [];
  footprints: Footprint[] = [];

  private hx = 0;
  private hz = -1;
  private cx = 0;
  private cz = 0;
  private y = 0;
  last: Plat | null = null;
  readonly rand = mulberry32(1337);

  begin(x: number, z: number, heading: Heading, y: number): void {
    this.cx = x; this.cz = z;
    this.hx = heading[0]; this.hz = heading[1];
    this.y = y;
  }

  /** Lays a new platform after the cursor and advances the cursor to its end edge. */
  platform(o: PlatformOpts): Plat {
    const gap = o.gap ?? 0;
    const shift = o.shift ?? 0;
    const rx = -this.hz;
    const rz = this.hx;
    const ox = this.cx + this.hx * gap + rx * shift;
    const oz = this.cz + this.hz * gap + rz * shift;
    const top = this.y + (o.dy ?? 0);
    const p = new Plat(this, o.name, ox, oz, this.hx, this.hz, o.len, o.width, top);
    // The building body (white facade, white concrete roof).
    p.add(0, o.len, -o.width / 2, o.width / 2, -(o.depth ?? 70), 0, o.glass ? 'glass' : 'arch', {
      collide: true,
      color: o.tint ?? (o.glass ? 0x9cc0de : WHITE),
      flags: { label: o.name },
    });

    const [x0, z0] = p.world(0, -o.width / 2);
    const [x1, z1] = p.world(o.len, o.width / 2);
    this.footprints.push({
      minX: Math.min(x0, x1), maxX: Math.max(x0, x1),
      minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top,
    });

    this.cx = ox + this.hx * o.len;
    this.cz = oz + this.hz * o.len;
    this.y = top;
    this.last = p;
    return p;
  }

  /** Turns 90 degrees at a point along the last platform and continues from its side edge. */
  turn(dir: 'left' | 'right', at = 0.5): void {
    const p = this.last;
    if (!p) throw new Error('turn() needs a previous platform');
    const sign = dir === 'right' ? 1 : -1;
    const [x, z] = p.world(p.len * at, sign * p.width / 2);
    this.cx = x;
    this.cz = z;
    const nx = dir === 'right' ? p.rx : -p.rx;
    const nz = dir === 'right' ? p.rz : -p.rz;
    this.hx = nx;
    this.hz = nz;
  }

  /** Extra building mass (towers, side buildings). Coordinates are relative to `p`'s frame. */
  tower(p: Plat, s0: number, s1: number, t0: number, t1: number, topRel: number, flags?: BoxFlags, tint = WHITE, mat: Mat = 'arch'): void {
    p.add(s0, s1, t0, t1, -90, topRel, mat, { collide: true, flags, color: tint });
    const [x0, z0] = p.world(s0, t0);
    const [x1, z1] = p.world(s1, t1);
    this.footprints.push({
      minX: Math.min(x0, x1), maxX: Math.max(x0, x1),
      minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top: p.top + topRel,
    });
  }

  checkpoint(index: number, label: string, p: Plat, s: number, t = 0): void {
    const [x, z] = p.world(s, t);
    const yaw = Math.atan2(-p.hx, -p.hz); // heading -> yaw (0 = facing -Z)
    const hw = p.width / 2;
    const [ax, az] = p.world(s - 1.0, -hw);
    const [bx, bz] = p.world(s + 1.0, hw);
    // The marker stands at the right-hand edge region of the lane.
    const [mx, mz] = p.world(s + 1.5, hw - 1.2);
    this.checkpoints.push({
      index, label,
      pos: [x, p.top, z],
      yaw,
      triggerMin: [Math.min(ax, bx), p.top, Math.min(az, bz)],
      triggerMax: [Math.max(ax, bx), p.top + 4, Math.max(az, bz)],
      markerPos: [mx, p.top, mz],
      markerAxis: p.hx !== 0 ? 'z' : 'x',
    });
  }

  hint(p: Plat, s0: number, s1: number, text: string): void {
    const hw = p.width / 2;
    const [ax, az] = p.world(s0, -hw);
    const [bx, bz] = p.world(s1, hw);
    this.hints.push({
      min: [Math.min(ax, bx), p.top - 1, Math.min(az, bz)],
      max: [Math.max(ax, bx), p.top + 6, Math.max(az, bz)],
      text,
    });
  }

  flag(p: Plat, s: number, t: number): void {
    const [x, z] = p.world(s, t);
    this.flags.push([x, p.top, z]);
  }
}

// =====================================================================================
//  THE LEVEL
// =====================================================================================

/** Length of the catwalk bridge between the vent roof and the wall-run approach. */
const BRIDGE_GAP = 5.8;

export function buildLevelSpec(): LevelSpec {
  const L = new LevelBuilder();
  L.begin(0, 14, [0, -1], 0);

  // ---------------------------------------------------------------- SECTION 1: tutorial
  const start = L.platform({ name: 'start-roof', len: 58, width: 20 });
  start.curbs({}, true);
  start.railing('left', 1, 57);
  start.railing('right', 1, 57);
  start.takeoffMarker();
  // dressing
  start.penthouse(3.5, -6.5, 4.4, 3.6, 3.6);
  start.ac(9, 8, 2.6, 1.8, 1.3);
  start.ac(12, 8, 2.6, 1.8, 1.0, MID_GRAY);
  start.pylon(14, -7.8, 9);
  start.ac(23, -8, 2.4, 1.7, 1.2);
  start.ac(40, 8.2, 2.6, 1.8, 1.3);
  start.box(44, -8.4, 2.0, 1.4, 0.9, LIGHT_GRAY);
  start.box(48, 8.6, 1.6, 1.4, 0.8, LIGHT_GRAY);
  start.ac(52, -8, 2.4, 1.7, 1.2);
  start.pylon(36, 8, 8);
  start.grate(10, 3.2, 2.6, 2.0);
  start.skylight(21, -5.2, 3.0, 2.0);
  start.skylight(48, 4.6, 2.6, 1.8);
  start.pipeRun(17, 29, 9.2);
  start.pipeRun(40, 52, -9.1);
  L.flag(start, 56, 8.6);
  L.flag(start, 56, -8.6);
  // vault wall, then a plain jump gap.
  start.vaultWall(30, 0.6, 1.0);
  start.route(8, 0, 'run');
  start.route(28.2, 0, 'vault', undefined, 'vault wall');
  start.route(start.len - 0.35, 0, 'jump', 0.7, 'tutorial gap');
  L.checkpoint(0, 'START', start, 6);
  L.hint(start, 0, 14, '[W][A][S][D] move  ·  [SHIFT] sprint  ·  mouse look');
  L.hint(start, 18, 29, '[E] vault low obstacles — or just [SPACE] jump over');
  L.hint(start, 38, 57, 'Hold [SPACE] to jump — release early for a short hop');

  const r1 = L.platform({ name: 'tutorial-roof-2', len: 40, width: 20, gap: 4.0 });
  r1.curbs({}, true);
  r1.railing('left', 1, 39);
  r1.railing('right', 1, 39);
  r1.takeoffMarker();
  r1.ac(5, 8.3, 2.4, 1.8, 1.2);
  r1.ac(26, -8.3, 2.4, 1.8, 1.2);
  r1.box(33, 8.4, 1.6, 1.2, 0.9, LIGHT_GRAY);
  r1.skylight(9, -5.4, 2.8, 1.8);
  r1.skylight(28, 5.4, 2.8, 1.8);
  r1.pipeRun(21, 33, -9.2);
  r1.slideGate(16, 2.2);
  r1.route(2, 0, 'run');
  r1.route(10.2, 0, 'slide', undefined, 'tutorial slide gate');
  r1.route(r1.len - 0.35, 0, 'jump', 0.7);
  L.hint(r1, 2, 13.5, 'Sprint, then tap [CTRL] or [C] to slide under low ducts');

  // ---------------------------------------------------------------- SECTION 2: rooftop jumps
  const a1 = L.platform({ name: 'jump-1', len: 16, width: 14, gap: 5.8, dy: -1.5 });
  a1.curbs({}, true);
  a1.railing('left', 1, 15);
  a1.railing('right', 1, 15);
  a1.takeoffMarker();
  a1.ac(7, 5.2, 2.2, 1.6, 1.1);
  a1.box(11, -5.4, 1.6, 1.4, 0.8, LIGHT_GRAY);
  a1.pipeRun(2, 8, -6.3);
  L.checkpoint(1, 'CHECKPOINT 1', a1, 3);
  L.hint(a1, 0, 15, 'Sprint towards the red edges and jump — hold [SPACE] for full height');
  a1.route(3, 0, 'run');
  a1.route(a1.len - 0.35, 0, 'jump', 0.75);

  const a2 = L.platform({ name: 'jump-2', len: 14, width: 12, gap: 6.4, dy: -1.0, glass: true });
  a2.curbs({}, true);
  a2.railing('left', 1, 13);
  a2.railing('right', 1, 13);
  a2.takeoffMarker();
  a2.ac(6, -4.2, 2.0, 1.6, 1.1);
  a2.route(2, 0, 'run');
  a2.route(a2.len - 0.35, 0, 'jump', 0.78);

  // Ledge recovery showcase: the next roof is higher than a normal jump reaches cleanly.
  const a3 = L.platform({ name: 'jump-3-high', len: 16, width: 14, gap: 3.8, dy: 2.0 });
  a3.curbs({ front: false }, true);
  a3.railing('left', 1, 15);
  a3.railing('right', 1, 15);
  a3.takeoffMarker();
  // Red ledge band on the climbable edge (face of the building, plus a stripe on the roof lip).
  a3.add(-0.05, 0.05, -5.5, 5.5, -0.35, 0.02, 'red', { color: RED, castShadow: false });
  a3.add(0.0, 0.5, -5.5, 5.5, 0.0, 0.03, 'red', { color: RED, castShadow: false });
  a3.ac(8, 5.0, 2.2, 1.6, 1.2);
  a3.penthouse(12.5, -4.8, 3.6, 3.2, 3.4);
  L.hint(a2, 8, 13.8, 'Just under a ledge? Keep holding [W] — you will pull yourself up');
  a3.route(4, 0, 'run', undefined, 'mantle onto this roof is automatic');
  a3.route(a3.len - 0.35, 0, 'jump', 0.78);

  const a4 = L.platform({ name: 'jump-4', len: 14, width: 12, gap: 7.0, dy: -2.2 });
  a4.curbs({}, true);
  a4.railing('left', 1, 13);
  a4.railing('right', 1, 13);
  a4.takeoffMarker();
  a4.ac(5.5, 4.0, 2.0, 1.6, 1.1);
  a4.route(2, 0, 'run');
  a4.route(a4.len - 0.35, 0, 'jump', 0.78);

  // Big turn roof - lands and turns right (east).
  const a5 = L.platform({ name: 'turn-roof', len: 24, width: 24, gap: 5.6, dy: 0.5 });
  const a5Exit = a5.len * 0.55;
  a5.curbs({ right: false, back: true }, false);
  a5.sideCurb('right', 0.35, a5Exit - 4);
  a5.sideCurb('right', a5Exit + 4, a5.len - 0.35);
  a5.sideMarker('right', a5Exit, 4);
  a5.railing('left', 1, 23);
  a5.railing('right', 1, a5Exit - 4.6);
  a5.railing('right', a5Exit + 4.6, 23);
  a5.ac(7, -8, 2.8, 1.8, 1.4);
  a5.box(13, -4, 1.6, 1.6, 0.9, LIGHT_GRAY);
  a5.penthouse(20, -8.5, 3.6, 3.2, 3.6);
  a5.pylon(4, -10, 9);
  L.flag(a5, 23, -11);
  a5.route(3, 0, 'run');
  // Turn: run diagonally to the east edge and jump.
  a5.route(a5Exit - 2, a5.width / 2 - 3.5, 'run');
  a5.route(a5Exit, a5.width / 2 - 0.35, 'jump', 0.75, 'turn jump');
  L.turn('right', 0.55);

  // ---------------------------------------------------------------- SECTION 3: sliding challenge
  const v1 = L.platform({ name: 'vent-roof', len: 78, width: 16, gap: 5.0, dy: -0.5, glass: true });
  v1.curbs({ back: false }, false);
  v1.railing('left', 1, 77);
  v1.railing('right', 1, 77);
  v1.takeoffMarker();
  L.checkpoint(2, 'CHECKPOINT 2', v1, 3);
  L.hint(v1, 0, 14, 'Slide under every duct — keep your speed up');
  v1.route(2, 0, 'run');
  const gates = [14, 30, 56];
  for (const s of gates) v1.slideGate(s, 2.4);
  // A low pipe bar between the ducts to vault or hop.
  v1.pipeBar(43);
  v1.route(7.6, 0, 'slide', undefined, 'duct 1');
  v1.route(23.8, 0, 'slide', undefined, 'duct 2');
  v1.route(41.2, 0, 'vault', undefined, 'pipe bar');
  v1.route(49.6, 0, 'slide', undefined, 'duct 3');
  v1.route(v1.len + 3, 0, 'run', undefined, 'narrow bridge');
  // Lane dressing: AC units along the walls between gates.
  v1.ac(8, -6.6, 2.4, 1.6, 1.2);
  v1.ac(23, 6.6, 2.4, 1.6, 1.2, MID_GRAY);
  v1.ac(37, -6.6, 2.4, 1.6, 1.2);
  v1.box(50, 6.6, 1.6, 1.4, 0.9, LIGHT_GRAY);
  v1.ac(64, -6.6, 2.4, 1.6, 1.2);
  v1.ac(70, 6.6, 2.4, 1.6, 1.3);
  // red pipes running along the left wall
  v1.pipeRun(10, 21, -7.35);
  v1.pipeRun(40, 54, -7.35);
  v1.skylight(36, 5.2, 2.6, 1.8);
  v1.grate(62, -4.5, 2.4, 1.8);
  L.flag(v1, 76, 7.4);
  L.flag(v1, 76, -7.4);

  // ---------------------------------------------------------------- SECTION 4: wall run
  // The vent roof ends in a narrow catwalk bridge that leads to the wall-run approach.
  const wa = L.platform({ name: 'wallrun-approach', len: 24, width: 14, gap: BRIDGE_GAP, dy: 0 });
  v1.bridge(BRIDGE_GAP);
  wa.curbs({ front: false, back: false, left: false }, false);
  wa.railing('right', 1, 23);
  wa.ac(8, 5.2, 2.2, 1.6, 1.1);
  wa.box(15, 5.6, 1.4, 1.4, 0.8, LIGHT_GRAY);
  // Red lane along the tower side, ending in the take-off pad.
  wa.decal(3, wa.len - 0.4, -6.4, -5.7, RED);
  wa.decal(wa.len - 3.4, wa.len - 0.4, -6.4, -3.2, RED);
  L.checkpoint(3, 'CHECKPOINT 3', wa, 4, -2);
  L.hint(wa, 0, 18, 'Wall-run: jump along the red wall and hold [W] — [SPACE] kicks off the wall');

  const gapLen = 12.5;
  const wb = L.platform({ name: 'wallrun-landing', len: 28, width: 14, gap: gapLen, dy: -0.8 });
  wb.curbs({ front: true, left: false }, false);
  wb.railing('right', 1, 27);
  wb.ac(14, 5.0, 2.2, 1.6, 1.1);
  wb.ac(20, -5.0, 2.2, 1.6, 1.1);
  wb.skylight(24, 4.4, 2.4, 1.8);
  // Tower on the left side of the whole stretch; its face is the wall-run surface.
  const faceT = -7;
  L.tower(wa, wa.len - 1.2, wa.len + gapLen + 10, faceT - 28, faceT, 11, { wallRun: true, label: 'wallrun-tower-1' });
  // Red wall band along the run (and an arrow-like lead-in).
  wa.wallBand('left', wa.len - 1.2, wa.len + gapLen + 9.5, faceT, 1.5, 3.1);
  wa.route(2, 0, 'run');
  wa.route(wa.len - 10, -5.9, 'run');
  wa.route(wa.len - 0.2, -5.9, 'wallrun', 0.2, 'wall run #1');
  wb.route(10, -4.6, 'run', undefined, 'after wall run');
  wb.route(wb.len - 0.35, 0, 'jump', 0.75);
  L.flag(wb, 27, 6.6);

  // ---------------------------------------------------------------- SECTION 5: combination
  const c1 = L.platform({ name: 'combo-1', len: 22, width: 14, gap: 5.8, dy: 0 });
  c1.curbs({}, true);
  c1.railing('left', 1, 21);
  c1.railing('right', 1, 21);
  c1.takeoffMarker();
  L.checkpoint(4, 'CHECKPOINT 4', c1, 3);
  c1.vaultWall(8, 0.6, 1.1);
  c1.ac(15, 5.5, 2.2, 1.6, 1.2);
  c1.route(2, 0, 'run');
  c1.route(6.2, 0, 'vault', undefined, 'combo vault');
  c1.route(c1.len - 0.35, 0, 'jump', 0.75);

  const c2 = L.platform({ name: 'combo-2', len: 13, width: 12, gap: 6.6, dy: -1.0, glass: true });
  c2.curbs({}, true);
  c2.railing('left', 1, 12);
  c2.railing('right', 1, 12);
  c2.takeoffMarker();
  c2.route(2, 0, 'run');
  c2.route(c2.len - 0.35, 0, 'jump', 0.78);

  // Second wall run, this time on the right-hand side, followed straight away by a slide gate.
  const c3 = L.platform({ name: 'combo-wallrun-approach', len: 16, width: 12, gap: 5.8, dy: 0.0 });
  c3.curbs({ back: false, right: false }, false);
  c3.railing('left', 1, 15);
  c3.decal(3, c3.len - 0.4, 5.7, 6.4, RED);
  c3.decal(c3.len - 3.4, c3.len - 0.4, 3.2, 6.4, RED);
  c3.route(2, 0, 'run');
  const gap2 = 11.0;
  const c4 = L.platform({ name: 'combo-wallrun-landing', len: 30, width: 12, gap: gap2, dy: -1.0 });
  c4.curbs({ right: false }, false);
  c4.railing('left', 1, 29);
  const faceR = 6;
  L.tower(c3, c3.len - 1.2, c3.len + gap2 + 8, faceR, faceR + 26, 12, { wallRun: true, label: 'wallrun-tower-2' });
  c3.wallBand('right', c3.len - 1.2, c3.len + gap2 + 7.5, faceR, 1.5, 3.1);
  c3.route(c3.len - 9, 5.0, 'run');
  c3.route(c3.len - 0.2, 5.0, 'wallrun', 0.2, 'wall run #2');
  // after landing: slide gate close to the wall-run exit, then a jump.
  c4.slideGate(14, 2.2);
  c4.route(5, 4.5, 'run');
  c4.route(8.2, 0, 'slide', undefined, 'combo duct');
  c4.route(c4.len - 0.35, 0, 'jump', 0.75);
  c4.ac(22, -4.8, 2.2, 1.6, 1.1);
  c4.takeoffMarker();
  c4.curbs({ right: false }, true);

  // Mantle up to a higher roof, which also turns north.
  const c5 = L.platform({ name: 'combo-turn-roof', len: 22, width: 22, gap: 3.6, dy: 2.0 });
  const c5Exit = c5.len * 0.5;
  c5.curbs({ front: false, left: false }, false);
  c5.sideCurb('left', 0.35, c5Exit - 4);
  c5.sideCurb('left', c5Exit + 4, c5.len - 0.35);
  c5.sideMarker('left', c5Exit, 4);
  c5.railing('right', 1, 21);
  c5.railing('left', 1, c5Exit - 4.6);
  c5.railing('left', c5Exit + 4.6, 21);
  c5.add(-0.05, 0.05, -9.5, 9.5, -0.35, 0.02, 'red', { color: RED, castShadow: false });
  c5.add(0.0, 0.5, -9.5, 9.5, 0.0, 0.03, 'red', { color: RED, castShadow: false });
  c5.pylon(6, 8.5, 8.5);
  c5.ac(15, 7.5, 2.6, 1.8, 1.3);
  c5.penthouse(18, 8.5, 3.6, 3.2, 3.6);
  c5.route(4, 0, 'run', undefined, 'mantle onto this roof is automatic');
  c5.route(c5Exit - 2, -c5.width / 2 + 3.5, 'run');
  c5.route(c5Exit, -c5.width / 2 + 0.35, 'jump', 0.78, 'turn jump');
  L.turn('left', 0.5);

  // ---------------------------------------------------------------- SECTION 6: final sprint
  const f1 = L.platform({ name: 'final-1', len: 16, width: 12, gap: 5.8, dy: -1.5 });
  f1.curbs({}, true);
  f1.railing('left', 1, 15);
  f1.railing('right', 1, 15);
  f1.takeoffMarker();
  L.checkpoint(5, 'CHECKPOINT 5', f1, 3);
  L.hint(f1, 0, 14, 'Final sprint — chain your jumps and follow the red');
  f1.route(3, 0, 'run');
  f1.route(f1.len - 0.35, 0, 'jump', 0.78);

  const f2 = L.platform({ name: 'final-2', len: 14, width: 12, gap: 7.0, dy: -1.2, glass: true });
  f2.curbs({}, true);
  f2.railing('left', 1, 13);
  f2.railing('right', 1, 13);
  f2.takeoffMarker();
  f2.ac(6, 4.2, 2.0, 1.6, 1.1);
  f2.route(2, 0, 'run');
  f2.route(f2.len - 0.35, 0, 'jump', 0.78);

  const f3 = L.platform({ name: 'final-3', len: 12, width: 10, gap: 5.4, dy: 0.5 });
  f3.curbs({}, true);
  f3.railing('left', 1, 11);
  f3.railing('right', 1, 11);
  f3.takeoffMarker();
  f3.route(2, 0, 'run');
  f3.route(f3.len - 0.35, 0, 'jump', 0.78);

  const f4 = L.platform({ name: 'final-4', len: 14, width: 12, gap: 7.2, dy: -2.0, glass: true });
  f4.curbs({}, true);
  f4.railing('left', 1, 13);
  f4.railing('right', 1, 13);
  f4.takeoffMarker();
  f4.ac(7, -4.2, 2.0, 1.6, 1.1);
  f4.route(2, 0, 'run');
  f4.route(f4.len - 0.35, 0, 'jump', 0.78);

  const fin = L.platform({ name: 'finish-roof', len: 44, width: 22, gap: 6.4, dy: -1.0 });
  fin.curbs({ front: true }, false);
  fin.railing('left', 1, 43);
  fin.railing('right', 1, 43);
  fin.route(3, 0, 'run');
  const finishS = 22;
  fin.route(finishS + 3, 0, 'run', undefined, 'finish');
  fin.pylon(8, -9, 9);
  fin.pylon(8, 9, 9);
  fin.ac(36, 8.5, 2.6, 1.8, 1.3);
  fin.ac(36, -8.5, 2.6, 1.8, 1.3);
  fin.skylight(14, 5.5, 3.0, 2.0);
  fin.grate(30, -5, 2.6, 2.0);
  fin.pipeRun(4, 14, 10.0);
  L.flag(fin, 10, 9);
  L.flag(fin, 10, -9);
  L.flag(fin, 40, 10);
  L.flag(fin, 40, -10);

  // Finish gate: two red masts, a lintel and a red/white line on the roof.
  const hw = fin.width / 2;
  fin.add(finishS - 0.35, finishS + 0.35, -hw + 1.0, -hw + 1.7, 0, 5.2, 'red', { collide: true, color: RED });
  fin.add(finishS - 0.35, finishS + 0.35, hw - 1.7, hw - 1.0, 0, 5.2, 'red', { collide: true, color: RED });
  fin.add(finishS - 0.45, finishS + 0.45, -hw + 1.0, hw - 1.0, 5.2, 5.9, 'red', { color: RED });
  fin.add(finishS - 0.46, finishS + 0.46, -hw + 1.0, hw - 1.0, 5.55, 5.62, 'prop', { color: WHITE, castShadow: false });
  for (let i = 0; i < 12; i++) {
    const t0 = -hw + 1.7 + i * ((fin.width - 3.4) / 12);
    const t1 = t0 + (fin.width - 3.4) / 12;
    fin.decal(finishS - 0.5, finishS, t0, t1, i % 2 === 0 ? RED : WHITE, i % 2 === 0 ? 'red' : 'prop');
    fin.decal(finishS, finishS + 0.5, t0, t1, i % 2 === 0 ? WHITE : RED, i % 2 === 0 ? 'prop' : 'red');
  }
  const [fax, faz] = fin.world(finishS - 0.2, -hw);
  const [fbx, fbz] = fin.world(finishS + 1.2, hw);
  const [fcx, fcz] = fin.world(finishS, 0);
  const finish: FinishSpec = {
    triggerMin: [Math.min(fax, fbx), fin.top, Math.min(faz, fbz)],
    triggerMax: [Math.max(fax, fbx), fin.top + 6, Math.max(faz, fbz)],
    pos: [fcx, fin.top, fcz],
    heading: [fin.hx, fin.hz],
    width: fin.width,
  };

  // --------------------------------------------------------------------------- spawn
  const [spx, spz] = start.world(7, 0);
  const spawn = { pos: [spx, start.top, spz] as V3, yaw: 0 };

  // Route waypoints are collected in level order because each platform is dressed right
  // after it is placed.
  return {
    parts: L.parts,
    cylinders: L.cylinders,
    flags: L.flags,
    checkpoints: L.checkpoints,
    hints: L.hints,
    finish,
    spawn,
    route: L.route,
    footprints: L.footprints,
  };
}
