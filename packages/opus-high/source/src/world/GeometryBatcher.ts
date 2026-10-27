import * as THREE from 'three';
import type { MaterialKey, Materials } from './Materials';

interface Bucket {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export interface BoxMaterials {
  top: MaterialKey;
  side: MaterialKey;
  bottom?: MaterialKey;
}

export interface BoxOptions {
  /** Skip the bottom face (most boxes sit on something). Default true. */
  skipBottom?: boolean;
  /** Bucket name suffix; e.g. background geometry is kept separate so it does not cast shadows. */
  layer?: string;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/**
 * Collects many boxes / primitives into a single merged mesh per material.
 * Boxes get world-space UVs so textures (windows, floor tiles) line up
 * seamlessly across every building regardless of its size.
 */
export class GeometryBatcher {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly materials: Materials) {}

  private bucket(key: MaterialKey, layer = ''): Bucket {
    const id = `${key}|${layer}`;
    let b = this.buckets.get(id);
    if (!b) {
      b = { positions: [], normals: [], uvs: [], indices: [] };
      this.buckets.set(id, b);
    }
    return b;
  }

  private quad(
    b: Bucket,
    p: number[][],
    n: [number, number, number],
    uv: number[][],
  ): void {
    const base = b.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      b.positions.push(p[i][0], p[i][1], p[i][2]);
      b.normals.push(n[0], n[1], n[2]);
      b.uvs.push(uv[i][0], uv[i][1]);
    }
    b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned box in world coordinates. */
  box(min: THREE.Vector3, max: THREE.Vector3, mats: BoxMaterials | MaterialKey, opts: BoxOptions = {}): void {
    const m: BoxMaterials = typeof mats === 'string' ? { top: mats, side: mats } : mats;
    const layer = opts.layer ?? '';
    const skipBottom = opts.skipBottom ?? true;
    const [x0, y0, z0] = [min.x, min.y, min.z];
    const [x1, y1, z1] = [max.x, max.y, max.z];

    const side = this.bucket(m.side, layer);
    const [su, sv] = this.materials.get(m.side).uvScale;
    // +X
    this.quad(side, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [
      [-z1 / su, y0 / sv], [-z0 / su, y0 / sv], [-z0 / su, y1 / sv], [-z1 / su, y1 / sv],
    ]);
    // -X
    this.quad(side, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [
      [z0 / su, y0 / sv], [z1 / su, y0 / sv], [z1 / su, y1 / sv], [z0 / su, y1 / sv],
    ]);
    // +Z
    this.quad(side, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [
      [x0 / su, y0 / sv], [x1 / su, y0 / sv], [x1 / su, y1 / sv], [x0 / su, y1 / sv],
    ]);
    // -Z
    this.quad(side, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [
      [-x1 / su, y0 / sv], [-x0 / su, y0 / sv], [-x0 / su, y1 / sv], [-x1 / su, y1 / sv],
    ]);

    const top = this.bucket(m.top, layer);
    const [tu, tv] = this.materials.get(m.top).uvScale;
    this.quad(top, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [
      [x0 / tu, -z1 / tv], [x1 / tu, -z1 / tv], [x1 / tu, -z0 / tv], [x0 / tu, -z0 / tv],
    ]);

    if (!skipBottom) {
      const bk = m.bottom ?? m.side;
      const bot = this.bucket(bk, layer);
      const [bu, bv] = this.materials.get(bk).uvScale;
      this.quad(bot, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [
        [x0 / bu, z0 / bv], [x1 / bu, z0 / bv], [x1 / bu, z1 / bv], [x0 / bu, z1 / bv],
      ]);
    }
  }

  /** Appends an arbitrary (indexed or not) geometry transformed by `matrix`. */
  geometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, key: MaterialKey, layer = ''): void {
    const b = this.bucket(key, layer);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const base = b.positions.length / 3;
    _nm.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      b.positions.push(_v.x, _v.y, _v.z);
      if (nor) {
        _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
        b.normals.push(_n.x, _n.y, _n.z);
      } else b.normals.push(0, 1, 0);
      if (uv) b.uvs.push(uv.getX(i), uv.getY(i));
      else b.uvs.push(0, 0);
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) b.indices.push(base + geo.index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) b.indices.push(base + i);
    }
  }

  /** Builds one mesh per material/layer bucket and adds them to `parent`. */
  build(parent: THREE.Object3D, shadowLayers: { cast: boolean; receive: boolean } | ((layer: string) => { cast: boolean; receive: boolean })): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [id, b] of this.buckets) {
      if (b.indices.length === 0) continue;
      const [key, layer] = id.split('|') as [MaterialKey, string];
      const entry = this.materials.get(key);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
      geo.setIndex(b.indices);
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, entry.material);
      const sh = typeof shadowLayers === 'function' ? shadowLayers(layer) : shadowLayers;
      mesh.castShadow = sh.cast && entry.castShadow;
      mesh.receiveShadow = sh.receive && entry.receiveShadow;
      mesh.name = `batch:${id}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
