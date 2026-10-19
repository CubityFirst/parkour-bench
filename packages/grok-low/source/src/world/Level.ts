import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MaterialSet } from "./Materials";
import { type CollisionWorld } from "./CollisionWorld";
import { type Decor, type LevelSpec, type MatId } from "./levelSpec";

export interface LevelVisuals {
  root: THREE.Group;
  flags: { cloth: THREE.Object3D; phase: number }[];
  red: THREE.MeshStandardMaterial;
}

/** One mesh per material. Collision boxes and these meshes share the spec. */
export function buildLevelMeshes(spec: LevelSpec, mats: MaterialSet): LevelVisuals {
  const batches = new Map<MatId, THREE.BufferGeometry[]>();
  const push = (mat: MatId, sx: number, sy: number, sz: number, x: number, bottom: number, z: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    scaleBoxUVs(g, sx, sy, sz, mat === "glass" ? 3.1 : 2.5);
    g.translate(x, bottom + sy / 2, z);
    const list = batches.get(mat) ?? [];
    list.push(g);
    batches.set(mat, list);
  };

  for (const s of spec.solids) push(s.mat, s.sx, s.sy, s.sz, s.x, s.y, s.z);
  const flags: { cloth: THREE.Object3D; phase: number }[] = [];
  const root = new THREE.Group();

  for (const d of spec.decor) {
    if (d.kind === "box") {
      const mat = d.mat as MatId;
      if (!mats.byId[mat]) continue;
      push(mat, d.sx, d.sy, d.sz, d.x, d.y, d.z);
    } else if (d.kind === "flag") {
      flags.push(addFlag(root, d, mats));
    } else if (d.kind === "billboard") {
      addBillboard(root, d, mats);
    }
  }

  for (const [id, geos] of batches) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    for (const g of geos) g.dispose();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mats.byId[id]);
    mesh.castShadow = id !== "glass";
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  return { root, flags, red: mats.byId.red };
}

export function colliderHelpers(world: CollisionWorld): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x39ff9a, wireframe: true });
  for (const b of world.boxes) {
    const sx = b.maxX - b.minX;
    const sy = b.maxY - b.minY;
    const sz = b.maxZ - b.minZ;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    group.add(mesh);
  }
  return group;
}

function addFlag(root: THREE.Group, d: Decor, mats: MaterialSet): { cloth: THREE.Object3D; phase: number } {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, d.sy, 6), mats.byId.metal);
  pole.position.set(d.x, d.y + d.sy / 2, d.z);
  pole.castShadow = true;
  root.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.36), mats.flag);
  cloth.geometry.translate(0.39, 0, 0);
  cloth.position.set(d.x, d.y + d.sy - 0.28, d.z);
  cloth.frustumCulled = false;
  root.add(cloth);
  return { cloth, phase: d.phase ?? 0 };
}

function addBillboard(root: THREE.Group, d: Decor, mats: MaterialSet): void {
  const mat = mats.banner(d.text ?? "FLOW", d.text === "FINISH" ? "#e10600" : "#ff8614");
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.sz, d.sy), mat);
  // Face back toward the runner, who approaches from −X.
  mesh.rotation.y = -Math.PI / 2;
  mesh.position.set(d.x - 0.28, d.y, d.z);
  root.add(mesh);
}

function scaleBoxUVs(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number, tile: number): void {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const normal = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
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
  uv.needsUpdate = true;
}
