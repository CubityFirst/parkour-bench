import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BoxCollider, CollisionWorld, Vec3 } from './CollisionWorld';
import { Checkpoint } from './Checkpoints';
import { Materials, createMaterials } from './Materials';

export interface HintZone {
  min: Vec3;
  max: Vec3;
  text: string;
}

export interface LevelBuild {
  /** Merged visual meshes for the whole route. */
  group: THREE.Group;
  checkpoints: Checkpoint[];
  /** Where a new run begins. */
  spawn: Vec3;
  finish: { min: Vec3; max: Vec3 };
  hints: HintZone[];
  /** Falling below this height respawns the player. */
  killY: number;
  materials: Materials;
}

/**
 * Collects boxes into one merged mesh per material, which keeps the route to a handful of draw calls.
 * Colliders are registered in the same pass, so visuals and collision can never disagree.
 */
class LevelBuilder {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  constructor(private readonly world: CollisionWorld) {}

  /** A box the player collides with. `flags` marks how parkour treats it. */
  solid(min: Vec3, max: Vec3, material: THREE.Material, flags: Omit<BoxCollider, 'min' | 'max'> = {}): void {
    this.world.add({ min, max, ...flags });
    this.addMesh(min, max, material);
  }

  /** A box that is only visual. The player passes through it. */
  deco(min: Vec3, max: Vec3, material: THREE.Material): void {
    this.addMesh(min, max, material);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [material, geometries] of this.buckets) {
      const merged = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  private addMesh(min: Vec3, max: Vec3, material: THREE.Material): void {
    const geometry = new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z);
    geometry.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    let list = this.buckets.get(material);
    if (!list) {
      list = [];
      this.buckets.set(material, list);
    }
    list.push(geometry);
  }
}

/**
 * The single authored route. Z decreases as the player progresses (camera yaw 0 looks down -Z).
 * Gap widths are chosen against the movement tuning: a sprint jump covers about 6.5 m, a walking jump about 4.3 m.
 *
 *   S1 tutorial          z   12 -> -30   flat start, small vault crate, 3.5 m gap
 *   S2 rooftop jumps     z  -30 -> -72   4.5 / 5 / 5 m gaps with 0.4 m steps
 *   S3 slide challenge   z  -76 -> -110  three full-width gates, slide under each
 *   S4 wall run          z -110 -> -122  12 m gap, red wall beside it
 *   S5 combination       z -122 -> -166  vault, slide gate, 6 m wall-run gap
 *   S6 final sprint      z -166 -> -215  four jumps with rising and falling ledges, red finish arch
 */
