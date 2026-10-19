import * as THREE from 'three';

/**
 * Accumulates axis-aligned boxes into one BufferGeometry (positions, normals, UVs,
 * vertex colours). The whole level collapses into a handful of draw calls.
 * UVs are in "tiles": one tile = tileSize metres, so textures keep a constant scale.
 */
export class MeshBatch {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];

  private quad(
    p0: number[], p1: number[], p2: number[], p3: number[],
    n: number[], tile: number, tint: number[],
  ): void {
    const u = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / tile;
    const v = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]) / tile;
    const quad = [p0, p1, p2, p0, p2, p3];
    const uvs = [[0, 0], [u, 0], [u, v], [0, 0], [u, v], [0, v]];
    for (let i = 0; i < 6; i++) {
      this.pos.push(quad[i][0], quad[i][1], quad[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(tint[0], tint[1], tint[2]);
    }
  }

  addBox(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    o: { top?: boolean; sides?: boolean; bottom?: boolean; tile?: number; tint?: number[] } = {},
  ): void {
    const tile = o.tile ?? 6;
    const tint = o.tint ?? [1, 1, 1];
    if (o.top !== false) {
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], tile, tint);
    }
    if (o.bottom) {
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], tile, tint);
    }
    if (o.sides !== false) {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], tile, tint);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], tile, tint);
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], tile, tint);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], tile, tint);
    }
  }

  get empty(): boolean { return this.pos.length === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
