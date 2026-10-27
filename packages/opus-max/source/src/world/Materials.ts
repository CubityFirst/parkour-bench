import * as THREE from 'three';
import type { Style } from './LevelData.ts';

/**
 * Shared materials and procedurally drawn textures (no image files).
 *
 * Facade textures are tiled in world units (see GeometryBuilder), so one material covers
 * every building regardless of size. Each facade also gets a roughness/metalness map, so
 * glass reflects the sky environment while walls stay matte.
 */

const PX_PER_M = 64;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return [c, ctx];
}

/** Deterministic noise for texture detail. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface FacadeTextures {
  map: THREE.CanvasTexture;
  rm: THREE.CanvasTexture;
  tileW: number;
  tileH: number;
}

/** Paints colour and roughness/metalness canvases with the same layout callback. */
function paintFacade(
  tileW: number,
  tileH: number,
  draw: (color: CanvasRenderingContext2D, rm: CanvasRenderingContext2D, px: (m: number) => number) => void,
): FacadeTextures {
  const w = Math.round(tileW * PX_PER_M);
  const h = Math.round(tileH * PX_PER_M);
  const [cc, color] = canvas(w, h);
  const [rc, rm] = canvas(w, h);
  draw(color, rm, (m) => m * PX_PER_M);
  return { map: new THREE.CanvasTexture(cc), rm: new THREE.CanvasTexture(rc), tileW, tileH };
}

/**
 * rgb() string for a roughness/metalness texel: G = roughness, B = metalness.
 * Glossy surfaces stay at roughness >= 0.14: sharper sun highlights overflow the
 * half-float HDR buffer used for bloom.
 */
const rmColor = (roughness: number, metalness: number) => `rgb(255, ${Math.round(roughness * 255)}, ${Math.round(metalness * 255)})`;

function whiteOfficeFacade(): FacadeTextures {
  // Two floors of 3.5 m, 6 m wide: white slab bands with continuous strip windows.
  return paintFacade(6, 7, (c, rm, px) => {
    const rand = rng(7);
    const W = px(6);
    c.fillStyle = '#f1f2f3';
    c.fillRect(0, 0, W, px(7));
    rm.fillStyle = rmColor(0.85, 0);
    rm.fillRect(0, 0, W, px(7));
    for (let f = 0; f < 2; f++) {
      // Canvas y grows downwards; floor f occupies [f*3.5, f*3.5 + 3.5] from the top.
      const top = px(f * 3.5);
      const winTop = top + px(0.3);
      const winH = px(2.15);
      for (let i = 0; i < 4; i++) {
        const x0 = px(i * 1.5) + px(0.05);
        const x1 = px((i + 1) * 1.5) - px(0.05);
        const shade = 0.85 + rand() * 0.3;
        const g = c.createLinearGradient(0, winTop, 0, winTop + winH);
        g.addColorStop(0, `rgb(${32 * shade}, ${46 * shade}, ${62 * shade})`);
        g.addColorStop(0.55, `rgb(${58 * shade}, ${82 * shade}, ${108 * shade})`);
        g.addColorStop(1, `rgb(${78 * shade}, ${106 * shade}, ${134 * shade})`);
        c.fillStyle = g;
        c.fillRect(x0, winTop, x1 - x0, winH);
        if (rand() < 0.25) {
          // Lowered blinds behind some panes.
          c.fillStyle = 'rgba(214, 220, 226, 0.85)';
          c.fillRect(x0, winTop, x1 - x0, winH * (0.25 + rand() * 0.45));
        }
        rm.fillStyle = rmColor(0.14, 0.55);
        rm.fillRect(x0, winTop, x1 - x0, winH);
      }
      // Recess shadow under the slab, and a crisp sill line.
      c.fillStyle = 'rgba(70, 82, 96, 0.55)';
      c.fillRect(0, winTop, W, px(0.07));
      c.fillStyle = '#d5dade';
      c.fillRect(0, winTop + winH, W, px(0.05));
    }
  });
}

