import * as THREE from 'three';
import { boxGeometry, createRng, mergeOrNull } from './Geometry';
import type { MaterialKey } from './Materials';

/** Street level far below the rooftops. Buildings rise from here. */
const GROUND_Y = -110;
const SKY_TOP = new THREE.Color(0x2a7fd3);
const SKY_HORIZON = new THREE.Color(0xd3eafa);

/** Background colour and fog colour. Distant buildings fade into this haze. */
export const HAZE_COLOR = 0xd3eafa;

/** True inside the playable corridor, where no background building may stand. */
function inCorridor(x: number, z: number): boolean {
  return Math.abs(x) < 52 && z < 44 && z > -330;
}

/** Gradient sky dome, drawn with vertex colours so it needs no custom shader. */
export function createSky(radius = 2200): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 48, 24);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    const height = positions.getY(i) / radius;
    const t = Math.pow(Math.min(1, Math.max(0, height * 1.4 + 0.02)), 0.55);
    color.copy(SKY_HORIZON).lerp(SKY_TOP, t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * Background city, placed well outside the route, plus a ground plane and clouds. None of it
 * collides. Geometry is merged per material, so the whole city is a handful of draw calls.
 */
export class CityGenerator {
  readonly group = new THREE.Group();

  constructor(materials: Record<MaterialKey, THREE.Material>) {
    const buckets = new Map<MaterialKey, THREE.BufferGeometry[]>();
    const push = (key: MaterialKey, geometry: THREE.BufferGeometry): void => {
      const list = buckets.get(key) ?? [];
      list.push(geometry);
      buckets.set(key, list);
    };

    const rand = createRng(1337);
    const cell = 46;
    for (let gx = -18; gx <= 18; gx++) {
      for (let gz = -30; gz <= 10; gz++) {
        if (rand() < 0.22) continue;
        const cx = gx * cell + (rand() - 0.5) * 18;
        const cz = gz * cell + (rand() - 0.5) * 18;
        if (inCorridor(cx, cz)) continue;

        const w = 16 + rand() * 20;
        const d = 16 + rand() * 20;
        // Buildings grow taller with distance, so the skyline stacks up behind the route.
        const distance = Math.hypot(cx, cz);
        const top = 40 + rand() * 110 + Math.min(1, distance / 700) * 110;
        const roll = rand();
        const key: MaterialKey = roll < 0.45 ? 'facadeWhite' : roll < 0.7 ? 'facadeGrey' : 'glass';
        push(
          key,
          boxGeometry({ x: cx - w / 2, y: GROUND_Y, z: cz - d / 2 }, { x: cx + w / 2, y: top, z: cz + d / 2 }, 4),
        );

        if (key !== 'glass' && rand() < 0.12) {
          // Red construction cranes, a nod to the towers in the reference.
          const height = 50 + rand() * 40;
          push(
            'crane',
            boxGeometry({ x: cx - 0.9, y: top, z: cz - 0.9 }, { x: cx + 0.9, y: top + height, z: cz + 0.9 }, 4),
          );
          push(
            'crane',
            boxGeometry(
              { x: cx - 22, y: top + height - 3, z: cz - 0.6 },
              { x: cx + 22, y: top + height - 1.5, z: cz + 0.6 },
              4,
            ),
          );
        }
      }
    }

    push('ground', boxGeometry({ x: -4000, y: GROUND_Y - 4, z: -4000 }, { x: 4000, y: GROUND_Y, z: 600 }, 50));

    const cloudRand = createRng(42);
    for (let i = 0; i < 120; i++) {
      const cx = (cloudRand() - 0.5) * 2400;
      const cz = -600 + (cloudRand() - 0.5) * 2200;
      const cy = 150 + cloudRand() * 110;
      const puffs = 3 + Math.floor(cloudRand() * 3);
      for (let p = 0; p < puffs; p++) {
        const sphere = new THREE.SphereGeometry(14 + cloudRand() * 22, 9, 6);
        sphere.translate(cx + (cloudRand() - 0.5) * 60, cy + (cloudRand() - 0.5) * 8, cz + (cloudRand() - 0.5) * 40);
        push('cloud', sphere);
      }
    }

    for (const [key, list] of buckets) {
      const geometry = mergeOrNull(list);
      if (!geometry) continue;
      this.group.add(new THREE.Mesh(geometry, materials[key]));
    }
  }
}
