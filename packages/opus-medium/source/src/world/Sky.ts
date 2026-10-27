import {
  BackSide, CanvasTexture, Color, Group, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry,
  Sprite, SpriteMaterial, SRGBColorSpace, type Texture, Vector3, type WebGLRenderer,
} from 'three';
import { rng } from './Materials';

export const SUN_DIR = new Vector3(0.45, 0.62, 0.35).normalize();

/** Gradient sky dome with a soft sun glow. */
function makeDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new Color(0x2f7fd6) },
      horizon: { value: new Color(0xd6e9f7) },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        float t = pow(clamp(h, 0.0, 1.0), 0.55);
        vec3 col = mix(horizon, zenith, t);
        // below horizon: hazy city glow
        col = mix(col, horizon * 0.95, smoothstep(0.0, -0.2, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.85) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new Mesh(new SphereGeometry(2000, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

function cloudTexture(seed: number): Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const x = 40 + r() * 176, y = 50 + r() * 40, rad = 18 + r() * 34;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createSky(renderer: WebGLRenderer): { group: Group; envMap: Texture } {
  const group = new Group();
  group.add(makeDome());

  const r = rng(99);
  const textures = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
  for (let i = 0; i < 22; i++) {
    const mat = new SpriteMaterial({ map: textures[i % 3], fog: false, depthWrite: false, transparent: true, opacity: 0.75 + r() * 0.2 });
    const s = new Sprite(mat);
    const a = r() * Math.PI * 2, d = 900 + r() * 500;
    s.position.set(Math.cos(a) * d, 160 + r() * 260, Math.sin(a) * d - 150);
    const w = 300 + r() * 400;
    s.scale.set(w, w * 0.4, 1);
    group.add(s);
  }

  // Environment map from the sky dome only (cheap reflections for glass).
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new Scene();
  envScene.add(makeDome());
  const envMap = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  return { group, envMap };
}
