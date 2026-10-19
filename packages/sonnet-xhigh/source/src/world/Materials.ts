/**
 * Procedural materials. Everything is generated in shaders / vertex colours, no textures
 * are downloaded.
 *
 *  - arch  : white architecture. World-space procedural pattern: concrete roofs with
 *            expansion joints, and ribbon-window facades with reflective glazing.
 *  - glass : blue tinted reflective curtain-wall for the skyscrapers.
 *  - prop  : plain painted props, colour comes from vertex colours (baked soft AO).
 *  - red   : the "runner vision" red, slightly emissive so it always pops.
 *
 * arch and glass share one patched MeshStandardMaterial implementation; the patch works
 * in world space so the very same material can be used for merged level geometry and
 * for instanced background buildings with arbitrary scale.
 */

import * as THREE from 'three';

export interface MaterialSet {
  arch: THREE.MeshStandardMaterial;
  /** Same look as `arch` but tinted per instance (for InstancedMesh). */
  archInst: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  /** Glass look for level geometry (tint from baked vertex colours). */
  glassV: THREE.MeshStandardMaterial;
  prop: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  flag: THREE.MeshStandardMaterial;
  /** Shared time uniform (seconds) for animated materials. */
  time: { value: number };
  dispose(): void;
}

/** Display-space (sRGB) colour of the horizon haze; fog and sky use the same value so they blend. */
export const HAZE_DISPLAY: [number, number, number] = [0.80, 0.88, 0.96];
export const HAZE_COLOR = new THREE.Color().setRGB(HAZE_DISPLAY[0], HAZE_DISPLAY[1], HAZE_DISPLAY[2], THREE.SRGBColorSpace);

const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const ARCH_PATTERN = /* glsl */ `
  float archWin = 0.0;
  {
    vec3 wN = normalize(vWNrm);
    vec3 tint = diffuseColor.rgb;
    // Screen-space footprint of the world position. Derivatives are taken here, in
    // uniform control flow, and reused by the branches below.
    vec3 fw = fwidth(vWPos);
    if (wN.y > 0.7) {
      // ---- concrete roof
      float n1 = vnoise(vWPos.xz * 0.6);
      float n2 = vnoise(vWPos.xz * 4.0);
      float n3 = hash12(floor(vWPos.xz * 24.0));
      float tone = 0.93 + 0.07 * n1 - 0.035 * n2 + 0.025 * n3;
      vec2 g = abs(fract(vWPos.xz / 6.0 + 0.5) - 0.5) * 6.0;
      float jw = 0.045 + fw.x + fw.z;
      float joint = 1.0 - smoothstep(0.0, jw, min(g.x, g.y));
      float stain = smoothstep(0.58, 0.92, vnoise(vWPos.xz * 0.16 + 7.0)) * 0.09;
      tone *= 1.0 - 0.11 * joint;
      #if ARCH_STYLE == 1
        vec3 roofTint = vec3(1.0);   // glass towers still have plain white concrete roofs
      #else
        vec3 roofTint = tint;
      #endif
      diffuseColor.rgb = roofTint * vec3(0.86, 0.87, 0.89) * (tone - stain);
    } else if (wN.y < -0.7) {
      diffuseColor.rgb = tint * 0.5;
    } else {
      // ---- facade
      float u = abs(wN.x) > abs(wN.z) ? vWPos.z : vWPos.x;
      float floorH = 3.6;
      float bayW = 2.6;
      float fy = vWPos.y / floorH;
      float fi = floor(fy);
      float ly = fract(fy);
      float bx = u / bayW;
      float bi = floor(bx);
      float lx = fract(bx);
      float pxF = max(fw.y / floorH, 1e-5);
      float pxB = max((abs(wN.x) > abs(wN.z) ? fw.z : fw.x) / bayW, 1e-5);

      #if ARCH_STYLE == 1
        // glass curtain wall: panels with thin mullions and an opaque spandrel band
        float panel = hash12(vec2(bi, fi));
        float mull = 1.0 - smoothstep(0.0, 0.05 + pxB, min(lx, 1.0 - lx));
        float spand = 1.0 - smoothstep(0.20, 0.24 + pxF, ly);
        float win = (1.0 - spand) * (1.0 - mull);
        vec3 glassCol = tint * (0.78 + 0.5 * panel);
        vec3 frameCol = tint * 1.25 + 0.10;
        diffuseColor.rgb = mix(frameCol, glassCol, win);
        archWin = win;
      #else
        // white office block with ribbon windows
        float wy = smoothstep(0.27, 0.27 + pxF, ly) * (1.0 - smoothstep(0.80, 0.80 + pxF, ly));
        float wx = smoothstep(0.035, 0.035 + pxB, lx) * (1.0 - smoothstep(0.965 - pxB, 0.965, lx));
        float win = wy * wx;
        float lod = clamp(max(pxF, pxB) * 1.2, 0.0, 1.0);
        win = mix(win, 0.52, smoothstep(0.18, 0.7, lod));
        float vary = hash12(vec2(bi, fi) + 3.7);
        vec3 wallCol = tint * vec3(0.90, 0.91, 0.93) * (0.97 + 0.03 * hash12(vec2(fi, 1.0)));
        // slight shadow on the sill below each window band
        wallCol *= 1.0 - 0.10 * (1.0 - smoothstep(0.0, 0.27, ly));
        vec3 glassCol = vec3(0.07, 0.12, 0.19) * (0.7 + 0.9 * vary);
        if (vary > 0.9) glassCol = vec3(0.55, 0.62, 0.70);   // blinds
        diffuseColor.rgb = mix(wallCol, glassCol, win);
        archWin = win * (vary > 0.9 ? 0.0 : 1.0);
      #endif
    }
  }
`;

