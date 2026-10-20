import * as THREE from 'three';
import type { MatKey } from './LevelBuilder.ts';

/**
 * Shared procedural materials. Everything is a MeshStandardMaterial so lighting, cascaded shadows,
 * fog, image-based reflections and tone mapping all work out of the box; the facade / roof / noise
 * detail is injected into the stock shader with `onBeforeCompile` and driven purely by world position,
 * so no textures or UVs are needed.
 */

const NOISE_GLSL = /* glsl */ `
float fh21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fh21(i);
  float b = fh21(i + vec2(1.0, 0.0));
  float c = fh21(i + vec2(0.0, 1.0));
  float d = fh21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbox(vec2 c, vec2 lo, vec2 hi, vec2 e) {
  vec2 a = smoothstep(lo - e, lo + e, c);
  vec2 b = 1.0 - smoothstep(hi - e, hi + e, c);
  return a.x * a.y * b.x * b.y;
}
`;

export const FACADE_VERTEX_PARS = /* glsl */ `
#if FACADE_MODE == 1
  attribute vec4 aFacade;
#endif
varying vec4 vFacade;
varying vec3 vWPos;
varying vec3 vWNrm;
`;

export const FACADE_VERTEX_MAIN = /* glsl */ `
vec4 fwp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  fwp = instanceMatrix * fwp;
#endif
fwp = modelMatrix * fwp;
vWPos = fwp.xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
#if FACADE_MODE == 1
  vFacade = aFacade;
#else
  vFacade = vec4(3.0, 0.0, 0.5, 0.0);
#endif
`;

export const FACADE_FRAGMENT_PARS = /* glsl */ `
varying vec4 vFacade;
varying vec3 vWPos;
varying vec3 vWNrm;
${NOISE_GLSL}
`;

