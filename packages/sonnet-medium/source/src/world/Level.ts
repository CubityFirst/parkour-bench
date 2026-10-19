import { CollisionWorld } from './CollisionWorld';

/**
 * Level layout. This file is pure data + collision registration (no rendering),
 * so the same level can be loaded headless by the simulation test.
 *
 * Coordinates: +Y up, the route runs towards -Z. Units are metres.
 * Movement budget used to size the gaps (see PlayerController):
 *   sprint 9 m/s, jump 7.8 m/s, gravity 22 m/s^2 -> ~6.4 m flat sprint-jump reach.
 */

export type Mat = 'red' | 'grey' | 'dark' | 'white' | 'concrete';

export interface Piece {
  kind: 'building' | 'prop';
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  mat: Mat;
  glass: boolean;
  /** Optional brightness/colour variation (multiplier). */
  tint?: number;
}

export interface Roof {
  minX: number; maxX: number; minZ: number; maxZ: number; top: number;
}

export interface Checkpoint {
  id: number;
  name: string;
  /** Respawn feet position. */
  x: number; y: number; z: number; yaw: number;
  /** Trigger volume. */
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

export interface HintZone {
  text: string;
  minZ: number; maxZ: number;
}

export interface BuildingOpts {
  cx: number; w: number; nearZ: number; len: number; top: number;
  glass?: boolean; wallRun?: boolean;
  /** Which sides get a low curb. Default both. */
  curbLeft?: boolean; curbRight?: boolean;
}

export const KILL_Y = 10;

export class Level {
  readonly world = new CollisionWorld();
  readonly pieces: Piece[] = [];
  readonly roofs: Roof[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly hints: HintZone[] = [];
  spawn = { x: 0, y: 40, z: 6, yaw: 0 };
  finish = { minX: -9, maxX: 9, minY: 28, maxY: 45, minZ: -387, maxZ: -384 };
  /** Finish gate centre (for the renderer). */
  finishGate = { x: 0, y: 31, z: -385.5 };
  /** Lateral extent of every roof building footprint (used by the skyline generator to avoid overlaps). */
  readonly footprints: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

  constructor() {
    this.build();
  }

  // ---------------------------------------------------------------- helpers

  /** Decorative / solid box. */
  prop(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    mat: Mat, opts: { collide?: boolean; wallRun?: boolean; tint?: number } = {},
  ): void {
    this.pieces.push({ kind: 'prop', x0, y0, z0, x1, y1, z1, mat, glass: false, tint: opts.tint });
    if (opts.collide !== false) {
      this.world.add(x0, y0, z0, x1, y1, z1, { wallRun: opts.wallRun, tag: mat });
    }
  }

  /** Solid building from the ground to `top`. Returns the roof. */
  building(o: BuildingOpts): Roof {
    const minX = o.cx - o.w / 2, maxX = o.cx + o.w / 2;
    const maxZ = o.nearZ, minZ = o.nearZ - o.len;
    this.pieces.push({
      kind: 'building', x0: minX, y0: 0, z0: minZ, x1: maxX, y1: o.top, z1: maxZ,
      mat: 'concrete', glass: !!o.glass,
    });
    this.world.add(minX, 0, minZ, maxX, o.top, maxZ, { wallRun: o.wallRun, tag: 'building' });
    const roof: Roof = { minX, maxX, minZ, maxZ, top: o.top };
    this.roofs.push(roof);
    this.footprints.push({ minX, maxX, minZ, maxZ });
    const curb = 0.22, cw = 0.35;
    if (o.curbLeft !== false) this.prop(minX, o.top, minZ, minX + cw, o.top + curb, maxZ, 'white');
    if (o.curbRight !== false) this.prop(maxX - cw, o.top, minZ, maxX, o.top + curb, maxZ, 'white');
    return roof;
  }

  /** Tall tower beside the route. Footprint only (no roof curbs), flagged wall-runnable. */
  tower(minX: number, maxX: number, minZ: number, maxZ: number, top: number, glass: boolean): void {
    this.pieces.push({ kind: 'building', x0: minX, y0: 0, z0: minZ, x1: maxX, y1: top, z1: maxZ, mat: 'concrete', glass });
    this.world.add(minX, 0, minZ, maxX, top, maxZ, { wallRun: true, tag: 'tower' });
    this.footprints.push({ minX, maxX, minZ, maxZ });
  }

  /** Flat red marker painted on the roof surface near an edge. */
  strip(r: Roof, atFarEdge: boolean, inset = 0): void {
    const x0 = r.minX + 0.4 + inset, x1 = r.maxX - 0.4 - inset;
    const z0 = atFarEdge ? r.minZ : r.maxZ - 0.7;
    this.prop(x0, r.top, z0, x1, r.top + 0.03, z0 + 0.7, 'red', { collide: false });
  }

  /** Red pylons on both corners of an edge, marking a jump point. */
  pylons(r: Roof, atFarEdge: boolean): void {
    const z = atFarEdge ? r.minZ + 0.5 : r.maxZ - 0.5;
    for (const x of [r.minX + 0.9, r.maxX - 0.9]) {
      this.prop(x - 0.15, r.top, z - 0.15, x + 0.15, r.top + 1.5, z + 0.15, 'red');
    }
  }

  ac(x: number, z: number, top: number, w = 2.2, d = 1.4, h = 1.2): void {
    this.prop(x - w / 2, top, z - d / 2, x + w / 2, top + h, z + d / 2, 'grey');
    this.prop(x - w / 2 + 0.2, top + h, z - d / 2 + 0.2, x + w / 2 - 0.2, top + h + 0.08, z + d / 2 - 0.2, 'dark', { collide: false });
  }

  /** Low red pipe along the roof (stepped over). axis 'z' runs along Z. */
  pipe(x: number, z0: number, z1: number, top: number): void {
    this.prop(x - 0.14, top, Math.min(z0, z1), x + 0.14, top + 0.28, Math.max(z0, z1), 'red');
  }

  stairHouse(x0: number, z0: number, x1: number, z1: number, top: number, doorFace: '+x' | '-x' | '+z' | '-z'): void {
    const h = 3.3;
    this.prop(x0, top, z0, x1, top + h, z1, 'white');
    this.prop(x0 - 0.1, top + h, z0 - 0.1, x1 + 0.1, top + h + 0.15, z1 + 0.1, 'grey');
    const dw = 1.3, dh = 2.15, t = 0.04;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    switch (doorFace) {
      case '+x': this.prop(x1, top, cz - dw / 2, x1 + t, top + dh, cz + dw / 2, 'red', { collide: false }); break;
      case '-x': this.prop(x0 - t, top, cz - dw / 2, x0, top + dh, cz + dw / 2, 'red', { collide: false }); break;
      case '+z': this.prop(cx - dw / 2, top, z1, cx + dw / 2, top + dh, z1 + t, 'red', { collide: false }); break;
      case '-z': this.prop(cx - dw / 2, top, z0 - t, cx + dw / 2, top + dh, z0, 'red', { collide: false }); break;
    }
  }

  /** Solid railing along a straight edge. The collider is a solid fence; the renderer draws bars. */
  railing(x0: number, z0: number, x1: number, z1: number, top: number): void {
    const t = 0.06;
    const minX = Math.min(x0, x1) - t, maxX = Math.max(x0, x1) + t;
    const minZ = Math.min(z0, z1) - t, maxZ = Math.max(z0, z1) + t;
    this.world.add(minX, top, minZ, maxX, top + 1.1, maxZ, { tag: 'rail' });
    // Visual bars (top rail, mid rail, posts).
    this.prop(minX, top + 1.04, minZ, maxX, top + 1.12, maxZ, 'grey', { collide: false });
    this.prop(minX, top + 0.52, minZ, maxX, top + 0.58, maxZ, 'grey', { collide: false });
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? maxX - minX : maxZ - minZ;
    const n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (alongX) {
        const px = minX + (maxX - minX) * f;
        this.prop(px - 0.04, top, minZ, px + 0.04, top + 1.1, maxZ, 'grey', { collide: false });
      } else {
        const pz = minZ + (maxZ - minZ) * f;
        this.prop(minX, top, pz - 0.04, maxX, top + 1.1, pz + 0.04, 'grey', { collide: false });
      }
    }
  }

