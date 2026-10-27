import * as THREE from 'three';

export const SUN_DIRECTION = new THREE.Vector3(0.42, 0.78, 0.46).normalize();
export const HAZE_COLOR = new THREE.Color('#d6e8f5');

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always on the far plane
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    // Sky gradient: pale hazy horizon to deep blue zenith.
    float t = pow(clamp(h, 0.0, 1.0), 0.5);
    vec3 col = mix(uHorizon, uZenith, t);
    // Below the horizon fade into the haze so the city melts into the distance.
    col = mix(col, uHorizon, smoothstep(0.02, -0.12, h));

    // Sun disc + glow.
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 1600.0) * 18.0 + pow(sd, 64.0) * 0.35 + pow(sd, 6.0) * 0.12);

    // Puffy clouds projected on a plane, denser toward the horizon.
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.15) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
      float n = fbm(uv * 1.3);
      float c = smoothstep(0.52, 0.8, n) * smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.55, 0.95, h));
      float lit = 0.75 + 0.25 * smoothstep(0.4, 0.9, fbm(uv * 1.3 + uSunDir.xz * 0.15));
      vec3 cloud = mix(vec3(0.78, 0.84, 0.92), vec3(1.0), lit) * 1.08;
      cloud += uSunColor * pow(sd, 8.0) * 0.4;
      col = mix(col, cloud, c * 0.92);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Sky dome mesh that follows the camera. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color('#2f7fd6') },
        uHorizon: { value: HAZE_COLOR.clone() },
        uSunDir: { value: SUN_DIRECTION.clone() },
        uSunColor: { value: new THREE.Color('#fff2d9') },
        uTime: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';
  }

  update(time: number, cameraPosition: THREE.Vector3): void {
    this.material.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPosition);
  }

  /** Renders the sky into a prefiltered environment map for reflections/IBL. */
  createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(this.mesh.geometry, this.material);
    scene.add(dome);
    // A soft "ground" bounce so reflections below the horizon are not black.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9d2da') }),
    );
    ground.position.y = -60;
    scene.add(ground);
    const rt = pmrem.fromScene(scene, 0, 0.1, 1500);
    pmrem.dispose();
    (ground.geometry as THREE.BufferGeometry).dispose();
    (ground.material as THREE.Material).dispose();
    return rt.texture;
  }
}
