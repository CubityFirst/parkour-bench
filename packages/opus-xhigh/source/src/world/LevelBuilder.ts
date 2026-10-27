import * as THREE from 'three';
import type { ColliderTag, CollisionWorld } from './CollisionWorld';
import type { MaterialKey } from './Materials';
import type { BoxStyle, MeshBatcher } from './MeshBatcher';

/** Street level far below the rooftops. */
export const STREET_Y = -70;

/**
 * A local coordinate frame for laying out a stretch of the route.
 * `side` is metres to the right of the route, `fwd` metres along it.
 * Rotations are multiples of 90°, so boxes stay axis-aligned in the world.
 */
export interface Frame {
  ox: number;
  oz: number;
  /** World direction of +fwd. */
  fx: number;
  fz: number;
  /** World direction of +side. */
  rx: number;
  rz: number;
}

/** rot: 0 = route runs toward -Z, 1 = toward -X (turned left), 3 = toward +X (turned right). */
export function makeFrame(ox: number, oz: number, rot: 0 | 1 | 2 | 3): Frame {
  const fwd = [
    [0, -1],
    [-1, 0],
    [0, 1],
    [1, 0],
  ][rot];
  const right = [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ][rot];
  return { ox, oz, fx: fwd[0], fz: fwd[1], rx: right[0], rz: right[1] };
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RouteFootprint extends Rect {
  top: number;
}

export type Edge = 'back' | 'front' | 'left' | 'right';

export interface BuildingOptions {
  facade: MaterialKey;
  roof?: MaterialKey;
  /** Edges that get a low parapet wall (blocks accidental falls). */
  parapets?: Edge[];
  /** Edges marked with a red stripe: jump from here. */
  jumpEdges?: Edge[];
  /** Edges marked with a red lip: climb up here. */
  ledgeEdges?: Edge[];
  /** Skip the decorative cornice band. */
  noCornice?: boolean;
}

/**
 * Helper used by Level to create geometry and colliders together, working in
 * route-local coordinates.
 */
export class LevelBuilder {
  frame: Frame = makeFrame(0, 0, 0);
  readonly footprints: RouteFootprint[] = [];
  readonly extraMeshes: THREE.Object3D[] = [];

  constructor(
    readonly world: CollisionWorld,
    readonly batch: MeshBatcher,
  ) {}

  useFrame(frame: Frame): void {
    this.frame = frame;
  }

  /** Local (side, fwd) → world (x, z). */
  point(side: number, fwd: number): THREE.Vector2 {
    const f = this.frame;
    return new THREE.Vector2(f.ox + f.rx * side + f.fx * fwd, f.oz + f.rz * side + f.fz * fwd);
  }

  /** World position of a local point at height y. */
  vec3(side: number, fwd: number, y: number): THREE.Vector3 {
    const p = this.point(side, fwd);
    return new THREE.Vector3(p.x, y, p.y);
  }

  /** Yaw that looks along +fwd of the current frame. */
  get forwardYaw(): number {
    return Math.atan2(-this.frame.fx, -this.frame.fz);
  }

  rect(s0: number, s1: number, f0: number, f1: number): Rect {
    const a = this.point(s0, f0);
    const b = this.point(s1, f1);
    return {
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minZ: Math.min(a.y, b.y),
      maxZ: Math.max(a.y, b.y),
    };
  }

  /** Solid box: collider + visuals. */
  solid(s0: number, s1: number, f0: number, f1: number, y0: number, y1: number, style: BoxStyle | MaterialKey, tag: ColliderTag = 'solid'): void {
    const r = this.rect(s0, s1, f0, f1);
    this.world.add(r.minX, y0, r.minZ, r.maxX, y1, r.maxZ, tag);
    this.batch.box(r.minX, y0, r.minZ, r.maxX, y1, r.maxZ, typeof style === 'string' ? propStyle(style) : style);
  }

  /** Visual-only box (stripes, trims, decals). */
  deco(s0: number, s1: number, f0: number, f1: number, y0: number, y1: number, style: BoxStyle | MaterialKey): void {
    const r = this.rect(s0, s1, f0, f1);
    this.batch.box(r.minX, y0, r.minZ, r.maxX, y1, r.maxZ, typeof style === 'string' ? { side: style, bottom: null } : style);
  }

  /** Collider without visuals (only used where geometry is drawn some other way). */
  collider(s0: number, s1: number, f0: number, f1: number, y0: number, y1: number, tag: ColliderTag = 'solid'): void {
    const r = this.rect(s0, s1, f0, f1);
    this.world.add(r.minX, y0, r.minZ, r.maxX, y1, r.maxZ, tag);
  }

  /** A full building from the street up to a walkable roof. */
  building(s0: number, s1: number, f0: number, f1: number, top: number, opts: BuildingOptions): void {
    const r = this.rect(s0, s1, f0, f1);
    this.world.add(r.minX, STREET_Y, r.minZ, r.maxX, top, r.maxZ, 'roof');
    this.batch.box(r.minX, STREET_Y, r.minZ, r.maxX, top, r.maxZ, {
      side: opts.facade,
      top: opts.roof ?? 'roof',
      bottom: null,
      shadeBottom: 0.42,
      shadeTop: 1,
    });
    this.footprints.push({ ...r, top });

    // Cornice band just below the roof line gives facades a crisp top edge.
    if (!opts.noCornice) {
      const o = 0.14;
      this.batch.box(r.minX - o, top - 0.75, r.minZ - o, r.maxX + o, top - 0.12, r.maxZ + o, {
        side: 'white',
        shadeBottom: 0.85,
        tile: [2, 2],
      });
    }

    const t = 0.3;
    const ph = 0.55;
    for (const edge of opts.parapets ?? []) {
      const [a0, a1, b0, b1] = this.edgeStrip(s0, s1, f0, f1, edge, t);
      this.solid(a0, a1, b0, b1, top, top + ph, { side: 'white', top: 'concrete', shadeBottom: 0.8, bottom: null });
    }
    for (const edge of opts.jumpEdges ?? []) {
      const [a0, a1, b0, b1] = this.edgeStrip(s0, s1, f0, f1, edge, 0.45);
      this.deco(a0, a1, b0, b1, top, top + 0.025, 'red');
    }
    for (const edge of opts.ledgeEdges ?? []) {
      const [a0, a1, b0, b1] = this.edgeStrip(s0, s1, f0, f1, edge, 0.25);
      this.deco(a0, a1, b0, b1, top - 0.35, top + 0.02, 'red');
    }
  }

  /** Local rectangle of a strip along one edge of a rectangle (inside it). */
  edgeStrip(s0: number, s1: number, f0: number, f1: number, edge: Edge, width: number): [number, number, number, number] {
    switch (edge) {
      case 'back':
        return [s0, s1, f0, f0 + width];
      case 'front':
        return [s0, s1, f1 - width, f1];
      case 'left':
        return [s0, s0 + width, f0, f1];
      case 'right':
        return [s1 - width, s1, f0, f1];
    }
  }

  /** Low parapet along part of an edge. */
  parapet(s0: number, s1: number, f0: number, f1: number, top: number, height = 0.55): void {
    this.solid(s0, s1, f0, f1, top, top + height, { side: 'white', top: 'concrete', shadeBottom: 0.8, bottom: null });
  }

  /** Air-conditioning unit: a solid metal box with a fan grille on top. */
  acUnit(side: number, fwd: number, top: number, w = 1.4, d = 1.1, h = 1.05): void {
    this.solid(side - w / 2, side + w / 2, fwd - d / 2, fwd + d / 2, top, top + h, { side: 'metal', top: 'grate', shadeBottom: 0.6, bottom: null });
    const p = this.vec3(side, fwd, top + h);
    const fan = new THREE.CylinderGeometry(0.38, 0.38, 0.06, 16);
    this.batch.geometry(fan, new THREE.Matrix4().makeTranslation(p.x, p.y + 0.03, p.z), 'darkMetal', 0.8);
    // Small base plinth
    this.deco(side - w / 2 - 0.06, side + w / 2 + 0.06, fwd - d / 2 - 0.06, fwd + d / 2 + 0.06, top, top + 0.08, 'concrete');
  }

  /** Cluster of small vent pipes (decor + collider). */
  ventStack(side: number, fwd: number, top: number): void {
    const p = this.vec3(side, fwd, top);
    for (const [dx, dz, h, r] of [
      [0, 0, 0.9, 0.16],
      [0.45, 0.2, 0.6, 0.12],
      [-0.3, 0.35, 0.75, 0.1],
    ]) {
      const g = new THREE.CylinderGeometry(r, r, h, 12);
      this.batch.geometry(g, new THREE.Matrix4().makeTranslation(p.x + dx, top + h / 2, p.z + dz), 'metal', 0.9);
      const cap = new THREE.CylinderGeometry(r * 1.5, r * 1.5, 0.05, 12);
      this.batch.geometry(cap, new THREE.Matrix4().makeTranslation(p.x + dx, top + h + 0.08, p.z + dz), 'darkMetal');
    }
    this.collider(side - 0.45, side + 0.65, fwd - 0.45, fwd + 0.65, top, top + 0.9);
  }

  /** Rooftop access block with a red door facing -fwd or +fwd. */
  stairHouse(s0: number, s1: number, f0: number, f1: number, top: number, doorFacing: 'back' | 'front', height = 3.1): void {
    this.solid(s0, s1, f0, f1, top, top + height, { side: 'white', top: 'roofGray', shadeBottom: 0.75, bottom: null });
    // Roof overhang
    this.solid(s0 - 0.2, s1 + 0.2, f0 - 0.2, f1 + 0.2, top + height, top + height + 0.18, { side: 'white', top: 'roofGray', bottom: 'white' });
    const mid = (s0 + s1) / 2;
    if (doorFacing === 'back') {
      this.deco(mid - 0.6, mid + 0.6, f0 - 0.06, f0, top, top + 2.2, 'red');
      this.deco(mid - 0.75, mid + 0.75, f0 - 0.04, f0, top + 2.2, top + 2.32, 'white');
    } else {
      this.deco(mid - 0.6, mid + 0.6, f1, f1 + 0.06, top, top + 2.2, 'red');
      this.deco(mid - 0.75, mid + 0.75, f1, f1 + 0.04, top + 2.2, top + 2.32, 'white');
    }
  }

  /** Railing along a local line (fwd or side axis), with a single solid collider. */
  railing(s0: number, s1: number, f0: number, f1: number, top: number, height = 1.05): void {
    const alongFwd = Math.abs(f1 - f0) > Math.abs(s1 - s0);
    const len = alongFwd ? f1 - f0 : s1 - s0;
    const posts = Math.max(2, Math.round(len / 1.6) + 1);
    const cs = (s0 + s1) / 2;
    const cf = (f0 + f1) / 2;
    for (let i = 0; i < posts; i++) {
      const k = i / (posts - 1);
      const s = alongFwd ? cs : s0 + (s1 - s0) * k;
      const f = alongFwd ? f0 + (f1 - f0) * k : cf;
      this.deco(s - 0.04, s + 0.04, f - 0.04, f + 0.04, top, top + height, 'metal');
    }
    const rail = (y0: number, y1: number, w: number) => {
      if (alongFwd) this.deco(cs - w, cs + w, f0, f1, y0, y1, 'metal');
      else this.deco(s0, s1, cf - w, cf + w, y0, y1, 'metal');
    };
    rail(top + height - 0.06, top + height, 0.05);
    rail(top + height * 0.5 - 0.03, top + height * 0.5 + 0.03, 0.03);
    if (alongFwd) this.collider(cs - 0.06, cs + 0.06, f0, f1, top, top + height);
    else this.collider(s0, s1, cf - 0.06, cf + 0.06, top, top + height);
  }

  /** Cylinder pipe between two local points at heights (visual only). */
  pipe(s0: number, f0: number, y0: number, s1: number, f1: number, y1: number, radius: number, mat: MaterialKey = 'red'): void {
    const a = this.vec3(s0, f0, y0);
    const b = this.vec3(s1, f1, y1);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.batch.geometry(g, m, mat);
  }

  /**
   * A low ventilation bank spanning the route: the gap under it is only
   * slide-height, and it is too tall to climb over.
   */
  slideGate(s0: number, s1: number, f0: number, f1: number, top: number, clearance: number, height: number, variant: 'duct' | 'pipes'): void {
    const y0 = top + clearance;
    const y1 = top + height;
    // Legs at both ends
    this.solid(s0, s0 + 0.5, f0, f1, top, y0, { side: 'darkMetal', shadeBottom: 0.7, bottom: null });
    this.solid(s1 - 0.5, s1, f0, f1, top, y0, { side: 'darkMetal', shadeBottom: 0.7, bottom: null });
    this.collider(s0, s1, f0, f1, y0, y1);
    if (variant === 'duct') {
      this.deco(s0, s1, f0, f1, y0, y0 + 1.1, { side: 'metal', bottom: 'darkMetal', shadeBottom: 0.85, tile: [2, 2] });
      this.deco(s0, s1, f0 + 0.1, f1 - 0.1, y0 + 1.1, y1, { side: 'white', top: 'roofGray', bottom: null, shadeBottom: 0.9 });
      // Red guide stripe along the opening on both sides
      this.deco(s0 + 0.5, s1 - 0.5, f0 - 0.03, f0 + 0.02, y0, y0 + 0.14, 'red');
      this.deco(s0 + 0.5, s1 - 0.5, f1 - 0.02, f1 + 0.03, y0, y0 + 0.14, 'red');
    } else {
      // Bundle of red pipes with a white service housing above.
      const n = 3;
      for (let i = 0; i < n; i++) {
        const fwd = f0 + ((i + 0.5) / n) * (f1 - f0);
        this.pipe(s0, fwd, y0 + 0.3, s1, fwd, y0 + 0.3, 0.28, i === 1 ? 'metal' : 'red');
      }
      this.deco(s0, s1, f0, f1, y0 + 0.62, y1, { side: 'white', top: 'roofGray', bottom: 'darkMetal', shadeBottom: 0.9 });
    }
  }

  /** A low barrier to vault over: white body with a red top. */
  vaultBarrier(s0: number, s1: number, f0: number, f1: number, top: number, height = 0.95): void {
    this.solid(s0, s1, f0, f1, top, top + height - 0.12, { side: 'white', top: 'white', shadeBottom: 0.75, bottom: null }, 'vault');
    this.solid(s0 - 0.03, s1 + 0.03, f0 - 0.03, f1 + 0.03, top + height - 0.12, top + height, { side: 'red', bottom: 'red' }, 'vault');
  }

  /** Water tank on legs (decor with a box collider). */
  waterTank(side: number, fwd: number, top: number, radius = 1.6, height = 3): void {
    const p = this.vec3(side, fwd, top);
    const legH = 1.6;
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const s = side + dx * radius * 0.6;
      const f = fwd + dz * radius * 0.6;
      this.deco(s - 0.08, s + 0.08, f - 0.08, f + 0.08, top, top + legH, 'darkMetal');
    }
    const g = new THREE.CylinderGeometry(radius, radius, height, 24);
    this.batch.geometry(g, new THREE.Matrix4().makeTranslation(p.x, top + legH + height / 2, p.z), 'white', 0.95);
    const cone = new THREE.ConeGeometry(radius * 1.05, 0.7, 24);
    this.batch.geometry(cone, new THREE.Matrix4().makeTranslation(p.x, top + legH + height + 0.35, p.z), 'roofGray');
    this.collider(side - radius * 0.7, side + radius * 0.7, fwd - radius * 0.7, fwd + radius * 0.7, top, top + legH + height + 0.5);
  }

  /** Billboard frame with an image, facing +fwd or -fwd. */
  billboard(s0: number, s1: number, fwd: number, y0: number, y1: number, texture: THREE.Texture, facing: 'back' | 'front'): void {
    this.deco(s0, s1, fwd - 0.1, fwd + 0.1, y0, y1, { side: 'white', bottom: 'white' });
    const a = this.vec3(s0, fwd, y0);
    const b = this.vec3(s1, fwd, y1);
    const w = Math.hypot(b.x - a.x, b.z - a.z) - 0.4;
    const h = y1 - y0 - 0.4;
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.25 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const dir = facing === 'back' ? -1 : 1;
    const c = this.vec3((s0 + s1) / 2, fwd + dir * 0.115, (y0 + y1) / 2);
    plane.position.copy(c);
    plane.lookAt(c.x + this.frame.fx * dir, c.y, c.z + this.frame.fz * dir);
    plane.receiveShadow = true;
    this.extraMeshes.push(plane);
  }
}

/** Default style for solid props. */
export function propStyle(key: MaterialKey): BoxStyle {
  return { side: key, shadeBottom: 0.72, shadeTop: 1, bottom: null };
}