export function buildLevel(world: CollisionWorld): LevelBuild {
  const mats = createMaterials();
  const b = new LevelBuilder(world);

  // A rooftop slab. zStart is the near edge (larger z), zEnd the far edge. The top sits at `top`.
  const roof = (x0: number, x1: number, zStart: number, zEnd: number, top: number): void => {
    b.solid({ x: x0, y: top - 4, z: zEnd }, { x: x1, y: top, z: zStart }, mats.roof, { climbable: true });
  };
  // Thin red strip on a roof, marking where to take off.
  const marker = (x0: number, x1: number, z0: number, z1: number, top: number): void => {
    b.deco({ x: x0, y: top, z: z0 }, { x: x1, y: top + 0.03, z: z1 }, mats.red);
  };
  // Parapet rail along an edge; collides so the player cannot walk off the side.
  const rail = (x: number, z0: number, z1: number, top: number): void => {
    b.solid({ x: x - 0.12, y: top, z: z0 }, { x: x + 0.12, y: top + 1.0, z: z1 }, mats.trim);
  };

  // ---- S1: movement tutorial ----
  roof(-14, 14, 12, -16, 0);
  rail(-14, -16, 12, 0);
  rail(14, -16, 12, 0);
  // Small red vault crate off-centre, so the route can be walked around.
  b.solid({ x: -2, y: 0, z: -6.5 }, { x: 2, y: 0.8, z: -5.5 }, mats.red, { vaultable: true });
  b.deco({ x: -2.3, y: 0.8, z: -6.6 }, { x: 2.3, y: 0.84, z: -5.4 }, mats.dark);

  // ---- S2: rooftop jumps ----
  roof(-14, 14, -19.5, -30, 0);
  marker(-3, 3, -29.4, -28, 0);
  roof(-12, 12, -34.5, -44, 0.4);
  marker(-3, 3, -43.4, -42, 0.4);
  b.solid({ x: 8, y: 0.4, z: -38 }, { x: 11, y: 1.9, z: -35.5 }, mats.red); // red ventilation duct off the route
  roof(-12, 12, -49, -58, 0.8);
  marker(-3, 3, -57.4, -56, 0.8);
  b.solid({ x: -11.5, y: 0.8, z: -53 }, { x: -8.5, y: 1.9, z: -50.5 }, mats.gray); // AC unit
  roof(-12, 12, -63, -72, 0.4);
  marker(-3, 3, -71.4, -70, 0.4);

  // ---- S3: sliding challenge ----
  roof(-9, 9, -76, -110, 0.4);
  for (const zc of [-84, -93, -102]) {
    // Gate bottom is 1.1 m above the roof: taller than a slide, shorter than a standing body.
    b.solid({ x: -9, y: 1.5, z: zc - 0.5 }, { x: 9, y: 2.7, z: zc + 0.5 }, mats.red);
    b.deco({ x: -9.2, y: 0.4, z: zc - 0.4 }, { x: -8.7, y: 1.5, z: zc + 0.4 }, mats.gray);
    b.deco({ x: 8.7, y: 0.4, z: zc - 0.4 }, { x: 9.2, y: 1.5, z: zc + 0.4 }, mats.gray);
  }

  // ---- S4: wall run ----
  // Landing deck on the far side of the gap. Its near edge is where the wall run ends.
  roof(-12, 12, -122, -136, 0.4);
  // Tall red wall on the right of the gap. Running alongside it carries the player across.
  b.solid({ x: 0.7, y: -6, z: -122 }, { x: 1.1, y: 6, z: -110 }, mats.red, { wallRun: true });

  // ---- S5: combination ----
  b.solid({ x: -2, y: 0.4, z: -130.5 }, { x: 2, y: 1.2, z: -129.5 }, mats.red, { vaultable: true });
  roof(-6.5, 6.5, -140.5, -150, 1.6);
  marker(-3, 3, -149, -147.5, 1.6);
  // Slide gate on the ledge.
  b.solid({ x: -6.5, y: 2.7, z: -145.5 }, { x: 6.5, y: 3.9, z: -144.5 }, mats.red);
  // Second wall, on the left of the 6 m gap.
  b.solid({ x: -0.9, y: -6, z: -156 }, { x: -0.5, y: 6, z: -150 }, mats.red, { wallRun: true });
  roof(-12, 12, -156, -166, 1.2);
  rail(12, -166, -156, 1.2);

  // ---- S6: final sprint ----
  roof(-6, 6, -170.5, -176, 1.6);
  marker(-2.5, 2.5, -175, -173.8, 1.6);
  roof(-6, 6, -180.8, -186, 2.0);
  marker(-2.5, 2.5, -185, -183.8, 2.0);
  roof(-6, 6, -190.8, -196, 1.6);
  marker(-2.5, 2.5, -195, -193.8, 1.6);
  roof(-12, 12, -200.8, -215, 1.2);
  rail(-12, -215, -200.8, 1.2);
  rail(12, -215, -200.8, 1.2);

  // Finish arch: red uprights and crossbar. Decorative only, so it does not block the route.
  b.deco({ x: -8.4, y: 1.2, z: -213.5 }, { x: -7.8, y: 7, z: -212.5 }, mats.red);
  b.deco({ x: 7.8, y: 1.2, z: -213.5 }, { x: 8.4, y: 7, z: -212.5 }, mats.red);
  b.deco({ x: -8.4, y: 6.4, z: -213.5 }, { x: 8.4, y: 7.2, z: -212.5 }, mats.red);

  // Background rooftop clutter on the route's flanks (collides, but well away from the line).
  b.solid({ x: 9, y: 0, z: -22 }, { x: 11.5, y: 1.6, z: -19.5 }, mats.gray);
  b.solid({ x: -11.5, y: 0.4, z: -66 }, { x: -9, y: 1.7, z: -64 }, mats.gray);

  return {
    group: b.build(),
    checkpoints: [
      {
        name: 'ROOFTOP JUMPS',
        zone: { min: { x: -14, y: -2, z: -23 }, max: { x: 14, y: 5, z: -21 } },
        spawn: { x: 0, y: 0, z: -21.5 },
      },
      {
        name: 'SLIDE YARD',
        zone: { min: { x: -9, y: -2, z: -80 }, max: { x: 9, y: 5, z: -77.5 } },
        spawn: { x: 0, y: 0.4, z: -78 },
      },
      {
        name: 'WALL RUN',
        zone: { min: { x: -9, y: -2, z: -106 }, max: { x: 9, y: 5, z: -104 } },
        spawn: { x: 0, y: 0.4, z: -105 },
      },
      {
        name: 'COMBINATION',
        zone: { min: { x: -12, y: -2, z: -127 }, max: { x: 12, y: 5, z: -125 } },
        spawn: { x: 0, y: 0.4, z: -125.5 },
      },
      {
        name: 'FINAL SPRINT',
        zone: { min: { x: -12, y: 0, z: -161 }, max: { x: 12, y: 6, z: -158.5 } },
        spawn: { x: 0, y: 1.2, z: -159.5 },
      },
    ],
    spawn: { x: 0, y: 0, z: 8 },
    finish: { min: { x: -8, y: -1, z: -213.8 }, max: { x: 8, y: 8, z: -211.5 } },
    hints: [
      {
        min: { x: -4, y: -1, z: -9 },
        max: { x: 4, y: 4, z: -3 },
        text: 'E to vault low obstacles',
      },
      {
        min: { x: -14, y: -1, z: -31 },
        max: { x: 14, y: 4, z: -28.5 },
        text: 'Sprint (Shift) and jump the gap',
      },
      {
        min: { x: -9, y: -1, z: -80 },
        max: { x: 9, y: 4, z: -75 },
        text: 'Hold Ctrl / C while running to slide under the gates',
      },
      {
        min: { x: -2, y: -1, z: -120 },
        max: { x: 3, y: 4, z: -110 },
        text: 'Run beside the red wall to wall-run across',
      },
      {
        min: { x: -6, y: -1, z: -152 },
        max: { x: 6, y: 4, z: -147 },
        text: 'Slide under the gate, then wall-run the gap',
      },
    ],
    killY: -14,
    materials: mats,
  };
}
