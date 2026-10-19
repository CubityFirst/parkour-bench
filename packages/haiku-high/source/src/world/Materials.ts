import * as THREE from 'three';

/** One unit cube, shared by every solid in the level and scaled per mesh. */
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * Shared materials. Keeping the palette small means few materials and few draw-call state changes.
 */
export interface Materials {
  /** Rooftop slabs and clean architecture. */
  white: THREE.MeshStandardMaterial;
  /** Subtle gray concrete for trims, plant units and railings. */
  concrete: THREE.MeshStandardMaterial;
  /** Dark accents for posts, vents and mechanical details. */
  dark: THREE.MeshStandardMaterial;
  /** Red traversal surfaces: vault obstacles, wall-run walls, ducts, markers, finish gate. */
  red: THREE.MeshStandardMaterial;
  /** Blue-tinted reflective glass for skyscrapers. */
  glass: THREE.MeshStandardMaterial;
}

export function createMaterials(): Materials {
  return {
    white: new THREE.MeshStandardMaterial({ color: 0xf3f5f7, roughness: 0.82, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xc4c9d0, roughness: 0.9, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.6, metalness: 0.1 }),
    red: new THREE.MeshStandardMaterial({
      color: 0xe0202a,
      roughness: 0.5,
      metalness: 0,
      emissive: 0x2a0204,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8dbfe0,
      roughness: 0.18,
      metalness: 0.35,
      envMapIntensity: 0.6,
    }),
  };
}