function glassTowerFacade(): FacadeTextures {
  // One 3.5 m floor, 3 m wide: two tall blue panes with slim aluminium mullions.
  return paintFacade(3, 3.5, (c, rm, px) => {
    const rand = rng(11);
    const W = px(3);
    const H = px(3.5);
    c.fillStyle = '#c9d4de';
    c.fillRect(0, 0, W, H);
    rm.fillStyle = rmColor(0.35, 0.8);
    rm.fillRect(0, 0, W, H);
    // Spandrel band at the floor line.
    c.fillStyle = '#3f6a92';
    c.fillRect(0, H - px(0.55), W, px(0.5));
    rm.fillStyle = rmColor(0.18, 0.6);
    rm.fillRect(0, H - px(0.55), W, px(0.5));
    for (let i = 0; i < 2; i++) {
      const x0 = px(i * 1.5) + px(0.035);
      const x1 = px((i + 1) * 1.5) - px(0.035);
      const y0 = px(0.035);
      const y1 = H - px(0.6);
      const t = 0.9 + rand() * 0.18;
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, `rgb(${120 * t}, ${170 * t}, ${214 * t})`);
      g.addColorStop(1, `rgb(${74 * t}, ${124 * t}, ${172 * t})`);
      c.fillStyle = g;
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
      rm.fillStyle = rmColor(0.14, 0.85);
      rm.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  });
}

function concreteFacade(): FacadeTextures {
  // One 3.5 m floor, 4 m wide: light concrete with a deep punched window.
  return paintFacade(4, 3.5, (c, rm, px) => {
    const rand = rng(23);
    const W = px(4);
    const H = px(3.5);
    c.fillStyle = '#e1e3e5';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      const v = 200 + rand() * 40;
      c.fillStyle = `rgba(${v}, ${v}, ${v + 4}, 0.25)`;
      c.fillRect(rand() * W, rand() * H, 2, 2);
    }
    rm.fillStyle = rmColor(0.95, 0);
    rm.fillRect(0, 0, W, H);
    const x0 = px(1.0);
    const x1 = px(3.0);
    const y0 = px(0.75);
    const y1 = px(2.75);
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#22303f');
    g.addColorStop(1, '#4a627a');
    c.fillStyle = g;
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    rm.fillStyle = rmColor(0.15, 0.45);
    rm.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Recess shading on the top and left reveals, a lit sill at the bottom.
    c.fillStyle = 'rgba(40, 50, 62, 0.55)';
    c.fillRect(x0, y0, x1 - x0, px(0.12));
    c.fillRect(x0, y0, px(0.1), y1 - y0);
    c.fillStyle = '#f4f5f6';
    c.fillRect(x0 - px(0.05), y1, x1 - x0 + px(0.1), px(0.08));
    // Faint horizontal joint at the floor line.
    c.fillStyle = 'rgba(150, 156, 164, 0.5)';
    c.fillRect(0, H - px(0.03), W, px(0.03));
  });
}

function roofTexture(): THREE.CanvasTexture {
  // 4 m x 4 m of clean, slightly mottled roofing with 2 m panel joints.
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = rng(5);
  ctx.fillStyle = '#efefed';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = 222 + rand() * 30;
    ctx.fillStyle = `rgba(${v}, ${v}, ${v - 2}, 0.35)`;
    const s = 1 + rand() * 2.5;
    ctx.fillRect(rand() * S, rand() * S, s, s);
  }
  for (let i = 0; i < 14; i++) {
    const g = ctx.createRadialGradient(rand() * S, rand() * S, 0, rand() * S, rand() * S, 20 + rand() * 50);
    g.addColorStop(0, 'rgba(210, 212, 214, 0.18)');
    g.addColorStop(1, 'rgba(210, 212, 214, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.fillStyle = 'rgba(190, 194, 199, 0.32)';
  ctx.fillRect(0, 0, S, 1.5);
  ctx.fillRect(0, S / 2, S, 1.5);
  ctx.fillRect(0, 0, 1.5, S);
  ctx.fillRect(S / 2, 0, 1.5, S);
  return new THREE.CanvasTexture(c);
}

function grateTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#2b3036';
  ctx.fillRect(0, 0, S, S);
  const n = 8;
  const cell = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const g = ctx.createRadialGradient(i * cell + cell / 2, j * cell + cell / 2, 1, i * cell + cell / 2, j * cell + cell / 2, cell * 0.55);
      g.addColorStop(0, '#9aa3ad');
      g.addColorStop(1, '#4a525b');
      ctx.fillStyle = g;
      ctx.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
    }
  }
  return new THREE.CanvasTexture(c);
}

