import * as THREE from 'three';
import type { FacadeParams, V3 } from './LevelBuilder.ts';

/**
 * Accumulates boxes / cylinders into one interleaved-free BufferGeometry so a whole section of the level
 * costs a single draw call per material. Vertices are stored in world space.
 */
export class MeshBucket {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly facade: number[] = [];
  private readonly flagAttr: number[] = [];
  private readonly indices: number[] = [];
  private count = 0;

  get vertexCount(): number {
    return this.count;
  }

  /** Axis-aligned box. `facade` is only written when the bucket is used with the building material. */
  addBox(min: V3, max: V3, facade: FacadeParams | null): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    // 6 faces: normal, then 4 corners (counter-clockwise seen from outside).
    const faces: Array<[number, number, number, number[][]]> = [
      [1, 0, 0, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [-1, 0, 0, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [0, 1, 0, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [0, -1, 0, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [0, 0, 1, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [0, 0, -1, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [nx, ny, nz, corners] of faces) {
      const base = this.count;
      for (const c of corners) {
        this.positions.push(c[0]!, c[1]!, c[2]!);
        this.normals.push(nx, ny, nz);
        this.pushFacade(facade, max[1]);
        this.flagAttr.push(0, 0);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      this.count += 4;
    }
  }

  /** Append an arbitrary indexed geometry already positioned in world space. */
  addGeometry(geo: THREE.BufferGeometry, facade: FacadeParams | null, flag?: Float32Array): void {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.getIndex();
    const base = this.count;
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
    for (let i = 0; i < pos.count; i++) {
      this.positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      this.pushFacade(facade, top);
      if (flag) this.flagAttr.push(flag[i * 2]!, flag[i * 2 + 1]!);
      else this.flagAttr.push(0, 0);
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) this.indices.push(base + idx.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) this.indices.push(base + i);
    }
    this.count += pos.count;
  }

  private pushFacade(f: FacadeParams | null, top: number): void {
    if (f) {
      this.colors.push(f.tint[0], f.tint[1], f.tint[2]);
      this.facade.push(f.style, top, f.seed, f.accent);
    } else {
      this.colors.push(1, 1, 1);
      this.facade.push(3, top, 0.5, 0);
    }
  }

  build(opts: { facade: boolean; flag?: boolean }): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    if (opts.facade) {
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
      g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.facade, 4));
    }
    if (opts.flag) g.setAttribute('aFlag', new THREE.Float32BufferAttribute(this.flagAttr, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Cylinder with its axis along x / y / z, centred at (cx, cy, cz), returned in world space. */
export function makeCylinder(
  axis: 'x' | 'y' | 'z',
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  radiusTop: number,
  length: number,
  segments: number,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radiusTop, radius, length, segments, 1, false);
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  else if (axis === 'z') geo.rotateX(Math.PI / 2);
  geo.translate(cx, cy, cz);
  return geo;
}

const barUp = new THREE.Vector3(0, 1, 0);
const barDir = new THREE.Vector3();
const barQuat = new THREE.Quaternion();
const barMat = new THREE.Matrix4();

/** Square-section bar from `a` to `b`, in world space. */
export function makeBar(a: V3, b: V3, thickness: number): THREE.BufferGeometry {
  barDir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = barDir.length();
  barDir.multiplyScalar(1 / Math.max(len, 1e-6));
  barQuat.setFromUnitVectors(barUp, barDir);
  barMat.compose(
    new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
    barQuat,
    new THREE.Vector3(thickness, len, thickness),
  );
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.applyMatrix4(barMat);
  return geo;
}