  /** Low overhead vent/duct structure that must be slid under. Spans the full roof width. */
  duct(r: Roof, zFront: number, depth: number, bottom = 1.15, thick = 0.6): void {
    const x0 = r.minX + 0.35, x1 = r.maxX - 0.35;
    const z0 = zFront - depth, z1 = zFront;
    const top = r.top;
    // main slab
    this.prop(x0, top + bottom, z0, x1, top + bottom + thick, z1, 'grey');
    // red frames on both ends and over the entrance, so the route reads clearly
    this.prop(x0, top, z0, x0 + 0.4, top + bottom, z1, 'red');
    this.prop(x1 - 0.4, top, z0, x1, top + bottom, z1, 'red');
    this.prop(x0, top + bottom - 0.14, z1 - 0.18, x1, top + bottom, z1, 'red', { collide: false });
    // vent grates on top (decor)
    for (let x = x0 + 1.5; x < x1 - 1.5; x += 3.5) {
      this.prop(x, top + bottom + thick, z0 + 0.5, x + 1.4, top + bottom + thick + 0.12, z1 - 0.5, 'dark', { collide: false });
    }
  }

  /** Red low obstacle that can be vaulted (E) or jumped. */
  vaultBox(x0: number, x1: number, z: number, top: number, h = 0.95, d = 0.6): void {
    this.prop(x0, top, z - d / 2, x1, top + h, z + d / 2, 'red');
  }

