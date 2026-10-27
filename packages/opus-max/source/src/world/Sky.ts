import * as THREE from 'three';

/** Direction towards the sun (normalised): high in the south-west, behind the runner at the start. */
export const SUN_DIRECTION = new THREE.Vector3(-0.42, 0.74, 0.52).normalize();

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Pale haze near the horizon, deepening to saturated blue overhead.
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));
    float s = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(s, 1400.0) * 30.0 + pow(s, 90.0) * 0.6 + pow(s, 8.0) * 0.18);
    // Brighter haze band towards the sun side.
    col += uHorizon * 0.18 * pow(clamp(1.0 - abs(h), 0.0, 1.0), 6.0) * (0.5 + 0.5 * dot(normalize(vec2(d.x, d.z) + 1e-5), normalize(uSunDir.xz)));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uZenith: { value: new THREE.Color(0x1f6fdc) },
      uHorizon: { value: new THREE.Color(0xc4e2f6) },
      uGround: { value: new THREE.Color(0xb7c4cf) },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: new THREE.Color(0xfff2dd) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

/** Draws a soft cumulus cloud with canvas radial gradients. */
function cloudTexture(seed: number): THREE.CanvasTexture {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const puffs = 26 + Math.floor(rand() * 14);
  for (let i = 0; i < puffs; i++) {
    const t = rand();
    const x = W * (0.12 + 0.76 * t);
    // Taller in the middle, flat-bottomed.
    const hump = Math.sin(t * Math.PI);
    const r = (34 + rand() * 46) * (0.6 + hump * 0.7);
    const y = H * 0.72 - hump * H * 0.28 * rand() - r * 0.35;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(250,252,255,0.55)');
    g.addColorStop(1, 'rgba(240,246,252,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Slightly shaded underside.
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, H * 0.4, 0, H);
  shade.addColorStop(0, 'rgba(200,214,232,0)');
  shade.addColorStop(1, 'rgba(176,196,222,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Sky {
  readonly dome: THREE.Mesh;
  readonly clouds = new THREE.Group();
  private readonly cloudSprites: THREE.Sprite[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = createSkyMaterial();
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.dome.scale.setScalar(4000);

    const variants = [cloudTexture(7), cloudTexture(19), cloudTexture(31), cloudTexture(53)];
    this.textures.push(...variants);
    let seed = 99;
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 22; i++) {
      const mat = new THREE.SpriteMaterial({
        map: variants[i % variants.length],
        transparent: true,
        depthWrite: false,
        fog: false,
        opacity: 0.75 + rand() * 0.25,
      });
      const sprite = new THREE.Sprite(mat);
      const ang = rand() * Math.PI * 2;
      const dist = 2200 + rand() * 1100;
      const w = 700 + rand() * 900;
      sprite.position.set(Math.cos(ang) * dist, 260 + rand() * 520, Math.sin(ang) * dist);
      sprite.scale.set(w, w * (0.36 + rand() * 0.12), 1);
      sprite.renderOrder = -9;
      this.clouds.add(sprite);
      this.cloudSprites.push(sprite);
    }
  }

  /** Keeps the sky centred on the camera and drifts the clouds slowly. */
  update(cameraPosition: THREE.Vector3, time: number): void {
    this.dome.position.copy(cameraPosition);
    this.clouds.position.set(cameraPosition.x, 0, cameraPosition.z);
    this.clouds.rotation.y = time * 0.0025;
  }

  /** Builds a prefiltered environment map (for reflections and image-based lighting). */
  createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), createSkyMaterial());
    dome.scale.setScalar(100);
    envScene.add(dome);
    // A city-coloured lower hemisphere so reflections aren't lit from below by "sky".
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(90, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.06, Math.PI / 2 - 0.06),
      new THREE.MeshBasicMaterial({ color: 0x9aa6b2, side: THREE.BackSide }),
    );
    envScene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 500);
    pmrem.dispose();
    dome.geometry.dispose();
    (dome.material as THREE.Material).dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    return rt.texture;
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.material.dispose();
    for (const s of this.cloudSprites) s.material.dispose();
    for (const t of this.textures) t.dispose();
  }
}
