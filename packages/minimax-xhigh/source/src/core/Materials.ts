import * as THREE from 'three';

/**
 * Shared material palette + procedural textures.
 *
 * Everything is generated at runtime: no external textures or models are used.
 * The facade texture is a hand-drawn canvas grid of windows, tiled across every
 * building so the skyline reads as a real city instead of a pile of cubes.
 */

/** Metres covered by one tile of the facade texture. */
export const FACADE_TILE_W = 13;
export const FACADE_TILE_H = 14;

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

/** Procedural window-grid facade: pale concrete mullions with dark blue glass. */
function createFacadeTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);

  // base concrete
  ctx.fillStyle = '#e6ebee';
  ctx.fillRect(0, 0, size, size);

  // faint vertical banding so the surface is not perfectly flat
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.012 + Math.random() * 0.02})`;
    ctx.fillRect(x, 0, 1, size);
  }

  const cols = 4;
  const rows = 4;
  const cw = size / cols;
  const ch = size / rows;
  const pad = Math.max(3, cw * 0.16);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + pad;
      const y = r * ch + pad;
      const w = cw - pad * 2;
      const h = ch - pad * 2;

      // glass pane — slight vertical gradient from sky reflection to interior
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      const tint = 0.72 + Math.random() * 0.28;
      grad.addColorStop(0, `rgba(${Math.round(120 * tint)},${Math.round(168 * tint)},${Math.round(206 * tint)},1)`);
      grad.addColorStop(0.55, `rgba(${Math.round(78 * tint)},${Math.round(118 * tint)},${Math.round(154 * tint)},1)`);
      grad.addColorStop(1, `rgba(${Math.round(52 * tint)},${Math.round(82 * tint)},${Math.round(112 * tint)},1)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);

      // a rare warm lit window for life
      if (Math.random() < 0.09) {
        ctx.fillStyle = 'rgba(255,196,120,0.75)';
        ctx.fillRect(x, y, w, h);
      }

      // top highlight on the mullion
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + h + 0.5);
      ctx.lineTo(x + w, y + h + 0.5);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Procedural roof deck: pale concrete panels with seams and light wear. */
function createRoofTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);

  ctx.fillStyle = '#e9edef';
  ctx.fillRect(0, 0, size, size);

  // large panel seams
  ctx.strokeStyle = 'rgba(150,160,168,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // subtle stains and speckles
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 16;
    ctx.fillStyle = `rgba(140,150,158,${0.015 + Math.random() * 0.035})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface Palette {
  white: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  grey: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  redBright: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  facade: THREE.MeshStandardMaterial;
  facadeGlass: THREE.MeshStandardMaterial;
  facadeDark: THREE.MeshStandardMaterial;
  /** Background city variants (own texture repeat, opaque glass). */
  cityFacade: THREE.MeshStandardMaterial;
  cityFacadeDark: THREE.MeshStandardMaterial;
  cityGlass: THREE.MeshStandardMaterial;
  citySignRed: THREE.MeshStandardMaterial;
  citySignOrange: THREE.MeshStandardMaterial;
}

export function createPalette(): Palette {
  const facadeMap = createFacadeTexture();
  const roofMap = createRoofTexture();

  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.82, metalness: 0.03 });
  const roof = new THREE.MeshStandardMaterial({ map: roofMap, color: 0xffffff, roughness: 0.88, metalness: 0.03 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd2d8dc, roughness: 0.95, metalness: 0.0 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa4ab, roughness: 0.72, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x525c63, roughness: 0.68, metalness: 0.18 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd81f16, roughness: 0.55, metalness: 0.05 });
  const redBright = new THREE.MeshStandardMaterial({ color: 0xff2f22, roughness: 0.45, metalness: 0.04 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9c1c6, roughness: 0.38, metalness: 0.72 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fd0ef,
    roughness: 0.08,
    metalness: 0.35,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.4,
  });

  const facade = new THREE.MeshStandardMaterial({ map: facadeMap, color: 0xffffff, roughness: 0.78, metalness: 0.05 });
  const facadeGlass = new THREE.MeshStandardMaterial({
    map: facadeMap,
    color: 0x8fbcdd,
    roughness: 0.14,
    metalness: 0.45,
    envMapIntensity: 1.5,
  });
  const facadeDark = new THREE.MeshStandardMaterial({ map: facadeMap, color: 0x6c7880, roughness: 0.66, metalness: 0.12 });

  // Background city: same window texture but tiled with a fixed repeat so the
  // instanced boxes keep a believable window scale.
  const cityMap = facadeMap.clone();
  cityMap.needsUpdate = true;
  cityMap.repeat.set(2.4, 6);
  const cityDarkMap = facadeMap.clone();
  cityDarkMap.needsUpdate = true;
  cityDarkMap.repeat.set(2.4, 6);

  const cityFacade = new THREE.MeshStandardMaterial({ map: cityMap, color: 0xffffff, roughness: 0.8, metalness: 0.05 });
  const cityFacadeDark = new THREE.MeshStandardMaterial({ map: cityDarkMap, color: 0x6c7880, roughness: 0.68, metalness: 0.12 });
  const cityGlass = new THREE.MeshStandardMaterial({
    color: 0x8ec4e6,
    roughness: 0.12,
    metalness: 0.5,
    envMapIntensity: 1.6,
  });
  const citySignRed = new THREE.MeshStandardMaterial({ color: 0xd8261b, roughness: 0.6, metalness: 0.05 });
  const citySignOrange = new THREE.MeshStandardMaterial({ color: 0xf0912a, roughness: 0.62, metalness: 0.05 });

  return {
    white,
    roof,
    concrete,
    grey,
    dark,
    red,
    redBright,
    metal,
    glass,
    facade,
    facadeGlass,
    facadeDark,
    cityFacade,
    cityFacadeDark,
    cityGlass,
    citySignRed,
    citySignOrange,
  };
}