export function bannerTexture(text: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 96);
  ctx.fillStyle = '#e2231a';
  ctx.fillRect(0, 0, 1024, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spaced = text.split('').join('\u2009\u2009');
  ctx.fillText(spaced, 512, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export type MaterialKey = Style | 'grate' | 'ground' | 'crane';

export class Materials {
  readonly byKey = new Map<MaterialKey, THREE.Material>();
  /** World-space tile sizes for facade styles (used to generate UVs). */
  readonly tiles: Partial<Record<Style, { w: number; h: number }>> = {};
  private readonly textures: THREE.Texture[] = [];

  constructor(maxAnisotropy: number) {
    const aniso = Math.min(8, maxAnisotropy);
    const prep = (t: THREE.Texture, srgb: boolean, repeatW = 1, repeatH = 1) => {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      t.repeat.set(1 / repeatW, 1 / repeatH);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(t);
      return t;
    };

    const facade = (key: Style, tex: FacadeTextures, envMapIntensity: number) => {
      prep(tex.map, true, tex.tileW, tex.tileH);
      prep(tex.rm, false, tex.tileW, tex.tileH);
      this.tiles[key] = { w: tex.tileW, h: tex.tileH };
      this.byKey.set(
        key,
        new THREE.MeshStandardMaterial({
          map: tex.map,
          roughnessMap: tex.rm,
          metalnessMap: tex.rm,
          roughness: 1,
          metalness: 1,
          envMapIntensity,
        }),
      );
    };
    facade('facadeWhite', whiteOfficeFacade(), 1.0);
    facade('facadeGlass', glassTowerFacade(), 1.15);
    facade('facadeConcrete', concreteFacade(), 0.9);

    const roof = prep(roofTexture(), true, 4, 4);
    this.byKey.set('roof', new THREE.MeshStandardMaterial({ map: roof, roughness: 0.92, metalness: 0, vertexColors: true }));
    const grate = prep(grateTexture(), true, 1, 1);
    this.byKey.set('grate', new THREE.MeshStandardMaterial({ map: grate, roughness: 0.6, metalness: 0.4 }));

    const flat = (key: MaterialKey, color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => {
      this.byKey.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true, ...extra }));
    };
    flat('white', 0xf2f2f0, 0.78);
    flat('grey', 0xc3c8ce, 0.7, 0.05);
    flat('dark', 0x3a3f47, 0.6, 0.25);
    flat('red', 0xe2231a, 0.48, 0.0);
    flat('metal', 0xd2d7dc, 0.38, 0.75);
    flat('glass', 0x8fbde3, 0.14, 0.7);
    flat('orange', 0xf08a24, 0.6);
    flat('blue', 0x2f7fd1, 0.5, 0.1);
    flat('crane', 0xd94a2b, 0.6, 0.2);
    this.byKey.set('ground', new THREE.MeshStandardMaterial({ color: 0xa9b0b7, roughness: 1, metalness: 0 }));
  }

  get(key: MaterialKey): THREE.Material {
    const m = this.byKey.get(key);
    if (!m) throw new Error(`Unknown material ${key}`);
    return m;
  }

  dispose(): void {
    for (const m of this.byKey.values()) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