function patchArch(material: THREE.MeshStandardMaterial, style: 0 | 1): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 aWp = vec4(transformed, 1.0);
         vec3 aWn = objectNormal;
         #ifdef USE_INSTANCING
           aWp = instanceMatrix * aWp;
           aWn = mat3(instanceMatrix) * aWn;
         #endif
         aWp = modelMatrix * aWp;
         vWPos = aWp.xyz;
         vWNrm = normalize(mat3(modelMatrix) * aWn);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n#define ARCH_STYLE ${style}\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n${NOISE_GLSL}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ARCH_PATTERN}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = mix(roughnessFactor, ${style === 1 ? '0.10' : '0.07'}, archWin);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         metalnessFactor = mix(metalnessFactor, ${style === 1 ? '0.85' : '0.9'}, archWin);`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
         #ifdef USE_FOG
           // Height haze: facades dissolve into the street-level smog far below the rooftops.
           float hHaze = smoothstep(-22.0, -105.0, vWPos.y);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, hHaze * 0.93);
         #endif`,
      );
  };
  material.customProgramCacheKey = () => `arch-style-${style}`;
}

export function createMaterials(): MaterialSet {
  const time = { value: 0 };

  // Level geometry: tint comes from baked vertex colours.
  const arch = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.0,
    vertexColors: true,
  });
  patchArch(arch, 0);

  // Background city: tint comes from per-instance colours.
  const archInst = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.0,
  });
  patchArch(archInst, 0);

  const glass = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.2,
  });
  patchArch(glass, 1);

  const glassV = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.2,
    vertexColors: true,
  });
  patchArch(glassV, 1);

  const prop = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.02,
  });

  const red = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.0,
    emissive: new THREE.Color(0xff1408),
    emissiveIntensity: 0.16,
  });

  const flag = new THREE.MeshStandardMaterial({
    color: 0xe0231c,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0xff1408),
    emissiveIntensity: 0.14,
  });
  flag.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float wave = sin(uTime * 5.0 + transformed.x * 5.0 + float(gl_InstanceID) * 1.7);
         transformed.z += wave * 0.09 * transformed.x;
         transformed.y += sin(uTime * 3.1 + transformed.x * 3.0) * 0.03 * transformed.x;`,
      );
  };
  flag.customProgramCacheKey = () => 'flag';

  return {
    arch, archInst, glass, glassV, prop, red, flag, time,
    dispose() {
      arch.dispose();
      archInst.dispose();
      glass.dispose();
      glassV.dispose();
      prop.dispose();
      red.dispose();
      flag.dispose();
    },
  };
}
