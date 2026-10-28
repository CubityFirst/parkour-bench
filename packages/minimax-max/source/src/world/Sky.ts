import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { COLORS } from '../game/Config';

/**
 * Procedural sky dome.
 *
 * A simple gradient with a warm sun bloom is enough to sell the "bright
 * futuristic city" look and it doubles as the environment map for the glass
 * facades.
 */
export class Sky {
  readonly mesh: Mesh;
  readonly sunDirection = new Vector3(-0.42, 0.58, 0.7).normalize();

  constructor() {
    const geometry = new SphereGeometry(900, 32, 20);
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new Color(COLORS.skyTop) },
        horizonColor: { value: new Color(COLORS.skyHorizon) },
        groundColor: { value: new Color(0xb9c6cf) },
        sunColor: { value: new Color(COLORS.sun) },
        sunDirection: { value: this.sunDirection.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDirection;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vWorldDirection;

        void main() {
          vec3 direction = normalize(vWorldDirection);
          float height = direction.y;

          // Gradient from horizon to zenith.
          float upper = smoothstep(0.0, 0.55, height);
          vec3 sky = mix(horizonColor, topColor, upper);

          // Soft haze band right above the horizon.
          float haze = 1.0 - smoothstep(0.0, 0.22, abs(height));
          sky = mix(sky, vec3(0.86, 0.92, 0.97), haze * 0.45);

          // Below the horizon fades into a muted city haze.
          float lower = smoothstep(0.0, -0.25, height);
          sky = mix(sky, groundColor, lower);

          // Sun glow.
          float sun = max(dot(direction, normalize(sunDirection)), 0.0);
          sky += sunColor * pow(sun, 220.0) * 1.6;
          sky += sunColor * pow(sun, 12.0) * 0.14;

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** Renders the sky into an environment map for reflective materials. */
  createEnvironment(renderer: WebGLRenderer): Texture {
    const pmrem = new PMREMGenerator(renderer);
    const scene = new Scene();
    const previousParent = this.mesh.parent;
    scene.add(this.mesh);
    const target = pmrem.fromScene(scene, 0, 1, 1200);
    if (previousParent) previousParent.add(this.mesh);
    pmrem.dispose();
    return target.texture;
  }
}
