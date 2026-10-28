import {
  CanvasTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { COLORS } from '../game/Config';

export type MaterialKey =
  | 'white'
  | 'concrete'
  | 'gray'
  | 'dark'
  | 'red'
  | 'orange'
  | 'glass'
  | 'metal'
  | 'glassDark';

export type MaterialSet = Record<MaterialKey, MeshStandardMaterial>;

/** Fine grained noise used to break up the flat white surfaces. */
function createGrainTexture(): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const base = 205 + Math.random() * 50;
      image.data[i] = base;
      image.data[i + 1] = base;
      image.data[i + 2] = base;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.repeat.set(3, 3);
  return texture;
}

/** Creates the shared material palette used by the level and the city. */
export function createMaterials(): MaterialSet {
  const grain = createGrainTexture();

  const white = new MeshStandardMaterial({
    color: COLORS.white,
    roughness: 0.74,
    metalness: 0.02,
    roughnessMap: grain,
    envMapIntensity: 0.55,
  });
  const concrete = new MeshStandardMaterial({
    color: COLORS.concrete,
    roughness: 0.88,
    metalness: 0.0,
    roughnessMap: grain,
    envMapIntensity: 0.4,
  });
  const gray = new MeshStandardMaterial({
    color: COLORS.gray,
    roughness: 0.82,
    metalness: 0.05,
    roughnessMap: grain,
    envMapIntensity: 0.5,
  });
  const dark = new MeshStandardMaterial({
    color: COLORS.dark,
    roughness: 0.92,
    metalness: 0.08,
    envMapIntensity: 0.35,
  });
  const red = new MeshStandardMaterial({
    color: COLORS.red,
    roughness: 0.42,
    metalness: 0.08,
    envMapIntensity: 0.85,
  });
  const orange = new MeshStandardMaterial({
    color: COLORS.orange,
    roughness: 0.5,
    metalness: 0.05,
    envMapIntensity: 0.7,
  });
  const glass = new MeshStandardMaterial({
    color: COLORS.glass,
    roughness: 0.1,
    metalness: 0.9,
    envMapIntensity: 1.6,
  });
  const glassDark = new MeshStandardMaterial({
    color: 0x3d6f92,
    roughness: 0.16,
    metalness: 0.95,
    envMapIntensity: 1.4,
  });
  const metal = new MeshStandardMaterial({
    color: 0x9fa8b0,
    roughness: 0.34,
    metalness: 0.92,
    envMapIntensity: 1.1,
  });

  return { white, concrete, gray, dark, red, orange, glass, metal, glassDark };
}
