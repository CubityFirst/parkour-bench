import * as THREE from 'three';

/** Colour of the haze at the horizon; the scene fog uses the same value so the city fades into the sky. */
export const HORIZON_COLOR = new THREE.Color(0xcfe3f3);

export const SUN_DIRECTION = new THREE.Vector3(0.52, 0.72, 0.38).normalize();

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 horizon = vec3(0.81, 0.89, 0.953);
  vec3 mid = vec3(0.42, 0.68, 0.94);
  vec3 zenith = vec3(0.10, 0.37, 0.84);
  vec3 col = mix(horizon, mid, pow(smoothstep(0.0, 0.5, h), 0.7));
  col = mix(col, zenith, smoothstep(0.25, 1.0, h));

  // sun glow + disc
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.93, 0.78) * (0.22 * pow(s, 6.0) + 0.5 * pow(s, 64.0));
  col = srgb(col);
  col += vec3(1.0, 0.96, 0.85) * (6.0 * smoothstep(0.9993, 0.9998, s));

  // soft clouds on a flat plane above the viewer
  vec2 uv = d.xz / (d.y + 0.18) * 0.55;
  float c = fbm(uv * 1.3 + vec2(3.0, 1.0));
  float cloud = smoothstep(0.50, 0.80, c) * smoothstep(0.02, 0.22, d.y);
  float lit = 0.88 + 0.12 * smoothstep(0.3, 0.8, fbm(uv * 2.7 + 5.0));
  vec3 cloudCol = srgb(vec3(1.0, 1.0, 1.0)) * lit;
  col = mix(col, cloudCol, cloud * 0.9);

  // below the horizon: haze colour (hidden by ground / buildings in practice)
  vec3 haze = srgb(vec3(0.81, 0.89, 0.953));
  col = mix(col, haze, smoothstep(0.0, -0.15, d.y));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.SphereGeometry;

  constructor() {
    this.geometry = new THREE.SphereGeometry(1000, 48, 24);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: SUN_DIRECTION.clone() } },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  /** Bakes the sky into a PMREM environment map so glass and metal reflect it. */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(this.geometry, this.material);
    envSky.frustumCulled = false;
    envScene.add(envSky);
    const target = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
    pmrem.dispose();
    return target.texture;
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
