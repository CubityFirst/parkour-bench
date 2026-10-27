import {
  CanvasTexture, Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture,
  type WebGLRenderer,
} from 'three';

/** Seeded PRNG so procedural textures and the city are stable between runs. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, renderer: WebGLRenderer, srgb = true): Texture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

/** Light concrete with subtle noise and expansion joints. Tile = 4 m. */
function concreteTexture(renderer: WebGLRenderer): Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#eceeef';
  g.fillRect(0, 0, 256, 256);
  const r = rng(7);
  for (let i = 0; i < 5000; i++) {
    const v = 220 + Math.floor(r() * 30);
    g.fillStyle = `rgba(${v},${v},${v + 2},${0.25 + r() * 0.2})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(160,165,170,${0.04 + r() * 0.05})`;
    g.beginPath();
    g.arc(r() * 256, r() * 256, 10 + r() * 40, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(150,155,160,0.35)';
  g.fillRect(0, 0, 256, 2);
  g.fillRect(0, 0, 2, 256);
  return toTexture(c, renderer);
}

/** White office facade with horizontal window bands. Tile = 4 m x 3.5 m (one floor). */
function facadeTexture(renderer: WebGLRenderer): Texture {
  const [c, g] = canvas(256, 224);
  g.fillStyle = '#f1f2f3';
  g.fillRect(0, 0, 256, 224);
  // window band
  const grad = g.createLinearGradient(0, 60, 0, 170);
  grad.addColorStop(0, '#5f7f9f');
  grad.addColorStop(0.5, '#86a7c4');
  grad.addColorStop(1, '#4c6a88');
  g.fillStyle = grad;
  g.fillRect(0, 62, 256, 104);
  // mullions
  g.fillStyle = '#e8eaec';
  for (let x = 0; x < 256; x += 64) g.fillRect(x, 62, 6, 104);
  g.fillRect(0, 112, 256, 3);
  // sill shadow
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 166, 256, 6);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 56, 256, 6);
  return toTexture(c, renderer);
}

/** Blue glass curtain wall. Tile = 3 m x 3.5 m. */
function glassTexture(renderer: WebGLRenderer): Texture {
  const [c, g] = canvas(192, 224);
  const grad = g.createLinearGradient(0, 0, 192, 224);
  grad.addColorStop(0, '#c4dcef');
  grad.addColorStop(0.5, '#8fb5d8');
  grad.addColorStop(1, '#b0cde6');
  g.fillStyle = grad;
  g.fillRect(0, 0, 192, 224);
  g.fillStyle = 'rgba(236,242,248,0.95)';
  g.fillRect(0, 0, 192, 7);
  g.fillRect(0, 0, 5, 224);
  g.fillStyle = 'rgba(236,242,248,0.5)';
  g.fillRect(96, 0, 2, 224);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(10, 10, 60, 200);
  return toTexture(c, renderer);
}

/** Dark metal grate for rooftop vents / AC units. Tile = 1 m. */
function grateTexture(renderer: WebGLRenderer): Texture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#2d3238';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#8e969e';
  for (let i = 0; i < 128; i += 16) {
    g.fillRect(i, 0, 3, 128);
    g.fillRect(0, i, 128, 3);
  }
  return toTexture(c, renderer);
}

/** Street level: asphalt with lane markings. Tile = 20 m. */
function streetTexture(renderer: WebGLRenderer): Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#8f969e';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#7b8189';
  g.fillRect(0, 100, 256, 56);
  g.fillStyle = '#e8e8e8';
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 126, 16, 3);
  return toTexture(c, renderer);
}

export interface WorldMaterials {
  roof: MeshStandardMaterial;
  facade: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  trim: MeshStandardMaterial;
  white: MeshStandardMaterial;
  gray: MeshStandardMaterial;
  darkGray: MeshStandardMaterial;
  grate: MeshStandardMaterial;
  red: MeshStandardMaterial;
  redDark: MeshStandardMaterial;
  orange: MeshStandardMaterial;
  street: MeshStandardMaterial;
  checkpointOff: MeshStandardMaterial;
  checkpointOn: MeshStandardMaterial;
  /** World-space UV tile size (metres) per material key. */
  tiles: Map<MeshStandardMaterial, [number, number]>;
}

export function createMaterials(renderer: WebGLRenderer): WorldMaterials {
  const concrete = concreteTexture(renderer);
  const facadeTex = facadeTexture(renderer);
  const glassTex = glassTexture(renderer);
  const grate = grateTexture(renderer);
  const street = streetTexture(renderer);

  const m = {
    roof: new MeshStandardMaterial({ color: 0xffffff, map: concrete, roughness: 0.88, metalness: 0 }),
    facade: new MeshStandardMaterial({ color: 0xffffff, map: facadeTex, roughness: 0.55, metalness: 0.05 }),
    glass: new MeshStandardMaterial({ color: 0xffffff, map: glassTex, roughness: 0.1, metalness: 0.6, envMapIntensity: 1.6 }),
    trim: new MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.6 }),
    white: new MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.7 }),
    gray: new MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.65, metalness: 0.15 }),
    darkGray: new MeshStandardMaterial({ color: 0x5d636b, roughness: 0.6, metalness: 0.2 }),
    grate: new MeshStandardMaterial({ color: 0xffffff, map: grate, roughness: 0.6, metalness: 0.3 }),
    red: new MeshStandardMaterial({ color: 0xe3242b, roughness: 0.45, emissive: new Color(0x3a0204) }),
    redDark: new MeshStandardMaterial({ color: 0xb51c22, roughness: 0.5, metalness: 0.2 }),
    orange: new MeshStandardMaterial({ color: 0xf28a1e, roughness: 0.5 }),
    street: new MeshStandardMaterial({ color: 0xffffff, map: street, roughness: 0.95 }),
    checkpointOff: new MeshStandardMaterial({ color: 0xe3242b, roughness: 0.4, emissive: new Color(0x550608) }),
    checkpointOn: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: new Color(0x66aaff), emissiveIntensity: 0.9 }),
  };
  const tiles = new Map<MeshStandardMaterial, [number, number]>([
    [m.roof, [4, 4]],
    [m.facade, [4, 3.5]],
    [m.glass, [4.5, 3.5]],
    [m.grate, [1, 1]],
    [m.street, [20, 20]],
  ]);
  return { ...m, tiles };
}
