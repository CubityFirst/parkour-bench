import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld';
import { boxGeometry, mergeOrNull } from './Geometry';
import type { BoxSpec, LevelLayout, SurfaceKind } from './LevelLayout';
import type { MaterialKey } from './Materials';

const MATERIAL_FOR: Record<SurfaceKind, MaterialKey> = {
  roof: 'roof',
  trim: 'trim',
  machine: 'machine',
  vent: 'vent',
  red: 'red',
  wallrun: 'red',
  redGlow: 'redGlow',
};

/** Texture repeat length in metres for each surface kind that uses a texture. */
const TILE_FOR: Partial<Record<SurfaceKind, number>> = {
  roof: 4,
  vent: 0.5,
};

/**
 * Builds the playable rooftops from layout data: a collision world for physics, and merged
 * meshes for rendering (one draw call per material, not one per box).
 */
export class Level {
  readonly world = new CollisionWorld();
  readonly group = new THREE.Group();

  constructor(
    readonly layout: LevelLayout,
    materials: Record<MaterialKey, THREE.Material>,
  ) {
    for (const spec of layout.solids) {
      this.world.add(spec.min, spec.max, spec.kind === 'wallrun');
    }
    this.group.add(buildMeshes(layout.solids, materials, true));
    this.group.add(buildMeshes(layout.decor, materials, false));
  }
}

function buildMeshes(specs: BoxSpec[], materials: Record<MaterialKey, THREE.Material>, collidable: boolean): THREE.Group {
  const buckets = new Map<MaterialKey, THREE.BufferGeometry[]>();
  for (const spec of specs) {
    const key = MATERIAL_FOR[spec.kind];
    const list = buckets.get(key) ?? [];
    list.push(boxGeometry(spec.min, spec.max, TILE_FOR[spec.kind] ?? 1));
    buckets.set(key, list);
  }

  const group = new THREE.Group();
  for (const [key, list] of buckets) {
    const geometry = mergeOrNull(list);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.castShadow = collidable;
    mesh.receiveShadow = collidable;
    group.add(mesh);
  }
  return group;
}
