import * as THREE from 'three';
import { FACADE_TILE, type MaterialKey, type MaterialSet } from './Materials';

/** Per-box visual options. */
export interface BoxStyle {
  /** Material for the four sides. */
  side: MaterialKey;
  /** Material for the top face (defaults to `side`). */
  top?: MaterialKey;
  /** Material for the bottom face (defaults to `side`). Use null to skip it. */
  bottom?: MaterialKey | null;
  /** Vertex shade at the bottom / top of the box (cheap ambient occlusion). */
  shadeBottom?: number;
  shadeTop?: number;
  /** Metres per texture repeat on sides: [horizontal, vertical]. */
  tile?: [number, number];
  /** Metres per repeat on top/bottom faces. */
  topTile?: number;
  /** Skip specific side faces: px, nx, pz, nz. */
  skip?: Partial<Record<'px' | 'nx' | 'pz' | 'nz' | 'top', boolean>>;
}

interface Bucket {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

/**
 * Accumulates static geometry per material and merges it into one mesh per
 * material, so the entire level renders in a handful of draw calls.
 * Boxes get world-scaled UVs, so textures tile consistently on every
 * building regardless of its size.
 */
export class MeshBatcher {
  private readonly buckets = new Map<MaterialKey, Bucket>();

  private bucket(key: MaterialKey): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Adds a quad. Corners are given counter-clockwise when viewed from the front. */
  private quad(
    key: MaterialKey,
    p: number[][],
    n: [number, number, number],
    uv: number[][],
    shade: number[],
  ): void {
    const b = this.bucket(key);
    const base = b.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      b.positions.push(p[i][0], p[i][1], p[i][2]);
      b.normals.push(n[0], n[1], n[2]);
      b.uvs.push(uv[i][0], uv[i][1]);
      b.colors.push(shade[i], shade[i], shade[i]);
    }
    b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, style: BoxStyle): void {
    const sideKey = style.side;
    const tile = style.tile ?? FACADE_TILE[sideKey] ?? [2, 2];
    const [tw, th] = tile;
    const topTile = style.topTile ?? 4;
    const sb = style.shadeBottom ?? 1;
    const st = style.shadeTop ?? 1;
    const skip = style.skip ?? {};
    const h = maxY - minY;
    // Facade V is measured down from the top so every building ends in the same band.
    const v0 = -h / th;
    const v1 = 0;

    // +X face (looking at it from +X: left = +Z, right = -Z)
    if (!skip.px) {
      const w = (maxZ - minZ) / tw;
      this.quad(
        sideKey,
        [
          [maxX, minY, maxZ],
          [maxX, minY, minZ],
          [maxX, maxY, minZ],
          [maxX, maxY, maxZ],
        ],
        [1, 0, 0],
        [
          [0, v0],
          [w, v0],
          [w, v1],
          [0, v1],
        ],
        [sb, sb, st, st],
      );
    }
    // -X face (left = -Z, right = +Z)
    if (!skip.nx) {
      const w = (maxZ - minZ) / tw;
      this.quad(
        sideKey,
        [
          [minX, minY, minZ],
          [minX, minY, maxZ],
          [minX, maxY, maxZ],
          [minX, maxY, minZ],
        ],
        [-1, 0, 0],
        [
          [0, v0],
          [w, v0],
          [w, v1],
          [0, v1],
        ],
        [sb, sb, st, st],
      );
    }
    // +Z face (left = -X, right = +X)
    if (!skip.pz) {
      const w = (maxX - minX) / tw;
      this.quad(
        sideKey,
        [
          [minX, minY, maxZ],
          [maxX, minY, maxZ],
          [maxX, maxY, maxZ],
          [minX, maxY, maxZ],
        ],
        [0, 0, 1],
        [
          [0, v0],
          [w, v0],
          [w, v1],
          [0, v1],
        ],
        [sb, sb, st, st],
      );
    }
    // -Z face (left = +X, right = -X)
    if (!skip.nz) {
      const w = (maxX - minX) / tw;
      this.quad(
        sideKey,
        [
          [maxX, minY, minZ],
          [minX, minY, minZ],
          [minX, maxY, minZ],
          [maxX, maxY, minZ],
        ],
        [0, 0, -1],
        [
          [0, v0],
          [w, v0],
          [w, v1],
          [0, v1],
        ],
        [sb, sb, st, st],
      );
    }
    // Top
    if (!skip.top) {
      const topKey = style.top ?? sideKey;
      const isFacade = FACADE_TILE[topKey] !== undefined;
      // Facade textures have a solid band at v≈0.95, so sample that on top faces.
      const uv = isFacade
        ? [
            [0.3, 0.985],
            [0.31, 0.985],
            [0.31, 0.995],
            [0.3, 0.995],
          ]
        : [
            [minX / topTile, -maxZ / topTile],
            [maxX / topTile, -maxZ / topTile],
            [maxX / topTile, -minZ / topTile],
            [minX / topTile, -minZ / topTile],
          ];
      this.quad(
        topKey,
        [
          [minX, maxY, maxZ],
          [maxX, maxY, maxZ],
          [maxX, maxY, minZ],
          [minX, maxY, minZ],
        ],
        [0, 1, 0],
        uv,
        [st, st, st, st],
      );
    }
    // Bottom
    if (style.bottom !== null) {
      const bottomKey = style.bottom ?? sideKey;
      this.quad(
        bottomKey,
        [
          [minX, minY, minZ],
          [maxX, minY, minZ],
          [maxX, minY, maxZ],
          [minX, minY, maxZ],
        ],
        [0, -1, 0],
        [
          [0.3, 0.985],
          [0.31, 0.985],
          [0.31, 0.995],
          [0.3, 0.995],
        ],
        [sb, sb, sb, sb],
      );
    }
  }

  /** Adds an arbitrary (indexed or not) geometry transformed by `matrix`. */
  geometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, key: MaterialKey, shade = 1): void {
    const b = this.bucket(key);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const base = b.positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      b.positions.push(v.x, v.y, v.z);
      if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      else n.set(0, 1, 0);
      b.normals.push(n.x, n.y, n.z);
      if (uv) b.uvs.push(uv.getX(i), uv.getY(i));
      else b.uvs.push(0, 0);
      b.colors.push(shade, shade, shade);
    }
    const index = geo.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) b.indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) b.indices.push(base + i);
    }
  }

  /** Builds one mesh per material. */
  build(materials: MaterialSet, options: { castShadow?: (k: MaterialKey) => boolean } = {}): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, b] of this.buckets) {
      if (b.indices.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
      const vertexCount = b.positions.length / 3;
      geo.setIndex(vertexCount > 65535 ? new THREE.Uint32BufferAttribute(b.indices, 1) : new THREE.Uint16BufferAttribute(b.indices, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.name = `batch:${key}`;
      mesh.castShadow = options.castShadow ? options.castShadow(key) : true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
