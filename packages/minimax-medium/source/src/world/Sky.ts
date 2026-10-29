import * as THREE from 'three';
import { PALETTE } from './Materials';

/**
 * Procedural sky dome: bright cyan-blue zenith fading into a pale haze at the
 * horizon with a soft sun bloom. Also used to bake an environment map so the
 * glass towers actually reflect the sky.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sunDirection = new THREE.Vector3(0.42, 0.58, 0.7).normalize();

  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(PALETTE.skyTop) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uSun: { value: new THREE.Color(PALETTE.sun) },
        uSunDir: { value: this.sunDirection.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w; // keep the dome at the far plane
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSun;
        uniform vec3 uSunDir;

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.48));

          // a bright band just above the horizon reads as city haze
          col = mix(col, uHorizon * 1.06, smoothstep(0.34, 0.0, abs(d.y - 0.03)) * 0.5);

          // below the horizon fades into distant city haze
          col = mix(vec3(0.74, 0.79, 0.84), col, smoothstep(-0.22, 0.04, d.y));

          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSun * (pow(s, 2400.0) * 12.0 + pow(s, 26.0) * 0.34 + pow(s, 4.0) * 0.06);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(1200);
    this.mesh.name = 'sky';
  }

  /** Renders the dome into an environment map for reflections. */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 20), this.material);
    envScene.add(dome);

    const target = pmrem.fromScene(envScene, 0.04, 1, 400);
    pmrem.dispose();
    dome.geometry.dispose();
    return target.texture;
  }
}
