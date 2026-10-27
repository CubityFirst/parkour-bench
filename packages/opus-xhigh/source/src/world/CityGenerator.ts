import * as THREE from 'three';
import type { CollisionWorld } from './CollisionWorld';
import { STREET_Y, type RouteFootprint } from './LevelBuilder';
import { rng, type MaterialKey, type MaterialSet } from './Materials';
import type { MeshBatcher } from './MeshBatcher';

/**
 * Procedural background city: city blocks of white offices and glass towers
 * around the route, instanced rooftop clutter, a distant skyline ring, red
 * radio towers as landmarks and the street far below.
 *
 * Buildings close to the route are kept either well below it (so falling is
 * always a fall) or far above it, and never closer than a few metres, so
 * the background can never interfere with the designed route.
 */
export function generateCity(
  world: CollisionWorld,
  batch: MeshBatcher,
  materials: MaterialSet,
  route: RouteFootprint[],
): THREE.Object3D[] {
  const rand = rng(1337);
  const objects: THREE.Object3D[] = [];

  const routeBounds = route.reduce(
    (acc, r) => ({
      minX: Math.min(acc.minX, r.minX),
      maxX: Math.max(acc.maxX, r.maxX),
      minZ: Math.min(acc.minZ, r.minZ),
      maxZ: Math.max(acc.maxZ, r.maxZ),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  const center = new THREE.Vector2((routeBounds.minX + routeBounds.maxX) / 2, (routeBounds.minZ + routeBounds.maxZ) / 2);

  const routeDistance = (minX: number, maxX: number, minZ: number, maxZ: number): number => {
    let best = Infinity;
    for (const r of route) {
      const dx = Math.max(r.minX - maxX, 0, minX - r.maxX);
      const dz = Math.max(r.minZ - maxZ, 0, minZ - r.maxZ);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  };

  const acMatrices: THREE.Matrix4[] = [];
  const tankMatrices: THREE.Matrix4[] = [];
  const mastMatrices: THREE.Matrix4[] = [];
  const m4 = () => new THREE.Matrix4();

  const pickFacade = (tall: boolean): MaterialKey => {
    const r = rand();
    if (tall) return r < 0.5 ? 'glassBlue' : r < 0.68 ? 'glassTeal' : r < 0.86 ? 'officeWhite' : 'officeGrid';
    return r < 0.46 ? 'officeWhite' : r < 0.71 ? 'officeGrid' : r < 0.86 ? 'officeWarm' : r < 0.96 ? 'glassBlue' : 'glassTeal';
  };

  // Red lattice radio towers stand on their own buildings; keep the city away from them.
  const towers: [number, number, number, number][] = [
    [-228, 18, -318, 78],
    [96, 8, -140, 64],
    [-70, 24, -470, 90],
  ];
  const nearTower = (minX: number, maxX: number, minZ: number, maxZ: number): boolean =>
    towers.some(([x, , z]) => maxX > x - 13 && minX < x + 13 && maxZ > z - 13 && minZ < z + 13);

  const BLOCK = 46;
  const STREET = 13;
  for (let bx = -620; bx < 460; bx += BLOCK) {
    for (let bz = -880; bz < 330; bz += BLOCK) {
      const lotX0 = bx + STREET / 2;
      const lotZ0 = bz + STREET / 2;
      const lot = BLOCK - STREET;
      // Split the lot into 1–4 buildings.
      const split = rand();
      const parts: [number, number, number, number][] = [];
      if (split < 0.35) parts.push([0, lot, 0, lot]);
      else if (split < 0.65) {
        const k = lot * (0.4 + rand() * 0.2);
        parts.push([0, k - 1, 0, lot], [k + 1, lot, 0, lot]);
      } else {
        const kx = lot * (0.4 + rand() * 0.2);
        const kz = lot * (0.4 + rand() * 0.2);
        parts.push([0, kx - 1, 0, kz - 1], [kx + 1, lot, 0, kz - 1], [0, kx - 1, kz + 1, lot], [kx + 1, lot, kz + 1, lot]);
      }
      for (const [a0, a1, c0, c1] of parts) {
        const inset = rand() * 1.5;
        const minX = lotX0 + a0 + inset;
        const maxX = lotX0 + a1 - inset;
        const minZ = lotZ0 + c0 + inset;
        const maxZ = lotZ0 + c1 - inset;
        if (maxX - minX < 6 || maxZ - minZ < 6) continue;

        const d = routeDistance(minX, maxX, minZ, maxZ);
        if (d < 7) continue; // keep the route's gaps and edges clear
        if (nearTower(minX, maxX, minZ, maxZ)) continue;

        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const far = Math.hypot(cx - center.x, cz - center.y);
        // Mirror's-Edge-style composition: mostly white mid-rises around and
        // below the route, glass skyscrapers further out.
        let top: number;
        let tall = false;
        const r = rand();
        if (d < 34) {
          if (d > 16 && r < 0.1) {
            top = 24 + rand() * 30;
            tall = true;
          } else top = -46 + rand() * 18;
        } else if (far < 260) {
          if (r < 0.55) top = -40 + rand() * 34;
          else if (r < 0.9) top = -6 + rand() * 30;
          else {
            top = 40 + rand() * 80;
            tall = true;
          }
        } else {
          if (r < 0.34) top = -30 + rand() * 30;
          else if (r < 0.78) top = rand() * 40;
          else {
            top = 55 + rand() * 160;
            tall = true;
          }
        }
        const facade = pickFacade(tall);
        batch.box(minX, STREET_Y, minZ, maxX, top, maxZ, {
          side: facade,
          top: rand() < 0.5 ? 'roof' : 'roofGray',
          bottom: null,
          shadeBottom: 0.4,
          shadeTop: 1,
        });
        if (d < 70) world.add(minX, STREET_Y, minZ, maxX, top, maxZ, 'background');

        // Set-back crown on some tall towers.
        if (tall && rand() < 0.5) {
          const s = 0.18 + rand() * 0.12;
          const w = maxX - minX;
          const dd = maxZ - minZ;
          const h2 = 6 + rand() * 18;
          batch.box(minX + w * s, top, minZ + dd * s, maxX - w * s, top + h2, maxZ - dd * s, {
            side: facade,
            top: 'roofGray',
            bottom: null,
          });
          if (rand() < 0.6) mastMatrices.push(m4().compose(new THREE.Vector3(cx, top + h2 + 8, cz), new THREE.Quaternion(), new THREE.Vector3(0.5, 16, 0.5)));
          top += h2;
        } else {
          // Cornice
          batch.box(minX - 0.15, top - 0.7, minZ - 0.15, maxX + 0.15, top - 0.1, maxZ + 0.15, { side: 'white', bottom: 'white', tile: [2, 2] });
        }

        // Rooftop clutter for buildings you can see from above.
        if (top < 70) {
          const count = 1 + Math.floor(rand() * 4);
          for (let i = 0; i < count; i++) {
            const sx = 1.2 + rand() * 1.6;
            const sz = 1.0 + rand() * 1.4;
            const sy = 0.8 + rand() * 0.9;
            const px = minX + 2 + rand() * (maxX - minX - 4);
            const pz = minZ + 2 + rand() * (maxZ - minZ - 4);
            acMatrices.push(m4().compose(new THREE.Vector3(px, top + sy / 2, pz), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
          }
          if (rand() < 0.22) {
            const px = minX + 3 + rand() * (maxX - minX - 6);
            const pz = minZ + 3 + rand() * (maxZ - minZ - 6);
            tankMatrices.push(m4().compose(new THREE.Vector3(px, top + 2.6, pz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
          }
        }
      }
    }
  }

  // Distant skyline ring — big simple towers that read as silhouettes through the haze.
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + rand() * 0.05;
    const r = 820 + rand() * 420;
    const cx = center.x + Math.cos(a) * r;
    const cz = center.y + Math.sin(a) * r;
    const w = 30 + rand() * 45;
    const dd = 30 + rand() * 45;
    const h = 40 + rand() * 260;
    batch.box(cx - w / 2, STREET_Y, cz - dd / 2, cx + w / 2, h, cz + dd / 2, {
      side: rand() < 0.5 ? 'skyline' : 'glassBlue',
      top: 'roofGray',
      bottom: null,
      tile: [6, 4],
    });
  }

  // Red lattice radio towers as landmarks, each on its own white base building.
  for (const [x, top, z, height] of towers) {
    redTower(batch, x, top, z, height);
    batch.box(x - 9, STREET_Y, z - 9, x + 9, top, z + 9, { side: 'officeWhite', top: 'roofGray', bottom: null, shadeBottom: 0.4 });
  }

  // Instanced rooftop clutter.
  const addInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], cast: boolean) => {
    if (matrices.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    objects.push(mesh);
  };
  addInstanced(withShade(new THREE.BoxGeometry(1, 1, 1), 0.75), materials.metal, acMatrices, false);
  addInstanced(withShade(new THREE.CylinderGeometry(1.4, 1.4, 3, 16), 0.95), materials.white, tankMatrices, false);
  addInstanced(withShade(new THREE.BoxGeometry(1, 1, 1), 1), materials.darkMetal, mastMatrices, false);

  // Street plane far below.
  const streetSize = 5000;
  const streetGeo = new THREE.PlaneGeometry(streetSize, streetSize).rotateX(-Math.PI / 2);
  const uv = streetGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (streetSize / BLOCK), uv.getY(i) * (streetSize / BLOCK));
  const street = new THREE.Mesh(withShade(streetGeo, 1), materials.street);
  street.position.set(0, STREET_Y, 0);
  street.receiveShadow = false;
  objects.push(street);

  return objects;
}

/** Adds a constant vertex colour so geometry works with vertexColors materials. */
function withShade(geo: THREE.BufferGeometry, shade: number): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  const colors = new Float32Array(n * 3).fill(shade);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Tapered red lattice tower built from boxes. */
function redTower(batch: MeshBatcher, x: number, baseY: number, z: number, height: number): void {
  const levels = Math.floor(height / 6);
  const halfBase = 3.2;
  const halfTop = 0.9;
  const leg = 0.35;
  for (let i = 0; i < levels; i++) {
    const t0 = i / levels;
    const t1 = (i + 1) / levels;
    const y0 = baseY + t0 * height;
    const y1 = baseY + t1 * height;
    const h0 = halfBase + (halfTop - halfBase) * t0;
    const h1 = halfBase + (halfTop - halfBase) * t1;
    const hm = (h0 + h1) / 2;
    // Four legs (stepped to approximate the taper).
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const cx = x + sx * hm;
      const cz = z + sz * hm;
      batch.box(cx - leg, y0, cz - leg, cx + leg, y1, cz + leg, { side: 'red', bottom: null, shadeBottom: 0.85 });
    }
    // Horizontal ring at the top of each segment.
    const r = h1;
    batch.box(x - r, y1 - 0.25, z - r - 0.2, x + r, y1, z - r + 0.2, { side: 'red', bottom: 'red' });
    batch.box(x - r, y1 - 0.25, z + r - 0.2, x + r, y1, z + r + 0.2, { side: 'red', bottom: 'red' });
    batch.box(x - r - 0.2, y1 - 0.25, z - r, x - r + 0.2, y1, z + r, { side: 'red', bottom: 'red' });
    batch.box(x + r - 0.2, y1 - 0.25, z - r, x + r + 0.2, y1, z + r, { side: 'red', bottom: 'red' });
  }
  // Antenna and platform.
  const topY = baseY + height;
  batch.box(x - 1.6, topY, z - 1.6, x + 1.6, topY + 0.6, z + 1.6, { side: 'white', bottom: 'white' });
  batch.box(x - 0.2, topY + 0.6, z - 0.2, x + 0.2, topY + 16, z + 0.2, { side: 'white', bottom: null });
  batch.box(x - 0.35, topY + 16, z - 0.35, x + 0.35, topY + 16.8, z + 0.35, { side: 'red', bottom: 'red' });
}
