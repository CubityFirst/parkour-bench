import * as THREE from 'three';
import { CollisionWorld, Box } from './CollisionWorld';
import { GeometryBuilder, Materials } from './Materials';

export const GROUND_Y = -80;
export const KILL_Y = -14;

export interface CheckpointDef { pos: THREE.Vector3; yaw: number; name: string; }
export interface HintZone { zMax: number; zMin: number; text: string; }

/**
 * The hand-designed rooftop route. The level runs along -Z.
 *
 * Movement reference (see PlayerController MOVE): a full sprint jump covers
 * roughly 6.3 m on flat ground and rises ~1.2 m, so regular gaps are 2.5–4 m,
 * while wall-run gaps (11–13 m) cannot be crossed without the wall.
 */
export class Level {
  world = new CollisionWorld();
  start: CheckpointDef = { pos: new THREE.Vector3(0, 0, -4), yaw: 0, name: 'START' };
  checkpoints: CheckpointDef[] = [];
  finish!: Box;
  hints: HintZone[] = [];
  group = new THREE.Group();

  private b: Record<string, GeometryBuilder>;

  constructor(private mats: Materials) {
    this.b = {
      facade: new GeometryBuilder(4, 3.5),
      glass: new GeometryBuilder(3, 3),
      roof: new GeometryBuilder(6, 6),
      white: new GeometryBuilder(),
      gray: new GeometryBuilder(),
      dark: new GeometryBuilder(),
      red: new GeometryBuilder(),
      redGlow: new GeometryBuilder(),
    };
    this.build();
    for (const [key, builder] of Object.entries(this.b)) {
      this.group.add(builder.build((this.mats as unknown as Record<string, THREE.Material>)[key]));
    }
  }

  // ------------------------------------------------------------ helpers

  /** A building whose roof is the walkable surface. Parapets line the x-sides. */
  private roof(x0: number, x1: number, zNear: number, zFar: number, top: number, opts: { glass?: boolean; parapet?: boolean } = {}) {
    const z0 = Math.min(zNear, zFar), z1 = Math.max(zNear, zFar);
    this.world.add(x0, GROUND_Y, z0, x1, top, z1);
    (opts.glass ? this.b.glass : this.b.facade).addBox(x0, GROUND_Y, z0, x1, top - 0.3, z1, { sides: true, top: false });
    // Roof slab band (white trim around the top of the building).
    this.b.white.addBox(x0 - 0.05, top - 0.3, z0 - 0.05, x1 + 0.05, top - 0.01, z1 + 0.05, { sides: true, top: false });
    this.b.roof.addBox(x0, top - 0.3, z0, x1, top, z1, { sides: false, top: true });
    if (opts.parapet !== false) {
      this.solid('white', x0, top, z0, x0 + 0.3, top + 0.4, z1);
      this.solid('white', x1 - 0.3, top, z0, x1, top + 0.4, z1);
    }
  }

  /** Visible + collidable box. */
  private solid(mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, runnable = false): Box {
    this.b[mat].addBox(x0, y0, z0, x1, y1, z1);
    return this.world.add(x0, y0, z0, x1, y1, z1, runnable);
  }

  /** Visual-only box (decals, stripes). */
  private deco(mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.b[mat].addBox(x0, y0, z0, x1, y1, z1);
  }

  /** Red stripe painted along a jump edge at z, marking the take-off. */
  private edgeStripe(x0: number, x1: number, z: number, top: number) {
    this.deco('red', x0 + 0.3, top, z, x1 - 0.3, top + 0.02, z + 0.5);
  }

  /** Air-conditioning unit with a dark grille on top. */
  private acUnit(x: number, z: number, top: number, w = 1.6, d = 1.2, h = 1.1) {
    this.solid('gray', x - w / 2, top, z - d / 2, x + w / 2, top + h, z + d / 2);
    this.deco('dark', x - w / 2 + 0.15, top + h, z - d / 2 + 0.15, x + w / 2 - 0.15, top + h + 0.03, z + d / 2 - 0.15);
  }

