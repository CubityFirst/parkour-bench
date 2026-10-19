/**
 * Pure-data description of the single rooftop level: every solid (visual + collision), the
 * checkpoints, hint triggers, section triggers and the finish gate.
 *
 * Coordinates are metres. The route runs towards -Z (yaw 0), then turns right towards +X for
 * the final sprint. Gap widths / heights were chosen against the movement values in
 * MovementConfig.ts (a sprint jump covers ~6 m on the flat) and are verified by tools/sim.ts.
 *
 * No rendering code lives here so the level can also be loaded headlessly for testing.
 */
import type { AABB } from './CollisionWorld.ts';

export type MatKind = 'building' | 'glass' | 'concrete' | 'red' | 'dark' | 'grate' | 'trim';

export interface SolidDesc extends AABB {
  mat: MatKind;
  collide: boolean;
  runnable: boolean;
  tint: [number, number, number];
  /** Vertex-shade multiplier at the top / bottom of the box (cheap baked ambient occlusion). */
  aoTop: number;
  aoBottom: number;
}

export interface CheckpointDesc {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface HintDesc {
  box: AABB;
  html: string;
}

export interface SectionDesc {
  box: AABB;
  index: number;
  title: string;
}

export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export interface LevelDesc {
  solids: SolidDesc[];
  checkpoints: CheckpointDesc[];
  hints: HintDesc[];
  sections: SectionDesc[];
  footprints: Footprint[];
  spawn: { x: number; y: number; z: number; yaw: number };
  finish: { trigger: AABB; x: number; y: number; z: number; halfWidth: number };
  killY: number;
}

export const BASE_Y = -80;
const LIP_H = 0.28;
const LIP_T = 0.35;

type Edge = 'w' | 'e' | 's' | 'n';
type LipSpec = boolean | [number, number];

interface RoofOpts {
  style?: 'building' | 'glass';
  /** w = -X side, e = +X side, s = +Z side, n = -Z side. true = full edge, [a,b] = partial range. */
  lips?: Partial<Record<Edge, LipSpec>>;
  rails?: Partial<Record<Edge, [number, number]>>;
  noFootprint?: boolean;
}

interface BoxOpts {
  collide?: boolean;
  runnable?: boolean;
  tint?: [number, number, number];
  aoTop?: number;
  aoBottom?: number;
}

const GRAY_TINT: [number, number, number] = [0.9, 0.92, 0.95];

class LayoutBuilder {
  readonly solids: SolidDesc[] = [];
  readonly footprints: Footprint[] = [];

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKind, o: BoxOpts = {}): void {
    this.solids.push({
      minX: Math.min(x0, x1),
      maxX: Math.max(x0, x1),
      minY: Math.min(y0, y1),
      maxY: Math.max(y0, y1),
      minZ: Math.min(z0, z1),
      maxZ: Math.max(z0, z1),
      mat,
      collide: o.collide ?? true,
      runnable: o.runnable ?? false,
      tint: o.tint ?? [1, 1, 1],
      aoTop: o.aoTop ?? 1,
      aoBottom: o.aoBottom ?? 0.82,
    });
  }

