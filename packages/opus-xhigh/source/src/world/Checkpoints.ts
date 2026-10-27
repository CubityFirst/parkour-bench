import * as THREE from 'three';
import type { CheckpointDef, TriggerBox } from './Level';

const beamVertex = /* glsl */ `
  varying float vY;
  varying vec3 vWorld;
  void main() {
    vY = uv.y;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vY;
  varying vec3 vWorld;
  void main() {
    float a = pow(1.0 - vY, 1.6) * uOpacity;
    a *= 0.8 + 0.2 * sin(uTime * 2.5 - vY * 14.0);
    // Fade out when the camera gets close, so standing in a beam never tints the view.
    a *= smoothstep(2.0, 9.0, distance(cameraPosition.xz, vWorld.xz));
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** A soft vertical light column used to mark checkpoints and the finish. */
export class Beacon {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly ring: THREE.Mesh;
  private targetOpacity: number;
  private readonly targetColor = new THREE.Color();

  constructor(position: THREE.Vector3, color: THREE.ColorRepresentation, radius = 0.6, height = 38, opacity = 0.55) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uTime: { value: 0 },
      },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.targetOpacity = opacity;
    this.targetColor.set(color);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20, 1, true), this.material);
    beam.position.y = height / 2;
    beam.renderOrder = 5;
    this.group.add(beam);

    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.6, radius * 2.0, 40).rotateX(-Math.PI / 2), ringMat);
    this.ring.position.y = 0.03;
    this.group.add(this.ring);
    this.group.position.copy(position);
  }

  set(color: THREE.ColorRepresentation, opacity: number): void {
    this.targetColor.set(color);
    this.targetOpacity = opacity;
  }

  update(time: number, dt: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    const k = 1 - Math.exp(-4 * dt);
    u.uOpacity.value += (this.targetOpacity - u.uOpacity.value) * k;
    (u.uColor.value as THREE.Color).lerp(this.targetColor, k);
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    ringMat.color.copy(u.uColor.value as THREE.Color);
    ringMat.opacity = Math.min(0.85, u.uOpacity.value * 1.6);
  }
}

const RED = 0xff3b2f;
const DONE = 0xffffff;

/** Tracks checkpoint progress and drives the checkpoint beacons. */
export class Checkpoints {
  current = 0;
  readonly group = new THREE.Group();
  private readonly beacons: (Beacon | null)[];

  constructor(readonly defs: CheckpointDef[]) {
    this.beacons = defs.map((def, i) => {
      if (i === 0) return null; // the start needs no beacon
      const beacon = new Beacon(def.spawn, RED);
      this.group.add(beacon.group);
      return beacon;
    });
  }

  get count(): number {
    return this.defs.length;
  }

  get active(): CheckpointDef {
    return this.defs[this.current];
  }

  reset(): void {
    this.current = 0;
    this.beacons.forEach((b) => b?.set(RED, 0.55));
  }

  /** Returns the index of a newly reached checkpoint, or -1. Only forward progress counts. */
  update(pos: THREE.Vector3): number {
    for (let i = this.current + 1; i < this.defs.length; i++) {
      if (inside(pos, this.defs[i])) {
        for (let j = this.current + 1; j <= i; j++) this.beacons[j]?.set(DONE, 0.06);
        this.current = i;
        return i;
      }
    }
    return -1;
  }

  animate(time: number, dt: number): void {
    for (const b of this.beacons) b?.update(time, dt);
  }
}

export function inside(p: THREE.Vector3, box: TriggerBox): boolean {
  return p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y && p.z >= box.min.z && p.z <= box.max.z;
}
