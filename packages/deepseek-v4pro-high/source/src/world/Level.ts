import * as THREE from 'three';
import { Checkpoints, Checkpoint } from './Checkpoints';

/**
 * Builds the playable rooftop level. The route runs along +X with six themed
 * sections (tutorial, jumps, slide, wall-run, combination, final sprint).
 * Every solid box is added both as a render mesh and as a collider.
 */
export class Level {
  readonly group = new THREE.Group();
  readonly checkpoints = new Checkpoints();
  spawn = new THREE.Vector3(-8, 0, 0);
  spawnYaw = -Math.PI / 2;

  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private cylGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 10);

  private matWhite = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.92 });
  private matRoof = new THREE.MeshStandardMaterial({ color: 0xedf0f4, roughness: 0.95 });
  private matConcrete = new THREE.MeshStandardMaterial({ color: 0xbcc4cc, roughness: 0.95 });
  private matRed = new THREE.MeshStandardMaterial({ color: 0xe5343b, roughness: 0.55, metalness: 0.1 });
  private matRedGlow = new THREE.MeshStandardMaterial({
    color: 0xe5343b,
    roughness: 0.4,
    emissive: 0xe5343b,
    emissiveIntensity: 0.5,
  });
  private matGlass = new THREE.MeshStandardMaterial({
    color: 0x9fd0ef,
    roughness: 0.12,
    metalness: 0.85,
  });

  constructor(private world: import('./CollisionWorld').CollisionWorld) {
    this.build();
  }

  private addBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material,
    collide = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collide) {
      this.world.addBox(
        cx - sx / 2,
        cy - sy / 2,
        cz - sz / 2,
        cx + sx / 2,
        cy + sy / 2,
        cz + sz / 2,
      );
    }
    return mesh;
  }

  private roof(top: number, x0: number, x1: number, z0: number, z1: number): void {
    const h = 40;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const cy = top - h / 2;
    this.addBox(cx, cy, cz, x1 - x0, h, z1 - z0, this.matWhite);
    // subtle roof cap to differentiate the walkable surface
    this.addBox(cx, top + 0.01, cz, x1 - x0, 0.02, z1 - z0, this.matRoof, false);
  }

  /** Thin red edge marker on the takeoff side of a gap. */
  private edgeMarker(x: number, zHalf: number): void {
    this.addBox(x, 0.03, 0, 0.5, 0.06, zHalf * 2, this.matRed, false);
  }

  private redPipe(cx: number, cy: number, cz: number, len: number, axis: 'x' | 'z'): void {
    const mesh = new THREE.Mesh(this.cylGeo, this.matRed);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (axis === 'x') {
      mesh.rotation.z = Math.PI / 2;
      mesh.scale.set(1, len, 1);
    } else {
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.set(1, len, 1);
    }
    mesh.position.set(cx, cy, cz);
    this.group.add(mesh);
  }

  private checkpoint(pos: THREE.Vector3, yaw: number): void {
    const c: Checkpoint = {
      position: pos.clone(),
      yaw,
      min: new THREE.Vector3(pos.x - 2, pos.y - 1, pos.z - 2),
      max: new THREE.Vector3(pos.x + 2, pos.y + 4, pos.z + 2),
    };
    this.checkpoints.list.push(c);
    // floating marker
    this.addBox(pos.x, pos.y + 2.2, pos.z, 0.3, 0.7, 0.3, this.matRedGlow, false);
  }

  private build(): void {
    // ===== Section 1 — Tutorial (big starting rooftop) =====
    this.roof(0, -15, 15, -12, 12);
    // vaultable red vent
    this.addBox(3, 0.5, 0, 3, 1, 8, this.matRed);
    // forced slide beam (gap 0..1.0 below)
    this.addBox(9, 1.4, 0, 1.0, 0.8, 24, this.matRed);
    this.redPipe(9, 1.8, 0, 24, 'z');

    // ===== Section 2 — Rooftop jumps =====
    this.roof(0, 18, 28, -10, 10);
    this.roof(0.5, 34, 44, -9, 9);
    this.roof(0.2, 49, 59, -8, 8);
    this.roof(0, 64, 74, -8, 8);
    this.roof(0.4, 79, 91, -9, 9);
    this.edgeMarker(28, 10);
    this.edgeMarker(44, 9);
    this.edgeMarker(59, 8);
    this.edgeMarker(74, 8);
    this.edgeMarker(91, 9);
    // flavor: red doors / panels
    this.addBox(23, 1.2, 10, 1.4, 2.4, 0.2, this.matRed, false);
    this.addBox(39, 1.0, -9, 0.2, 1.8, 0.4, this.matRed, false);

    // ===== Section 3 — Sliding challenge =====
    this.roof(0.2, 96, 126, -8, 8);
    this.addBox(102, 1.4, 0, 1.4, 0.8, 16, this.matRed);
    this.addBox(112, 1.4, 0, 1.4, 0.8, 16, this.matRed);
    this.addBox(122, 1.4, 0, 1.4, 0.8, 16, this.matRed);
    // AC units to weave around
    this.addBox(107, 0.3, 3.5, 2, 0.6, 2, this.matConcrete);
    this.addBox(117, 0.3, -3.5, 2, 0.6, 2, this.matConcrete);

    // ===== Section 4 — Wall run =====
    this.roof(0.2, 129, 141, -6, 6);
    // long red wall-run surface along the left (z = -7) of the gap
    this.addBox(147, 3, -7, 18, 6, 2, this.matRed);
    this.roof(0.2, 154, 166, -6, 6);

    // ===== Section 5 — Combination =====
    this.addBox(159, 0.5, 0, 0.6, 1.0, 5, this.matRed); // vault obstacle
    this.roof(0.3, 171, 181, -6, 6);
    this.addBox(188, 3, -7, 14, 6, 2, this.matRed); // second wall-run surface
    this.roof(0.3, 194, 206, -6, 6);
    this.addBox(200, 1.4, 0, 1.2, 0.8, 12, this.matRed); // slide duct

    // ===== Section 6 — Final sprint + finish =====
    this.roof(0.1, 211, 221, -5, 5);
    this.roof(0, 226, 236, -5, 5);
    this.roof(0, 241, 262, -6, 6);

    // red finish arch (visual only)
    this.addBox(250, 2.0, -3, 0.5, 4, 0.5, this.matRed, false);
    this.addBox(250, 2.0, 3, 0.5, 4, 0.5, this.matRed, false);
    this.addBox(250, 4.0, 0, 0.5, 0.5, 6.5, this.matRed, false);

    // finish trigger
    this.checkpoints.finish = {
      position: new THREE.Vector3(250, 1, 0),
      min: new THREE.Vector3(247, -2, -6),
      max: new THREE.Vector3(253, 6, 6),
    };

    // ===== Checkpoints =====
    this.checkpoint(new THREE.Vector3(-8, 0, 0), -Math.PI / 2); // start
    this.checkpoint(new THREE.Vector3(20, 0, 0), -Math.PI / 2); // section 2
    this.checkpoint(new THREE.Vector3(98, 0.2, 0), -Math.PI / 2); // section 3
    this.checkpoint(new THREE.Vector3(131, 0.2, 0), -Math.PI / 2); // section 4
    this.checkpoint(new THREE.Vector3(156, 0.2, 0), -Math.PI / 2); // section 5
    this.checkpoint(new THREE.Vector3(213, 0.1, 0), -Math.PI / 2); // section 6
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
