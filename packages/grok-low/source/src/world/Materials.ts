import * as THREE from "three";
import type { MatId } from "./levelSpec";

export interface MaterialSet {
  byId: Record<MatId, THREE.MeshStandardMaterial>;
  flag: THREE.MeshStandardMaterial;
  banner: (text: string, accent?: string) => THREE.MeshStandardMaterial;
  sky: THREE.ShaderMaterial;
}

export function createMaterials(renderer: THREE.WebGLRenderer): MaterialSet {
  const concreteMap = noiseTexture("#e7ebef", "#d5dbe2", 220);
  const windowMap = windowTexture();

  const pmrem = new THREE.PMREMGenerator(renderer);
  // A tiny neutral scene gives glass and the red walls something to reflect.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xb7dcff);
  const hemi = new THREE.HemisphereLight(0xd6ecff, 0x8d8680, 1);
  envScene.add(hemi);
  const env = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();

  const concrete = new THREE.MeshStandardMaterial({
    color: 0xf3f5f7,
    map: concreteMap,
    roughness: 0.9,
    metalness: 0.02,
    envMap: env,
    envMapIntensity: 0.25,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xd5e4ee,
    map: windowMap,
    roughness: 0.14,
    metalness: 0.78,
    emissive: 0x163646,
    emissiveMap: windowMap,
    emissiveIntensity: 0.42,
    envMap: env,
    envMapIntensity: 1,
  });
  const red = new THREE.MeshStandardMaterial({
    color: 0xe10600,
    roughness: 0.4,
    metalness: 0.28,
    emissive: 0x6a0810,
    emissiveIntensity: 0.22,
    envMap: env,
    envMapIntensity: 0.6,
  });
  const white = new THREE.MeshStandardMaterial({
    color: 0xf7f8fa,
    map: concreteMap,
    roughness: 0.72,
    metalness: 0.04,
    envMap: env,
    envMapIntensity: 0.2,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x8e969e,
    roughness: 0.38,
    metalness: 0.72,
    envMap: env,
    envMapIntensity: 0.7,
  });
  const vent = new THREE.MeshStandardMaterial({
    color: 0x2c333a,
    roughness: 0.62,
    metalness: 0.45,
    envMap: env,
    envMapIntensity: 0.4,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1c2126,
    roughness: 0.8,
    metalness: 0.1,
  });
  const flag = new THREE.MeshStandardMaterial({
    color: 0xff8614,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
    emissive: 0x8a3a00,
    emissiveIntensity: 0.15,
  });

  const banners = new Map<string, THREE.MeshStandardMaterial>();
  const sky = skyMaterial();

  return {
    byId: { concrete, glass, red, white, metal, vent, dark },
    flag,
    banner(text: string, accent = "#ff8614") {
      const key = text + accent;
      let mat = banners.get(key);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          map: bannerTexture(text, accent),
          roughness: 0.5,
          metalness: 0.05,
          emissive: 0x221004,
          emissiveMap: bannerTexture(text, accent),
          emissiveIntensity: 0.25,
          side: THREE.DoubleSide,
        });
        banners.set(key, mat);
      }
      return mat;
    },
    sky,
  };
}

function noiseTexture(base: string, line: string, seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  let s = seed;
  const rnd = () => {
    s = (s * 16807 + 11) % 2147483647;
    return (s & 255) / 255;
  };
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    img.data[i] = clampByte(img.data[i] + n);
    img.data[i + 1] = clampByte(img.data[i + 1] + n);
    img.data[i + 2] = clampByte(img.data[i + 2] + n);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = line;
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#9ec0d2";
  g.fillRect(0, 0, 128, 160);
  g.fillStyle = "#f4f7f8";
  g.fillRect(0, 0, 128, 7);
  g.fillRect(0, 153, 128, 7);
  g.fillRect(0, 0, 7, 160);
  g.fillRect(121, 0, 7, 160);
  g.fillRect(60, 0, 6, 160);
  const panes: [number, number, string][] = [
    [12, 14, "#7eabc0"],
    [72, 14, "#d5e6ef"],
    [12, 86, "#6f9eb4"],
    [72, 86, "#cfe0ea"],
  ];
  for (const [x, y, col] of panes) {
    g.fillStyle = col;
    g.fillRect(x, y, 44, 60);
  }
  // A couple of warm interior lights, fixed so the facade doesn't shimmer between loads.
  g.fillStyle = "rgba(255, 196, 120, 0.55)";
  g.fillRect(78, 28, 14, 18);
  g.fillRect(20, 100, 12, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function bannerTexture(text: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = accent;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "rgba(255,255,255,0.14)";
  g.fillRect(0, 0, 512, 10);
  g.fillStyle = "#ffffff";
  g.font = "700 64px Segoe UI, Helvetica Neue, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: new THREE.Vector3(0.35, 0.82, 0.28).normalize() },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        // Local position stays a direction even when the dome follows the camera.
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 sunDir;
      uniform float time;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 zenith = vec3(0.30, 0.62, 0.92);
        vec3 horizon = vec3(0.78, 0.90, 0.98);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
        float sun = pow(max(dot(dir, sunDir), 0.0), 900.0);
        col += vec3(1.0, 0.96, 0.88) * sun * 1.4;
        col += vec3(1.0, 0.85, 0.65) * pow(max(dot(dir, sunDir), 0.0), 8.0) * 0.18;
        if (dir.y > 0.02) {
          vec2 uv = dir.xz / max(dir.y, 0.08) * 0.55 + vec2(time * 0.008, 0.0);
          float n = noise(uv) * 0.6 + noise(uv * 2.1) * 0.4;
          float cloud = smoothstep(0.52, 0.72, n) * smoothstep(0.02, 0.25, dir.y);
          col = mix(col, vec3(1.0, 0.99, 0.97), cloud * 0.85);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, v));
}
