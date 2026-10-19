import * as THREE from 'three';
import { CollisionWorld, SolidKind } from './CollisionWorld';

/**
 * The rooftop route. The player starts at z ≈ 2 and runs toward -Z. Every
 * number here is in metres. The layout is data, so tweaks stay local.
 *
 * Sections:
 *   1. Movement tutorial   (z   6 .. -44)   run, jump, vault a crate, 3.5 m gap
 *   2. Rooftop jumps       (z -44 .. -88)   stepped rooftops, 4-5 m gaps, red pads
 *   3. Sliding challenge   (z -88 .. -124)  three low red ducts to slide under
 *   4. Wall run            (z -124 .. -143) 7 m gap that needs the red wall to cross
 *   5. Combination         (z -143 .. -182) sprint, vault, mantle onto a ledge, slide
 *   6. Final sprint        (z -182 .. -232) quick jumps to the red finish arch
 */

/** Half width of the main route. */
const W = 14;
/** Bottom of every rooftop slab. Far below the play area, so falls read as falls. */
const SLAB_BOTTOM = -8;

export interface CheckpointDef {
  id: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Feet position used when respawning here. */
  spawn: THREE.Vector3;
}

export class Level {
  readonly world = new CollisionWorld();
  /** Group that holds every mesh the level creates. Add it to the scene once. */
  readonly group = new THREE.Group();
  readonly spawn = new THREE.Vector3(0, 0, 2);
  readonly checkpoints: CheckpointDef[] = [];
  readonly finish = {
    min: new THREE.Vector3(-W, -1, -229),
    max: new THREE.Vector3(W, 6, -225),
  };
  /** Lowest y before the player counts as having fallen off. */
  readonly killY = -16;

  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly materials = {
    white: new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.82, metalness: 0 }),
    red: new THREE.MeshStandardMaterial({ color: '#e0202a', roughness: 0.45, metalness: 0.05 }),
    glass: new THREE.MeshStandardMaterial({ color: '#9ccbe6', roughness: 0.12, metalness: 0.4 }),
    decor: new THREE.MeshStandardMaterial({ color: '#d81e27', roughness: 0.6 }),
  };

  constructor() {
    this.build();
  }

  /** Frees GPU resources. Call when the game is torn down. */
  dispose(): void {
    this.boxGeometry.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
  }

  private build(): void {
    this.sectionOne();
    this.sectionTwo();
    this.sectionThree();
    this.sectionFour();
    this.sectionFive();
    this.sectionSix();
    this.buildFinishArch();
  }

  // ----------------------------------------------------------- helpers

  /** Solid block, with an optional mesh. Decorative blocks skip collision. */
  private block(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    kind: SolidKind = 'white',
    wallRun = false,
  ): void {
    const min = new THREE.Vector3(Math.min(x0, x1), y0, Math.min(z0, z1));
    const max = new THREE.Vector3(Math.max(x0, x1), y1, Math.max(z0, z1));
    this.world.add(min, max, kind, wallRun);
    this.addMesh(min, max, kind);
  }

  /** A rooftop: a solid slab from deep below up to `top`, spanning z0 (near) to z1 (far). */
  private roof(x0: number, x1: number, z0: number, z1: number, top: number, kind: SolidKind = 'white'): void {
    this.block(x0, x1, SLAB_BOTTOM, top, z0, z1, kind);
  }

  /** Thin red marker plate on a rooftop. Visual only, so it never blocks. */
  private pad(x0: number, x1: number, z0: number, z1: number, top: number): void {
    this.addMesh(
      new THREE.Vector3(x0, top, z0),
      new THREE.Vector3(x1, top + 0.03, z1),
      'decor',
    );
  }

  private addMesh(min: THREE.Vector3, max: THREE.Vector3, kind: SolidKind | 'decor'): void {
    const size = new THREE.Vector3().subVectors(max, min);
    const mesh = new THREE.Mesh(this.boxGeometry, this.materials[kind]);
    mesh.scale.copy(size);
    mesh.position.copy(min).add(max).multiplyScalar(0.5);
    mesh.castShadow = kind !== 'decor';
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Checkpoint trigger inside a rooftop. Touching it sets the respawn point. */
  private checkpoint(id: string, zMin: number, zMax: number, top: number, spawnZ: number): void {
    this.checkpoints.push({
      id,
      min: new THREE.Vector3(-W, top - 1, Math.min(zMin, zMax)),
      max: new THREE.Vector3(W, top + 4, Math.max(zMin, zMax)),
      spawn: new THREE.Vector3(0, top, spawnZ),
    });
  }

  // ---------------------------------------------------------- sections

  private sectionOne(): void {
    // Start rooftop. Players learn to run, sprint and jump here.
    this.roof(-W, W, -22, 6, 0);
    // Vault obstacle: a red crate 1 m tall, 1.5 m deep.
    this.block(-2, 2, 0, 1, -11.5, -10, 'red');
    this.pad(-2.5, 2.5, -8.5, -7.5, 0);

    // 3.5 m gap, comfortable with a sprint jump.
    this.roof(-W, W, -44, -25.5, 0);
    this.checkpoint('cp1', -36, -40, 0, -38);
  }

  private sectionTwo(): void {
    // Each rooftop steps up or down. Gaps are 4 to 5 m, within sprint jump range.
    this.pad(-3, 3, -43, -41, 0);
    this.roof(-W, W, -58, -48, 1.0);
    this.pad(-3, 3, -57, -55, 1.0);
    this.roof(-W, W, -72, -62.5, 0.5);
    this.pad(-3, 3, -71, -69, 0.5);
    this.roof(-W, W, -88, -77, 0);
    this.checkpoint('cp2', -80, -86, 0, -83);
  }

  private sectionThree(): void {
    // Sliding challenge. Gap first, then a long rooftop with low red ducts.
    // Ducts sit between 1.0 and 2.2 m, so a standing player is blocked but a slide passes.
    this.roof(-W, W, -92, -124, 0);
    for (const zc of [-96, -104, -112]) {
      this.block(-W, W, 1.0, 2.2, zc - 0.6, zc + 0.6, 'red');
    }
    this.checkpoint('cp3', -119, -123, 0, -120);
  }

  private sectionFour(): void {
    // Narrow runways, and a 7 m gap that a normal jump cannot cross.
    // The tall red wall beside the gap is the wall-run surface.
    this.roof(-1.2, 1.0, -124, -130, 0);
    this.block(1.0, 1.4, SLAB_BOTTOM, 9, -129, -138, 'red', true);
    this.roof(-1.2, 1.0, -137, -143, 0);
    this.checkpoint('cp4', -139, -142, 0, -140.5);
  }

  private sectionFive(): void {
    // Wide landing, then a vault crate.
    this.roof(-W, W, -143, -155, 0);
    this.block(-2, 2, 0, 1, -146, -147.5, 'red');
    this.pad(-2.5, 2.5, -148.5, -150, 0);

    // Raised ledge at 1.2 m, reached with a jump or a mantle.
    this.roof(-3, 3, -159, -165, 1.2, 'red');

    // Wide landing with a low red beam across it. Slide under it.
    this.roof(-W, W, -169, -182, 0);
    this.block(-W, W, 1.0, 2.4, -175, -174, 'red');
    this.checkpoint('cp5', -177, -181, 0, -179);
  }

  private sectionSix(): void {
    // Final sprint: short rooftops, a little step up, and a long run to the finish.
    this.roof(-W, W, -193, -187, 0);
    this.roof(-W, W, -204, -197.5, 0.5);
    this.pad(-3, 3, -198.5, -200.5, 0.5);
    this.roof(-W, W, -217, -209, 0);
    this.roof(-W, W, -232, -221, 0);
    this.checkpoint('cp6', -199, -203, 0.5, -201);
  }

  /** Red arch across the finish. Visual only, so it does not block. */
  private buildFinishArch(): void {
    const top = 0;
    this.addMesh(new THREE.Vector3(-W + 1, top, -226.5), new THREE.Vector3(-W + 1.6, top + 5, -226), 'decor');
    this.addMesh(new THREE.Vector3(W - 1.6, top, -226.5), new THREE.Vector3(W - 1, top + 5, -226), 'decor');
    this.addMesh(new THREE.Vector3(-W + 1, top + 4.4, -226.5), new THREE.Vector3(W - 1, top + 5, -226), 'decor');
  }
}
