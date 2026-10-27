import {
  BoxGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, type Material, Matrix4, Mesh, Object3D,
  PlaneGeometry, Quaternion, Vector3,
} from 'three';
import type { CollisionWorld } from './CollisionWorld';
import { GeometryBatcher } from './GeometryBatcher';
import type { RoofDef } from './Level';
import { rng, type WorldMaterials } from './Materials';

/**
 * Procedural background city. Buildings near the route stay well below the
 * playable rooftops (so you look down into streets), while towers further out
 * form the skyline. Everything is batched by material; repeated rooftop props
 * use instancing.
 */
export function generateCity(m: WorldMaterials, route: RoofDef[], world: CollisionWorld): Group {
  const group = new Group();
  const batch = new GeometryBatcher(m.tiles as Map<Material, [number, number]>);
  const rand = rng(1337);
  const acMatrices: Matrix4[] = [];
  const accentBoxes: Array<[number, number, number, number, number, number, Material]> = [];

  // Distance from a rectangle to the nearest route rooftop (XZ only).
  const distToRoute = (x0: number, z0: number, x1: number, z1: number): number => {
    let best = Infinity;
    for (const r of route) {
      const dx = Math.max(r.minX - x1, x0 - r.maxX, 0);
      const dz = Math.max(r.minZ - z1, z0 - r.maxZ, 0);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    // Wall-run towers are part of the route too.
    const extra: Array<[number, number, number, number]> = [[3, -192, 13, -145], [-42, -232, -14, -219]];
    for (const [ax, az, bx, bz] of extra) {
      const dx = Math.max(ax - x1, x0 - bx, 0);
      const dz = Math.max(az - z1, z0 - bz, 0);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  };

  const BLOCK = 30, STREET = 12;
  const step = BLOCK + STREET;
  for (let bx = -520; bx < 420; bx += step) {
    for (let bz = -760; bz < 320; bz += step) {
      // Split each block into 1-3 lots along X and Z.
      const nx = 1 + Math.floor(rand() * 2.4), nz = 1 + Math.floor(rand() * 2.4);
      const lw = BLOCK / nx, ld = BLOCK / nz;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const inset = 0.6 + rand() * 1.4;
          const x0 = bx + i * lw + inset, x1 = bx + (i + 1) * lw - inset;
          const z0 = bz + j * ld + inset, z1 = bz + (j + 1) * ld - inset;
          const d = distToRoute(x0, z0, x1, z1);
          if (d < 7) continue; // keep gaps and the route clear
          let h: number;
          if (d < 30) h = 12 + rand() * 15; // below the route rooftops
          else if (d < 90) h = 16 + rand() * (rand() < 0.25 ? 70 : 32);
          else h = 20 + rand() * (rand() < 0.3 ? 150 : 55);
          const glass = h > 70 ? rand() < 0.45 : rand() < 0.12;
          const sideMat = glass ? m.glass : m.facade;
          batch.addBox(x0, 0, z0, x1, h, z1, { side: sideMat, top: m.roof }, ['ny']);
          if (d < 60) world.add(x0, 0, z0, x1, h, z1);

          // Setback / crown for taller buildings.
          if (h > 45 && rand() < 0.6) {
            const s = 2 + rand() * 3;
            const h2 = h + 6 + rand() * 25;
            batch.addBox(x0 + s, h, z0 + s, x1 - s, h2, z1 - s, { side: glass ? m.glass : m.facade, top: m.roof }, ['ny']);
            if (rand() < 0.4) {
              const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
              accentBoxes.push([cx - 0.3, h2, cz - 0.3, cx + 0.3, h2 + 12 + rand() * 20, cz + 0.3, m.gray]);
            }
          } else {
            // Roof trim and some AC units.
            batch.addBox(x0 - 0.15, h - 0.4, z0 - 0.15, x1 + 0.15, h, z1 + 0.15, m.trim, ['ny']);
            const n = Math.floor(rand() * 4);
            for (let k = 0; k < n; k++) {
              const ax = x0 + 2 + rand() * Math.max(0.1, x1 - x0 - 4);
              const az = z0 + 2 + rand() * Math.max(0.1, z1 - z0 - 4);
              acMatrices.push(new Matrix4().compose(
                new Vector3(ax, h + 0.6, az), new Quaternion(), new Vector3(1.8, 1.2, 1.4)));
            }
          }
          // Occasional orange / red accent panels (billboards, awnings).
          if (rand() < 0.18) {
            const face = Math.floor(rand() * 4);
            const py = h * (0.55 + rand() * 0.3);
            const ph = 3 + rand() * 4;
            const mat = rand() < 0.6 ? m.orange : m.red;
            const w = Math.min(x1 - x0, z1 - z0) * 0.6;
            const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
            if (face === 0) accentBoxes.push([cx - w / 2, py, z1, cx + w / 2, py + ph, z1 + 0.25, mat]);
            if (face === 1) accentBoxes.push([cx - w / 2, py, z0 - 0.25, cx + w / 2, py + ph, z0, mat]);
            if (face === 2) accentBoxes.push([x1, py, cz - w / 2, x1 + 0.25, py + ph, cz + w / 2, mat]);
            if (face === 3) accentBoxes.push([x0 - 0.25, py, cz - w / 2, x0, py + ph, cz + w / 2, mat]);
          }
        }
      }
    }
  }
  for (const b of accentBoxes) batch.addBox(b[0], b[1], b[2], b[3], b[4], b[5], b[6], ['ny']);

  // A couple of red lattice cranes / masts for skyline interest (as in the reference shots).
  const mast = (x: number, z: number, h: number) => {
    const w = 1.6;
    for (const [dx, dz] of [[0, 0], [w, 0], [0, w], [w, w]]) batch.addBox(x + dx, 0, z + dz, x + dx + 0.3, h, z + dz + 0.3, m.red, ['ny']);
    for (let y = 6; y < h; y += 5) batch.addBox(x, y, z, x + w + 0.3, y + 0.25, z + w + 0.3, m.redDark, ['ny']);
    batch.addBox(x - 0.4, h, z - 0.4, x + w + 0.7, h + 1.2, z + w + 0.7, m.red, ['ny']);
  };
  mast(48, -120, 95);
  mast(-120, -330, 110);
  mast(-150, -60, 80);

  batch.build(group, { castShadow: false, receiveShadow: false });

  // Instanced rooftop AC units for the background buildings.
  if (acMatrices.length) {
    const ac = new InstancedMesh(new BoxGeometry(1, 1, 1), m.gray, acMatrices.length);
    acMatrices.forEach((mt, i) => ac.setMatrixAt(i, mt));
    ac.instanceMatrix.needsUpdate = true;
    group.add(ac);
  }

  // Instanced orange flags on poles near the route (reference vibe).
  const flagSpots: Array<[number, number, number]> = [
    [14, 62, -60], [-14, 30, -150], [20, 70, -230], [-90, 55, -250], [-50, 50, -300], [28, 66, -20],
  ];
  const poleGeo = new CylinderGeometry(0.06, 0.06, 3, 6);
  const flagGeo = new PlaneGeometry(1.4, 0.9);
  const poles = new InstancedMesh(poleGeo, m.gray, flagSpots.length);
  const flagMat = m.orange.clone();
  flagMat.side = DoubleSide;
  const flags = new InstancedMesh(flagGeo, flagMat, flagSpots.length);
  const o = new Object3D();
  flagSpots.forEach(([x, y, z], i) => {
    o.position.set(x, y + 1.5, z); o.rotation.set(0, 0, 0); o.updateMatrix();
    poles.setMatrixAt(i, o.matrix);
    o.position.set(x + 0.7, y + 2.5, z); o.rotation.set(0, 0.4, 0); o.updateMatrix();
    flags.setMatrixAt(i, o.matrix);
  });
  group.add(poles, flags);

  // Street level.
  const ground = new Mesh(new PlaneGeometry(3000, 3000), m.street);
  ground.rotation.x = -Math.PI / 2;
  const uv = ground.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 150, uv.getY(i) * 150);
  group.add(ground);
  return group;
}
