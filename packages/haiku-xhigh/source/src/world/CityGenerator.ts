import * as THREE from 'three';
import { Materials } from './Materials';

/** Deterministic PRNG so the skyline is identical on every load. */
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

const GROUND_Y = -40;
/** Area around the playable route that stays free of background towers. */
const ROUTE_CLEAR_X = 26;
const ROUTE_Z_MIN = -232;
const ROUTE_Z_MAX = 22;

/**
 * Background city and sky. None of this collides and none of it casts shadows,
 * which keeps the scenery cheap. Towers are instanced so the whole skyline is a few draw calls.
 */
export function buildCity(scene: THREE.Scene, mats: Materials): void {
  scene.add(createSky());

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ color: 0xa9b5c2, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  scene.add(ground);

  const rand = mulberry32(20260419);
  const glassTowers: THREE.Matrix4[] = [];
  const whiteTowers: THREE.Matrix4[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  const place = (out: THREE.Matrix4[], x: number, z: number, w: number, d: number, h: number): void => {
    position.set(x, GROUND_Y + h / 2, z);
    scale.set(w, h, d);
    matrix.compose(position, quat, scale);
    out.push(matrix.clone());
  };

  // Near ring: towers just outside the route, plus a mid-distance band.
  for (let i = 0; i < 260; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 40 + Math.pow(rand(), 1.4) * 420;
    const x = Math.cos(angle) * dist;
    const z = -90 + Math.sin(angle) * dist;
    if (Math.abs(x) < ROUTE_CLEAR_X && z > ROUTE_Z_MIN && z < ROUTE_Z_MAX) continue;

    const w = 10 + rand() * 18;
    const d = 10 + rand() * 18;
    const isGlass = rand() < 0.55;
    // Taller towers further out, so the skyline rises toward the horizon.
    const h = isGlass ? 40 + rand() * 120 + dist * 0.15 : 18 + rand() * 60;
    if (isGlass) place(glassTowers, x, z, w, d, h);
    else place(whiteTowers, x, z, w, d, h);
  }

  addInstanced(scene, new THREE.BoxGeometry(1, 1, 1), mats.glass, glassTowers);
  addInstanced(scene, new THREE.BoxGeometry(1, 1, 1), mats.tower, whiteTowers);
}

function addInstanced(scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]): void {
  if (matrices.length === 0) return;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

/** Large inward-facing dome with a vertical blue gradient. It is never fogged. */
function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1400, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2f86dc) },
      horizonColor: { value: new THREE.Color(0xd3ecfb) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.6, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.7));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
}