  /** Low duct spanning the roof that must be slid under (clearance 0.95 m). */
  private duct(x0: number, x1: number, z: number, top: number, depth = 2) {
    this.solid('red', x0, top + 0.95, z - depth, x1, top + 1.85, z);
    this.solid('gray', x0, top, z - depth + 0.3, x0 + 0.35, top + 0.95, z - 0.3);
    this.solid('gray', x1 - 0.35, top, z - depth + 0.3, x1, top + 0.95, z - 0.3);
  }

  /** Tall runnable wall beside a gap, with a red panel on the running face. */
  private runWall(x0: number, x1: number, zNear: number, zFar: number, top: number, faceSide: 1 | -1, refY: number) {
    const z0 = Math.min(zNear, zFar), z1 = Math.max(zNear, zFar);
    this.b.facade.addBox(x0, GROUND_Y, z0, x1, top, z1, { sides: true, top: false });
    this.b.roof.addBox(x0, top - 0.1, z0, x1, top, z1, { sides: false, top: true });
    this.world.add(x0, GROUND_Y, z0, x1, top, z1, true);
    const fx = faceSide > 0 ? x1 : x0 - 0.06;
    this.deco('red', fx, refY - 0.5, z0, fx + 0.06, refY + 3.2, z1);
    // Thin white trims above and below the red band.
    this.deco('white', fx - 0.01, refY + 3.2, z0, fx + 0.07, refY + 3.4, z1);
  }

  private checkpoint(x: number, y: number, z: number, name: string) {
    this.checkpoints.push({ pos: new THREE.Vector3(x, y, z), yaw: 0, name });
  }

  private hint(zMax: number, zMin: number, text: string) { this.hints.push({ zMax, zMin, text }); }

  // ------------------------------------------------------------- layout

