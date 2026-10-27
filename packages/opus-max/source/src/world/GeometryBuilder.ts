import * as THREE from 'three';
import type { Vec3 } from './LevelData.ts';

/**
 * Accumulates many boxes and arbitrary geometries into a single BufferGeometry, so the
 * whole static city renders with one draw call per material.
 */
export class Batch {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** Adds a quad given 4 corners in counter-clockwise order (seen from the front). */
  quad(
    p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
    n: Vec3,
    uvs: readonly [number, number, number, number, number, number, number, number],
    shade: readonly [number, number, number, number] = [1, 1, 1, 1],
  ): void {
    const base = this.vertexCount;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(...uvs);
    for (const s of shade) this.col.push(s, s, s);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Appends an indexed or non-indexed geometry transformed by `matrix`. */
  geometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, shade = 1): void {
    const base = this.vertexCount;
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const t = geo.getAttribute('uv');
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      if (n) {
        v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
        this.nrm.push(v.x, v.y, v.z);
      } else {
        this.nrm.push(0, 1, 0);
      }
      if (t) this.uv.push(t.getX(i), t.getY(i));
      else this.uv.push(0, 0);
      this.col.push(shade, shade, shade);
    }
    const index = geo.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const count = this.vertexCount;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface BoxFaceOptions {
  sides?: boolean;
  top?: boolean;
  bottom?: boolean;
  /**
   * Side UVs: 'facade' maps metres with the facade pattern anchored to the box top
   * (so every building ends on a clean floor line); 'world' maps metres from the origin.
   */
  sideUv?: 'facade' | 'world';
  /** Darkening at the base of the sides (0 = none). A cheap contact shadow. */
  ao?: number;
}

/**
 * Emits the faces of an axis-aligned box. Sides and top can go to different batches
 * (facade vs roof material).
 */
export function addBox(min: Vec3, max: Vec3, sideBatch: Batch | null, topBatch: Batch | null, opts: BoxFaceOptions = {}, bottomBatch: Batch | null = sideBatch): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const sides = opts.sides ?? true;
  const top = opts.top ?? true;
  const bottom = opts.bottom ?? false;
  const facade = opts.sideUv === 'facade';
  const ao = opts.ao ?? 0;
  const h = y1 - y0;
  // AO only darkens the first ~0.6 m: with tall props the gradient stops partway up.
  const aoTop = ao > 0 ? 1 - ao * Math.max(0, 1 - h / 0.6) : 1;
  const shade: [number, number, number, number] = [1 - ao, 1 - ao, aoTop, aoTop];
  // v coordinate: facade patterns are anchored at the top edge.
  const vb = facade ? y0 - y1 : y0;
  const vt = facade ? 0 : y1;

  if (sides && sideBatch) {
    // +Z face (seen from +Z, u runs along +X)
    sideBatch.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], u4(facade ? 0 : x0, facade ? x1 - x0 : x1, vb, vt), shade);
    // -Z face (u runs along -X)
    sideBatch.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], u4(facade ? 0 : -x1, facade ? x1 - x0 : -x0, vb, vt), shade);
    // +X face (u runs along -Z)
    sideBatch.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], u4(facade ? 0 : -z1, facade ? z1 - z0 : -z0, vb, vt), shade);
    // -X face (u runs along +Z)
    sideBatch.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], u4(facade ? 0 : z0, facade ? z1 - z0 : z1, vb, vt), shade);
  }
  if (top && topBatch) {
    topBatch.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0, -z1, x1, -z1, x1, -z0, x0, -z0]);
  }
  if (bottom && bottomBatch) {
    bottomBatch.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0, z0, x1, z0, x1, z1, x0, z1], [0.85, 0.85, 0.85, 0.85]);
  }
}

function u4(u0: number, u1: number, v0: number, v1: number): [number, number, number, number, number, number, number, number] {
  return [u0, v0, u1, v0, u1, v1, u0, v1];
}

/** Matrix that maps a unit cylinder (height 1 along Y, centred) onto the segment a-b. */
export function segmentMatrix(a: Vec3, b: Vec3, radius: number): THREE.Matrix4 {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const mid = va.add(vb).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(radius, len, radius));
}
