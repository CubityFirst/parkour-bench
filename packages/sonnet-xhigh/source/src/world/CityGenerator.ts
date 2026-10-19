/**
 * CityGenerator - the endless-looking city around the playable rooftops.
 *
 * A jittered grid of blocks is generated outside the level's footprint. Buildings close to
 * the route stay below it (so you look *down* onto rooftops and streets), while the
 * skyline further out grows into glass skyscrapers. Everything is drawn with a few
 * InstancedMeshes (one draw call each) sharing the procedural arch / glass materials.
 */

import * as THREE from 'three';
import { type Footprint } from './LevelSpec';
import { HAZE_COLOR, type MaterialSet } from './Materials';

export const STREET_Y = -150;

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

const GLASS_TINTS = [0x8fb6d8, 0x7aa5cd, 0xa4c6de, 0x95b0c8, 0x6f98c0, 0xb6cfe2, 0x88a8c4, 0xc2d8e8];
const ARCH_TINTS = [0xf6f8fa, 0xecf0f4, 0xe2e8ee, 0xf3eee8, 0xdde4ea, 0xffffff];

interface Block {
  x: number;
  z: number;
  w: number;
  d: number;
  top: number;
  glass: boolean;
  tint: number;
  dist: number;
}

export class CityGenerator {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  /** Number of generated blocks (for diagnostics). */
  blockCount = 0;

  constructor(footprints: Footprint[], materials: MaterialSet, seed = 20240611) {
    this.group.name = 'city';
    const rand = mulberry32(seed);

    // Level bounds / reference heights
    const ref = this.routeSampler(footprints);

    const blocks: Block[] = [];
    const CELL = 46;
    const RADIUS = 1150;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of footprints) {
      minX = Math.min(minX, f.minX); maxX = Math.max(maxX, f.maxX);
      minZ = Math.min(minZ, f.minZ); maxZ = Math.max(maxZ, f.maxZ);
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const ixMin = Math.floor((centerX - RADIUS) / CELL), ixMax = Math.ceil((centerX + RADIUS) / CELL);
    const izMin = Math.floor((centerZ - RADIUS) / CELL), izMax = Math.ceil((centerZ + RADIUS) / CELL);
    for (let ix = ixMin; ix <= ixMax; ix++) {
      for (let iz = izMin; iz <= izMax; iz++) {
        const cx = ix * CELL;
        const cz = iz * CELL;
        const dx = cx - centerX;
        const dz = cz - centerZ;
        if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
        if (rand() < 0.07) continue; // plazas / gaps

        const w = 22 + rand() * 16;
        const d = 22 + rand() * 16;
        const x = cx + (rand() - 0.5) * 6;
        const z = cz + (rand() - 0.5) * 6;

        const dist = ref.distanceTo(x, z, Math.max(w, d) * 0.5);
        if (dist < 9) continue; // keep clear of the level itself

        const routeY = ref.heightNear(x, z);
        let top: number;
        const r = rand();
        if (dist < 22) {
          top = routeY - 20 - rand() * 36;
        } else if (dist < 60) {
          // Close neighbours stay below the route so the view along it is never walled in.
          top = routeY - 10 - rand() * 55;
        } else if (dist < 130) {
          top = routeY - 12 - rand() * 55;
          if (r > 0.84) top = routeY + 12 + rand() * 45; // occasional taller neighbour
        } else if (dist < 320) {
          top = routeY - 30 + Math.pow(rand(), 1.4) * 110;
        } else {
          top = routeY - 10 + Math.pow(rand(), 1.7) * 230;
        }
        const tall = top > routeY + 25;
        const glass = tall ? rand() < 0.72 : rand() < 0.28;
        const tint = glass
          ? GLASS_TINTS[Math.floor(rand() * GLASS_TINTS.length)]
          : ARCH_TINTS[Math.floor(rand() * ARCH_TINTS.length)];
        blocks.push({ x, z, w, d, top, glass, tint, dist });
      }
    }
    this.blockCount = blocks.length;

    // ---------------------------------------------------------------- instanced towers
    const unit = new THREE.BoxGeometry(1, 1, 1);
    unit.translate(0, 0.5, 0); // origin at the bottom centre
    this.disposables.push(unit);

    const buildInstanced = (list: Block[], material: THREE.Material, name: string): void => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(unit, material, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      list.forEach((b, i) => {
        m.compose(
          new THREE.Vector3(b.x, STREET_Y, b.z),
          q,
          new THREE.Vector3(b.w, b.top - STREET_Y, b.d),
        );
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.set(b.tint));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.disposables.push({ dispose: () => mesh.dispose() });
    };
    buildInstanced(blocks.filter((b) => b.glass), materials.glass, 'city-glass');
    buildInstanced(blocks.filter((b) => !b.glass), materials.archInst, 'city-arch');

    // ---------------------------------------------------------------- rooftop clutter
    const clutter: { x: number; y: number; z: number; w: number; h: number; d: number; c: number }[] = [];
    for (const b of blocks) {
      if (b.dist > 260 || b.glass) continue;
      const n = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const w = 1.5 + rand() * 3.5;
        const d = 1.5 + rand() * 3.5;
        const h = 0.8 + rand() * 2.2;
        clutter.push({
          x: b.x + (rand() - 0.5) * (b.w - w - 2),
          z: b.z + (rand() - 0.5) * (b.d - d - 2),
          y: b.top,
          w, h, d,
          c: rand() < 0.06 ? 0xe0231c : (rand() < 0.5 ? 0xe6eaee : 0xc4cbd3),
        });
      }
    }
    if (clutter.length > 0) {
      const cube = new THREE.BoxGeometry(1, 1, 1);
      cube.translate(0, 0.5, 0);
      const mesh = new THREE.InstancedMesh(cube, materials.archInst, clutter.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const col = new THREE.Color();
      clutter.forEach((c, i) => {
        m.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(c.w, c.h, c.d));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.set(c.c));
      });
      mesh.name = 'city-clutter';
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(cube, { dispose: () => mesh.dispose() });
    }

