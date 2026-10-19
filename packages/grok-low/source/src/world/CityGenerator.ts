import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MaterialSet } from "./Materials";

/**
 * Background towers. They sit outside the jump range of the playable roofs
 * and have no collision, so a missed landing falls instead of sticking.
 */
export function buildCity(mats: MaterialSet): THREE.Group {
  const root = new THREE.Group();
  const rand = mulberry32(19);
  const glass: THREE.BufferGeometry[] = [];
  const concrete: THREE.BufferGeometry[] = [];
  const playX0 = -30;
  const playX1 = 500;
  const playZ = 24;

  const place = (x: number, z: number, sx: number, sz: number, top: number) => {
    const h = top - -36;
    if (h < 4) return;
    const body = new THREE.BoxGeometry(sx, h - 0.6, sz);
    scaleUv(body, sx, h, sz);
    body.translate(x, -36 + (h - 0.6) / 2, z);
    glass.push(body);
    const roof = new THREE.BoxGeometry(sx + 0.2, 0.6, sz + 0.2);
    scaleUv(roof, sx, 0.6, sz);
    roof.translate(x, top - 0.3, z);
    concrete.push(roof);
  };

  for (let i = 0; i < 90; i++) {
    const side = rand() > 0.5 ? 1 : -1;
    const x = -60 + rand() * 620;
    const z = side * (playZ + 6 + rand() * 70);
    if (x > playX0 && x < playX1 && Math.abs(z) < playZ) continue;
    const sx = 8 + rand() * 16;
    const sz = 8 + rand() * 14;
    const top = -8 + rand() * 62;
    place(x, z, sx, sz, top);
  }

  // A red crane beyond the course, the kind of landmark the skyline needs.
  addCrane(root, mats, 96, 36);

  const glassMesh = mergeList(glass, mats.byId.glass);
  const roofMesh = mergeList(concrete, mats.byId.concrete);
  glassMesh.castShadow = false;
  glassMesh.receiveShadow = true;
  roofMesh.castShadow = false;
  roofMesh.receiveShadow = true;
  root.add(glassMesh, roofMesh);

  const street = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 1, metalness: 0 }),
  );
  street.rotation.x = -Math.PI / 2;
  street.position.y = -36.2;
  street.receiveShadow = true;
  root.add(street);

  addSkylineBoards(root, mats);
  return root;
}

export function buildSky(mats: MaterialSet): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 20), mats.sky);
  mesh.frustumCulled = false;
  return mesh;
}

function addCrane(root: THREE.Group, mats: MaterialSet, x: number, z: number): void {
  const red = mats.byId.red;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.1, 48, 1.1), red);
  mast.position.set(x, -12, z);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(28, 0.5, 0.5), red);
  arm.position.set(x + 8, 12, z);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.6), red);
  cab.position.set(x, 11, z);
  root.add(mast, arm, cab);
}

function addSkylineBoards(root: THREE.Group, mats: MaterialSet): void {
  const boards: { text: string; x: number; y: number; z: number; w: number }[] = [
    { text: "NORTHLINE", x: 70, y: 18, z: 42, w: 14 },
    { text: "KITE", x: 180, y: 14, z: -40, w: 10 },
    { text: "HALCYON", x: 300, y: 22, z: 48, w: 12 },
    { text: "RED CIRCUIT", x: 40, y: 11, z: -36, w: 13 },
  ];
  for (const b of boards) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.w * 0.28), mats.banner(b.text));
    mesh.position.set(b.x, b.y, b.z);
    mesh.lookAt(b.x, b.y, 0);
    root.add(mesh);
  }
}

function mergeList(geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh {
  const merged = mergeGeometries(geos, false) ?? new THREE.BufferGeometry();
  for (const g of geos) g.dispose();
  return new THREE.Mesh(merged, mat);
}

function scaleUv(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number): void {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const normal = geo.getAttribute("normal") as THREE.BufferAttribute;
  const tile = 3.2;
  for (let i = 0; i < uv.count; i++) {
    const ny = Math.abs(normal.getY(i));
    const nx = Math.abs(normal.getX(i));
    let u = uv.getX(i);
    let v = uv.getY(i);
    if (ny > 0.5) {
      u *= sx / tile;
      v *= sz / tile;
    } else if (nx > 0.5) {
      u *= sz / tile;
      v *= sy / tile;
    } else {
      u *= sx / tile;
      v *= sy / tile;
    }
    uv.setXY(i, u, v);
  }
}

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
