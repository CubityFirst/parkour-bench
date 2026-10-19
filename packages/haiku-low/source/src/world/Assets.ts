import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';

/** One shared unit cube; every box in the level is this geometry, scaled and positioned. */
export const unitBox = new BoxGeometry(1, 1, 1);

export const materials = {
  roof: new MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.9 }),
  concrete: new MeshStandardMaterial({ color: 0xb8bfc8, roughness: 0.95 }),
  red: new MeshStandardMaterial({ color: 0xe0211b, roughness: 0.45 }),
  vent: new MeshStandardMaterial({ color: 0x6a727d, roughness: 0.6, metalness: 0.3 }),
  glass: new MeshStandardMaterial({ color: 0x8ac4e6, roughness: 0.12, metalness: 0.35 }),
  cityWhite: new MeshStandardMaterial({ color: 0xe6ecf2, roughness: 0.9 }),
  ground: new MeshStandardMaterial({ color: 0xcfd7df, roughness: 1 }),
  arm: new MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.8 }),
};

/** Builds a mesh that exactly fills the axis-aligned box from `min` to `max`. */
export function boxMesh(min: Vector3, max: Vector3, material: MeshStandardMaterial, casts = true): Mesh {
  const mesh = new Mesh(unitBox, material);
  mesh.position.addVectors(min, max).multiplyScalar(0.5);
  mesh.scale.subVectors(max, min);
  mesh.castShadow = casts;
  mesh.receiveShadow = casts;
  return mesh;
}
