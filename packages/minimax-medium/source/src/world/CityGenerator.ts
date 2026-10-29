import * as THREE from 'three';
import type { MaterialSet } from './Materials';

export interface CityRect {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** Small deterministic PRNG so the skyline is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface InstanceData {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rot: number;
  color: THREE.Color;
}

/**
 * Procedural background city: dense low blocks right below the play space and
 * a hazy skyline of towers further out. Instanced, so it costs almost nothing.
 */
export function buildCity(
  materials: MaterialSet,
  blocked: CityRect[],
  scene: THREE.Scene
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'city';
  const rnd = mulberry32(20240917);

  const solid: InstanceData[] = [];
  const glass: InstanceData[] = [];

  const overlaps = (x: number, z: number, w: number, d: number): boolean => {
    for (const r of blocked) {
      if (
        x + w / 2 > r.xMin - 6 &&
        x - w / 2 < r.xMax + 6 &&
        z + d / 2 > r.zMin - 6 &&
        z - d / 2 < r.zMax + 6
      ) {
        return true;
      }
    }
    return false;
  };

  // --- dense low blocks around the play space ---------------------------
  const spacing = 27;
  for (let gx = -22; gx <= 22; gx++) {
    for (let gz = -14; gz <= 10; gz++) {
      const x = gx * spacing + (rnd() - 0.5) * 9;
      const z = gz * spacing + (rnd() - 0.5) * 9;
      const w = 9 + rnd() * 14;
      const d = 9 + rnd() * 14;
      if (overlaps(x, z, w, d)) continue;

      const dist = Math.hypot(x, z + 150);
      const tall = dist > 220 && rnd() > 0.55;
      const h = tall ? 40 + rnd() * 95 : 8 + rnd() * 26;

      const data: InstanceData = {
        x,
        y: h / 2,
        z,
        w,
        h,
        d,
        rot: (rnd() - 0.5) * 0.12,
        color: new THREE.Color().setHSL(0.58, 0.05 + rnd() * 0.08, 0.68 + rnd() * 0.24),
      };

      if (tall && rnd() > 0.35) {
        glass.push(data);
      } else {
        solid.push(data);
      }

      // crown detail on the taller blocks
      if (tall) {
        solid.push({
          x,
          y: h + 1.2,
          z,
          w: w * 0.55,
          h: 2.4,
          d: d * 0.55,
          rot: 0,
          color: new THREE.Color().setHSL(0.58, 0.06, 0.82),
        });
      }
    }
  }

  // --- far skyline towers ----------------------------------------------
  for (let i = 0; i < 90; i++) {
    const angle = (i / 90) * Math.PI * 2 + rnd() * 0.4;
    const radius = 330 + rnd() * 520;
    const x = Math.cos(angle) * radius;
    const z = -150 + Math.sin(angle) * radius;
    const w = 16 + rnd() * 30;
    const d = 16 + rnd() * 30;
    const h = 55 + rnd() * 130;
    const data: InstanceData = {
      x,
      y: h / 2,
      z,
      w,
      h,
      d,
      rot: rnd() * 0.5,
      color: new THREE.Color().setHSL(0.57, 0.12 + rnd() * 0.18, 0.62 + rnd() * 0.22),
    };
    if (rnd() > 0.45) glass.push(data);
    else solid.push(data);
  }

  const makeInstanced = (
    data: InstanceData[],
    material: THREE.Material,
    name: string,
    castShadow: boolean
  ) => {
    if (data.length === 0) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, material, data.length);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    data.forEach((d, i) => {
      e.set(0, d.rot, 0);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(d.x, d.y, d.z),
        q,
        new THREE.Vector3(d.w, d.h, d.d)
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, d.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  };

  makeInstanced(solid, materials.white, 'city-solid', true);
  makeInstanced(glass, materials.glass, 'city-glass', false);

  // --- street level -----------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.95, metalness: 0.02 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  ground.receiveShadow = false;
  ground.name = 'street';
  group.add(ground);

  scene.add(group);
  return group;
}
