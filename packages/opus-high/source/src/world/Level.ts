import * as THREE from 'three';
import { CollisionWorld, type ColliderFlags } from './CollisionWorld';
import { GeometryBatcher, type BoxMaterials } from './GeometryBatcher';
import type { MaterialKey, Materials } from './Materials';

/** Axis-aligned trigger volume in world space. */
export interface Zone {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function zoneContains(z: Zone, p: THREE.Vector3): boolean {
  return p.x >= z.minX && p.x <= z.maxX && p.y >= z.minY && p.y <= z.maxY && p.z >= z.minZ && p.z <= z.maxZ;
}

export interface CheckpointDef {
  index: number;
  label: string;
  spawn: THREE.Vector3;
  yaw: number;
  zone: Zone;
  /** Where the beacon stands. */
  marker: THREE.Vector3;
}

export interface HintDef {
  zone: Zone;
  text: string;
}

export interface SectionDef {
  index: number;
  title: string;
  zone: Zone;
}

/** Footprint rectangle in world XZ, used to keep the background city off the route. */
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Bottom of every building; the street is far below the rooftops. */
export const CITY_FLOOR = -120;

/**
 * The playable rooftop course.
 *
 * Coordinates in this file are written in "route space": x is lateral, d is the
 * distance along the route and y is height. The route runs toward world -Z,
 * so world z = -d. Each section's numbers were chosen against the movement
 * values in PlayerPhysics (sprint jump ≈ 8 m, wall run ≈ 15 m, mantle reach 2.2 m).
 */
export class Level {
  readonly collision = new CollisionWorld();
  readonly group = new THREE.Group();
  readonly checkpoints: CheckpointDef[] = [];
  readonly hints: HintDef[] = [];
  readonly sections: SectionDef[] = [];
  readonly footprints: Footprint[] = [];
  finishZone!: Zone;
  finishMarker = new THREE.Vector3();
  /** Falling below this height respawns the player. */
  readonly killY = -14;
  /** Total length of the route, used for the progress bar. */
  readonly routeLength = 334;

  private readonly b: GeometryBatcher;

  constructor(materials: Materials) {
    this.b = new GeometryBatcher(materials);
    this.group.name = 'level';
    this.buildCourse();
    this.b.build(this.group, { cast: true, receive: true });
  }

  // ---------------------------------------------------------------------------
  // Primitive helpers (route space)
  // ---------------------------------------------------------------------------

  private vmin(x0: number, y0: number, d1: number) {
    return new THREE.Vector3(x0, y0, -d1);
  }
  private vmax(x1: number, y1: number, d0: number) {
    return new THREE.Vector3(x1, y1, -d0);
  }

  /** Visual box (and optional collider). */
  private solid(
    x0: number, x1: number, y0: number, y1: number, d0: number, d1: number,
    mats: BoxMaterials | MaterialKey, flags: ColliderFlags | null = {}, skipBottom = true,
  ): void {
    this.b.box(this.vmin(x0, y0, d1), this.vmax(x1, y1, d0), mats, { skipBottom });
    if (flags) this.collision.add(x0, y0, -d1, x1, y1, -d0, flags);
  }

  /** Collider only (used for railings whose visuals are built from thin parts). */
  private collider(x0: number, x1: number, y0: number, y1: number, d0: number, d1: number, flags: ColliderFlags = {}): void {
    this.collision.add(x0, y0, -d1, x1, y1, -d0, flags);
  }

  private zone(x0: number, x1: number, y0: number, y1: number, d0: number, d1: number): Zone {
    return { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: -d1, maxZ: -d0 };
  }

  /** A full building rising from the street up to `top`. */
  private building(x0: number, x1: number, d0: number, d1: number, top: number, facade: MaterialKey = 'facade'): void {
    this.solid(x0, x1, CITY_FLOOR, top, d0, d1, { top: 'roof', side: facade });
    // Cornice band just under the roof edge.
    this.solid(x0 - 0.12, x1 + 0.12, top - 0.55, top - 0.05, d0 - 0.12, d1 + 0.12, 'white', null, false);
    this.footprints.push({ minX: x0, maxX: x1, minZ: -d1, maxZ: -d0 });
  }

