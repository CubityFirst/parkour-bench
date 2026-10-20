import * as THREE from 'three';
import { PLAYER } from '../config.ts';
import type { Aabb, CheckpointDef, Facing, LevelLayout } from './LevelBuilder.ts';

const ROT_Y: Record<Facing, number> = { 0: 0, 1: -Math.PI / 2, 2: Math.PI, 3: Math.PI / 2 };

const FIELD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uActive;
uniform float uPulse;
varying vec2 vUv;
void main() {
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(0.0, 0.06, 1.0 - vUv.x);
  float grad = pow(max(1.0 - vUv.y, 0.0), 1.5) * 0.6 + 0.08;
  float lines = 0.55 + 0.45 * sin(vUv.y * 46.0 - uTime * 2.4);
  float a = grad * lines * edge;
  a *= mix(1.0, 0.3, uActive);
  vec3 col = uColor * (1.0 + uPulse * 2.5);
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
#include <fog_pars_fragment>
void main() {
  float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0), 1.2);
  float height = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 0.9);
  float flow = 0.75 + 0.25 * sin(vUv.y * 60.0 - uTime * 3.0);
  float a = (0.10 + 0.5 * fres) * height * flow;
  gl_FragColor = vec4(uColor * a * 1.6, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const w = 1024;
  const h = 200;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = -h; x < w; x += 48) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + h * 0.6, 0);
    g.lineTo(x + h * 0.6 + 20, 0);
    g.lineTo(x + 20, h);
    g.closePath();
    g.fill();
  }
  g.fillStyle = fg;
  g.font = '900 120px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface GateVisual {
  def: CheckpointDef;
  group: THREE.Group;
  field: THREE.ShaderMaterial;
  posts: THREE.MeshStandardMaterial;
  claimed: boolean;
  pulse: number;
}

export interface RespawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  killY: number;
  id: number;
}

const overlaps = (a: Aabb, x: number, y: number, z: number, h: number): boolean => {
  const hw = PLAYER.halfWidth;
  return (
    x + hw > a.min[0] && x - hw < a.max[0] && y + h > a.min[1] && y < a.max[1] && z + hw > a.min[2] && z - hw < a.max[2]
  );
};

/** Checkpoint gates (visuals + trigger logic) and the finish gate. */
export class Checkpoints {
  readonly group = new THREE.Group();
  /** Latest checkpoint id that has been reached (0 = start line). */
  current = 0;
  private readonly gates: GateVisual[] = [];
  private readonly layout: LevelLayout;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private time = 0;
  private finishMaterials: THREE.ShaderMaterial[] = [];

  constructor(layout: LevelLayout) {
    this.layout = layout;
    this.group.name = 'checkpoints';
    for (const def of layout.checkpoints) this.gates.push(this.buildGate(def));
    this.buildFinish();
  }

  /** Checks the player against the next checkpoint triggers. Returns a checkpoint that was newly reached. */
  update(dt: number, px: number, py: number, pz: number, height: number): CheckpointDef | null {
    this.time += dt;
    for (const g of this.gates) {
      g.field.uniforms.uTime!.value = this.time;
      g.pulse = Math.max(0, g.pulse - dt * 1.6);
      g.field.uniforms.uPulse!.value = g.pulse;
    }
    for (const m of this.finishMaterials) m.uniforms.uTime!.value = this.time;

    let reached: CheckpointDef | null = null;
    for (const g of this.gates) {
      if (g.claimed || g.def.id <= this.current) continue;
      if (overlaps(g.def.trigger, px, py, pz, height)) {
        g.claimed = true;
        g.pulse = 1;
        g.field.uniforms.uActive!.value = 1;
        g.field.uniforms.uColor!.value.set(1, 1, 1);
        g.posts.color.set(0xf2f4f6);
        g.posts.emissive.set(0x222222);
        this.current = g.def.id;
        reached = g.def;
      }
    }
    return reached;
  }

  respawn(): RespawnPoint {
    const start = this.layout.start;
    if (this.current === 0) return { x: start.x, y: start.y, z: start.z, yaw: start.yaw, killY: 41, id: 0 };
    const cp = this.layout.checkpoints.find((c) => c.id === this.current)!;
    return { x: cp.x, y: cp.y, z: cp.z, yaw: cp.yaw, killY: cp.killY, id: cp.id };
  }

  /** Lowest allowed height for the current stretch (below it the player respawns). */
  get killY(): number {
    return this.respawn().killY;
  }

  finishReached(px: number, py: number, pz: number, height: number): boolean {
    return overlaps(this.layout.finish.trigger, px, py, pz, height);
  }

  reset(): void {
    this.current = 0;
    for (const g of this.gates) {
      g.claimed = false;
      g.pulse = 0;
      g.field.uniforms.uActive!.value = 0;
      g.field.uniforms.uColor!.value.set(1.0, 0.1, 0.06);
      g.posts.color.set(0xe0150f);
      g.posts.emissive.set(0x4a0300);
    }
  }

