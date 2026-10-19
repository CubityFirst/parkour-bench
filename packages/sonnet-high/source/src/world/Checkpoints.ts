import * as THREE from 'three';
import type { CheckpointDesc } from './LevelLayout.ts';

interface Pad {
  desc: CheckpointDesc;
  group: THREE.Group;
  padMaterial: THREE.MeshStandardMaterial;
  beamMaterial: THREE.ShaderMaterial;
}

const beamVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float a = pow(1.0 - vUv.y, 1.6) * uOpacity;
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * Checkpoint pads: a red disc with a faint light column. Touching one stores a respawn point
 * (position + facing). Falling off the rooftops respawns at the latest activated checkpoint.
 */
export class Checkpoints {
  readonly group = new THREE.Group();
  /** Index of the latest activated checkpoint, or -1 for the start. */
  active = -1;

  private readonly pads: Pad[] = [];
  private readonly padGeo = new THREE.CylinderGeometry(1.5, 1.6, 0.1, 40);
  private readonly ringGeo = new THREE.RingGeometry(1.75, 1.95, 48);
  private readonly beamGeo = new THREE.CylinderGeometry(1.45, 1.45, 7.5, 32, 1, true);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });

  constructor(descs: CheckpointDesc[]) {
    this.ringGeo.rotateX(-Math.PI / 2);
    for (const desc of descs) {
      const group = new THREE.Group();
      group.position.set(desc.x, desc.y, desc.z);

      const padMaterial = new THREE.MeshStandardMaterial({ color: 0xe0121a, roughness: 0.4, metalness: 0.05 });
      const pad = new THREE.Mesh(this.padGeo, padMaterial);
      pad.position.y = 0.05;
      pad.receiveShadow = true;
      group.add(pad);

      const ring = new THREE.Mesh(this.ringGeo, this.ringMaterial);
      ring.position.y = 0.04;
      group.add(ring);

      const beamMaterial = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1, 0.18, 0.2) }, uOpacity: { value: 0.55 } },
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const beam = new THREE.Mesh(this.beamGeo, beamMaterial);
      // Cylinder uv.y runs 0 (bottom) .. 1 (top) already; flip so it fades upward.
      beam.position.y = 3.75;
      group.add(beam);

      this.group.add(group);
      this.pads.push({ desc, group, padMaterial, beamMaterial });
    }
  }

  get count(): number {
    return this.pads.length;
  }

  /** Returns the newly activated checkpoint index when the player touches the next pad. */
  update(x: number, y: number, z: number, time: number): number | null {
    let activated: number | null = null;
    for (let i = this.active + 1; i < this.pads.length; i++) {
      const d = this.pads[i].desc;
      if (Math.abs(x - d.x) < 2.2 && Math.abs(z - d.z) < 2.2 && y > d.y - 0.6 && y < d.y + 3) {
        this.active = i;
        activated = i;
        const pad = this.pads[i];
        pad.padMaterial.color.set(0xf4f6f8);
        pad.beamMaterial.uniforms.uColor.value.set(1, 1, 1);
        pad.beamMaterial.uniforms.uOpacity.value = 0.22;
      }
    }
    for (let i = 0; i < this.pads.length; i++) {
      const upcoming = i > this.active;
      this.pads[i].group.rotation.y = time * 0.4;
      if (upcoming) this.pads[i].beamMaterial.uniforms.uOpacity.value = 0.45 + 0.12 * Math.sin(time * 2.4 + i);
    }
    return activated;
  }

  /** Respawn position for the latest checkpoint (or null → use the level spawn). */
  respawnPoint(): CheckpointDesc | null {
    return this.active >= 0 ? this.pads[this.active].desc : null;
  }

  reset(): void {
    this.active = -1;
    for (const pad of this.pads) {
      pad.padMaterial.color.set(0xe0121a);
      pad.beamMaterial.uniforms.uColor.value.set(1, 0.18, 0.2);
      pad.beamMaterial.uniforms.uOpacity.value = 0.55;
    }
  }

  dispose(): void {
    this.padGeo.dispose();
    this.ringGeo.dispose();
    this.beamGeo.dispose();
    this.ringMaterial.dispose();
    for (const p of this.pads) {
      p.padMaterial.dispose();
      p.beamMaterial.dispose();
    }
  }
}
