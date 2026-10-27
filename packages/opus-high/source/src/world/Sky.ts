import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uBelow, smoothstep(0.0, -0.25, h));

  // Soft cumulus band above the horizon.
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.18);
    float n = fbm(uv * 1.6 + vec2(uTime * 0.004, 0.0));
    float n2 = fbm(uv * 4.0 - vec2(0.0, uTime * 0.006));
    float c = smoothstep(0.52, 0.8, n * 0.8 + n2 * 0.3) * smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.35, 0.8, h));
    col = mix(col, vec3(1.0, 1.0, 1.0) * 1.05, c * 0.85);
  }

  // Sun glow and disc.
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.95, 0.85) * (pow(s, 1200.0) * 8.0 + pow(s, 24.0) * 0.18 + pow(s, 4.0) * 0.05);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SUN_DIRECTION = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
export const HORIZON_COLOR = new THREE.Color('#d6e8f5');

/**
 * Sky dome, sun + ambient lighting, fog and the reflection environment map.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadowSize: number) {
    this.uniforms = {
      uZenith: { value: new THREE.Color('#2f78d8') },
      uHorizon: { value: HORIZON_COLOR.clone() },
      uBelow: { value: new THREE.Color('#c3d3df') },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    scene.fog = new THREE.FogExp2(HORIZON_COLOR.clone(), 0.00105);
    scene.background = HORIZON_COLOR.clone();

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0xe8e1d6, 0.9);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e4, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -55;
    cam.right = 55;
    cam.top = 55;
    cam.bottom = -55;
    cam.near = 1;
    cam.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Image based lighting: render the sky into a prefiltered environment map
    // so glass towers reflect it and white surfaces pick up soft blue fill.
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat.clone());
    (envSky.material as THREE.ShaderMaterial).uniforms = this.uniforms;
    envScene.add(envSky);
    const groundDisc = new THREE.Mesh(
      new THREE.CircleGeometry(45, 32).rotateX(-Math.PI / 2).translate(0, -6, 0),
      new THREE.MeshBasicMaterial({ color: 0xb9c3cc }),
    );
    envScene.add(groundDisc);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(envScene, 0, 0.1, 200).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    envSky.geometry.dispose();
    groundDisc.geometry.dispose();
  }

  /** Keeps the sky centred on the camera and the shadow frustum around the player. */
  update(time: number, cameraPos: THREE.Vector3, focus: THREE.Vector3): void {
    this.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPos);
    // Snap the shadow focus to a coarse grid to limit shadow edge shimmering.
    const snap = 1.0;
    const fx = Math.round(focus.x / snap) * snap;
    const fy = Math.round(focus.y / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + SUN_DIRECTION.x * 150, fy + SUN_DIRECTION.y * 150, fz + SUN_DIRECTION.z * 150);
    this.sun.target.updateMatrixWorld();
  }
}
