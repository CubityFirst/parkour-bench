import * as THREE from 'three';

/**
 * Procedural textures and shared materials. Everything is generated on
 * canvases at startup — no external image assets.
 */

export type MaterialKey =
  | 'roof'
  | 'roofGray'
  | 'officeWhite'
  | 'officeGrid'
  | 'officeWarm'
  | 'glassBlue'
  | 'glassTeal'
  | 'white'
  | 'concrete'
  | 'red'
  | 'redMatte'
  | 'metal'
  | 'darkMetal'
  | 'grate'
  | 'glassRail'
  | 'orange'
  | 'street'
  | 'skyline';

export type MaterialSet = Record<MaterialKey, THREE.MeshStandardMaterial>;

/** Metres covered by one texture repeat on building facades (width, height). */
export const FACADE_TILE: Record<string, [number, number]> = {
  officeWhite: [4, 3.6],
  officeGrid: [3, 3.6],
  officeWarm: [4, 3.6],
  glassBlue: [1.6, 3.6],
  glassTeal: [1.6, 3.6],
  skyline: [6, 4],
};

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const v = r() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    const s = 1 + r() * 2;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

function toTexture(canvas: HTMLCanvasElement, anisotropy: number, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Light concrete roof with large slabs and subtle stains. 1 repeat = 4 m. */
function roofTexture(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(7);
  // Slab tone variation (2 m slabs).
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const v = 228 + Math.floor(r() * 18);
      ctx.fillStyle = `rgb(${v},${v},${v + 2})`;
      ctx.fillRect(x * 256 + 2, y * 256 + 2, 252, 252);
    }
  }
  // Soft stains.
  for (let i = 0; i < 30; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 20 + r() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(150,150,155,${0.05 + r() * 0.05})`);
    g.addColorStop(1, 'rgba(150,150,155,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(ctx, 512, 512, 9000, 0.08, 3);
  // Slab joints.
  ctx.fillStyle = 'rgba(120,120,125,0.35)';
  ctx.fillRect(0, 0, 512, 2);
  ctx.fillRect(0, 256, 512, 2);
  ctx.fillRect(0, 0, 2, 512);
  ctx.fillRect(256, 0, 2, 512);
  return c;
}

/**
 * Office facade: one floor (3.6 m) by 4 m. White concrete bands with a dark
 * glazed ribbon window — the classic look of the reference screenshots.
 * Texture row 0 (top of the canvas) maps to the top of each floor.
 */
function officeTexture(variant: 'white' | 'warm'): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = variant === 'white' ? '#f3f3f1' : '#efe9e1';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 1500, 0.06, variant === 'white' ? 11 : 12);
  // Ribbon window band.
  const top = 82;
  const bottom = 214;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#5f7488');
  g.addColorStop(0.45, '#33475b');
  g.addColorStop(1, '#22313f');
  ctx.fillStyle = g;
  ctx.fillRect(0, top, 256, bottom - top);
  // Sky reflection streak.
  const rg = ctx.createLinearGradient(0, top, 256, bottom);
  rg.addColorStop(0, 'rgba(190,220,245,0.30)');
  rg.addColorStop(0.5, 'rgba(190,220,245,0.05)');
  rg.addColorStop(1, 'rgba(190,220,245,0.18)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, top, 256, bottom - top);
  // Mullions every metre.
  ctx.fillStyle = '#d9dde0';
  for (let x = 0; x <= 256; x += 64) ctx.fillRect(x - 3, top, 6, bottom - top);
  // Sill shadow and lintel highlight.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, top, 256, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(0, bottom, 256, 3);
  // Panel joints.
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, 40, 256, 2);
  ctx.fillRect(127, 0, 2, top);
  ctx.fillRect(127, bottom, 2, 256 - bottom);
  return c;
}

/** Grid facade with punched square windows (3 m × 3.6 m). */
function gridTexture(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#f1f2f2';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 1200, 0.06, 21);
  const x0 = 40;
  const x1 = 216;
  const y0 = 70;
  const y1 = 222;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#6b8094');
  g.addColorStop(1, '#273746');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = 'rgba(200,225,245,0.22)';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + 90, y0);
  ctx.lineTo(x0, y0 + 110);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#cfd5da';
  ctx.fillRect(127, y0, 4, y1 - y0);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x0, y0, x1 - x0, 5);
  ctx.fillRect(x0, y0, 5, y1 - y0);
  return c;
}

/** Curtain-wall glass: blue panels with thin mullions (1.6 m × 3.6 m). */
function glassTexture(tint: 'blue' | 'teal'): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  if (tint === 'blue') {
    g.addColorStop(0, '#7fb0dc');
    g.addColorStop(1, '#5d93c6');
  } else {
    g.addColorStop(0, '#8fc3cc');
    g.addColorStop(1, '#6aa6b2');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);
  // Spandrel band at the floor line, then thin mullions.
  ctx.fillStyle = tint === 'blue' ? 'rgba(40,70,105,0.35)' : 'rgba(35,80,90,0.35)';
  ctx.fillRect(0, 214, 128, 42);
  ctx.fillStyle = 'rgba(235,242,248,0.95)';
  ctx.fillRect(0, 0, 128, 4);
  ctx.fillRect(0, 0, 3, 256);
  ctx.fillStyle = 'rgba(235,242,248,0.5)';
  ctx.fillRect(0, 212, 128, 2);
  return c;
}

/** Distant skyline facade — simple light windows grid, cheap to read in the haze. */
function skylineTexture(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#e9eef2';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#8fa6bb';
  for (let x = 8; x < 128; x += 32) ctx.fillRect(x, 40, 22, 60);
  return c;
}

/** Steel grate for vents / walkways. */
function grateTexture(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#2d3238';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#7d858e';
  for (let i = 0; i < 128; i += 16) {
    ctx.fillRect(i, 0, 4, 128);
    ctx.fillRect(0, i, 128, 4);
  }
  return c;
}

/** Street level asphalt with lane markings (1 repeat = 50 m city block). */
function streetTexture(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#b9bfc4';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#8c949b';
  ctx.fillRect(0, 0, 256, 70);
  ctx.fillRect(0, 0, 70, 256);
  ctx.fillStyle = '#e8e8e8';
  for (let x = 80; x < 256; x += 28) ctx.fillRect(x, 33, 14, 3);
  for (let y = 80; y < 256; y += 28) ctx.fillRect(33, y, 3, 14);
  speckle(ctx, 256, 256, 2000, 0.06, 41);
  return c;
}

export function createMaterials(renderer: THREE.WebGLRenderer): MaterialSet {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const roofTex = toTexture(roofTexture(), aniso);
  const officeTex = toTexture(officeTexture('white'), aniso);
  const warmTex = toTexture(officeTexture('warm'), aniso);
  const gridTex = toTexture(gridTexture(), aniso);
  const glassBlueTex = toTexture(glassTexture('blue'), aniso);
  const glassTealTex = toTexture(glassTexture('teal'), aniso);
  const skylineTex = toTexture(skylineTexture(), aniso);
  const grateTex = toTexture(grateTexture(), aniso);
  const streetTex = toTexture(streetTexture(), aniso);

  const std = (params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ vertexColors: true, ...params });

  return {
    roof: std({ map: roofTex, color: 0xffffff, roughness: 0.92, metalness: 0 }),
    roofGray: std({ map: roofTex, color: 0xd5d9dd, roughness: 0.95, metalness: 0 }),
    officeWhite: std({ map: officeTex, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.9 }),
    officeGrid: std({ map: gridTex, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.9 }),
    officeWarm: std({ map: warmTex, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.8 }),
    glassBlue: std({ map: glassBlueTex, roughness: 0.12, metalness: 0.65, envMapIntensity: 1.4 }),
    glassTeal: std({ map: glassTealTex, roughness: 0.14, metalness: 0.6, envMapIntensity: 1.3 }),
    white: std({ color: 0xf6f6f4, roughness: 0.7, metalness: 0 }),
    concrete: std({ map: roofTex, color: 0xdfe1e3, roughness: 0.9 }),
    red: std({ color: 0xe0211b, emissive: 0x5a0402, roughness: 0.42, metalness: 0.05 }),
    redMatte: std({ color: 0xd8251f, emissive: 0x2a0201, roughness: 0.75 }),
    metal: std({ color: 0xc3c8cd, roughness: 0.45, metalness: 0.45 }),
    darkMetal: std({ color: 0x5a6068, roughness: 0.55, metalness: 0.4 }),
    grate: std({ map: grateTex, roughness: 0.6, metalness: 0.4 }),
    glassRail: std({ color: 0xbfe3f2, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }),
    orange: std({ color: 0xf08a24, emissive: 0x2a1000, roughness: 0.6 }),
    street: std({ map: streetTex, roughness: 0.95, color: 0xc7ced4 }),
    skyline: std({ map: skylineTex, roughness: 0.8, color: 0xf2f6fa }),
  };
}

/** Billboard texture with an original, made-up brand. */
export function billboardTexture(title: string, subtitle: string, bg: string, fg: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(300, 0);
  ctx.lineTo(380, 0);
  ctx.lineTo(80, 256);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = 'bold 88px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 36, 108);
  ctx.font = '600 30px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.globalAlpha = 0.85;
  ctx.fillText(subtitle, 40, 186);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