  /** Tall lattice tower (decor with 4 solid legs), red. */
  crane(cx: number, cz: number, top: number, height: number): void {
    const s = 0.9;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.prop(cx + sx * s - 0.12, top, cz + sz * s - 0.12, cx + sx * s + 0.12, top + height, cz + sz * s + 0.12, 'red');
      }
    }
    for (let y = 2.4; y < height; y += 2.6) {
      this.prop(cx - s, top + y, cz - s - 0.05, cx + s, top + y + 0.1, cz - s + 0.05, 'red', { collide: false });
      this.prop(cx - s, top + y, cz + s - 0.05, cx + s, top + y + 0.1, cz + s + 0.05, 'red', { collide: false });
      this.prop(cx - s - 0.05, top + y, cz - s, cx - s + 0.05, top + y + 0.1, cz + s, 'red', { collide: false });
      this.prop(cx + s - 0.05, top + y, cz - s, cx + s + 0.05, top + y + 0.1, cz + s, 'red', { collide: false });
    }
    // base plate
    this.prop(cx - s - 0.5, top, cz - s - 0.5, cx + s + 0.5, top + 0.12, cz + s + 0.5, 'red');
  }

  checkpoint(id: number, name: string, x: number, z: number, top: number): void {
    this.checkpoints.push({
      id, name, x, y: top + 0.01, z, yaw: 0,
      minX: x - 5, maxX: x + 5, minY: top - 1, maxY: top + 4, minZ: z - 2, maxZ: z + 2,
    });
  }

  // ---------------------------------------------------------------- the level

  private build(): void {
    // =============== Section 1 - Movement tutorial (big start roof) ===============
    const r0 = this.building({ cx: 0, w: 20, nearZ: 10, len: 60, top: 40, curbLeft: false, curbRight: false });
    this.spawn = { x: 0, y: r0.top + 0.01, z: 6, yaw: 0 };
    this.checkpoints.push({
      id: 0, name: 'START', x: 0, y: r0.top + 0.01, z: 6, yaw: 0,
      minX: -1, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0, // never triggered, start only
    });
    this.railing(-9.9, 10, -9.9, -50, r0.top);
    this.railing(9.9, 10, 9.9, -50, r0.top);
    this.railing(-9.9, 9.9, 9.9, 9.9, r0.top);
    this.stairHouse(6, 1.5, 9.5, 5, r0.top, '-z');
    this.crane(-7.5, -2, r0.top, 14);
    this.ac(-8, -9, r0.top, 2.2, 1.6, 1.3);
    this.pipe(5.5, -2, -12, r0.top);
    this.vaultBox(-3.5, 3.5, -16, r0.top);                   // vault tutorial
    this.ac(8, -23, r0.top, 2.4, 1.6, 1.2);
    this.duct(r0, -30, 3.2);                                 // slide tutorial
    this.ac(-8, -40, r0.top, 2.2, 1.4, 0.8);
    this.vaultBox(-3, 3, -42, r0.top, 0.5, 0.5);             // small obstacle: low hop
    this.strip(r0, true);
    this.pylons(r0, true);
    this.hints.push(
      { text: 'WASD to move  ·  hold SHIFT to sprint', minZ: -4, maxZ: 12 },
      { text: 'Press E to vault the red obstacle (or just jump it)', minZ: -16, maxZ: -5 },
      { text: 'Sprint, then press CTRL or C to slide under the vent', minZ: -29, maxZ: -17 },
      { text: 'SPACE to jump — hold it for height. Sprint-jump the gap!', minZ: -50, maxZ: -31 },
    );

    // =============== Section 2 - Rooftop jumps ===============
    const r1 = this.building({ cx: 0, w: 14, nearZ: -53, len: 18, top: 40 });
    this.ac(-4.5, -58, r1.top);
    this.vaultBox(-1.5, 1.5, -62, r1.top, 0.5, 0.5);
    this.ac(4.5, -66, r1.top, 2.2, 1.4, 1.0);
    this.strip(r1, true);
    this.pylons(r1, true);
    this.hints.push({ text: 'Follow the red. Sprint and jump between rooftops.', minZ: -71, maxZ: -52 });

    const r2 = this.building({ cx: 2, w: 12, nearZ: -76, len: 14, top: 38.5 });
    this.ac(6, -81, r2.top, 2.0, 1.4, 1.1);
    this.pipe(-3, -78, -88, r2.top);
    this.strip(r2, true);
    this.pylons(r2, true);

    const r3 = this.building({ cx: -2, w: 12, nearZ: -94.5, len: 12, top: 38.5 });
    this.ac(-6, -99, r3.top, 2.0, 1.4, 1.1);
    this.strip(r3, true, 4.5);
    this.prop(r3.minX + 0.4, r3.top, r3.minZ + 0.3, r3.maxX - 0.4, r3.top + 0.03, r3.minZ + 0.8, 'red', { collide: false });

    // narrow bridge (continuous with r3, no curbs)
    const bridge = this.building({ cx: -2, w: 2.6, nearZ: -106.5, len: 16, top: 38.5, curbLeft: false, curbRight: false });
    this.prop(bridge.minX, bridge.top, bridge.minZ, bridge.minX + 0.12, bridge.top + 0.02, bridge.maxZ, 'red', { collide: false });
    this.prop(bridge.maxX - 0.12, bridge.top, bridge.minZ, bridge.maxX, bridge.top + 0.02, bridge.maxZ, 'red', { collide: false });
    this.hints.push({ text: 'Narrow bridge — keep your line', minZ: -122, maxZ: -107 });

    const r5 = this.building({ cx: -2, w: 14, nearZ: -122.5, len: 16, top: 38.5 });
    this.stairHouse(-8.7, -136, -5.5, -132.5, r5.top, '+x');
    this.ac(3, -127, r5.top, 2.0, 1.4, 1.0);
    this.strip(r5, true);
    this.pylons(r5, true);
    this.checkpoint(1, 'CHECKPOINT 1', -2, -130, r5.top);

    // =============== Section 3 - Sliding challenge ===============
    const r6 = this.building({ cx: 0, w: 14, nearZ: -143, len: 44, top: 37.5, curbRight: false });
    this.duct(r6, -149, 3.5);
    this.ac(-4.2, -157, r6.top, 3.0, 1.6, 1.0);
    this.duct(r6, -159.5, 3.5);
    this.ac(4.2, -167.5, r6.top, 3.0, 1.6, 1.0);
    this.duct(r6, -170, 3.5);
    this.pipe(-6.2, -176, -186, r6.top);
    this.checkpoint(2, 'CHECKPOINT 2', 3, -177, r6.top);
    this.hints.push(
      { text: 'Slide under the red-framed vents — keep your momentum', minZ: -148, maxZ: -144 },
      { text: 'Hold forward + stay low. Slide under vents, hop over the units.', minZ: -176, maxZ: -149 },
    );

    // =============== Section 4 - Wall run ===============
    // Tower on the right whose face is the wall-run surface. 10 m gap is too wide to jump.
    this.tower(7, 22, -205, -178, 47, true);
    // Red wall-run panel on the wall face (decor, flush with the wall)
    this.prop(6.97, r6.top + 0.8, -202, 7.0, r6.top + 5.5, -180, 'red', { collide: false });
    this.hints.push(
      { text: 'Gap too wide? Hug the red wall, jump, and hold FORWARD to wall-run', minZ: -184, maxZ: -177 },
    );
    const r7 = this.building({ cx: 0, w: 14, nearZ: -197, len: 22, top: 37.5, curbRight: false });
    this.stairHouse(-6.5, -212, -3.5, -209, r7.top, '+z');
    this.ac(-5, -202, r7.top, 2.0, 1.4, 1.0);
    this.pipe(-6.2, -199, -216, r7.top);
    this.checkpoint(3, 'CHECKPOINT 3', 0, -208, r7.top);

    // =============== Section 5 - Parkour combination ===============
    const r8 = this.building({ cx: 0, w: 14, nearZ: -224, len: 22, top: 38, curbLeft: false });
    this.vaultBox(-4, 4, -228.5, r8.top, 1.0, 0.6);
    this.duct(r8, -233.5, 3.5);
    this.ac(5, -239, r8.top, 2.0, 1.4, 1.0);
    this.hints.push({ text: 'Combine it all: vault, slide, then wall-run on the LEFT wall', minZ: -233, maxZ: -224 });
    this.tower(-22, -7, -266, -240, 47, true);
    this.prop(-7.0, r8.top + 0.8, -264, -6.97, r8.top + 5.5, -242, 'red', { collide: false });
    const r9 = this.building({ cx: 0, w: 14, nearZ: -255, len: 18, top: 38, curbLeft: false });
    this.vaultBox(-5.5, 5.5, -268.5, r9.top, 1.0, 0.6);
    this.strip(r8, true);
    this.pylons(r8, true);
    this.strip(r9, true, 0);

    const r10 = this.building({ cx: 0, w: 10, nearZ: -278, len: 14, top: 36 });
    this.ac(-3, -283, r10.top, 2.0, 1.4, 1.0);
    this.checkpoint(4, 'CHECKPOINT 4', 0, -285, r10.top);
    this.strip(r10, true);
    this.pylons(r10, true);

    // =============== Section 6 - Final sprint ===============
    const r11 = this.building({ cx: 2, w: 10, nearZ: -297, len: 12, top: 35 });
    this.strip(r11, true); this.pylons(r11, true);
    const r12 = this.building({ cx: -2, w: 10, nearZ: -314, len: 12, top: 34 });
    this.strip(r12, true); this.pylons(r12, true);
    const r13 = this.building({ cx: 2, w: 10, nearZ: -331.5, len: 12, top: 33 });
    this.strip(r13, true); this.pylons(r13, true);
    const r14 = this.building({ cx: 0, w: 10, nearZ: -349, len: 10, top: 32 });
    this.strip(r14, true); this.pylons(r14, true);
    this.hints.push({ text: 'Final sprint — never stop moving!', minZ: -296, maxZ: -278 });

    const r15 = this.building({ cx: 0, w: 18, nearZ: -364, len: 32, top: 31 });
    this.stairHouse(-8.7, -392.5, -5.5, -389.2, r15.top, '+z');
    this.crane(8, -392, r15.top, 40);
    // Finish gate: red pillars + beam (drawn with a FINISH banner by the renderer)
    const gz = this.finishGate.z;
    this.finishGate.y = r15.top;
    this.prop(-5.4, r15.top, gz - 0.3, -4.8, r15.top + 6, gz + 0.3, 'red');
    this.prop(4.8, r15.top, gz - 0.3, 5.4, r15.top + 6, gz + 0.3, 'red');
    this.prop(-5.4, r15.top + 5.2, gz - 0.35, 5.4, r15.top + 6.2, gz + 0.35, 'red', { collide: false });
    this.prop(-9, r15.top, gz - 4, 9, r15.top + 0.03, gz + 4, 'red', { collide: false, tint: 0.9 });
    this.finish = { minX: -9, maxX: 9, minY: r15.top - 1, maxY: r15.top + 10, minZ: gz - 1, maxZ: gz + 1 };
  }
}
