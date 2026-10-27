import * as THREE from 'three';

/** Material plus the world-space size (metres) that one texture repeat covers. */
export interface MaterialEntry {
  material: THREE.Material;
  uvScale: [number, number];
  castShadow: boolean;
  receiveShadow: boolean;
}

export type MaterialKey =
  | 'roof'
  | 'facade'
  | 'facadeWarm'
  | 'glass'
  | 'concrete'
  | 'white'
  | 'red'
  | 'redGlow'
  | 'orange'
  | 'metal'
  | 'dark'
  | 'steel'
  | 'grate'
  | 'ground';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srgb = true,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, seed: number): void {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    const s = 1 + rnd() * 2.5;
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

/** Light concrete roof tiles (one repeat = 4 m). */
function roofTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e6e9ec';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, 0.07, 7);
    // Large soft blotches for a weathered look.
    const rnd = mulberry32(3);
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(rnd() * w, rnd() * h, 0, rnd() * w, rnd() * h, 40 + rnd() * 90);
      g.addColorStop(0, 'rgba(120,130,140,0.05)');
      g.addColorStop(1, 'rgba(120,130,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = 'rgba(70,80,90,0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * h) / 2);
      ctx.lineTo(w, (i * h) / 2);
      ctx.moveTo((i * w) / 2, 0);
      ctx.lineTo((i * w) / 2, h);
      ctx.stroke();
    }
  });
}

/**
 * Office facade: one repeat = 4 m wide × 3.6 m (one storey) with two windows.
 * Returns colour and roughness maps so the glass reflects the sky but concrete does not.
 */
function facadeTextures(wall: string, glassTop: string, glassBottom: string): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const bandTop = 0.16;
  const bandBottom = 0.74;
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, rough: boolean) => {
    ctx.fillStyle = rough ? '#dcdcdc' : wall;
    ctx.fillRect(0, 0, w, h);
    if (!rough) speckle(ctx, w, h, 1500, 0.05, 11);
    const y0 = h * bandTop;
    const y1 = h * bandBottom;
    if (rough) {
      ctx.fillStyle = '#262626';
    } else {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, glassTop);
      g.addColorStop(1, glassBottom);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, y0, w, y1 - y0);
    if (!rough) {
      // Shadow line under the slab and a soft diagonal reflection.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y0, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(w * 0.1, y1);
      ctx.lineTo(w * 0.35, y0);
      ctx.lineTo(w * 0.45, y0);
      ctx.lineTo(w * 0.2, y1);
      ctx.fill();
    }
    // Mullions.
    ctx.fillStyle = rough ? '#dcdcdc' : wall;
    for (const x of [0, w / 2, w]) ctx.fillRect(x - 5, y0, 10, y1 - y0);
    ctx.fillStyle = rough ? '#999' : 'rgba(225,230,235,0.9)';
    for (const x of [w / 4, (3 * w) / 4]) ctx.fillRect(x - 1.5, y0, 3, y1 - y0);
  };
  return [
    canvasTexture(256, 256, (c, w, h) => draw(c, w, h, false)),
    canvasTexture(256, 256, (c, w, h) => draw(c, w, h, true), false),
  ];
}

/** Curtain-wall glass: one repeat = 3 m × 3.6 m. */
function glassTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6f9cc6');
    g.addColorStop(1, '#a9cbe6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(225,236,245,0.9)';
    ctx.fillRect(0, h * 0.9, w, h * 0.1);
    ctx.fillStyle = 'rgba(235,242,248,0.85)';
    ctx.fillRect(0, 0, 4, h);
    ctx.fillRect(w / 2 - 1, 0, 2, h * 0.9);
  });
}

function grateTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d7dbe0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#20252b';
    const n = 8;
    const cell = w / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) ctx.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
  });
}

/**
 * Shared, procedurally generated materials. Everything in the world uses one of
 * these, which keeps the number of shader programs and draw calls small.
 */
export class Materials {
  private readonly entries = new Map<MaterialKey, MaterialEntry>();

  constructor() {
    const roofMap = roofTexture();
    const [facadeMap, facadeRough] = facadeTextures('#f1f2f4', '#2f4f6e', '#7ea3c4');
    const [warmMap, warmRough] = facadeTextures('#e9e6e1', '#34506b', '#86a7c2');

    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);

    this.set('roof', std({ map: roofMap, color: 0xffffff, roughness: 0.92 }), [4, 4]);
    this.set('facade', std({ map: facadeMap, roughnessMap: facadeRough, roughness: 1, metalness: 0.05 }), [4, 3.6]);
    this.set('facadeWarm', std({ map: warmMap, roughnessMap: warmRough, roughness: 1, metalness: 0.05 }), [4, 3.6]);
    this.set(
      'glass',
      std({ map: glassTexture(), color: 0xc8dcf0, roughness: 0.06, metalness: 0.85, envMapIntensity: 1.25 }),
      [3, 3.6],
    );
    this.set('concrete', std({ map: roofMap, color: 0xd9dcdf, roughness: 0.95 }), [4, 4]);
    this.set('white', std({ color: 0xf4f5f6, roughness: 0.7 }), [1, 1]);
    this.set('red', std({ color: 0xd3140b, roughness: 0.45, emissive: 0x5a0402, emissiveIntensity: 0.3 }), [1, 1]);
    this.set(
      'redGlow',
      std({ color: 0xff2a1e, roughness: 0.5, emissive: 0xff1a0e, emissiveIntensity: 1.2 }),
      [1, 1],
      false,
    );
    this.set('orange', std({ color: 0xff7a1c, roughness: 0.6, emissive: 0x6b2500, emissiveIntensity: 0.3, side: THREE.DoubleSide }), [1, 1]);
    this.set('metal', std({ color: 0xcfd5db, roughness: 0.45, metalness: 0.35 }), [1, 1]);
    this.set('dark', std({ color: 0x2a3036, roughness: 0.6, metalness: 0.2 }), [1, 1]);
    this.set('steel', std({ color: 0x8e979f, roughness: 0.5, metalness: 0.5 }), [1, 1]);
    this.set('grate', std({ map: grateTexture(), roughness: 0.6, metalness: 0.3 }), [1.6, 1.6]);
    this.set('ground', std({ color: 0xa3abb3, roughness: 1 }), [1, 1], false, true);
  }

  private set(key: MaterialKey, material: THREE.Material, uvScale: [number, number], castShadow = true, receiveShadow = true): void {
    this.entries.set(key, { material, uvScale, castShadow, receiveShadow });
  }

  get(key: MaterialKey): MaterialEntry {
    return this.entries.get(key)!;
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      const m = e.material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.roughnessMap?.dispose();
      m.dispose();
    }
  }
}
