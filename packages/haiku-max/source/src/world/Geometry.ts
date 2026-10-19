import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Box geometry placed in world space. UVs are scaled so a texture repeats every `tileMetres`,
 * which keeps procedural textures at a consistent size across boxes of any dimension.
 */
export function boxGeometry(min: Point3, max: Point3, tileMetres: number): THREE.BufferGeometry {
  const sx = max.x - min.x;
  const sy = max.y - min.y;
  const sz = max.z - min.z;
  const geometry = new THREE.BoxGeometry(sx, sy, sz);

  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    let su: number;
    let sv: number;
    if (nx > 0.5) {
      su = sz;
      sv = sy;
    } else if (ny > 0.5) {
      su = sx;
      sv = sz;
    } else {
      su = sx;
      sv = sy;
    }
    uv.setXY(i, (uv.getX(i) * su) / tileMetres, (uv.getY(i) * sv) / tileMetres);
  }

  geometry.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  return geometry;
}

/** Merges geometries that share a material into one draw call. Empty input returns null. */
export function mergeOrNull(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;
  return mergeGeometries(geometries, false);
}

/** Seeded random number generator (mulberry32), so the city and textures look the same on every load. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
