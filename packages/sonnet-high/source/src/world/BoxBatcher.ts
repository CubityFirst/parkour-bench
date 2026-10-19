import * as THREE from 'three';

/**
 * Accumulates axis-aligned boxes into a single indexed BufferGeometry with per-vertex colours
 * (used for tint + baked ambient-occlusion gradient). One batcher per material keeps the whole
 * level to a handful of draw calls.
 */
export class BoxBatcher {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  private count = 0;

  get isEmpty(): boolean {
    return this.count === 0;
  }

  addBox(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    tint: [number, number, number],
    aoTop: number,
    aoBottom: number,
    skipBottom: boolean,
  ): void {
    const top: [number, number, number] = [tint[0] * aoTop, tint[1] * aoTop, tint[2] * aoTop];
    const bot: [number, number, number] = [tint[0] * aoBottom, tint[1] * aoBottom, tint[2] * aoBottom];

    // [normal, 4 verts (x,y,z), colour pick per vertex: 1 = top shade, 0 = bottom shade]
    const faces: Array<{ n: [number, number, number]; v: number[][]; c: number[] }> = [
      { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], c: [0, 0, 1, 1] },
      { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], c: [0, 0, 1, 1] },
      { n: [0, 1, 0], v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], c: [1, 1, 1, 1] },
      { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c: [0, 0, 1, 1] },
      { n: [0, 0, -1], v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], c: [0, 0, 1, 1] },
    ];
    if (!skipBottom) {
      faces.push({ n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c: [0, 0, 0, 0] });
    }
    for (const f of faces) {
      const base = this.count;
      for (let i = 0; i < 4; i++) {
        this.pos.push(f.v[i][0], f.v[i][1], f.v[i][2]);
        this.nor.push(f.n[0], f.n[1], f.n[2]);
        const c = f.c[i] ? top : bot;
        this.col.push(c[0], c[1], c[2]);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      this.count += 4;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