  /** A building: tall body down to the street, rooftop lip and optional railings. */
  roof(x0: number, x1: number, z0: number, z1: number, top: number, o: RoofOpts = {}): void {
    const style = o.style ?? 'building';
    this.box(x0, x1, BASE_Y, top, z0, z1, style, { aoTop: 1, aoBottom: 0.4 });
    if (!o.noFootprint) this.footprints.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top });

    const lips = o.lips ?? { w: true, e: true, s: true, n: true };
    const lip = (e: Edge, spec: LipSpec | undefined): void => {
      if (!spec) return;
      const alongX = e === 's' || e === 'n';
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      let from = a0;
      let to = a1;
      if (Array.isArray(spec)) [from, to] = spec;
      const y1l = top + LIP_H;
      const tint: [number, number, number] = [0.93, 0.95, 0.97];
      if (e === 'w') this.box(x0, x0 + LIP_T, top, y1l, from, to, 'concrete', { tint, aoBottom: 0.9 });
      if (e === 'e') this.box(x1 - LIP_T, x1, top, y1l, from, to, 'concrete', { tint, aoBottom: 0.9 });
      if (e === 'n') this.box(from, to, top, y1l, z0, z0 + LIP_T, 'concrete', { tint, aoBottom: 0.9 });
      if (e === 's') this.box(from, to, top, y1l, z1 - LIP_T, z1, 'concrete', { tint, aoBottom: 0.9 });
    };
    (['w', 'e', 's', 'n'] as Edge[]).forEach((e) => lip(e, lips[e]));

    const rails = o.rails ?? {};
    (['w', 'e', 's', 'n'] as Edge[]).forEach((e) => {
      const r = rails[e];
      if (!r) return;
      if (e === 'w') this.rail('z', x0 + LIP_T / 2, r[0], r[1], top + LIP_H);
      if (e === 'e') this.rail('z', x1 - LIP_T / 2, r[0], r[1], top + LIP_H);
      if (e === 'n') this.rail('x', z0 + LIP_T / 2, r[0], r[1], top + LIP_H);
      if (e === 's') this.rail('x', z1 - LIP_T / 2, r[0], r[1], top + LIP_H);
    });
  }

  /** Low railing along an axis: posts + two rails visually, one thin collider. */
  rail(axis: 'x' | 'z', fixed: number, from: number, to: number, y: number): void {
    const h = 1.1 - LIP_H;
    const top = y + h;
    const t = 0.04;
    const n = Math.max(1, Math.round((to - from) / 2.5));
    const tint: [number, number, number] = [0.94, 0.95, 0.97];
    const put = (a0: number, a1: number, y0: number, y1: number, th: number, collide = false): void => {
      if (axis === 'z') this.box(fixed - th, fixed + th, y0, y1, a0, a1, 'trim', { collide, tint, aoBottom: 1 });
      else this.box(a0, a1, y0, y1, fixed - th, fixed + th, 'trim', { collide, tint, aoBottom: 1 });
    };
    for (let i = 0; i <= n; i++) {
      const a = from + ((to - from) * i) / n;
      put(a - 0.035, a + 0.035, y, top, 0.035);
    }
    put(from, to, top - 0.05, top, t);
    put(from, to, y + h * 0.5 - 0.025, y + h * 0.5 + 0.025, 0.02);
    put(from, to, y, top, 0.03, true); // the (thin) collider
  }

  /** Flat red marker strip painted on a roof surface. */
  strip(x0: number, x1: number, z0: number, z1: number, top: number): void {
    this.box(x0, x1, top, top + 0.025, z0, z1, 'red', { collide: false, aoBottom: 1 });
  }

  ac(x0: number, z0: number, w: number, d: number, top: number, h: number): void {
    this.box(x0, x0 + w, top, top + h, z0, z0 + d, 'concrete', { tint: GRAY_TINT });
    this.box(x0 + 0.12, x0 + w - 0.12, top + h, top + h + 0.03, z0 + 0.12, z0 + d - 0.12, 'grate', { collide: false });
    // louvre panel on the +z face
    this.box(x0 + 0.15, x0 + w - 0.15, top + 0.15, top + h - 0.15, z0 + d, z0 + d + 0.03, 'grate', { collide: false });
  }

  stairs(x0: number, z0: number, w: number, d: number, top: number, h: number, door: 'e' | 'w' | 's' | 'n'): void {
    this.box(x0, x0 + w, top, top + h, z0, z0 + d, 'concrete', { tint: [0.96, 0.97, 0.98] });
    this.box(x0 - 0.1, x0 + w + 0.1, top + h, top + h + 0.18, z0 - 0.1, z0 + d + 0.1, 'concrete', {
      tint: [0.85, 0.87, 0.9],
      collide: false,
    });
    const dh = 2.2;
    if (door === 'e') this.box(x0 + w, x0 + w + 0.05, top, top + dh, z0 + d / 2 - 0.7, z0 + d / 2 + 0.7, 'red', { collide: false });
    if (door === 'w') this.box(x0 - 0.05, x0, top, top + dh, z0 + d / 2 - 0.7, z0 + d / 2 + 0.7, 'red', { collide: false });
    if (door === 's') this.box(x0 + w / 2 - 0.7, x0 + w / 2 + 0.7, top, top + dh, z0 + d, z0 + d + 0.05, 'red', { collide: false });
    if (door === 'n') this.box(x0 + w / 2 - 0.7, x0 + w / 2 + 0.7, top, top + dh, z0 - 0.05, z0, 'red', { collide: false });
  }

  /** Red pipe lying on the roof (low enough to step over). */
  pipe(x0: number, z0: number, x1: number, z1: number, top: number): void {
    this.box(x0, x1, top, top + 0.24, z0, z1, 'red', { aoBottom: 0.7 });
  }

  /** Low overhead duct / canopy spanning the roof: slide underneath, or mantle over. */
  duct(x0: number, x1: number, z0: number, z1: number, top: number, underside: number, thick: number, mat: MatKind): void {
    this.box(x0, x1, top + underside, top + underside + thick, z0, z1, mat, mat === 'concrete' ? { tint: GRAY_TINT, aoBottom: 0.7 } : { aoBottom: 0.7 });
    const pw = 0.45;
    // posts at the two ends of the span
    this.box(x0, x0 + pw, top, top + underside, z0, z1, 'dark', { aoBottom: 0.7 });
    this.box(x1 - pw, x1, top, top + underside, z0, z1, 'dark', { aoBottom: 0.7 });
  }

  flag(x: number, z: number, top: number): void {
    this.box(x - 0.025, x + 0.025, top, top + 2.6, z - 0.025, z + 0.025, 'dark', { collide: false, aoBottom: 1 });
    this.box(x + 0.025, x + 0.95, top + 1.75, top + 2.5, z - 0.012, z + 0.012, 'red', { collide: false, aoBottom: 1 });
  }

  /** Lattice crane / mast, decorative only. */
  crane(x: number, z: number, top: number): void {
    const w = 1.5;
    const leg = 0.14;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.box(x + sx * w - leg, x + sx * w + leg, BASE_Y, top, z + sz * w - leg, z + sz * w + leg, 'red', {
          collide: false,
          aoBottom: 0.5,
        });
      }
    }
    for (let y = BASE_Y + 6; y < top; y += 6) {
      this.box(x - w, x + w, y, y + 0.1, z - w - leg, z - w + leg, 'red', { collide: false, aoBottom: 1 });
      this.box(x - w, x + w, y, y + 0.1, z + w - leg, z + w + leg, 'red', { collide: false, aoBottom: 1 });
      this.box(x - w - leg, x - w + leg, y, y + 0.1, z - w, z + w, 'red', { collide: false, aoBottom: 1 });
      this.box(x + w - leg, x + w + leg, y, y + 0.1, z - w, z + w, 'red', { collide: false, aoBottom: 1 });
    }
    // jib + counterweight + cabin
    this.box(x - 1, x + 34, top, top + 0.5, z - 0.25, z + 0.25, 'red', { collide: false, aoBottom: 1 });
    this.box(x - 9, x - 1, top, top + 0.5, z - 0.25, z + 0.25, 'red', { collide: false, aoBottom: 1 });
    this.box(x - 9, x - 6, top - 1.6, top, z - 0.9, z + 0.9, 'dark', { collide: false, aoBottom: 1 });
    this.box(x - 1.2, x + 1.2, top + 0.5, top + 2.1, z - 1.2, z + 1.2, 'concrete', { collide: false, tint: [0.9, 0.2, 0.2] });
    this.box(x - 0.1, x + 0.1, top + 0.5, top + 9, z - 0.1, z + 0.1, 'red', { collide: false, aoBottom: 1 });
  }
}

