import * as THREE from 'three';
import { Materials, UNIT_BOX } from './Materials';

/**
 * Visual-only background city. Nothing here is added to collision, so it sits
 * outside the playable course and gives the illusion of a much larger skyline.
 * Repeated buildings are drawn with InstancedMesh to keep draw calls low.
 */

/** Ground level of the city street, far below the rooftop course. */
const STREET_Y = -70;

/** Small deterministic PRNG, so the skyline is the same on every load. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sky dome with a vertical gradient from deep blue at the zenith to pale haze at the horizon.
 * The radius must stay inside the camera's far plane (1200), otherwise the dome is clipped and
 * the black clear colour shows through as a dark blob. Game.ts re-centres it on the camera each frame.
 */
export function createSky(): THREE.Mesh {
  const radius = 1000;
  const geometry = new THREE.SphereGeometry(radius, 32, 16);
  const zenith = new THREE.Color(0x2b84d6);
  const horizon = new THREE.Color(0xc9e8fa);
  const colors: number[] = [];
  const position = geometry.attributes.position;
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(position.getY(i) / radius, 0, 1);
    color.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Draw first, so everything else renders over the sky.
  mesh.renderOrder = -1;
  return mesh;
}

/** Hazy street plane far below the course. */
export function createStreet(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(4000, 4000);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = STREET_Y;
  return mesh;
}

interface Slot {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  glass: boolean;
}

/**
 * Builds the skyline. Rows sit on both sides of the course, with near and far layers,
 * and taller glass towers further out.
 */
export function buildCity(routeLength: number, mats: Materials): THREE.Group {
  const rand = mulberry32(20240607);
  const slots: Slot[] = [];

  const addRow = (zMin: number, zMax: number, xSpacing: number, minH: number, maxH: number, glassChance: number): void => {
    for (let x = -260; x < routeLength + 260; x += xSpacing) {
      for (const sign of [-1, 1]) {
        const z = sign * (zMin + rand() * (zMax - zMin));
        const width = 14 + rand() * 10;
        const depth = 14 + rand() * 10;
        const height = minH + rand() * (maxH - minH);
        slots.push({
          x: x + rand() * 6,
          z,
          width,
          depth,
          height,
          glass: rand() < glassChance,
        });
      }
    }
  };

  // Near ring just outside the route, mostly white with some glass.
  addRow(34, 52, 26, 24, 80, 0.35);
  // Mid ring with more glass.
  addRow(80, 120, 38, 60, 150, 0.6);
  // Far skyline, tall glass towers that set the horizon silhouette.
  addRow(170, 260, 60, 100, 300, 0.8);

  const glassSlots = slots.filter((s) => s.glass);
  const whiteSlots = slots.filter((s) => !s.glass);

  const group = new THREE.Group();
  group.add(buildInstanced(whiteSlots, mats.white, 0.0));
  group.add(buildInstanced(glassSlots, mats.glass, 0.0));
  return group;
}

/** One InstancedMesh per material. `tint` jitters colour per building to break up the grid. */
function buildInstanced(slots: Slot[], material: THREE.Material, tint: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(UNIT_BOX, material, slots.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const rand = mulberry32(slots.length + 99);
  slots.forEach((s, i) => {
    matrix.makeScale(s.width, s.height, s.depth);
    matrix.setPosition(s.x, STREET_Y + s.height / 2, s.z);
    mesh.setMatrixAt(i, matrix);
    const shade = 1 - tint * rand() * 0.2 - rand() * 0.04;
    color.setRGB(shade, shade, shade);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
