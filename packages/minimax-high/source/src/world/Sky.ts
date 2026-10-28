import * as THREE from 'three';
import { RENDER, SUN } from '../core/Config';

const skyVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorld = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const skyFragment = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;

  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p *= 2.07;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 dir = normalize(vWorld);
    float height = clamp(dir.y, -0.25, 1.0);

    vec3 color = mix(horizonColor, topColor, pow(clamp(height, 0.0, 1.0), 0.55));
    color = mix(color, horizonColor * 1.03, smoothstep(0.22, -0.06, dir.y));

    float sun = max(dot(dir, sunDirection), 0.0);
    color += sunColor * pow(sun, 1400.0) * 9.0;
    color += sunColor * pow(sun, 10.0) * 0.16;

    if (dir.y > 0.015) {
      vec2 uv = dir.xz / max(dir.y, 0.07) * 0.32;
      float clouds = fbm(uv * 0.55 + vec2(3.1, 1.7));
      clouds = smoothstep(0.50, 0.88, clouds);
      float fade = smoothstep(0.02, 0.30, dir.y) * (1.0 - smoothstep(0.75, 1.0, dir.y) * 0.55);
      float shade = smoothstep(0.45, 0.95, fbm(uv * 0.9 + vec2(9.0, 4.0)));
      vec3 cloudColor = mix(vec3(0.86, 0.90, 0.95), vec3(1.0), shade);
      color = mix(color, cloudColor, clouds * 0.9 * fade);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Gradient sky dome with procedural clouds and a sun disc.
 * Also used to generate the environment map for the glass materials.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sunDirection: THREE.Vector3;

  constructor() {
    const elevation = SUN.elevation;
    const azimuth = SUN.azimuth;
    this.sunDirection = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    ).normalize();

    const material = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f83d6) },
        horizonColor: { value: new THREE.Color(0xd8ecfa) },
        sunColor: { value: new THREE.Color(0xfff3d8) },
        sunDirection: { value: this.sunDirection.clone() },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 20), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** Builds a small environment map from the sky for reflective materials. */
  createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const scene = new THREE.Scene();
    const clone = this.mesh.clone();
    (clone.material as THREE.ShaderMaterial).uniforms = (
      this.mesh.material as THREE.ShaderMaterial
    ).uniforms;
    scene.add(clone);

    // A soft ground bounce so the glass does not look black underneath.
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(1790, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      new THREE.MeshBasicMaterial({ color: 0x9fb4c4, side: THREE.BackSide })
    );
    scene.add(ground);

    const target = pmrem.fromScene(scene, 0.04);
    pmrem.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    return target.texture;
  }

  /** Keeps the dome centred on the camera. */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export const FOG_COLOR = new THREE.Color(0xcfe6f7);

export function applyFog(scene: THREE.Scene): void {
  scene.fog = new THREE.Fog(FOG_COLOR, RENDER.fogNear, RENDER.fogFar);
}