const key = (text: string): string => `<kbd>${text}</kbd>`;

export function buildLevel(): LevelDesc {
  const b = new LayoutBuilder();
  const T = 20;

  // =========================================================================================
  // SECTION 1 - Movement tutorial (start roof + a short gap)
  // =========================================================================================
  b.roof(-9, 9, -26, 30, T, {
    lips: { w: true, e: true, s: true },
    rails: { w: [-4, 28], e: [-4, 28], s: [-8.5, 8.5] },
  });
  b.stairs(-8, 22.5, 5.5, 6, T, 3.0, 'e');
  b.ac(4.5, 22, 3, 3.4, T, 1.2);
  b.ac(-8.2, 8, 2, 2.6, T, 1.0);
  b.ac(6.2, -3.4, 1.8, 1.5, T, 1.1);
  b.pipe(7.55, 12, 7.8, 21, T);
  // Red vault box (obstacle tutorial). 0.95 m: vault with [E] or simply jump it.
  b.box(-4, 4, T, T + 0.95, 9.4, 10.6, 'red', { aoBottom: 0.75 });
  // Slide tutorial: a low canopy spanning the whole roof (underside 1.0 m).
  b.duct(-9, 9, -14, -6, T, 1.0, 0.5, 'concrete');
  b.box(-9, 9, T + 1.0, T + 1.5, -6.0, -5.94, 'red', { collide: false, aoBottom: 1 });
  b.box(-9, 9, T + 1.0, T + 1.5, -14.06, -14.0, 'red', { collide: false, aoBottom: 1 });
  // Takeoff marker for the first gap.
  b.strip(-9, 9, -26, -25.4, T);
  b.flag(-8.4, -25.2, T);
  b.flag(8.4, -25.2, T);
  b.crane(-26, 18, 78);

  // =========================================================================================
  // SECTION 2 - Rooftop jumps (gaps 4.0 / 5.0 / 3.6, a climbable ledge and a narrow bridge)
  // =========================================================================================
  // A1 (landing, gap 2.6 m from the start roof)
  b.roof(-9, 9, -44, -28.6, T, { lips: { w: true, e: true }, rails: { w: [-41, -32], e: [-41, -32] } });
  b.ac(-8.3, -40.5, 1.8, 2.6, T, 1.0);
  b.ac(6.4, -36, 1.8, 2.8, T, 1.6);
  b.strip(-9, 9, -44, -43.4, T);
  b.flag(-8.4, -43.2, T);
  b.flag(8.4, -43.2, T);

  // A2 (gap 4.0)
  b.roof(-6, 6, -64, -48, 19, { lips: { w: true, e: true } });
  b.pipe(-5.6, -60, -5.35, -50.5, 19);
  b.ac(3.6, -58.5, 2, 3.2, 19, 1.1);
  b.strip(-6, 6, -64, -63.4, 19);
  b.flag(-5.4, -63.2, 19);
  b.flag(5.4, -63.2, 19);

  // A3 (gap 5.0, drop 1, shifted left)
  b.roof(-12, 0, -84, -69, 18, { lips: { w: true, e: true } });
  b.ac(-11.5, -80.5, 2, 3, 18, 1.2);
  b.pipe(-0.9, -82, -0.65, -72, 18);
  b.strip(-12, 0, -84, -83.4, 18);
  b.flag(-11.4, -83.2, 18);
  b.flag(-0.6, -83.2, 18);

  // A4 (gap 3.6, rise 1) with a climbable ledge
  b.roof(-12, -1, -100, -87.6, 19, { lips: { w: true, e: true } });
  b.box(-12, -1, 19, 19 + 1.8, -95.5, -93.5, 'concrete', { tint: [0.97, 0.97, 0.98], aoBottom: 0.75 });
  b.box(-12, -1, 19 + 1.8, 19 + 1.85, -95.55, -95.1, 'red', { collide: false, aoBottom: 1 });
  b.box(-12, -1, 19 + 0.2, 19 + 1.8, -95.59, -95.5, 'red', { collide: false, aoBottom: 1 });
  b.strip(-12, -1, -90.2, -89.8, 19);

  // Narrow bridge from A4 to A5
  b.box(-8.6, -6.4, 19 - 0.5, 19, -109, -100, 'concrete', { tint: [0.62, 0.65, 0.7], aoBottom: 0.6 });
  b.box(-8.6, -8.45, 19, 19.2, -109, -100, 'red', { aoBottom: 1 });
  b.box(-6.55, -6.4, 19, 19.2, -109, -100, 'red', { aoBottom: 1 });
  b.box(-8.0, -7.0, 19 - 1.5, 19 - 0.5, -109, -100, 'red', { collide: false, aoBottom: 0.6 });
  for (let z = -108; z < -100; z += 2.7) b.box(-7.55, -7.45, 19 - 1.5, 19 - 0.5, z, z + 0.1, 'dark', { collide: false });

  // A5 (checkpoint 1)
  b.roof(-14, -1, -124, -109, 19, { lips: { w: true, e: true } });
  b.stairs(-13.8, -122.5, 3.4, 3.4, 19, 3.0, 'e');
  b.pipe(-1.7, -121, -1.45, -112.5, 19);
  b.strip(-14, -1, -124, -123.4, 19);
  b.flag(-13.4, -123.2, 19);
  b.flag(-1.6, -123.2, 19);

  // =========================================================================================
  // SECTION 3 - Sliding challenge (long roof of low ducts)
  // =========================================================================================
  b.roof(-14, -1, -190, -127, 19, { lips: { w: true, e: true } });
  b.duct(-14, -1, -137, -135.6, 19, 1.0, 0.9, 'red');
  b.duct(-14, -1, -149, -147.6, 19, 1.0, 0.9, 'red');
  b.box(-14, -1, 19, 19 + 1.0, -157.5, -156.5, 'red', { aoBottom: 0.75 });
  b.duct(-14, -1, -165, -163.6, 19, 1.0, 0.9, 'red');
  // long low canopy ("ventilation tunnel")
  b.duct(-14, -1, -184, -172, 19, 1.0, 0.5, 'concrete');
  b.box(-14, -1, 19 + 1.0, 19 + 1.5, -172.06, -172.0, 'red', { collide: false, aoBottom: 1 });
  b.box(-14, -1, 19 + 1.0, 19 + 1.5, -184.0, -183.94, 'red', { collide: false, aoBottom: 1 });
  b.ac(-13.4, -144, 1.8, 3, 19, 0.9);
  b.ac(-3.4, -170, 1.8, 2.6, 19, 1.0);
  b.ac(-13.3, -131, 1.6, 2, 19, 1.0);
  b.pipe(-2.2, -160, -1.95, -150, 19);
  b.pipe(-13.7, -180, -13.45, -168, 19);
  b.strip(-14, -1, -190, -189.4, 19);
  b.flag(-13.4, -189.2, 19);
  b.flag(-1.6, -189.2, 19);

  // =========================================================================================
  // SECTION 4 - Wall run (14 m gap, long wall on the right)
  // =========================================================================================
  // A7 (checkpoint 2). East side is flush with the wall tower.
  b.roof(-14, -1, -214, -194, 19, { lips: { w: true } });
  // The wall: a tall white tower whose west face is the wall-run surface.
  b.box(-1, 11, BASE_Y, 49, -248, -194, 'building', { runnable: true, aoTop: 1, aoBottom: 0.4 });
  b.footprints.push({ minX: -1, maxX: 11, minZ: -248, maxZ: -194, top: 49 });
  // Red wall-run stripe + guide chevrons on the roof.
  b.box(-1.07, -1.0, 19 + 1.0, 19 + 3.0, -233, -196, 'red', { collide: false, aoBottom: 1 });
  for (const z of [-199, -203, -207]) b.strip(-5, -1, z, z + 0.45, 19);
  b.strip(-7, -1, -214, -213.4, 19);
  b.pipe(-13.7, -212, -13.45, -200, 19);
  b.ac(-13.3, -209, 1.8, 2.6, 19, 1.1);

  // A8 (landing, checkpoint 3)
  b.roof(-16, -1, -252, -228, 19, { lips: { w: true } });
  b.ac(-15.3, -246, 1.8, 2.8, 19, 1.2);
  b.pipe(-15.7, -236, -15.45, -229.5, 19);
  b.strip(-16, -1, -252, -251.4, 19);
  b.flag(-15.4, -251.2, 19);
  b.flag(-1.6, -251.2, 19);

  // =========================================================================================
  // SECTION 5 - Parkour combination (jump, vault, slide, drop, wall run on the left)
  // =========================================================================================
  b.roof(-16, -4, -282, -256, 19, { lips: { w: true, e: true } });
  b.box(-16, -4, 19, 19 + 1.1, -264, -263, 'red', { aoBottom: 0.75 });
  b.duct(-16, -4, -276, -274.6, 19, 1.0, 0.9, 'red');
  b.ac(-15.4, -271, 1.7, 2.4, 19, 1.0);
  b.pipe(-4.9, -262, -4.65, -257.5, 19);
  b.strip(-16, -4, -282, -281.4, 19);
  b.flag(-15.4, -281.2, 19);
  b.flag(-4.6, -281.2, 19);

  b.roof(-16, -4, -300, -286.8, 18, { lips: { w: true, e: true } });
  b.ac(-15.4, -296, 1.8, 3, 18, 1.1);
  b.pipe(-4.9, -297, -4.65, -289, 18);
  b.strip(-16, -4, -300, -299.4, 18);
  b.flag(-15.4, -299.2, 18);
  b.flag(-4.6, -299.2, 18);

  // A11: wall on the left (glass tower) for the second wall run (12 m gap)
  b.roof(-16, -4, -324, -304, 18, { lips: { e: true } });
  b.box(-34, -16, BASE_Y, 48, -352, -300, 'glass', { runnable: true, aoTop: 1, aoBottom: 0.4 });
  b.footprints.push({ minX: -34, maxX: -16, minZ: -352, maxZ: -300, top: 48 });
  b.box(-16.0, -15.93, 18 + 1.0, 18 + 3.0, -338, -304, 'red', { collide: false, aoBottom: 1 });
  for (const z of [-308, -312, -316]) b.strip(-16, -12, z, z + 0.45, 18);
  b.strip(-16, -4, -324, -323.4, 18);
  b.ac(-6.3, -322, 2, 2.4, 18, 1.1);
  b.pipe(-4.9, -318, -4.65, -308, 18);

  // A12: corner roof. Checkpoint 4. Turn right (+X) for the final sprint.
  b.roof(-16, 18, -352, -336, 18.5, {
    lips: { n: true, s: [-4, 18] },
    rails: { n: [-14, 14] },
  });
  b.ac(-15.3, -350.8, 2, 3, 18.5, 1.2);
  b.ac(8, -351.2, 2.4, 2.4, 18.5, 1.0);
  b.strip(17.4, 18, -352, -336, 18.5);
  b.flag(17.2, -351.4, 18.5);
  b.flag(17.2, -336.6, 18.5);

  // =========================================================================================
  // SECTION 6 - Final sprint (five jumps along +X) and finish gate
  // =========================================================================================
  const zc = -344;
  const finalRoof = (x0: number, x1: number, top: number, half: number, lipE?: boolean): void => {
    b.roof(x0, x1, zc - half, zc + half, top, { lips: { n: true, s: true, e: lipE } });
  };
  finalRoof(22.6, 40, 18.5, 7); // gap 4.6, level
  b.pipe(24, -350.4, 33, -350.15, 18.5);
  b.ac(34, -350.2, 2, 2.4, 18.5, 1.1);
  b.strip(22.6, 23.2, zc - 7, zc + 7, 18.5);
  b.strip(39.4, 40, zc - 7, zc + 7, 18.5);
  b.flag(39.2, zc - 6.6, 18.5);
  b.flag(39.2, zc + 6.6, 18.5);

  finalRoof(44.6, 60, 17.5, 8); // gap 4.6, drop 1
  b.box(50, 51, 17.5, 17.5 + 1.0, zc - 8, zc + 8, 'red', { aoBottom: 0.75 });
  b.strip(59.4, 60, zc - 8, zc + 8, 17.5);
  b.flag(59.2, zc - 7.6, 17.5);
  b.flag(59.2, zc + 7.6, 17.5);

  finalRoof(65.2, 80, 16.5, 7); // gap 5.2, drop 1
  b.ac(70, -350.1, 2, 2.3, 16.5, 1.0);
  b.strip(79.4, 80, zc - 7, zc + 7, 16.5);
  b.flag(79.2, zc - 6.6, 16.5);
  b.flag(79.2, zc + 6.6, 16.5);

  finalRoof(84, 98, 17.5, 8); // gap 4.0, rise 1
  b.strip(97.4, 98, zc - 8, zc + 8, 17.5);
  b.flag(97.2, zc - 7.6, 17.5);
  b.flag(97.2, zc + 7.6, 17.5);

  // Finish roof (gap 5.5, drop 1.5), railed all round.
  b.roof(103.5, 140, zc - 12, zc + 12, 16, {
    lips: { n: true, s: true, e: true },
    rails: { n: [105, 138], s: [105, 138], e: [zc - 10, zc + 10] },
  });
  const fx = 124;
  const FT = 16;
  // Finish gate: two pillars and a lintel; a translucent curtain is added by the renderer.
  b.box(fx - 0.5, fx + 0.5, FT, FT + 5.5, zc - 5, zc - 4, 'red', { aoBottom: 0.7 });
  b.box(fx - 0.5, fx + 0.5, FT, FT + 5.5, zc + 4, zc + 5, 'red', { aoBottom: 0.7 });
  b.box(fx - 0.6, fx + 0.6, FT + 5.5, FT + 6.4, zc - 5.2, zc + 5.2, 'red', { collide: false, aoBottom: 1 });
  b.strip(fx - 0.5, fx + 0.5, zc - 4, zc + 4, FT);
  b.strip(103.5, 104.1, zc - 12, zc + 12, FT);
  b.ac(130, -354, 3, 3, FT, 1.2);
  b.ac(130, -335, 3, 2.5, FT, 1.0);
  b.stairs(134, -346, 5, 5, FT, 3.0, 'w');

  // =========================================================================================
  // Triggers
  // =========================================================================================
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): AABB => ({
    minX: x0,
    maxX: x1,
    minY: y0,
    maxY: y1,
    minZ: z0,
    maxZ: z1,
  });

  const hints: HintDesc[] = [
    { box: box(-9, 9, 15, 30, 19, 31), html: `${key('W')}${key('A')}${key('S')}${key('D')} move &nbsp;·&nbsp; mouse to look` },
    { box: box(-9, 9, 15, 30, 12, 19), html: `Hold ${key('SHIFT')} to sprint` },
    { box: box(-9, 9, 15, 30, 3, 12), html: `${key('SPACE')} jump &nbsp;·&nbsp; ${key('E')} vault low obstacles` },
    { box: box(-9, 9, 15, 30, -4.5, 3), html: `Sprint, then ${key('CTRL')} / ${key('C')} to slide under low overhangs` },
    { box: box(-9, 9, 15, 30, -25.5, -15), html: `Sprint and ${key('SPACE')} at the edge to jump the gap` },
    { box: box(-12, 0, 15, 30, -99, -88), html: `Jump at the ledge — you will pull yourself up automatically` },
    { box: box(-14, -1, 15, 30, -134, -127), html: `Slide under red ducts: ${key('CTRL')} / ${key('C')} while sprinting` },
    { box: box(-14, -1, 15, 30, -214, -196), html: `Jump at the edge towards the red wall and hold ${key('W')} to wall-run` },
    { box: box(-16, -4, 15, 30, -274, -256), html: `${key('E')} vault, then slide the duct — keep your speed` },
    { box: box(-16, -4, 15, 30, -322, -304), html: `Wall-run on the left: jump at the edge, hold ${key('W')}, ${key('SPACE')} to leap off` },
  ];

  const sections: SectionDesc[] = [
    { index: 1, title: 'MOVEMENT', box: box(-40, 40, -10, 60, -27, 40) },
    { index: 2, title: 'ROOFTOP JUMPS', box: box(-40, 40, -10, 60, -125, -27) },
    { index: 3, title: 'SLIDING', box: box(-40, 40, -10, 60, -194.5, -125) },
    { index: 4, title: 'WALL RUN', box: box(-40, 40, -10, 70, -255, -194.5) },
    { index: 5, title: 'COMBINATION', box: box(-40, 20, -10, 70, -360, -255) },
    { index: 6, title: 'FINAL SPRINT', box: box(20, 160, -10, 70, -360, -320) },
  ];

  const checkpoints: CheckpointDesc[] = [
    { name: 'CHECKPOINT 1', x: -7.5, y: 19, z: -116, yaw: 0 },
    { name: 'CHECKPOINT 2', x: -9, y: 19, z: -203, yaw: 0 },
    { name: 'CHECKPOINT 3', x: -8.5, y: 19, z: -240, yaw: 0 },
    { name: 'CHECKPOINT 4', x: -8, y: 18.5, z: -344, yaw: -Math.PI / 2 },
  ];

  const minTop = Math.min(...b.footprints.filter((f) => f.top < 25).map((f) => f.top));

  return {
    solids: b.solids,
    checkpoints,
    hints,
    sections,
    footprints: b.footprints,
    spawn: { x: 0, y: T, z: 25.5, yaw: 0 },
    finish: {
      trigger: box(fx - 0.9, fx + 0.9, FT - 0.5, FT + 7, zc - 12, zc + 12),
      x: fx,
      y: FT,
      z: zc,
      halfWidth: 4.5,
    },
    killY: minTop - 6,
  };
}