  // ------------------------------------------------------------------------------------------

  private buildGate(def: CheckpointDef): GateVisual {
    const { gate } = def;
    const group = new THREE.Group();
    const w = gate.width;
    const h = 3.5;
    const posts = new THREE.MeshStandardMaterial({ color: 0xe0150f, roughness: 0.4, emissive: 0x4a0300, emissiveIntensity: 0.55 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.7 });
    this.disposables.push(posts, white);

    const postGeo = new THREE.BoxGeometry(0.3, h, 0.3);
    const beamGeo = new THREE.BoxGeometry(w + 0.3, 0.32, 0.3);
    const plateGeo = new THREE.BoxGeometry(0.8, 0.06, 0.8);
    this.disposables.push(postGeo, beamGeo, plateGeo);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, posts);
      post.position.set((sx * w) / 2, h / 2, 0);
      post.castShadow = true;
      group.add(post);
      const plate = new THREE.Mesh(plateGeo, white);
      plate.position.set((sx * w) / 2, 0.03, 0);
      group.add(plate);
    }
    const beam = new THREE.Mesh(beamGeo, posts);
    beam.position.set(0, h, 0);
    beam.castShadow = true;
    group.add(beam);

    const fieldGeo = new THREE.PlaneGeometry(w, h);
    const field = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1.0, 0.1, 0.06) },
        uTime: { value: 0 },
        uActive: { value: 0 },
        uPulse: { value: 0 },
      },
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.disposables.push(fieldGeo, field);
    const fieldMesh = new THREE.Mesh(fieldGeo, field);
    fieldMesh.position.set(0, h / 2, 0);
    fieldMesh.renderOrder = 3;
    group.add(fieldMesh);

    const tex = bannerTexture(def.name, '#e0150f', '#ffffff');
    const bannerGeo = new THREE.PlaneGeometry(Math.min(7, w * 0.55), Math.min(7, w * 0.55) * (200 / 1024));
    const bannerMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    this.disposables.push(tex, bannerGeo, bannerMat);
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, h + 0.7, 0);
    group.add(banner);

    group.position.set(gate.x, gate.y, gate.z);
    group.rotation.y = ROT_Y[gate.facing];
    this.group.add(group);
    return { def, group, field, posts, claimed: false, pulse: 0 };
  }

  private buildFinish(): void {
    const f = this.layout.finish;
    const group = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xe0150f, roughness: 0.35, emissive: 0x5a0400, emissiveIntensity: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.6 });
    this.disposables.push(red, white);

    // Pylons and top bar.
    const span = 18;
    const pylonH = 9.5;
    const pylonGeo = new THREE.BoxGeometry(1.1, pylonH, 1.1);
    const barGeo = new THREE.BoxGeometry(span + 1.1, 1.2, 1.1);
    this.disposables.push(pylonGeo, barGeo);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(pylonGeo, red);
      p.position.set((sx * span) / 2, pylonH / 2, 0);
      p.castShadow = true;
      group.add(p);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.7, 1.14), white);
      stripe.position.set((sx * span) / 2, 2.2, 0);
      group.add(stripe);
      this.disposables.push(stripe.geometry);
    }
    const bar = new THREE.Mesh(barGeo, red);
    bar.position.set(0, pylonH, 0);
    bar.castShadow = true;
    group.add(bar);

    // Banner.
    const tex = bannerTexture('FINISH', '#e0150f', '#ffffff');
    const bannerGeo = new THREE.PlaneGeometry(span - 1.6, (span - 1.6) * (200 / 1024));
    const bannerMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    this.disposables.push(tex, bannerGeo, bannerMat);
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, pylonH - 2.3, 0);
    group.add(banner);

    // Checker finish line across the full roof width.
    const lineW = f.width;
    const tiles = Math.round(lineW / 1.0);
    const tileGeo = new THREE.BoxGeometry(1.0, 0.04, 1.0);
    this.disposables.push(tileGeo);
    for (let i = 0; i < tiles; i++) {
      for (let j = 0; j < 2; j++) {
        const m = (i + j) % 2 === 0 ? red : white;
        const t = new THREE.Mesh(tileGeo, m);
        t.position.set(-lineW / 2 + 0.5 + i, 0.02, -0.5 + j);
        t.receiveShadow = true;
        group.add(t);
      }
    }

    // Beacon of light visible across the whole course.
    const beamMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(1, 0.12, 0.08) }, uTime: { value: 0 } }]),
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.finishMaterials.push(beamMat);
    const beamGeo = new THREE.CylinderGeometry(3.4, 3.4, 260, 28, 1, true);
    this.disposables.push(beamMat, beamGeo);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 130, 0);
    beam.renderOrder = 3;
    beam.frustumCulled = false;
    group.add(beam);

    group.position.set(f.x, f.y, f.z);
    group.rotation.y = ROT_Y[f.facing];
    this.group.add(group);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