    // ---------------------------------------------------------------- red antenna masts
    // A few slender red masts on tall roofs echo the red of the route in the skyline.
    const masts = blocks.filter((b) => b.top > 20 && rand() < 0.2);
    if (masts.length > 0) {
      const mastGeo = new THREE.CylinderGeometry(1, 1.4, 1, 8, 1);
      mastGeo.translate(0, 0.5, 0);
      const mastMat = new THREE.MeshStandardMaterial({
        color: 0xe0231c, roughness: 0.5, emissive: new THREE.Color(0xff1408), emissiveIntensity: 0.12,
      });
      const mesh = new THREE.InstancedMesh(mastGeo, mastMat, masts.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      masts.forEach((b, i) => {
        const h = 14 + rand() * 30;
        const r = 0.35 + rand() * 0.45;
        m.compose(new THREE.Vector3(b.x + (rand() - 0.5) * b.w * 0.4, b.top, b.z + (rand() - 0.5) * b.d * 0.4), q, new THREE.Vector3(r, h, r));
        mesh.setMatrixAt(i, m);
      });
      mesh.name = 'city-masts';
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(mastGeo, mastMat, { dispose: () => mesh.dispose() });
    }

    // ---------------------------------------------------------------- street level haze
    const groundGeo = new THREE.PlaneGeometry(6000, 6000);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshBasicMaterial({ color: HAZE_COLOR.clone().multiplyScalar(0.8) });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, STREET_Y + 0.5, 0);
    this.group.add(ground);
    this.disposables.push(groundGeo, groundMat);
  }

  /** Helper that answers "how far / how high is the level near this point". */
  private routeSampler(fps: Footprint[]): {
    distanceTo(x: number, z: number, pad: number): number;
    heightNear(x: number, z: number): number;
  } {
    return {
      distanceTo(x, z, pad) {
        let best = Infinity;
        for (const f of fps) {
          const dx = Math.max(f.minX - x, 0, x - f.maxX);
          const dz = Math.max(f.minZ - z, 0, z - f.maxZ);
          best = Math.min(best, Math.hypot(dx, dz) - pad);
        }
        return best;
      },
      heightNear(x, z) {
        let best = Infinity;
        let y = 0;
        for (const f of fps) {
          const dx = Math.max(f.minX - x, 0, x - f.maxX);
          const dz = Math.max(f.minZ - z, 0, z - f.maxZ);
          const d = Math.hypot(dx, dz);
          if (d < best) { best = d; y = f.top; }
        }
        return y;
      },
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }
}