/** Replaces diffuse colour with the procedural facade / roof / noise pattern; defines fWin (glass mask). */
export const FACADE_FRAGMENT_COLOR = /* glsl */ `
float fWin = 0.0;
{
  vec3 fn = normalize(vWNrm);
  vec3 fp = vWPos;
  vec3 col = diffuseColor.rgb;
  vec3 glass = vec3(0.0);
#if FACADE_MODE == 1
  float style = vFacade.x;
  float topY = vFacade.y;
  float seed = vFacade.z;
  float accent = vFacade.w;
  if (fn.y > 0.5) {
    // ---- roof membrane: seams every 2.4 m + gentle mottling ----
    vec2 q = fp.xz;
    vec2 aa = fwidth(q);
    vec2 g = abs(fract(q / 2.4 + 0.5) - 0.5) * 2.4;
    float sx = smoothstep(0.0, 0.035 + aa.x, g.x);
    float sz = smoothstep(0.0, 0.035 + aa.y, g.y);
    float seam = 1.0 - min(sx, sz);
    float lodFade = 1.0 - smoothstep(0.35, 1.2, max(aa.x, aa.y));
    float m = fnoise(q * 0.21 + seed * 37.0) * 0.6 + fnoise(q * 0.83 + seed * 11.0) * 0.4;
    col *= (0.935 + 0.1 * m);
    col *= 1.0 - 0.09 * seam * lodFade;
  } else if (fn.y < -0.5) {
    col *= 0.78;
  } else {
    float hh = abs(fn.x) > 0.5 ? fp.z : fp.x;
    float y = fp.y;
    vec2 cell;
    vec2 c;
    vec2 e;
    float win = 0.0;
    float avg = 0.0;
    vec3 gBase = vec3(0.2, 0.34, 0.5);
    if (style < 0.5) {
      cell = vec2(hh / 3.2 + seed * 7.0, y / 3.6);
      c = fract(cell);
      e = fwidth(cell) * 0.8 + 0.002;
      win = fbox(c, vec2(0.035, 0.30), vec2(0.965, 0.84), e);
      avg = 0.50;
    } else if (style < 1.5) {
      cell = vec2(hh / 1.6 + seed * 3.0, y / 3.6);
      c = fract(cell);
      e = fwidth(cell) * 0.8 + 0.002;
      win = fbox(c, vec2(0.045, 0.17), vec2(0.955, 1.5), e);
      float spandrel = fbox(c, vec2(-1.0, 0.0), vec2(2.0, 0.17), e);
      col = mix(col, vec3(0.45, 0.56, 0.7), spandrel * 0.85);
      gBase = vec3(0.27, 0.5, 0.76);
      avg = 0.78;
    } else if (style < 2.5) {
      cell = vec2(hh / 3.0 + seed * 5.0, y / 3.6);
      c = fract(cell);
      e = fwidth(cell) * 0.8 + 0.002;
      win = fbox(c, vec2(0.2, 0.26), vec2(0.8, 0.82), e);
      float sill = fbox(c, vec2(0.16, 0.2), vec2(0.84, 0.26), e);
      col = mix(col, col * 0.8, sill * (1.0 - win));
      avg = 0.34;
    } else {
      cell = vec2(hh / 1.6, y / 3.6);
      c = fract(cell);
      e = fwidth(cell) * 0.8 + 0.002;
      float seamLine = 1.0 - smoothstep(0.0, 0.018 + e.x, min(c.x, 1.0 - c.x));
      col *= 1.0 - 0.06 * seamLine * (1.0 - smoothstep(0.3, 0.8, e.x));
      win = 0.0;
      avg = 0.0;
      if (style > 3.5) {
        // roof trim band: plain, with a shadow gap under it
        col *= mix(0.86, 1.0, smoothstep(topY - 0.42, topY - 0.22, y));
      }
    }
    // distance LOD: collapse the pattern to its average colour to avoid shimmer
    float fw = max(fwidth(cell.x), fwidth(cell.y));
    float lod = smoothstep(0.1, 0.38, fw);
    win = mix(win, avg, lod);
    float r = fh21(floor(cell) + seed * 19.0);
    glass = gBase * (0.7 + 0.6 * r);
    // accent band just below the roofline
    if (accent > 0.5 && style < 3.5 && style != 1.0) {
      float ab = smoothstep(topY - 2.0, topY - 1.95, y) * (1.0 - smoothstep(topY - 0.95, topY - 0.9, y));
      vec3 ac = accent < 1.5 ? vec3(0.86, 0.1, 0.07) : (accent < 2.5 ? vec3(0.98, 0.42, 0.1) : vec3(0.12, 0.38, 0.78));
      col = mix(col, ac, ab);
      win *= 1.0 - ab;
    }
    // faint grime toward street level and vertical streaking
    col *= mix(0.86, 1.0, smoothstep(2.0, 48.0, y));
    col *= 0.955 + 0.07 * fnoise(vec2(hh * 0.11 + seed * 23.0, y * 0.035));
    fWin = win;
  }
#else
  // Props: gentle mottling only.
  float m = fnoise(fp.xz * 0.9 + fp.y * 0.6) * 0.6 + fnoise(fp.xz * 3.1 + fp.y * 2.3) * 0.4;
  col *= 0.95 + 0.08 * m;
#endif
  diffuseColor.rgb = mix(col, glass, fWin);
}
`;

export const FACADE_FRAGMENT_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.15, fWin);
`;
export const FACADE_FRAGMENT_METAL = /* glsl */ `
metalnessFactor = mix(metalnessFactor, 0.88, fWin);
`;

export function patchSurface(material: THREE.MeshStandardMaterial, mode: 'facade' | 'noise'): void {
  const modeValue = mode === 'facade' ? '1' : '0';
  material.defines = { ...(material.defines ?? {}), FACADE_MODE: modeValue };
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FACADE_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_FRAGMENT_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FACADE_FRAGMENT_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FACADE_FRAGMENT_METAL}`)
      // A mirror-like sun glint can exceed the half-float range of the HDR target (Inf -> NaN through bloom).
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(24.0));\n#include <tonemapping_fragment>');
  };
  material.customProgramCacheKey = () => `surface-${modeValue}`;
}

