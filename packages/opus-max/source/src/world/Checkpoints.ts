import * as THREE from 'three';
import type { CheckpointDef, LevelDef, Vec3, ZoneDef } from './LevelData.ts';

const BEAM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    // Fade out when the camera is close so a beacon never blocks the view.
    float near = smoothstep(3.0, 16.0, vDepth);
    float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.8) * near;
    float shimmer = 0.82 + 0.18 * sin(vUv.y * 38.0 - uTime * 3.2);
    float edge = 0.55 + 0.45 * pow(abs(sin(vUv.x * 3.14159 * 2.0)), 0.5);
    gl_FragColor = vec4(uColor * shimmer * edge, uOpacity * fade);
  }
`;

interface Beacon {
  group: THREE.Group;
  beam: THREE.ShaderMaterial;
  ring: THREE.MeshBasicMaterial;
  reachedAt: number;
}

export type CheckpointEvent = { type: 'checkpoint'; index: number } | { type: 'finish' };

const RED = new THREE.Color(0xff3a2a);
const WHITE = new THREE.Color(0xffffff);

const inside = (z: ZoneDef, p: THREE.Vector3) =>
  p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];

/**
 * Checkpoint progress, respawn points and the beacons that mark them.
 * Checkpoints are ordered; reaching one also counts any earlier one that was skipped.
 */
export class Checkpoints {
  readonly root = new THREE.Group();
  readonly defs: readonly CheckpointDef[];
  private readonly spawn: { pos: Vec3; yaw: number };
  private readonly finishZone: ZoneDef;
  private readonly beacons: Beacon[] = [];
  private readonly finishBeam: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  /** Number of checkpoints reached so far. */
  reached = 0;
  finished = false;
  private time = 0;

  constructor(def: LevelDef) {
    this.defs = def.checkpoints;
    this.spawn = def.spawn;
    this.finishZone = def.finish.zone;

    const beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 18, 24, 1, true);
    beamGeo.translate(0, 9, 0);
    const ringGeo = new THREE.RingGeometry(0.75, 0.95, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const dotGeo = new THREE.CircleGeometry(0.35, 24);
    dotGeo.rotateX(-Math.PI / 2);
    this.disposables.push(beamGeo, ringGeo, dotGeo);

    for (const cp of this.defs) {
      const group = new THREE.Group();
      group.position.set(cp.marker[0], cp.marker[1], cp.marker[2]);
      const beam = this.beamMaterial(RED, 0.5);
      const ring = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.95, depthWrite: false });
      const beamMesh = new THREE.Mesh(beamGeo, beam);
      beamMesh.renderOrder = 2;
      const ringMesh = new THREE.Mesh(ringGeo, ring);
      ringMesh.position.y = 0.03;
      const dot = new THREE.Mesh(dotGeo, ring);
      dot.position.y = 0.03;
      group.add(beamMesh, ringMesh, dot);
      this.root.add(group);
      this.beacons.push({ group, beam, ring, reachedAt: -1 });
      this.disposables.push(beam, ring);
    }

    // Tall red finish beacon, visible from most of the route.
    const finishGeo = new THREE.CylinderGeometry(1.4, 1.4, 140, 32, 1, true);
    finishGeo.translate(0, 70, 0);
    this.finishBeam = this.beamMaterial(RED, 0.55);
    const finish = new THREE.Mesh(finishGeo, this.finishBeam);
    finish.position.set(def.finish.beacon[0], def.finish.beacon[1], def.finish.beacon[2]);
    finish.renderOrder = 2;
    this.root.add(finish);
    this.disposables.push(finishGeo, this.finishBeam);
  }

  private beamMaterial(color: THREE.Color, opacity: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: {
        uColor: { value: color.clone() },
        uOpacity: { value: opacity },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  reset(): void {
    this.reached = 0;
    this.finished = false;
    for (const b of this.beacons) {
      b.reachedAt = -1;
      b.group.visible = true;
      b.group.scale.setScalar(1);
      b.beam.uniforms.uColor.value.copy(RED);
      b.ring.color.copy(RED);
    }
  }

  /** Where to respawn: the last checkpoint reached, or the start. */
  get respawnPoint(): { pos: Vec3; yaw: number } {
    if (this.reached === 0) return this.spawn;
    const cp = this.defs[this.reached - 1];
    return { pos: cp.spawn, yaw: cp.yaw };
  }

  /** Call once per physics step with the player's centre position. */
  check(p: THREE.Vector3): CheckpointEvent | null {
    if (this.finished) return null;
    for (let i = this.defs.length - 1; i >= this.reached; i--) {
      if (inside(this.defs[i].zone, p)) {
        for (let k = this.reached; k <= i; k++) this.beacons[k].reachedAt = this.time;
        this.reached = i + 1;
        return { type: 'checkpoint', index: i };
      }
    }
    if (inside(this.finishZone, p)) {
      this.finished = true;
      return { type: 'finish' };
    }
    return null;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.beacons.forEach((b, i) => {
      b.beam.uniforms.uTime.value = t + i;
      if (b.reachedAt >= 0) {
        // Flash white, then settle into a faint marker.
        const k = Math.min(1, (t - b.reachedAt) / 1.2);
        b.beam.uniforms.uColor.value.copy(WHITE);
        b.beam.uniforms.uOpacity.value = 0.9 * (1 - k) + 0.1;
        b.ring.color.copy(WHITE);
        b.group.scale.set(1 + (1 - k) * 0.6, 1, 1 + (1 - k) * 0.6);
      } else {
        const next = i === this.reached;
        b.beam.uniforms.uOpacity.value = next ? 0.5 + 0.18 * Math.sin(t * 3.0) : 0.32;
      }
    });
    this.finishBeam.uniforms.uTime.value = t;
    this.finishBeam.uniforms.uOpacity.value = 0.5 + 0.12 * Math.sin(t * 2.2);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
