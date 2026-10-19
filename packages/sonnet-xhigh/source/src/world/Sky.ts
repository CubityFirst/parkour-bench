/**
 * Procedural sky: bright blue gradient, soft cumulus clouds and a sun glow, drawn on an
 * inverted dome that follows the camera. The same shader also feeds a PMREM environment
 * map so glass and windows reflect the sky and the scene gets soft image based light.
 */

import * as THREE from 'three';
import { HAZE_DISPLAY } from './Materials';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uTime;
uniform float uLinear;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  vec3 zenith = vec3(0.07, 0.31, 0.78);
  vec3 mid = vec3(0.26, 0.56, 0.93);
  vec3 low = vec3(0.55, 0.77, 0.97);

  vec3 col = mix(uHaze, low, smoothstep(0.0, 0.10, h));
  col = mix(col, mid, smoothstep(0.08, 0.38, h));
  col = mix(col, zenith, smoothstep(0.30, 0.95, h));
  // below the horizon: smoggy city colour
  col = mix(col, uHaze * 0.96, smoothstep(0.0, -0.12, h));

  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  // (the environment map gets only a faint glow, otherwise roofs show a distracting hot spot)
  float glow = mix(1.0, 0.25, uLinear);
  col += vec3(1.0, 0.92, 0.75) * (pow(sd, 1400.0) * 3.0 + pow(sd, 90.0) * 0.35 * glow + pow(sd, 8.0) * 0.14 * glow);

  // clouds (projected onto a plane above the viewer)
  if (h > 0.01) {
    vec2 uv = d.xz / (h + 0.22) * 0.85 + vec2(uTime * 0.006, uTime * 0.002);
    float c = fbm(uv * 1.15);
    float cover = smoothstep(0.50, 0.80, c);
    // cheap self shadowing: compare density a little towards the sun
    vec2 sunOff = normalize(uSunDir.xz + 1e-4) * 0.06;
    float c2 = fbm((uv + sunOff) * 1.15);
    float shade = clamp((c - c2) * 3.0 + 0.5, 0.0, 1.0);
    vec3 lit = vec3(1.0, 0.99, 0.97);
    vec3 shadow = vec3(0.74, 0.82, 0.93);
    vec3 cloudCol = mix(shadow, lit, shade);
    float fade = smoothstep(0.01, 0.16, h);
    col = mix(col, cloudCol, cover * fade * 0.96);
  }

  if (uLinear > 0.5) col = pow(col, vec3(2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.ShaderMaterial;
  readonly sunDir: THREE.Vector3;

  constructor(sunDir: THREE.Vector3) {
    this.sunDir = sunDir.clone().normalize();
    this.geometry = new THREE.SphereGeometry(1, 32, 16);
    this.material = this.makeMaterial(false);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(3000);
  }

  private makeMaterial(linear: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uHaze: { value: new THREE.Vector3(...HAZE_DISPLAY) },
        uTime: { value: 0 },
        uLinear: { value: linear ? 1 : 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
  }

  update(camera: THREE.Camera, time: number): void {
    this.mesh.position.copy(camera.position);
    this.material.uniforms.uTime.value = time;
  }

  /** Renders the sky into a prefiltered environment map used for lighting and reflections. */
  createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const envScene = new THREE.Scene();
    const mat = this.makeMaterial(true);
    const dome = new THREE.Mesh(this.geometry, mat);
    dome.scale.setScalar(100);
    dome.frustumCulled = false;
    envScene.add(dome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(envScene, 0.02, 0.1, 500);
    pmrem.dispose();
    mat.dispose();
    return target.texture;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
