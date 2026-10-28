import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld.js';
import { Checkpoints } from './Checkpoints.js';

export interface LevelResult {
  root: THREE.Object3D;
  startPosition: THREE.Vector3;
  finishPosition: THREE.Vector3;
  finishRadius: number;
}

export class Level {
  root = new THREE.Object3D();
  result: LevelResult;

  private whiteMat: THREE.MeshStandardMaterial;
  private concreteMat: THREE.MeshStandardMaterial;
  private redMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshPhysicalMaterial;
  private finishMat: THREE.MeshBasicMaterial;

  constructor(private world: CollisionWorld, private checkpoints: Checkpoints) {
    this.whiteMat = new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.75 });
    this.concreteMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.9 });
    this.redMat = new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.6 });
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x88ccff,
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0.75,
      transmission: 0.2
    });
    this.finishMat = new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.5 });

    this.result = this.buildLevel();
  }

  private addBox(min: THREE.Vector3, max: THREE.Vector3, material: THREE.Material, type: CollisionWorld['boxes'][number]['type'] = 'solid', userData?: any): THREE.Mesh {
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.world.addBox(min.clone(), max.clone(), type, userData);
    return mesh;
  }

  private buildLevel(): LevelResult {
    // Helper to create a rooftop platform
    const platform = (x: number, z: number, w: number, d: number, y: number, mat = this.whiteMat) => {
      const min = new THREE.Vector3(x - w / 2, y, z - d / 2);
      const max = new THREE.Vector3(x + w / 2, y + 1, z + d / 2);
      return this.addBox(min, max, mat);
    };

    const startPos = new THREE.Vector3(0, 12, 5);

    // === Section 1: Movement Tutorial ===
    platform(0, 18, 20, 40, 10);
    // small red vault obstacle (off to the side so the straight-ahead route is clear)
    this.addBox(new THREE.Vector3(6, 11, 12), new THREE.Vector3(8.5, 12.2, 14), this.redMat, 'vault', { type: 'vault' });
    // tutorial gap (small)
    platform(0, 36, 16, 16, 10);
    this.checkpoints.add(new THREE.Vector3(0, 11, 30), 2.5, 1);

    // === Section 2: Rooftop Jumps ===
    platform(0, 58, 14, 14, 10);
    // Red ramp/visual indicator for jump
    this.addBox(new THREE.Vector3(-1, 10.8, 46), new THREE.Vector3(1, 11.8, 50), this.redMat);

    platform(0, 82, 12, 16, 10);
    this.addBox(new THREE.Vector3(-0.8, 10.8, 70), new THREE.Vector3(0.8, 11.8, 74), this.redMat);

    platform(8, 104, 14, 16, 12); // slightly higher
    this.addBox(new THREE.Vector3(7.2, 12.8, 94), new THREE.Vector3(8.8, 13.8, 98), this.redMat);

    platform(-6, 126, 16, 18, 14);
    this.addBox(new THREE.Vector3(-6.8, 14.8, 116), new THREE.Vector3(-5.2, 15.8, 120), this.redMat);
    this.checkpoints.add(new THREE.Vector3(-6, 15, 118), 3, 2);

    // === Section 3: Sliding Challenge ===
    platform(-6, 160, 18, 38, 14);
    // Low ventilation blocks to slide under
    for (let z = 145; z <= 170; z += 9) {
      this.addBox(new THREE.Vector3(-10, 16, z), new THREE.Vector3(10, 19.5, z + 4), this.concreteMat, 'solid');
      // red runner line under each vent
      this.addBox(new THREE.Vector3(-0.2, 14.2, z + 1), new THREE.Vector3(0.2, 14.6, z + 3), this.redMat);
    }
    this.checkpoints.add(new THREE.Vector3(-6, 15, 155), 3, 3);

    // === Section 4: Wall Run ===
    // Wide gap with a long wall on the right
    platform(-6, 196, 16, 22, 14);
    // runnable wall
    this.addBox(new THREE.Vector3(3, 14, 178), new THREE.Vector3(5, 26, 200), this.redMat, 'wallrun', { type: 'wallrun' });
    // landing platform across gap
    platform(-6, 220, 16, 18, 14);
    this.checkpoints.add(new THREE.Vector3(-6, 15, 210), 3, 4);

    // === Section 5: Parkour Combination ===
    platform(-6, 244, 14, 14, 14);
    // vault obstacle
    this.addBox(new THREE.Vector3(-7.5, 15, 232), new THREE.Vector3(-4.5, 17.5, 234), this.redMat, 'vault', { type: 'vault' });
    // jump to higher platform
    platform(2, 264, 14, 14, 18);
    this.addBox(new THREE.Vector3(-5.2, 18.8, 250), new THREE.Vector3(-3.8, 19.8, 254), this.redMat);
    // slide under low duct
    platform(2, 286, 16, 18, 18);
    this.addBox(new THREE.Vector3(-4, 20, 272), new THREE.Vector3(8, 23, 276), this.concreteMat);
    this.addBox(new THREE.Vector3(0.8, 18.2, 272.5), new THREE.Vector3(1.2, 18.6, 275.5), this.redMat);
    this.checkpoints.add(new THREE.Vector3(2, 19, 278), 3, 5);

    // === Section 6: Final Sprint ===
    platform(2, 308, 16, 14, 18);
    this.addBox(new THREE.Vector3(1.2, 18.8, 292), new THREE.Vector3(2.8, 19.8, 296), this.redMat);

    platform(-6, 328, 14, 16, 18);
    this.addBox(new THREE.Vector3(-6.8, 18.8, 314), new THREE.Vector3(-5.2, 19.8, 318), this.redMat);

    platform(-6, 352, 18, 18, 18);
    // Finish line
    const finishMin = new THREE.Vector3(-8, 18, 358);
    const finishMax = new THREE.Vector3(-4, 24, 360);
    const finishMesh = this.addBox(finishMin, finishMax, this.finishMat, 'trigger', { type: 'finish' });
    finishMesh.material = this.finishMat;

    // glass office buildings surrounding the route
    this.addBox(new THREE.Vector3(-35, 0, 80), new THREE.Vector3(-22, 45, 140), this.glassMat);
    this.addBox(new THREE.Vector3(22, 0, 120), new THREE.Vector3(38, 55, 180), this.glassMat);
    this.addBox(new THREE.Vector3(-38, 0, 220), new THREE.Vector3(-24, 40, 280), this.glassMat);
    this.addBox(new THREE.Vector3(24, 0, 260), new THREE.Vector3(36, 48, 330), this.glassMat);

    return {
      root: this.root,
      startPosition: startPos,
      finishPosition: new THREE.Vector3(-6, 19, 359),
      finishRadius: 3
    };
  }
}
