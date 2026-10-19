import * as THREE from 'three';
import { createRng } from './Geometry';

export type MaterialKey =
  | 'roof'
  | 'trim'
  | 'machine'
  | 'vent'
  | 'red'
  | 'redGlow'
  | 'facadeWhite'
  | 'facadeGrey'
  | 'glass'
  | 'crane'
  | 'cloud'
  | 'ground';

function makeTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  draw(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Off-white concrete with fine speckle and paving joints at each tile edge. */
function drawConcrete(ctx: CanvasRenderingContext2D, size: number): void {
  const rand = createRng(7);
  ctx.fillStyle = '#f4f6f9';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1100; i++) {
    const shade = 118 + Math.floor(rand() * 70);
    ctx.fillStyle = `rgba(${shade}, ${shade + 6}, ${shade + 14}, ${0.04 + rand() * 0.08})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.strokeStyle = 'rgba(90, 100, 114, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
}

/** Facade with a grid of windows: the texture repeats every four metres. */
function drawFacade(ctx: CanvasRenderingContext2D, size: number, base: string, glass: string, frame: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const cols = 4;
  const rows = 6;
  const w = size / cols;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * w;
      const y = r * h;
      ctx.fillStyle = frame;
      ctx.fillRect(x + w * 0.12, y + h * 0.16, w * 0.76, h * 0.6);
      ctx.fillStyle = glass;
      ctx.fillRect(x + w * 0.16, y + h * 0.2, w * 0.68, h * 0.52);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.fillRect(x + w * 0.16, y + h * 0.2, w * 0.18, h * 0.52);
    }
    ctx.fillStyle = 'rgba(40, 52, 66, 0.12)';
    ctx.fillRect(0, (r + 1) * h - h * 0.04, size, h * 0.04);
  }
}

/** Blue-tinted curtain wall with vertical mullions. */
function drawGlass(ctx: CanvasRenderingContext2D, size: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, '#d2ecfa');
  gradient.addColorStop(1, '#84b6dc');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const bays = 8;
  for (let i = 0; i < bays; i++) {
    ctx.fillStyle = 'rgba(230, 245, 255, 0.55)';
    ctx.fillRect((i * size) / bays, 0, size / bays / 14, size);
  }
  for (let j = 0; j < 8; j++) {
    ctx.fillStyle = 'rgba(30, 60, 90, 0.18)';
    ctx.fillRect(0, (j * size) / 8, size, 2);
  }
}

/** Dark ventilation grate with a regular grid of lighter cells. */
function drawGrate(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#343c48';
  ctx.fillRect(0, 0, size, size);
  const cells = 8;
  const cell = size / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = '#9aa5b3';
      ctx.fillRect(c * cell + cell * 0.2, r * cell + cell * 0.2, cell * 0.6, cell * 0.6);
    }
  }
}

/** Shared materials. Built once and reused everywhere so draw calls and GPU memory stay small. */
export function createMaterials(): Record<MaterialKey, THREE.MeshStandardMaterial> {
  const concrete = makeTexture(256, drawConcrete);
  const facadeWhite = makeTexture(256, (ctx, size) => drawFacade(ctx, size, '#eef1f5', '#5c7389', '#dfe6ee'));
  const facadeGrey = makeTexture(256, (ctx, size) => drawFacade(ctx, size, '#b9c1cc', '#44546a', '#c9d0d9'));
  const glass = makeTexture(256, drawGlass);
  const grate = makeTexture(128, drawGrate);

  return {
    roof: new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.92 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.55 }),
    machine: new THREE.MeshStandardMaterial({ color: 0xc3cad3, roughness: 0.6, metalness: 0.15 }),
    vent: new THREE.MeshStandardMaterial({ map: grate, color: 0xb4bcc7, roughness: 0.6, metalness: 0.25 }),
    red: new THREE.MeshStandardMaterial({ color: 0xe0242b, roughness: 0.42, emissive: 0x2a0204, emissiveIntensity: 1 }),
    redGlow: new THREE.MeshStandardMaterial({ color: 0xff3038, roughness: 0.4, emissive: 0x8a0a10, emissiveIntensity: 1 }),
    facadeWhite: new THREE.MeshStandardMaterial({ map: facadeWhite, roughness: 0.6 }),
    facadeGrey: new THREE.MeshStandardMaterial({ map: facadeGrey, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ map: glass, roughness: 0.2, metalness: 0.5 }),
    crane: new THREE.MeshStandardMaterial({ color: 0xd62a2f, roughness: 0.5 }),
    cloud: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xb8d4ea, emissiveIntensity: 0.25 }),
    ground: new THREE.MeshStandardMaterial({ color: 0xa9b2bd, roughness: 1 }),
  };
}