  /** Low parapet with a metal handrail along an edge. `axis` = which coordinate is constant. */
  private railing(axis: 'x' | 'd', at: number, from: number, to: number, y: number, inward: number): void {
    const t = 0.28; // parapet thickness
    const ph = 0.45; // parapet height
    const railH = 1.1;
    if (axis === 'x') {
      const x0 = inward > 0 ? at : at - t;
      const x1 = inward > 0 ? at + t : at;
      this.solid(x0, x1, y, y + ph, from, to, { top: 'white', side: 'white' }, null);
      const rx = (x0 + x1) / 2;
      this.solid(rx - 0.04, rx + 0.04, y + railH - 0.06, y + railH, from, to, 'metal', null);
      for (let d = from + 0.2; d < to; d += 2.2) this.solid(rx - 0.035, rx + 0.035, y + ph, y + railH, d, d + 0.07, 'metal', null);
      this.collider(x0, x1, y, y + railH, from, to);
    } else {
      const d0 = inward > 0 ? at : at - t;
      const d1 = inward > 0 ? at + t : at;
      this.solid(from, to, y, y + ph, d0, d1, { top: 'white', side: 'white' }, null);
      const rd = (d0 + d1) / 2;
      this.solid(from, to, y + railH - 0.06, y + railH, rd - 0.04, rd + 0.04, 'metal', null);
      for (let x = from + 0.2; x < to; x += 2.2) this.solid(x, x + 0.07, y + ph, y + railH, rd - 0.035, rd + 0.035, 'metal', null);
      this.collider(from, to, y, y + railH, d0, d1);
    }
  }

  /** Thin red line painted on a roof marking a take-off point. */
  private redStrip(x0: number, x1: number, d0: number, d1: number, y: number): void {
    this.solid(x0, x1, y, y + 0.025, d0, d1, 'red', null);
  }

  /** Red trim on the lip of a climbable ledge. */
  private ledgeTrim(x0: number, x1: number, d: number, y: number): void {
    this.solid(x0, x1, y - 0.35, y + 0.02, d - 0.06, d + 0.25, 'red', null);
  }

  /** Overhead ventilation duct the player must slide under. */
  private duct(x0: number, x1: number, d0: number, d1: number, floor: number, bottom: number, top: number): void {
    this.solid(x0, x1, floor + bottom, floor + top, d0, d1, 'red', { noMantle: true, noWallRun: true }, false);
    // Metal collars.
    for (let x = x0 + 1.5; x < x1 - 1; x += 3) {
      this.solid(x, x + 0.18, floor + bottom - 0.05, floor + top + 0.05, d0 - 0.05, d1 + 0.05, 'metal', null, false);
    }
    // Support legs at both ends.
    for (const lx of [x0 + 0.05, x1 - 0.35]) {
      this.solid(lx, lx + 0.3, floor, floor + bottom, d0 + 0.3, d1 - 0.3, 'steel', {});
    }
  }

  private acUnit(x: number, d: number, y: number, w: number, depth: number, h: number): void {
    this.solid(x - w / 2, x + w / 2, y, y + h, d - depth / 2, d + depth / 2, { top: 'metal', side: 'metal' });
    const fanR = Math.min(w, depth) * 0.32;
    const fan = new THREE.CylinderGeometry(fanR, fanR, 0.08, 20);
    this.b.geometry(fan, new THREE.Matrix4().makeTranslation(x, y + h + 0.04, -d), 'dark');
    fan.dispose();
    // Fins on the side.
    this.solid(x - w / 2 - 0.02, x + w / 2 + 0.02, y + 0.15, y + 0.2, d - depth / 2 - 0.02, d + depth / 2 + 0.02, 'dark', null);
  }

  private vaultBox(x0: number, x1: number, d0: number, d1: number, y: number, h: number): void {
    this.solid(x0, x1, y, y + h, d0, d1, { top: 'white', side: 'red' }, { noWallRun: true });
  }

  private grate(x0: number, x1: number, d0: number, d1: number, y: number): void {
    this.solid(x0, x1, y, y + 0.06, d0, d1, { top: 'grate', side: 'dark' }, null);
  }