/** Cloth flags: waving is done in the vertex shader from the baked `aFlag` attribute (u along the flag). */
function patchFlag(material: THREE.MeshStandardMaterial, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFlag;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float fu = aFlag.x;
float wave = sin(uTime * 5.0 - fu * 7.0 + aFlag.y) * 0.16 + sin(uTime * 8.3 - fu * 12.0 + aFlag.y * 1.7) * 0.05;
transformed += normal * wave * fu;
transformed.y -= fu * fu * 0.06;`,
      );
  };
  material.customProgramCacheKey = () => 'flag';
}

export interface MaterialLib {
  /** Look up a material by the keys used in the level layout. */
  get(key: MatKey): THREE.MeshStandardMaterial;
  building: THREE.MeshStandardMaterial;
  buildingInstanced: THREE.MeshStandardMaterial;
  flagOrange: THREE.MeshStandardMaterial;
  flagRed: THREE.MeshStandardMaterial;
  ao: THREE.MeshBasicMaterial;
  time: { value: number };
  dispose(): void;
}

function makeBlobTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Soft rounded-rectangle falloff: dark core fading to nothing at the edge.
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = Math.abs((x + 0.5) / size - 0.5) * 2;
      const v = Math.abs((y + 0.5) / size - 0.5) * 2;
      const d = Math.pow(Math.pow(u, 3) + Math.pow(v, 3), 1 / 3);
      const a = Math.max(0, 1 - d);
      const k = a * a * (3 - 2 * a);
      const i = (y * size + x) * 4;
      img.data[i] = 20;
      img.data[i + 1] = 34;
      img.data[i + 2] = 58;
      img.data[i + 3] = Math.round(255 * k);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createMaterials(): MaterialLib {
  const time = { value: 0 };
  const disposables: Array<{ dispose(): void }> = [];

  const std = (params: THREE.MeshStandardMaterialParameters, noise = true): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial(params);
    if (noise) patchSurface(m, 'noise');
    disposables.push(m);
    return m;
  };

  const building = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, vertexColors: true });
  patchSurface(building, 'facade');
  disposables.push(building);

  const buildingInstanced = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 });
  patchSurface(buildingInstanced, 'facade');
  disposables.push(buildingInstanced);

  const lib: Record<MatKey, THREE.MeshStandardMaterial> = {
    building,
    white: std({ color: 0xf3f5f7, roughness: 0.82 }),
    trim: std({ color: 0xe6e9ec, roughness: 0.9 }),
    red: std({ color: 0xe0150f, roughness: 0.42, emissive: 0x4a0300, emissiveIntensity: 0.55 }),
    redDark: std({ color: 0xa30d0a, roughness: 0.5, emissive: 0x2a0200, emissiveIntensity: 0.5 }),
    concrete: std({ color: 0xc3c8cd, roughness: 0.95 }),
    metal: std({ color: 0x9aa5ae, roughness: 0.42, metalness: 0.65 }),
    dark: std({ color: 0x20262d, roughness: 0.6, metalness: 0.2 }, false),
    glass: std({ color: 0x3f6f9e, roughness: 0.16, metalness: 0.9 }),
    orange: std({ color: 0xff6a1a, roughness: 0.6, emissive: 0x401200, emissiveIntensity: 0.4 }, false),
    grate: std({ color: 0x1b1f24, roughness: 0.7, metalness: 0.4 }, false),
    panel: std({ color: 0xd8120d, roughness: 0.36, emissive: 0x500300, emissiveIntensity: 0.7 }),
  };

  const makeFlag = (color: number, emissive: number) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide, emissive, emissiveIntensity: 0.45 });
    patchFlag(m, time);
    disposables.push(m);
    return m;
  };

  const blob = makeBlobTexture();
  disposables.push(blob);
  const ao = new THREE.MeshBasicMaterial({
    map: blob,
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: true,
  });
  disposables.push(ao);

  return {
    get: (key) => lib[key],
    building,
    buildingInstanced,
    flagOrange: makeFlag(0xff6a1a, 0x401200),
    flagRed: makeFlag(0xe0150f, 0x400300),
    ao,
    time,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
