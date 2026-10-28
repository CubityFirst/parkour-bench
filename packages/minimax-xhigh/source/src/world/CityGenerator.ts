import * as THREE from 'three';
import { Palette } from '../core/Materials';

/** Small deterministic PRNG so the city is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROUTE_X0 = -30;
const ROUTE_X1 = 425;
const ROUTE_Z = 24;

interface CityOptions {
  /** Keep the playable corridor free of background geometry. */
  x0: number;
  x1: number;
}

/**
 * Generates the surrounding skyline.
 *
 * Everything is drawn with a handful of instanced meshes so the whole city
 * costs only a few draw calls. The distant buildings sit lower than the
 * rooftops so the player always reads the playable route against the sky.
 */
export function createCity(palette: Palette, options: CityOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'city';
  const rand = mulberry32(20240617);

  const white = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), palette.white, 0);
  const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), palette.cityGlass, 0);
  const facade = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), palette.cityFacade, 0);
  const dark = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), palette.cityFacadeDark, 0);

  const whiteList: THREE.Matrix4[] = [];
  const glassList: THREE.Matrix4[] = [];
  const facadeList: THREE.Matrix4[] = [];
  const darkList: THREE.Matrix4[] = [];
  const signRedList: THREE.Matrix4[] = [];
  const signOrangeList: THREE.Matrix4[] = [];

  const dummy = new THREE.Object3D();

  const push = (list: THREE.Matrix4[], w: number, h: number, d: number, x: number, y: number, z: number) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  };

  /** A coloured banner on the face of a background building. */
  const pushSign = (x: number, y: number, z: number, side: number, w: number, h: number) => {
    const list = rand() < 0.45 ? signRedList : signOrangeList;
    push(list, w, h, 0.5, x, y, z + side * 0.4);
  };

  const overlapsRoute = (x: number, z: number, halfW: number, halfD: number): boolean => {
    if (x + halfW < options.x0 || x - halfW > options.x1) return false;
    return Math.abs(z) < ROUTE_Z + halfD;
  };

  // ---- near ring: mid distance blocks below the rooftops -----------------
  for (let i = 0; i < 90; i++) {
    const x = -180 + rand() * 900;
    const side = rand() < 0.5 ? -1 : 1;
    const z = side * (46 + rand() * 150);
    const w = 14 + rand() * 26;
    const d = 14 + rand() * 26;
    if (overlapsRoute(x, z, w / 2, d / 2)) continue;
    const top = -8 - rand() * 52;
    const h = 92 - top;
    const roll = rand();
    if (roll < 0.4) push(whiteList, w, h, d, x, top - h / 2, z);
    else if (roll < 0.7) push(facadeList, w, h, d, x, top - h / 2, z);
    else if (roll < 0.9) push(glassList, w, h, d, x, top - h / 2, z);
    else push(darkList, w, h, d, x, top - h / 2, z);
    if (rand() < 0.5) {
      const signSide = z > 0 ? -1 : 1;
      pushSign(x, top - 6 - rand() * 22, z, signSide, 6 + rand() * 12, 2 + rand() * 3);
    }
  }

  // ---- mid ring: taller towers ------------------------------------------
  for (let i = 0; i < 70; i++) {
    const x = -320 + rand() * 1200;
    const side = rand() < 0.5 ? -1 : 1;
    const z = side * (200 + rand() * 260);
    const w = 18 + rand() * 34;
    const d = 18 + rand() * 34;
    if (overlapsRoute(x, z, w / 2, d / 2)) continue;
    const top = -20 + rand() * 62;
    const h = 120 - top;
    const roll = rand();
    if (roll < 0.35) push(whiteList, w, h, d, x, top - h / 2, z);
    else if (roll < 0.65) push(facadeList, w, h, d, x, top - h / 2, z);
    else if (roll < 0.85) push(glassList, w, h, d, x, top - h / 2, z);
    else push(darkList, w, h, d, x, top - h / 2, z);
  }

  // ---- far skyline: the silhouette on the horizon ------------------------
  for (let i = 0; i < 80; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 620 + rand() * 620;
    const x = 190 + Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const w = 22 + rand() * 46;
    const d = 22 + rand() * 46;
    const top = -30 + rand() * 110;
    const h = 140 - top;
    const roll = rand();
    if (roll < 0.45) push(whiteList, w, h, d, x, top - h / 2, z);
    else if (roll < 0.8) push(glassList, w, h, d, x, top - h / 2, z);
    else push(facadeList, w, h, d, x, top - h / 2, z);
  }

  // ---- buildings beyond the end of the route -----------------------------
  for (let i = 0; i < 16; i++) {
    const x = ROUTE_X1 + 30 + rand() * 260;
    const z = (rand() - 0.5) * 220;
    const w = 16 + rand() * 28;
    const d = 16 + rand() * 28;
    const top = -14 - rand() * 44;
    const h = 100 - top;
    const roll = rand();
    if (roll < 0.5) push(whiteList, w, h, d, x, top - h / 2, z);
    else if (roll < 0.85) push(facadeList, w, h, d, x, top - h / 2, z);
    else push(glassList, w, h, d, x, top - h / 2, z);
  }

  const make = (list: THREE.Matrix4[], mat: THREE.Material, name: string): THREE.InstancedMesh | null => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = name;
    mesh.frustumCulled = false;
    return mesh;
  };

  const meshes = [
    make(whiteList, palette.white, 'city-white'),
    make(glassList, palette.cityGlass, 'city-glass'),
    make(facadeList, palette.cityFacade, 'city-facade'),
    make(darkList, palette.cityFacadeDark, 'city-dark'),
    make(signRedList, palette.citySignRed, 'city-sign-red'),
    make(signOrangeList, palette.citySignOrange, 'city-sign-orange'),
  ];

  for (const m of meshes) if (m) group.add(m);

  // ---- ground plane far below --------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: 0x7d8b95, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(190, -95, 0);
  ground.receiveShadow = false;
  group.add(ground);

  return group;
}
