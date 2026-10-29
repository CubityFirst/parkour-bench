import * as THREE from 'three';

/**
 * Shared palette + materials for the whole game.
 *
 * Everything is procedural: flat-ish MeshStandardMaterial with a couple of
 * shader tweaks (world-space panel grid on roofs, gradient sky) so the city
 * reads as designed architecture instead of a pile of untextured cubes.
 */

export type MaterialKey =
  | 'roof'
  | 'white'
  | 'concrete'
  | 'glass'
  | 'red'
  | 'redDark'
  | 'dark'
  | 'metal'
  | 'glow';

export type MaterialSet = Record<MaterialKey, THREE.Material>;

export const PALETTE = {
  roof: 0xf6f8fa,
  white: 0xeef1f5,
  concrete: 0xbcc3cc,
  glass: 0x7fb8dd,
  red: 0xe0202c,
  redDark: 0x9d1620,
  dark: 0x39404a,
  metal: 0x98a1ac,
  skyTop: 0x1f6fc4,
  skyHorizon: 0xbcd9f2,
  sun: 0xfff4de,
  haze: 0xb9d3ea,
};

export function createMaterials(): MaterialSet {
  const roof = new THREE.MeshStandardMaterial({
    color: PALETTE.roof,
    roughness: 0.82,
    metalness: 0.03,
  });
  applyWorldGrid(roof, 4.0, 0.55);

  const white = new THREE.MeshStandardMaterial({
    color: PALETTE.white,
    roughness: 0.62,
    metalness: 0.04,
  });

  const concrete = new THREE.MeshStandardMaterial({
    color: PALETTE.concrete,
    roughness: 0.9,
    metalness: 0.02,
  });

  const glass = new THREE.MeshStandardMaterial({
    color: PALETTE.glass,
    roughness: 0.08,
    metalness: 0.92,
    envMapIntensity: 1.6,
  });

  const red = new THREE.MeshStandardMaterial({
    color: PALETTE.red,
    roughness: 0.42,
    metalness: 0.08,
  });

  const redDark = new THREE.MeshStandardMaterial({
    color: PALETTE.redDark,
    roughness: 0.55,
    metalness: 0.1,
  });

  const dark = new THREE.MeshStandardMaterial({
    color: PALETTE.dark,
    roughness: 0.5,
    metalness: 0.35,
  });

  const metal = new THREE.MeshStandardMaterial({
    color: PALETTE.metal,
    roughness: 0.35,
    metalness: 0.7,
  });

  const glow = new THREE.MeshStandardMaterial({
    color: 0xff5560,
    emissive: 0xff2230,
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0,
  });

  return { roof, white, concrete, glass, red, redDark, dark, metal, glow };
}

/**
 * Injects a subtle world-space panel grid into a standard material.
 * Uses screen-space derivatives so the lines stay crisp at any distance.
 */
export function applyWorldGrid(
  material: THREE.Material,
  scale: number,
  strength: number
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGridScale = { value: scale };
    shader.uniforms.uGridStrength = { value: strength };
    shader.uniforms.uGridColor = { value: new THREE.Color(0xc9d1da) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        uniform float uGridScale;
        uniform float uGridStrength;
        uniform vec3 uGridColor;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vWorldNormal.y > 0.55) {
          vec2 g = vWorldPosition.xz / uGridScale;
          vec2 d = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-4));
          float line = 1.0 - min(min(d.x, d.y), 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uGridColor, line * uGridStrength);
        }`
      );
  };
  material.customProgramCacheKey = () => `grid-${scale}-${strength}`;
}
