import * as THREE from 'three';

/** Shared materials. Reusing them keeps draw calls low and lets merged meshes batch by material. */
export interface Materials {
  /** White rooftop concrete with a procedural speckle texture. */
  roof: THREE.MeshStandardMaterial;
  /** Slightly darker light-gray trim and parapets. */
  trim: THREE.MeshStandardMaterial;
  /** Signature red used for everything the player should read as traversal. */
  red: THREE.MeshStandardMaterial;
  /** Mid-gray for air-conditioning units and pipes. */
  gray: THREE.MeshStandardMaterial;
  /** Dark grilles and vent faces. */
  dark: THREE.MeshStandardMaterial;
  /** Blue-tinted glass office towers. */
  glass: THREE.MeshStandardMaterial;
  /** White towers for the background city. */
  tower: THREE.MeshStandardMaterial;
}

export function createMaterials(): Materials {
  const speckle = createSpeckleTexture();
  return {
    roof: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, map: speckle, roughness: 0.92, metalness: 0 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.85, metalness: 0 }),
    red: new THREE.MeshStandardMaterial({ color: 0xe0202a, roughness: 0.5, metalness: 0 }),
    gray: new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.8, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8ec4ea, roughness: 0.15, metalness: 0.25 }),
    tower: new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.75, metalness: 0 }),
  };
}

/** A small grayscale noise tile that breaks up flat white surfaces. */
function createSpeckleTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2200; i++) {
      const shade = 225 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.55)`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
