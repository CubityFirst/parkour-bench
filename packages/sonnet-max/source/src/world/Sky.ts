import * as THREE from 'three';

/** Haze colour shared by the sky horizon and the scene fog so distant buildings melt into the sky. */
export const HAZE_COLOR = new THREE.Color(0.74, 0.86, 0.97);

/** Direction TOWARD the sun. High and slightly ahead-left of the start heading for long, readable shadows. */
export const SUN_DIRECTION = new THREE.Vector3(-0.52, 0.74, -0.42).normalize();

/** Periodic value noise used to bake a tileable cumulus density texture. */
function makeCloudTexture(size = 512): THREE.DataTexture {
  const data = new Uint8Array(size * size);
  const hash = (x: number, y: number, period: number, seed: number) => {
    const px = ((x % period) + period) % period;
    const py = ((y % period) + period) % period;
    let h = (px * 374761393 + py * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
  const noise = (x: number, y: number, period: number, seed: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, period, seed);
    const b = hash(xi + 1, yi, period, seed);
    const c = hash(xi, yi + 1, period, seed);
    const d = hash(xi + 1, yi + 1, period, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 0.55;
      let sum = 0;
      let norm = 0;
      let period = 4;
      for (let o = 0; o < 6; o++) {
        sum += amp * noise((x / size) * period, (y / size) * period, period, o * 7 + 3);
        norm += amp;
        amp *= 0.52;
        period *= 2;
      }
      data[y * size + x] = Math.round(255 * Math.min(1, Math.max(0, sum / norm)));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Push the dome to the far plane so it is only shaded where nothing else was drawn.
  gl_Position = p.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D uClouds;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uTime;
uniform float uSunDisc;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);

  vec3 zenith = vec3(0.045, 0.24, 0.66);
  vec3 mid = vec3(0.20, 0.50, 0.90);
  vec3 sky = mix(uHaze, mid, smoothstep(0.0, 0.32, h));
  sky = mix(sky, zenith, smoothstep(0.22, 0.95, h));

  // Sun: soft glow plus a hot disc that feeds the bloom.
  float sd = max(dot(dir, uSunDir), 0.0);
  vec3 sunCol = vec3(1.0, 0.93, 0.78);
  sky += sunCol * (pow(sd, 5.0) * 0.12 + pow(sd, 48.0) * 0.4);
  sky += sunCol * smoothstep(0.99935, 0.99985, sd) * 14.0 * uSunDisc;

  // Cumulus: planar-projected tileable noise, lit from the sun side.
  if (dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.11) * 0.42 + vec2(uTime * 0.0035, uTime * 0.0012);
    float d = texture2D(uClouds, uv).r;
    float cover = smoothstep(0.50, 0.74, d) * smoothstep(0.0, 0.14, dir.y);
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.018;
    float dl = texture2D(uClouds, uv + toSun).r;
    float lit = clamp(0.62 + (d - dl) * 5.5, 0.0, 1.0);
    vec3 shade = vec3(0.60, 0.72, 0.90);
    vec3 bright = vec3(1.0, 0.985, 0.955);
    vec3 cloud = mix(shade, bright, lit);
    cloud = mix(cloud, uHaze, 0.18 * (1.0 - smoothstep(0.0, 0.5, h)));
    sky = mix(sky, cloud, cover * 0.94);
  }

  // Horizon haze band.
  sky = mix(sky, uHaze, exp(-h * 7.0) * 0.75);
  if (dir.y < 0.0) sky = uHaze * (0.98 + dir.y * 0.15);

  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly clouds: THREE.DataTexture;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor() {
    this.clouds = makeCloudTexture(512);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uClouds: { value: this.clouds },
        uSunDir: { value: SUN_DIRECTION.clone() },
        uHaze: { value: HAZE_COLOR.clone() },
        uTime: { value: 0 },
        uSunDisc: { value: 1 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1e6;
  }

  update(cameraPosition: THREE.Vector3, time: number): void {
    this.mesh.position.copy(cameraPosition);
    this.mesh.scale.setScalar(100);
    this.material.uniforms.uTime!.value = time;
  }

  /** Bake the sky into a small PMREM environment so glass and white walls pick up blue sky light. */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(this.mesh.geometry, this.material);
    dome.scale.setScalar(100);
    dome.frustumCulled = false;
    envScene.add(dome);
    const disc = this.material.uniforms.uSunDisc!;
    const before = disc.value as number;
    disc.value = 0.12;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = pmrem.fromScene(envScene, 0, 1, 1000);
    disc.value = before;
    pmrem.dispose();
    return this.envTarget.texture;
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.clouds.dispose();
    this.envTarget?.dispose();
  }
}
