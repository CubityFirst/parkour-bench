import * as THREE from 'three';
import { GeometryBatcher } from './GeometryBatcher';
import { CITY_FLOOR, type Footprint } from './Level';
import type { MaterialKey, Materials } from './Materials';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LANDMARKS: Array<[number, number, number, number, number]> = [
  [46, 86, -480, -440, 230],
  [-130, -90, -570, -530, 280],
  [150, 180, -390, -360, 170],
  [-78, -52, -160, -134, 95],
  [60, 84, -46, -22, 120],
];

interface RouteSpan {
  /** World z range of the route (z = -distance). */
  zMin: number;
  zMax: number;
  halfWidth: number;
}

/**
 * Procedural background skyline. Buildings are merged into a handful of draw
 * calls (one per material) and rooftop clutter uses instanced meshes.
 * Nothing here has collision: it is scenery outside the playable route.
 */
export class CityGenerator {
  readonly group = new THREE.Group();
  private readonly rnd = mulberry32(1337);
  private readonly acMatrices: THREE.Matrix4[] = [];
  private readonly mastMatrices: THREE.Matrix4[] = [];
  private readonly beaconMatrices: THREE.Matrix4[] = [];
  /** Landmark footprints the regular lots must avoid. */
  private readonly reserved: Footprint[] = [];

  constructor(
    private readonly materials: Materials,
    private readonly footprints: Footprint[],
    private readonly route: RouteSpan = { zMin: -360, zMax: 10, halfWidth: 11 },
  ) {
    this.group.name = 'city';
    const b = new GeometryBatcher(materials);
    this.generate(b);
    b.build(this.group, { cast: false, receive: true });
    this.buildInstances();
    this.buildGround();
  }

  /** Distance from a point (world XZ) to the playable corridor. */
  private routeDistance(x: number, z: number): number {
    const r = this.route;
    const dz = z < r.zMin ? r.zMin - z : z > r.zMax ? z - r.zMax : 0;
    const dx = Math.max(0, Math.abs(x) - r.halfWidth);
    return Math.hypot(dx, dz);
  }

  private overlapsRoute(x0: number, x1: number, z0: number, z1: number, margin: number): boolean {
    for (const f of this.footprints) {
      if (x1 > f.minX - margin && x0 < f.maxX + margin && z1 > f.minZ - margin && z0 < f.maxZ + margin) return true;
    }
    return false;
  }

  private generate(b: GeometryBatcher): void {
    const rnd = this.rnd;
    // A few landmark towers give the skyline a silhouette and the finish a goal.
    for (const [x0, x1, z0, z1, top] of LANDMARKS) {
      this.tower(b, x0, x1, z0, z1, top, 'glass');
      this.reserved.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
    }
    const pitch = 48;
    const street = 14;
    for (let gx = -14; gx <= 14; gx++) {
      for (let gz = -22; gz <= 9; gz++) {
        const bx = gx * pitch;
        const bz = gz * pitch;
        // Each city block is split into 1–4 lots.
        const splitX = rnd() < 0.55 ? 2 : 1;
        const splitZ = rnd() < 0.55 ? 2 : 1;
        const blockW = pitch - street;
        for (let ix = 0; ix < splitX; ix++) {
          for (let iz = 0; iz < splitZ; iz++) {
            const lw = blockW / splitX;
            const ld = blockW / splitZ;
            const inset = 0.8 + rnd() * 2.5;
            const x0 = bx - blockW / 2 + ix * lw + inset;
            const x1 = x0 + lw - inset * 2;
            const z0 = bz - blockW / 2 + iz * ld + inset;
            const z1 = z0 + ld - inset * 2;
            if (x1 - x0 < 6 || z1 - z0 < 6) continue;
            this.lot(b, x0, x1, z0, z1);
          }
        }
      }
    }
  }