  private build() {
    // ---------------- Section 1: Movement tutorial
    this.roof(-10, 10, 0, -40, 0);
    this.solid('white', -10, 0, -0.3, 10, 1.1, 0); // back wall behind start
    // Stairwell hut with a red door.
    this.solid('white', 5.5, 0, -8, 9.5, 3.2, -3);
    this.deco('red', 5.45, 0, -6.4, 5.5, 2.2, -5.2);
    this.acUnit(-7.5, -8, 0); this.acUnit(-7.5, -11, 0); this.acUnit(7.5, -30, 0, 2, 1.6, 1.4);
    // Red hurdle to vault (or jump).
    this.solid('red', -3, 0, -14.5, 3, 0.8, -14);
    // Slide-under bar.
    this.duct(-4, 4, -24, 0, 1);
    this.edgeStripe(-10, 10, -40, 0);
    this.hint(0, -10, 'WASD move  ·  SHIFT sprint  ·  SPACE jump');
    this.hint(-10, -19, 'Press E near the red hurdle to vault');
    this.hint(-19, -29, 'Sprint, then CTRL / C to slide under the duct');
    this.hint(-29, -42, 'Sprint and jump the gap');

    this.roof(-8, 8, -42.5, -60, 0);
    this.checkpoint(0, 0, -50, 'CHECKPOINT 1');
    this.acUnit(-6, -56, 0); this.acUnit(6, -46, 0);
    this.edgeStripe(-8, 8, -60, 0);

    // ---------------- Section 2: Rooftop jumps
    this.hint(-42, -96, 'Sprint jumps carry you further — aim for the red edges');
    this.roof(-6, 6, -64, -77, -1, { glass: true });
    this.edgeStripe(-6, 6, -77, -1);
    this.roof(-5, 7, -81, -93, -0.5);
    this.acUnit(5, -86, -0.5, 1.4, 2.5, 1);
    this.edgeStripe(-5, 7, -93, -0.5);
    this.roof(-7, 7, -97, -111, 0);
    this.checkpoint(0, 0, -105, 'CHECKPOINT 2');
    this.edgeStripe(-7, 7, -111, 0);
    // Red flag poles marking the jumps.
    for (const [x, z, y] of [[-5.5, -59.5, 0], [-5.5, -76.5, -1], [-4.6, -92.5, -0.5], [-6.5, -110.5, 0]]) {
      this.deco('gray', x - 0.05, y, z - 0.05, x + 0.05, y + 3, z + 0.05);
      this.deco('red', x + 0.05, y + 2.2, z - 0.02, x + 0.9, y + 2.9, z + 0.02);
    }

    // ---------------- Section 3: Sliding challenge
    this.roof(-6, 6, -114, -150, 0);
    this.duct(-6, 6, -122, 0);
    this.duct(-6, 6, -130, 0);
    this.duct(-6, 6, -138, 0);
    this.hint(-111, -141, 'Slide under the ducts — keep your momentum');
    this.checkpoint(0, 0, -143, 'CHECKPOINT 3');

    // ---------------- Section 4: Wall run (right wall)
    this.deco('red', 2.6, 0, -150, 3.2, 0.02, -144.5); // lane marking
    this.runWall(3.5, 4.5, -150, -166, 6, -1, 0);
    this.hint(-141, -163, 'Sprint along the red lane, jump toward the RED WALL and hold W to wall run');
    this.roof(-6, 6, -163, -185, -1);
    this.checkpoint(0, -1, -169, 'CHECKPOINT 4');

    // ---------------- Section 5: Parkour combination
    this.solid('red', -5.4, -1, -176.6, 5.4, -0.1, -176); // vault
    this.acUnit(-4.5, -181, -1); this.acUnit(4.2, -182, -1, 1.2, 1.2, 0.9);
    this.edgeStripe(-6, 6, -185, -1);
    this.hint(-170, -186, 'Vault (E) and keep moving');
    this.roof(-6, 6, -189, -200, -1);
    this.deco('red', -3.2, -1, -200, -2.6, -0.98, -194); // lane marking
    this.runWall(-4.5, -3.5, -200, -212, 5, 1, -1); // left wall, face on +x
    this.hint(-186, -211, 'Wall run on the left wall');
    this.roof(-6, 6, -211, -232, -2);
    this.duct(-6, 6, -220, -2);
    this.hint(-211, -222, 'Slide!');
    // Ledge to climb: J sits 2.5 m above I.
    this.roof(-6, 6, -232, -248, 0.5);
    this.deco('red', -6, 0.2, -231.96, 6, 0.5, -231.9); // red ledge lip
    this.hint(-222, -232, 'Jump into the ledge while holding W to climb');
    this.checkpoint(0, 0.5, -238, 'CHECKPOINT 5');
    this.edgeStripe(-6, 6, -248, 0.5);

    // ---------------- Section 6: Final sprint
    this.hint(-240, -320, 'Final sprint — reach the red gate!');
    this.roof(-5, 5, -252, -263, 0.5, { glass: true });
    this.edgeStripe(-5, 5, -263, 0.5);
    this.roof(-5, 5, -267, -278, 0);
    this.solid('red', -4.7, 0, -272.5, 4.7, 0.8, -272);
    this.edgeStripe(-5, 5, -278, 0);
    this.roof(-8, 8, -282, -310, 0);
    // Finish gate
    this.solid('redGlow', -3.6, 0, -298.4, -3, 4.5, -297.8);
    this.solid('redGlow', 3, 0, -298.4, 3.6, 4.5, -297.8);
    this.deco('redGlow', -3.6, 4.5, -298.4, 3.6, 5.1, -297.8);
    this.deco('red', -3, 0, -298.3, 3, 0.03, -297.9);
    this.finish = { min: new THREE.Vector3(-8, -1, -310), max: new THREE.Vector3(8, 8, -298), runnable: false };
    this.acUnit(-6, -305, 0); this.acUnit(6, -288, 0);
  }
}
