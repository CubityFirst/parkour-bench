import * as THREE from 'three';

/**
 * Procedural surface materials. Everything is generated in the fragment shader from world
 * position (no textures to download, no UV unwrapping, works with merged and instanced meshes):
 *
 *  0 concrete - white roofs / walls with subtle noise, panel seams and weathering
 *  1 office   - white building: concrete walls with strip windows (dark reflective glass)
 *  2 glass    - blue-tinted curtain wall with white mullions and per-pane variation
 *  3 grate    - dark metal grating with lighter holes (vents, fans)
 *
 * Window panes switch the PBR parameters to a glossy metallic look so they pick up the sky
 * reflection from the scene's environment map.
 */
export type SurfaceStyle = 0 | 1 | 2 | 3;

const FRAG_HEADER = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float rfHash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
float rfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = rfHash(i);
  float b = rfHash(i + vec2(1.0, 0.0));
  float c = rfHash(i + vec2(0.0, 1.0));
  float d = rfHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// 1 near integer values of x (a thin line), anti-aliased with screen derivatives.
float rfSeam(float x, float w) {
  float f = abs(fract(x + 0.5) - 0.5);
  float aa = fwidth(x) * 1.2 + 1e-4;
  return 1.0 - smoothstep(w, w + aa, f);
}
// 1 inside [a,b], 0 outside (anti-aliased).
float rfBand(float x, float a, float b) {
  float aa = fwidth(x) * 0.8 + 1e-4;
  return smoothstep(a - aa, a + aa, x) - smoothstep(b - aa, b + aa, x);
}
vec3 rfConcrete(vec2 p, float top) {
  float n1 = rfNoise(p * 0.31);
  float n2 = rfNoise(p * 2.7);
  float n3 = rfNoise(p * 13.0);
  float v = 0.935 + 0.05 * n1 + 0.025 * (n2 - 0.5) + 0.02 * (n3 - 0.5);
  float sx = rfSeam(p.x / 4.0, 0.010);
  float sy = rfSeam(p.y / (top > 0.5 ? 4.0 : 2.0), 0.010);
  v *= 1.0 - 0.14 * max(sx, sy);
  v *= 1.0 - 0.05 * smoothstep(0.62, 0.9, rfNoise(p * 0.11 + 7.0));
  if (top < 0.5) v *= 1.0 - 0.035 * rfNoise(vec2(p.x * 1.7, p.y * 0.12));
  return vec3(v) * vec3(0.985, 1.0, 1.02);
}
`;

function fragmentBody(style: SurfaceStyle): string {
  const common = /* glsl */ `
  vec3 rfN = normalize(vWorldNormal);
  float rfTop = step(0.5, rfN.y);
  float rfH = vWorldPos.x * abs(rfN.z) + vWorldPos.z * abs(rfN.x);
  vec2 rfP = mix(vec2(rfH, vWorldPos.y), vWorldPos.xz, rfTop);
  vec3 rfVcol = vec3(1.0);
  #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
    rfVcol = vColor.rgb;
  #endif
  float surfGlass = 0.0;
  vec3 rfPat = vec3(1.0);
  `;
  let body = '';
  if (style === 0) {
    body = /* glsl */ `
    rfPat = rfConcrete(rfP, rfTop);
    `;
  } else if (style === 1) {
    body = /* glsl */ `
    vec3 wall = rfConcrete(rfP, rfTop);
    rfPat = wall;
    if (rfTop < 0.5) {
      float cy = rfP.y / 3.7;
      float cx = rfP.x / 2.6;
      float fy = fract(cy);
      float fx = fract(cx);
      float win = rfBand(fy, 0.27, 0.80) * rfBand(fx, 0.035, 0.965);
      float r = rfHash(floor(vec2(cx, cy)));
      vec3 glassCol = mix(vec3(0.040, 0.075, 0.135), vec3(0.16, 0.29, 0.44), clamp(r * 0.85 + (1.0 - fy) * 0.35, 0.0, 1.0));
      // soft shadow under each window band + darker sill line
      wall *= 1.0 - 0.10 * rfBand(fy, 0.17, 0.27);
      wall *= 1.0 - 0.06 * rfSeam(cy, 0.012);
      float fade = smoothstep(0.10, 0.40, fwidth(cy));
      win = mix(win, 0.49, fade);
      rfPat = mix(wall, glassCol, win);
      surfGlass = win;
    }
    `;
  } else if (style === 2) {
    body = /* glsl */ `
    rfPat = rfConcrete(rfP, rfTop) * vec3(0.9, 0.93, 0.97);
    if (rfTop < 0.5) {
      vec2 q = rfP / vec2(1.9, 3.1);
      vec2 f = fract(q);
      float pane = rfBand(f.x, 0.022, 0.978) * rfBand(f.y, 0.030, 0.970);
      float spandrel = rfBand(f.y, 0.030, 0.20);
      float r = rfHash(floor(q));
      float skyT = smoothstep(-40.0, 170.0, vWorldPos.y);
      vec3 sky = mix(vec3(0.16, 0.36, 0.58), vec3(0.58, 0.78, 0.94), skyT);
      vec3 paneCol = sky * (0.62 + 0.38 * r) * (0.82 + 0.18 * f.y);
      vec3 spanCol = vec3(0.55, 0.62, 0.70) * (0.8 + 0.2 * r);
      float fade = smoothstep(0.10, 0.40, max(fwidth(q.x), fwidth(q.y)));
      vec3 frameCol = vec3(0.86, 0.89, 0.93);
      vec3 glassCol = mix(paneCol, spanCol, spandrel * 0.85);
      vec3 detail = mix(frameCol, glassCol, pane);
      vec3 avg = mix(frameCol, glassCol, 0.88);
      rfPat = mix(detail, avg, fade);
      surfGlass = mix(pane * (1.0 - spandrel * 0.7), 0.7, fade);
    }
    `;
  } else {
    body = /* glsl */ `
    vec2 gq = rfP / 0.11;
    vec2 gf = fract(gq);
    float hole = rfBand(gf.x, 0.18, 0.82) * rfBand(gf.y, 0.18, 0.82);
    float gfade = smoothstep(0.25, 0.7, max(fwidth(gq.x), fwidth(gq.y)));
    hole = mix(hole, 0.45, gfade);
    rfPat = mix(vec3(0.05, 0.055, 0.06), vec3(0.32, 0.34, 0.37), hole * 0.8);
    `;
  }
  return (
    common +
    body +
    /* glsl */ `
  diffuseColor.rgb = diffuse * rfVcol * rfPat;
  `
  );
}

function patchSurface(material: THREE.MeshStandardMaterial, style: SurfaceStyle): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vec4 rfWp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          rfWp = instanceMatrix * rfWp;
        #endif
        rfWp = modelMatrix * rfWp;
        vWorldPos = rfWp.xyz;
        vWorldNormal = normalize( mat3( modelMatrix ) * normal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEADER)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + fragmentBody(style))
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n roughnessFactor = mix( roughnessFactor, 0.07, surfGlass );',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\n metalnessFactor = mix( metalnessFactor, 0.92, surfGlass );',
      );
  };
  material.customProgramCacheKey = () => `rooftop-surface-${style}`;
}

export interface SurfaceMaterials {
  building: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  grate: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
}

export function createSurfaceMaterials(): SurfaceMaterials {
  const building = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, vertexColors: true });
  patchSurface(building, 1);
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, vertexColors: true });
  patchSurface(glass, 2);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true });
  patchSurface(concrete, 0);
  const grate = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.5, vertexColors: true });
  patchSurface(grate, 3);
  const red = new THREE.MeshStandardMaterial({ color: 0xe0121a, roughness: 0.42, metalness: 0.02, vertexColors: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.4, vertexColors: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf1f3f6, roughness: 0.45, metalness: 0.25, vertexColors: true });
  return { building, glass, concrete, grate, red, dark, trim };
}

/** Facade materials for the instanced background city. */
export function createCityMaterials(): {
  office: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
} {
  const office = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, vertexColors: true });
  patchSurface(office, 1);
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, vertexColors: true });
  patchSurface(glass, 2);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true });
  patchSurface(concrete, 0);
  return { office, glass, concrete };
}