  private lot(b: GeometryBatcher, x0: number, x1: number, z0: number, z1: number): void {
    const rnd = this.rnd;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const dist = this.routeDistance(cx, cz);
    for (const f of this.reserved) {
      if (x1 > f.minX - 4 && x0 < f.maxX + 4 && z1 > f.minZ - 4 && z0 < f.maxZ + 4) return;
    }

    if (this.overlapsRoute(x0, x1, z0, z1, 8)) {
      // Lots right beside the route become low buildings far below the rooftops,
      // which reads as depth when looking down between jumps.
      if (this.overlapsRoute(x0, x1, z0, z1, 1)) return;
      this.tower(b, x0, x1, z0, z1, -30 - rnd() * 30, rnd() < 0.5 ? 'facade' : 'facadeWarm');
      return;
    }

    let top: number;
    const r = rnd();
    if (dist < 22) top = -24 - rnd() * 40;
    else if (dist < 90) top = r < 0.6 ? -20 - rnd() * 35 : 6 + rnd() * 40;
    else if (dist < 260) top = r < 0.3 ? -12 - rnd() * 25 : r < 0.8 ? 8 + rnd() * 50 : 60 + rnd() * 80;
    else top = r < 0.2 ? 0 + rnd() * 30 : r < 0.7 ? 30 + rnd() * 70 : 90 + rnd() * 130;

    const tall = top > 55;
    const style: MaterialKey = tall ? (rnd() < 0.65 ? 'glass' : 'facade') : rnd() < 0.18 ? 'glass' : rnd() < 0.5 ? 'facade' : 'facadeWarm';
    this.tower(b, x0, x1, z0, z1, top, style);
  }

  private tower(b: GeometryBatcher, x0: number, x1: number, z0: number, z1: number, top: number, style: MaterialKey): void {
    const rnd = this.rnd;
    b.box(new THREE.Vector3(x0, CITY_FLOOR, z0), new THREE.Vector3(x1, top, z1), { top: 'roof', side: style });

    // Cornice / roof rim.
    b.box(new THREE.Vector3(x0 - 0.2, top - 0.6, z0 - 0.2), new THREE.Vector3(x1 + 0.2, top + 0.4, z1 + 0.2), 'white', { skipBottom: false });

    // Stepped crown on tall towers.
    const w = x1 - x0;
    const d = z1 - z0;
    let roof = top;
    if (top > 40 && rnd() < 0.6) {
      const k = 0.18 + rnd() * 0.12;
      const h = 4 + rnd() * 10;
      b.box(new THREE.Vector3(x0 + w * k, top, z0 + d * k), new THREE.Vector3(x1 - w * k, top + h, z1 - d * k), { top: 'roof', side: style });
      roof = top + h;
      if (rnd() < 0.5) {
        const mh = 8 + rnd() * 25;
        this.mastMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3((x0 + x1) / 2, roof + mh / 2, (z0 + z1) / 2),
          new THREE.Quaternion(),
          new THREE.Vector3(1, mh, 1),
        ));
        this.beaconMatrices.push(new THREE.Matrix4().makeTranslation((x0 + x1) / 2, roof + mh, (z0 + z1) / 2));
      }
    }

    // Orange / red accent band (billboards and painted floors).
    if (rnd() < 0.12 && top > -10) {
      const y = top - 3.6 * (1 + Math.floor(rnd() * 3));
      const key: MaterialKey = rnd() < 0.6 ? 'orange' : 'red';
      b.box(new THREE.Vector3(x0 - 0.15, y - 1.6, z0 - 0.15), new THREE.Vector3(x1 + 0.15, y, z1 + 0.15), key, { skipBottom: false });
    }

    // Rooftop AC units (instanced).
    if (top < 60) {
      const n = Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const sx = 1.5 + rnd() * 2.5;
        const sy = 1 + rnd() * 1.5;
        const sz = 1.5 + rnd() * 2.5;
        const px = x0 + 2 + rnd() * Math.max(0.1, w - 4);
        const pz = z0 + 2 + rnd() * Math.max(0.1, d - 4);
        this.acMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(px, top + sy / 2, pz),
          new THREE.Quaternion(),
          new THREE.Vector3(sx, sy, sz),
        ));
      }
    }
  }

  private buildInstances(): void {
    const make = (geo: THREE.BufferGeometry, key: MaterialKey, mats: THREE.Matrix4[]) => {
      if (mats.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, this.materials.get(key).material, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    make(new THREE.BoxGeometry(1, 1, 1), 'metal', this.acMatrices);
    make(new THREE.CylinderGeometry(0.25, 0.4, 1, 6), 'steel', this.mastMatrices);
    make(new THREE.SphereGeometry(0.7, 8, 6), 'redGlow', this.beaconMatrices);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.materials.get('ground').material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = CITY_FLOOR;
    this.group.add(ground);
  }
}
