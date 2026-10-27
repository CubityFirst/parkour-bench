import { BufferGeometry, Float32BufferAttribute, Mesh, type Material, type Object3D } from 'three';

interface Bucket {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  tileU: number;
  tileV: number;
}

/** Face definitions: normal, right and up axes (right x up = normal). */
const FACES = {
  px: { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] },
  nx: { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] },
  pz: { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
  nz: { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] },
  py: { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] },
  ny: { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] },
} as const;
type FaceKey = keyof typeof FACES;

export interface BoxMaterials {
  side: Material;
  top?: Material;
  bottom?: Material | null;
}

/**
 * Collects static boxes and merges them into one mesh per material, which keeps
 * the draw-call count tiny. UVs are generated in world space so tiling
 * textures (windows, concrete) line up across the whole city.
 */
export class GeometryBatcher {
  private buckets = new Map<Material, Bucket>();

  constructor(private tiles: Map<Material, [number, number]>) {}

  private bucket(m: Material): Bucket {
    let b = this.buckets.get(m);
    if (!b) {
      const t = this.tiles.get(m) ?? [1, 1];
      b = { positions: [], normals: [], uvs: [], indices: [], tileU: t[0], tileV: t[1] };
      this.buckets.set(m, b);
    }
    return b;
  }

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
    mats: BoxMaterials | Material, skip: FaceKey[] = []): void {
    const m: BoxMaterials = (mats as Material).isMaterial ? { side: mats as Material } : mats as BoxMaterials;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
    for (const key of Object.keys(FACES) as FaceKey[]) {
      if (skip.includes(key)) continue;
      let mat: Material | null | undefined = m.side;
      if (key === 'py') mat = m.top ?? m.side;
      if (key === 'ny') mat = m.bottom === undefined ? m.side : m.bottom;
      if (!mat) continue;
      const f = FACES[key];
      const b = this.bucket(mat);
      // half extents along r and u, offset along n
      const ext = (a: readonly number[]) => Math.abs(a[0]) * hx + Math.abs(a[1]) * hy + Math.abs(a[2]) * hz;
      const hr = ext(f.r), hu = ext(f.u), hn = ext(f.n);
      const ox = cx + f.n[0] * hn, oy = cy + f.n[1] * hn, oz = cz + f.n[2] * hn;
      const base = b.positions.length / 3;
      const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [sr, su] of corners) {
        const x = ox + f.r[0] * hr * sr + f.u[0] * hu * su;
        const y = oy + f.r[1] * hr * sr + f.u[1] * hu * su;
        const z = oz + f.r[2] * hr * sr + f.u[2] * hu * su;
        b.positions.push(x, y, z);
        b.normals.push(f.n[0], f.n[1], f.n[2]);
        const u = (x * f.r[0] + y * f.r[1] + z * f.r[2]) / b.tileU;
        const v = (x * f.u[0] + y * f.u[1] + z * f.u[2]) / b.tileV;
        b.uvs.push(u, v);
      }
      b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Build merged meshes and add them to the parent. */
  build(parent: Object3D, opts: { castShadow: boolean; receiveShadow: boolean }): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [mat, b] of this.buckets) {
      if (!b.indices.length) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(b.positions, 3));
      g.setAttribute('normal', new Float32BufferAttribute(b.normals, 3));
      g.setAttribute('uv', new Float32BufferAttribute(b.uvs, 2));
      g.setIndex(b.indices);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new Mesh(g, mat);
      mesh.castShadow = opts.castShadow;
      mesh.receiveShadow = opts.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