  private flag(x: number, d: number, y: number, dir = 1): void {
    this.solid(x - 0.04, x + 0.04, y, y + 3.6, d - 0.04, d + 0.04, 'steel', null);
    const cloth = new THREE.PlaneGeometry(1.25, 0.8, 4, 2);
    // Gentle static wave.
    const pos = cloth.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 3) * 0.08);
    cloth.computeVertexNormals();
    const m = new THREE.Matrix4()
      .makeTranslation(x + dir * 0.66, y + 3.15, -d)
      .multiply(new THREE.Matrix4().makeRotationY(0.25 * dir));
    this.b.geometry(cloth, m, 'orange');
    cloth.dispose();
  }

  private pipe(x0: number, x1: number, d0: number, d1: number, y: number, r: number, collide: boolean): void {
    const alongX = Math.abs(x1 - x0) > Math.abs(d1 - d0);
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(d1 - d0);
    const geo = new THREE.CylinderGeometry(r, r, len, 14);
    const m = new THREE.Matrix4();
    if (alongX) m.makeRotationZ(Math.PI / 2);
    else m.makeRotationX(Math.PI / 2);
    m.setPosition((x0 + x1) / 2, y + r, -(d0 + d1) / 2);
    this.b.geometry(geo, m, 'red');
    geo.dispose();
    // Small brackets.
    const n = Math.max(2, Math.floor(len / 3));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const px = x0 + (x1 - x0) * f;
      const pd = d0 + (d1 - d0) * f;
      this.solid(px - 0.08, px + 0.08, y - 0.01, y + r * 0.6, pd - 0.08, pd + 0.08, 'steel', null);
    }
    if (collide) {
      if (alongX) this.collider(Math.min(x0, x1), Math.max(x0, x1), y, y + 2 * r, d0 - r, d0 + r);
      else this.collider(x0 - r, x0 + r, y, y + 2 * r, Math.min(d0, d1), Math.max(d0, d1));
    }
  }

  private waterTank(x: number, d: number, y: number, r: number, h: number): void {
    const legH = 1.1;
    for (const [lx, ld] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = x + lx * r * 0.6;
      const pd = d + ld * r * 0.6;
      this.solid(px - 0.08, px + 0.08, y, y + legH, pd - 0.08, pd + 0.08, 'steel', null);
    }
    const geo = new THREE.CylinderGeometry(r, r, h, 24);
    this.b.geometry(geo, new THREE.Matrix4().makeTranslation(x, y + legH + h / 2, -d), 'metal');
    geo.dispose();
    const cap = new THREE.ConeGeometry(r * 1.03, 0.6, 24);
    this.b.geometry(cap, new THREE.Matrix4().makeTranslation(x, y + legH + h + 0.3, -d), 'white');
    cap.dispose();
    this.collider(x - r * 0.75, x + r * 0.75, y, y + legH + h, d - r * 0.75, d + r * 0.75);
  }

  /** Small stairwell structure with a red door facing +d (toward the route). */
  private stairHouse(x0: number, x1: number, d0: number, d1: number, y: number, h: number, doorFacesForward: boolean): void {
    this.solid(x0, x1, y, y + h, d0, d1, { top: 'concrete', side: 'white' });
    this.solid(x0 - 0.1, x1 + 0.1, y + h, y + h + 0.15, d0 - 0.1, d1 + 0.1, 'metal', null);
    const cx = (x0 + x1) / 2;
    const dd = doorFacesForward ? d1 : d0;
    const s = doorFacesForward ? 1 : -1;
    this.solid(cx - 0.65, cx + 0.65, y, y + 2.25, Math.min(dd, dd + 0.06 * s), Math.max(dd, dd + 0.06 * s), 'red', null);
    this.solid(cx - 0.8, cx + 0.8, y + 2.25, y + 2.4, Math.min(dd, dd + 0.1 * s), Math.max(dd, dd + 0.1 * s), 'white', null);
    // Door handle.
    this.solid(cx + 0.35, cx + 0.5, y + 1.0, y + 1.06, Math.min(dd, dd + 0.12 * s), Math.max(dd, dd + 0.12 * s), 'dark', null);
  }

  private antenna(x: number, d: number, y: number, h: number): void {
    this.solid(x - 0.05, x + 0.05, y, y + h, d - 0.05, d + 0.05, 'steel', null);
    this.solid(x - 0.12, x + 0.12, y + h, y + h + 0.25, d - 0.12, d + 0.12, 'redGlow', null);
  }

  /** Red platform on a slim steel column (floating stepping stone over a gap). */
  private redPlatform(x0: number, x1: number, d0: number, d1: number, top: number): void {
    this.solid(x0, x1, top - 0.4, top, d0, d1, { top: 'red', side: 'red' }, {}, false);
    const cx = (x0 + x1) / 2;
    const cd = (d0 + d1) / 2;
    this.solid(cx - 0.35, cx + 0.35, CITY_FLOOR, top - 0.4, cd - 0.35, cd + 0.35, 'steel', null);
    // Diagonal braces under the platform.
    for (const s of [-1, 1]) {
      const geo = new THREE.BoxGeometry(0.15, 2.2, 0.15);
      const m = new THREE.Matrix4()
        .makeTranslation(cx, top - 1.3, -cd)
        .multiply(new THREE.Matrix4().makeRotationX(0.55 * s))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, 0));
      this.b.geometry(geo, m, 'steel');
      geo.dispose();
    }
  }

  /** Red vertical panels on a building face used to signal a wall run. */
  private wallPanels(faceX: number, outward: number, d0: number, d1: number, y0: number, y1: number): void {
    const t = 0.05;
    const x0 = outward > 0 ? faceX : faceX - t;
    const x1 = outward > 0 ? faceX + t : faceX;
    for (let d = d0; d < d1 - 0.5; d += 3) {
      this.solid(x0, x1, y0, y1, d, Math.min(d + 2.7, d1), 'red', null);
    }
    // Long white guide stripe below the panels.
    this.solid(x0, x1, y0 - 0.35, y0 - 0.2, d0, d1, 'white', null);
  }

  private checkpoint(label: string, x0: number, x1: number, d: number, y: number, spawnX = 0): void {
    const index = this.checkpoints.length;
    this.checkpoints.push({
      index,
      label,
      spawn: new THREE.Vector3(spawnX, y + 0.01, -d),
      yaw: 0,
      zone: this.zone(x0, x1, y - 2, y + 6, d - 2.5, d + 1.5),
      marker: new THREE.Vector3(x0 + 0.9, y, -d),
    });
  }

  private hint(d0: number, d1: number, text: string, x0 = -20, x1 = 20): void {
    this.hints.push({ zone: this.zone(x0, x1, -20, 30, d0, d1), text });
  }

  private section(title: string, d0: number, d1: number): void {
    this.sections.push({ index: this.sections.length + 1, title, zone: this.zone(-30, 30, -40, 40, d0, d1) });
  }

  // ---------------------------------------------------------------------------
  // The course
  // ---------------------------------------------------------------------------

  private buildCourse(): void {
    // ===== Section 1 — Movement tutorial ======================================
    this.section('MOVEMENT TUTORIAL', -8, 47);
    this.building(-9, 9, -8, 46, 0);
    this.railing('x', -9, -8, 46, 0, 1);
    this.railing('x', 9, -8, 46, 0, -1);
    this.railing('d', -8, -9, 9, 0, 1);
    this.stairHouse(-3, 3, -7.4, -3.6, 0, 3.2, true);
    this.antenna(2.4, -6.8, 3.35, 4);
    this.checkpoint('START', -9, 9, 0, 0);
    this.checkpoints[0].zone = this.zone(0, 0, 0, 0, 0, 0); // start never re-triggers

    this.acUnit(-6.6, 4, 0, 2.2, 1.6, 1.3);
    this.acUnit(6.4, 6.5, 0, 1.6, 2.4, 1.1);
    this.grate(3.2, 5.6, 9.5, 11.5, 0);
    this.hint(-8, 9, 'WASD move  ·  MOUSE look  ·  hold SHIFT to sprint');

    // Low wall: jump it or vault it with E.
    this.vaultBox(-8.72, 8.72, 14, 15.2, 0, 0.8);
    this.hint(9, 15.6, 'Low wall — SPACE to jump it, or E to VAULT');

    // Duct: must slide.
    this.duct(-8.72, 8.72, 24, 25.2, 0, 1.0, 2.2);
    this.hint(17, 25.6, 'Duct ahead — sprint and press C or CTRL to SLIDE under');

    this.waterTank(-5.8, 33, 0, 1.3, 2.4);
    this.acUnit(6.2, 31, 0, 2.4, 1.8, 1.2);
    this.acUnit(6.2, 35, 0, 2.4, 1.8, 1.2);
    this.pipe(8.1, 8.1, 27, 44, 0, 0.16, true);
    this.grate(-3, -0.6, 38, 40, 0);
    this.redStrip(-8.72, 8.72, 45.4, 46, 0);
    this.flag(-8.4, 45.6, 0, -1);
    this.flag(8.4, 45.6, 0, 1);
    this.hint(34, 46.5, 'Sprint and JUMP the gap at the red line');

    // ===== Section 2 — Rooftop jumps ==========================================
    this.section('ROOFTOP JUMPS', 48, 120);
    this.building(-8, 8, 49, 66, 0, 'facadeWarm');
    this.railing('x', -8, 49, 66, 0, 1);
    this.railing('x', 8, 49, 66, 0, -1);
    this.checkpoint('ROOFTOP JUMPS', -8, 8, 52, 0);
    this.acUnit(-6, 58, 0, 2, 1.6, 1.2);
    this.stairHouse(4.5, 7.6, 56, 60, 0, 2.8, false);
    this.redStrip(-7.72, 7.72, 65.4, 66, 0);
    this.flag(7.3, 65.6, 0, 1);
    this.hint(49, 60, 'Hold SPACE for a higher jump  ·  keep SHIFT held for distance');

    this.building(-6, 6, 71, 82, -1.0);
    this.railing('x', -6, 71, 82, -1.0, 1);
    this.railing('x', 6, 71, 82, -1.0, -1);
    this.acUnit(4.2, 75, -1.0, 1.6, 2.2, 1.1);
    this.grate(-4.6, -2.4, 74, 76, -1.0);
    this.redStrip(-5.72, 5.72, 81.4, 82, -1.0);

    this.building(-7, 5, 88, 100, -1.8);
    this.railing('x', -7, 88, 100, -1.8, 1);
    this.railing('x', 5, 88, 100, -1.8, -1);
    this.acUnit(-5.2, 92, -1.8, 2, 1.6, 1.2);
    this.pipe(-6.4, -6.4, 89, 99, -1.8, 0.14, true);
    this.redStrip(-6.72, 4.72, 99.4, 100, -1.8);
    this.flag(-6.3, 99.6, -1.8, -1);
    this.hint(88, 100, 'Red platforms ahead — land and keep moving');

    this.redPlatform(-1.5, 1.5, 104, 109, -1.4);
    this.redPlatform(-1, 2, 113, 118, -1.0);
    this.hint(109, 121, 'Jump at the wall and hold W to CLIMB the ledge');

    // ===== Section 3 — Sliding challenge ======================================
    this.section('SLIDING CHALLENGE', 121, 150);
    this.building(-6, 6.6, 121, 160, 0.8);
    this.ledgeTrim(-6, 6.6, 121, 0.8);
    this.railing('x', -6, 121, 160, 0.8, 1);
    this.railing('x', 6.6, 121, 150.5, 0.8, -1);
    this.checkpoint('SLIDING CHALLENGE', -6, 6.6, 125, 0.8);
    this.duct(-5.72, 6.32, 130, 131.2, 0.8, 1.0, 2.2);
    this.duct(-5.72, 6.32, 137, 138.2, 0.8, 1.0, 2.2);
    this.duct(-5.72, 6.32, 141, 142.2, 0.8, 1.0, 2.2);
    this.duct(-5.72, 6.32, 147, 148.2, 0.8, 1.0, 2.2);
    this.acUnit(-4.6, 134, 0.8, 1.6, 1.6, 0.9);
    this.grate(3, 5.4, 144, 146, 0.8);
    this.hint(121, 133, 'Chain SLIDES under the ducts — tap C again as soon as you stand');

    // ===== Section 4 — Wall run ================================================
    this.section('WALL RUN', 150, 176);
    // The gap from d=160 to d=174 is far beyond a normal sprint jump (≈8 m).
    this.building(6.6, 15, 150, 182, 12, 'facade');
    this.wallPanels(6.6, -1, 151, 181.5, 0.6, 6.4);
    this.antenna(12, 170, 12, 6);
    this.redStrip(-5.72, 6.6, 159.4, 160, 0.8);
    // Runner-vision guide line leading along the wall.
    this.redStrip(5.55, 5.8, 147.5, 159.4, 0.8);
    this.hint(149, 160.5, 'Sprint along the RED WALL and jump — you will WALL RUN across');

    // ===== Section 5 — Parkour combination ====================================
    this.section('PARKOUR COMBINATION', 176, 282);
    this.building(-6, 6.6, 174, 204, 0.2, 'facadeWarm');
    this.railing('x', -6, 174, 204, 0.2, 1);
    this.railing('x', 6.6, 182.2, 204, 0.2, -1);
    this.checkpoint('PARKOUR COMBINATION', -6, 6.6, 180, 0.2);
    this.vaultBox(-5.72, 6.32, 188, 189, 0.2, 1.0);
    this.hint(181, 189, 'E to VAULT the barrier without losing speed');
    this.duct(-5.72, 6.32, 196, 197.2, 0.2, 1.0, 2.4);
    this.hint(190, 197.5, 'SLIDE!');
    this.redStrip(-5.72, 6.32, 203.4, 204, 0.2);
    this.flag(-5.4, 203.6, 0.2, -1);
    this.hint(198, 205, 'Sprint jump');

    this.building(-5, 5, 210, 222, -0.6);
    this.railing('x', -5, 210, 222, -0.6, 1);
    this.railing('x', 5, 210, 222, -0.6, -1);
    this.acUnit(3.4, 212.5, -0.6, 1.8, 1.4, 1.0);
    this.acUnit(3.4, 218, -0.6, 1.8, 1.4, 1.0);

    // Narrow beam bridge.
    this.solid(-3.6, -2.4, -1.1, -0.6, 222, 232, { top: 'white', side: 'red' }, {}, false);
    this.solid(-3.25, -2.75, -1.6, -1.1, 222, 232, 'steel', null, false);
    this.hint(214, 232, 'Narrow beam — line up and keep it steady');

    this.building(-7.6, 5, 232, 244, -0.6);
    this.railing('x', 5, 232, 244, -0.6, -1);
    this.building(-16, -7.6, 230, 262, 11, 'facadeWarm');
    this.wallPanels(-7.6, 1, 231, 261.5, 0.2, 5.6);
    this.antenna(-12, 240, 11, 5);
    this.redStrip(-7.6, 4.72, 243.4, 244, -0.6);
    this.redStrip(-6.8, -6.55, 234, 243.4, -0.6);
    this.hint(232, 244.5, 'Wall run on the LEFT — stay close to the red panels');

    this.building(-7.6, 4, 257, 270, -1.0);
    this.railing('x', 4, 257, 270, -1.0, -1);
    this.railing('x', -7.6, 262.2, 270, -1.0, 1);
    this.building(-7.6, 4, 270, 282, 1.0, 'facade');
    this.ledgeTrim(-7.6, 4, 270, 1.0);
    this.railing('x', -7.6, 270, 282, 1.0, 1);
    this.railing('x', 4, 270, 282, 1.0, -1);
    this.hint(257, 270, 'Jump at the wall and hold W to climb');
    this.checkpoint('FINAL SPRINT', -7.6, 4, 275, 1.0, -1.8);
    this.acUnit(-6, 279, 1.0, 1.6, 1.6, 1.0);
    this.redStrip(-7.32, 3.72, 281.4, 282, 1.0);

    // ===== Section 6 — Final sprint ===========================================
    this.section('FINAL SPRINT', 282, 357);
    this.building(-6, 6, 287, 298, 0.2);
    this.railing('x', -6, 287, 298, 0.2, 1);
    this.railing('x', 6, 287, 298, 0.2, -1);
    this.redStrip(-5.72, 5.72, 297.4, 298, 0.2);
    this.flag(5.4, 297.6, 0.2, 1);

    this.building(-5, 5, 304, 314, -0.6, 'facadeWarm');
    this.railing('x', -5, 304, 314, -0.6, 1);
    this.railing('x', 5, 304, 314, -0.6, -1);
    this.redStrip(-4.72, 4.72, 313.4, 314, -0.6);
    this.hint(282, 316, 'FINAL SPRINT — reach the red gate!');

    this.building(-9, 9, 319, 357, -1.2);
    this.railing('x', -9, 319, 357, -1.2, 1);
    this.railing('x', 9, 319, 357, -1.2, -1);
    this.railing('d', 357, -9, 9, -1.2, -1);
    this.stairHouse(-3, 3, 349, 354, -1.2, 3, false);
    this.acUnit(-6.5, 344, -1.2, 2, 2, 1.2);
    this.acUnit(6.5, 345, -1.2, 2, 2, 1.2);
    this.finishGate(334, -1.2);
  }

  private finishGate(d: number, y: number): void {
    const w = 4.2;
    for (const sx of [-1, 1]) {
      this.solid(sx * w - 0.35, sx * w + 0.35, y, y + 4.6, d - 0.35, d + 0.35, 'red', {});
    }
    this.solid(-w - 0.35, w + 0.35, y + 4.6, y + 5.4, d - 0.35, d + 0.35, 'red', {});
    this.solid(-w + 0.35, w - 0.35, y + 4.45, y + 4.6, d - 0.1, d + 0.1, 'redGlow', null);
    // Finish line across the roof.
    this.solid(-8.72, 8.72, y, y + 0.03, d - 0.4, d + 0.4, 'red', null);
    for (let x = -8.4; x < 8.6; x += 1.2) this.solid(x, x + 0.6, y + 0.03, y + 0.035, d - 0.4, d, 'white', null);
    this.finishZone = this.zone(-9, 9, y - 2, y + 8, d - 0.2, d + 3);
    this.finishMarker.set(0, y, -d);
  }
}
