import * as THREE from 'three';
import { Level, Mat } from './Level';
import { MeshBatch } from './MeshBatch';
import {
  bannerTexture, cloudTexture, facadeWhiteTexture, glassTexture, groundTexture, roofTexture,
} from './Textures';

export const FOG_COLOR = 0xcfe4f4;
export const SUN_DIR = new THREE.Vector3(0.55, 0.78, 0.3).normalize();

/** Small seeded RNG so the skyline is identical every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CheckpointMarker {
  group: THREE.Group;
  mat: THREE.MeshStandardMaterial;
}

export interface WorldVisuals {
  group: THREE.Group;
  checkpointMarkers: CheckpointMarker[];
  dispose(): void;
}

/** Everything static: sky, level meshes, background city. Returns objects for the scene + a dispose hook. */
export function buildWorld(level: Level, renderer: THREE.WebGLRenderer): WorldVisuals & { sky: THREE.Mesh; envMap: THREE.Texture } {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T): T => { disposables.push(o); return o; };

  // ------------------------------------------------------------ sky + environment
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(1800, 32, 16)),
    track(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2b7fe0) },
        mid: { value: new THREE.Color(0x7cb8f0) },
        horizon: { value: new THREE.Color(FOG_COLOR) },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, top, smoothstep(0.12, 0.75, h));
          if (d.y < 0.0) c = mix(horizon, vec3(0.86, 0.92, 0.97), clamp(-d.y * 3.0, 0.0, 1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += vec3(1.0, 0.96, 0.85) * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // Environment map for the glass: render just the sky into a PMREM cube (one-off).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, sky.material));
  const envMap = pmrem.fromScene(envScene, 0.02, 1, 4000).texture;
  pmrem.dispose();
  track(envMap);

  // clouds (billboard sprites)
  const cloudTex = track(cloudTexture());
  const cloudMat = track(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }));
  const rand = rng(7);
  for (let i = 0; i < 26; i++) {
    const az = rand() * Math.PI * 2;
    const el = 0.07 + rand() * 0.42;
    const R = 1500;
    const s = new THREE.Sprite(cloudMat);
    s.position.set(Math.cos(az) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(az) * Math.cos(el) * R);
    const w = 380 + rand() * 520;
    s.scale.set(w, w * (0.28 + rand() * 0.18), 1);
    group.add(s);
  }

  // ------------------------------------------------------------ materials
  const roofTex = track(roofTexture(renderer));
  const facadeTex = track(facadeWhiteTexture(renderer));
  const glassTex = track(glassTexture(renderer));
  const groundTex = track(groundTexture(renderer));

  const mats = {
    roof: track(new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95, vertexColors: true })),
    facade: track(new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.8, vertexColors: true })),
    glass: track(new THREE.MeshStandardMaterial({
      map: glassTex, roughness: 0.16, metalness: 0.75, envMap, envMapIntensity: 1.25, vertexColors: true,
    })),
    red: track(new THREE.MeshStandardMaterial({ color: 0xe0211b, roughness: 0.55, metalness: 0.05, vertexColors: true })),
    grey: track(new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.7, metalness: 0.15, vertexColors: true })),
    dark: track(new THREE.MeshStandardMaterial({ color: 0x2f353b, roughness: 0.8, vertexColors: true })),
    white: track(new THREE.MeshStandardMaterial({ map: roofTex, color: 0xffffff, roughness: 0.9, vertexColors: true })),
  };

  // ------------------------------------------------------------ level geometry
  const batches = {
    roof: new MeshBatch(), facade: new MeshBatch(), glass: new MeshBatch(),
    red: new MeshBatch(), grey: new MeshBatch(), dark: new MeshBatch(), white: new MeshBatch(),
  };
  const propBatch = (m: Mat): MeshBatch =>
    m === 'red' ? batches.red : m === 'grey' ? batches.grey : m === 'dark' ? batches.dark : batches.white;

  for (const p of level.pieces) {
    if (p.kind === 'building') {
      batches.roof.addBox(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, { sides: false, tile: 6, tint: [1, 1, 1] });
      const sideBatch = p.glass ? batches.glass : batches.facade;
      sideBatch.addBox(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, { top: false, tile: 8 });
    } else {
      const t = p.tint ?? 1;
      propBatch(p.mat).addBox(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, { tile: 2, tint: [t, t, t] });
    }
  }

  const addMesh = (b: MeshBatch, m: THREE.Material, shadows: boolean): void => {
    if (b.empty) return;
    const geo = track(b.build());
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
  };
  addMesh(batches.roof, mats.roof, true);
  addMesh(batches.facade, mats.facade, true);
  addMesh(batches.glass, mats.glass, true);
  addMesh(batches.red, mats.red, true);
  addMesh(batches.grey, mats.grey, true);
  addMesh(batches.dark, mats.dark, false);
  addMesh(batches.white, mats.white, true);

  // ------------------------------------------------------------ ground (the street, far below)
  groundTex.repeat.set(160, 160);
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(9600, 9600)),
    track(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = false;
  group.add(ground);

  // ------------------------------------------------------------ background skyline
  buildSkyline(level, group, mats, track);

  // ------------------------------------------------------------ finish gate banner
  const gate = level.finishGate;
  const bannerMat = track(new THREE.MeshBasicMaterial({ map: track(bannerTexture('FINISH')), side: THREE.DoubleSide }));
  const banner = new THREE.Mesh(track(new THREE.PlaneGeometry(10.4, 1.0)), bannerMat);
  banner.position.set(gate.x, gate.y + 5.7, gate.z + 0.37);
  const banner2 = banner.clone();
  banner2.position.z = gate.z - 0.37;
  group.add(banner, banner2);

  // ------------------------------------------------------------ checkpoint markers
  const markers: CheckpointMarker[] = [];
  const postGeo = track(new THREE.BoxGeometry(0.16, 3.2, 0.16));
  const barGeo = track(new THREE.BoxGeometry(2.0, 0.16, 0.16));
  for (const cp of level.checkpoints) {
    if (cp.id === 0) continue;
    const m = track(new THREE.MeshStandardMaterial({ color: 0xe0211b, roughness: 0.5, emissive: 0x330000 }));
    const g = new THREE.Group();
    const a = new THREE.Mesh(postGeo, m), b = new THREE.Mesh(postGeo, m), t = new THREE.Mesh(barGeo, m);
    a.position.set(-1, 1.6, 0); b.position.set(1, 1.6, 0); t.position.set(0, 3.2, 0);
    g.add(a, b, t);
    g.position.set(cp.x, cp.y, cp.z - 1.2);
    a.castShadow = b.castShadow = t.castShadow = true;
    group.add(g);
    markers.push({ group: g, mat: m });
  }

  return {
    group, sky, envMap, checkpointMarkers: markers,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}

/** Distant city: thousands of boxes merged into three meshes (white, glass, low roofs). */
function buildSkyline(
  level: Level, group: THREE.Group,
  mats: { facade: THREE.Material; glass: THREE.Material; roof: THREE.Material },
  track: <T extends { dispose(): void }>(o: T) => T,
): void {
  const rand = rng(1234);
  const white = new MeshBatch(), glass = new MeshBatch(), roofs = new MeshBatch();
  const CELL = 56;
  const intersectsRoute = (x0: number, x1: number, z0: number, z1: number): boolean => {
    const m = 5;
    for (const f of level.footprints) {
      if (x1 > f.minX - m && x0 < f.maxX + m && z1 > f.minZ - m && z0 < f.maxZ + m) return true;
    }
    return false;
  };
  for (let ix = -18; ix <= 18; ix++) {
    for (let iz = -20; iz <= 12; iz++) {
      const cx = ix * CELL + 28 + (rand() - 0.5) * 6;
      const cz = iz * CELL + 28 + (rand() - 0.5) * 6;
      const w = 20 + rand() * 24;
      const d = 20 + rand() * 24;
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
      if (intersectsRoute(x0, x1, z0, z1)) continue;
      const ax = Math.abs(cx);
      const nearRoute = ax < 70 && cz < 80 && cz > -430;
      let h: number;
      if (nearRoute) h = 8 + rand() * 18; // below the rooftops: you see the city drop away
      else if (rand() < 0.2) h = 80 + rand() * 170; // glass towers
      else h = 16 + rand() * 70;
      // keep the horizon ahead and behind busy
      if (cz < -450 || cz > 150) h += 40 + rand() * 80;
      const useGlass = h > 60 ? rand() < 0.5 : rand() < 0.15;
      const v = 0.82 + rand() * 0.22;
      const tint = useGlass ? [v * 0.95, v, v * 1.05] : [v, v, v * 1.02];
      (useGlass ? glass : white).addBox(x0, 0, z0, x1, h, z1, { top: false, tile: 8, tint });
      roofs.addBox(x0, 0, z0, x1, h, z1, { sides: false, tile: 6, tint: [v, v, v] });
    }
  }
  const mk = (b: MeshBatch, m: THREE.Material) => {
    const mesh = new THREE.Mesh(track(b.build()), m);
    group.add(mesh);
  };
  mk(white, mats.facade);
  mk(glass, mats.glass);
  mk(roofs, mats.roof);
}
