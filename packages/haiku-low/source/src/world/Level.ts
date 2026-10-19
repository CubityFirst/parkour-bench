import { Group, Scene, Vector3 } from 'three';
import { CollisionWorld } from './CollisionWorld';
import type { CheckpointDef } from './Checkpoints';
import { boxMesh, materials } from './Assets';

const ROOF_X0 = -8;
const ROOF_X1 = 8;
const ROOF_DEPTH = 30;

export interface RouteHint {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/**
 * The rooftop route. The player runs towards -z; every rooftop is laid out
 * along that axis so section boundaries are easy to read.
 *
 *  1. Tutorial roof, low crate, 3.5 m gap           z   10 .. -44
 *  2. Rooftop jumps with step-ups and 4.5 m gaps    z  -48 .. -68
 *  3. Sliding under red ducts                       z  -72 .. -100
 *  4. 11 m gap, wall run along the red wall         z -100 .. -111
 *  5. Vault barrier, mantle ledge, gap              z -111 .. -164
 *  6. Final sprint with step-ups, finish arch       z -168 .. -200
 */
export class Level {
  readonly world = new CollisionWorld();
  readonly startSpawn = v(0, 0, 7);
  readonly finishZ = -196.5;
  readonly checkpointDefs: CheckpointDef[] = [
    { spawn: v(0, 0, -37), triggerZ: -38.5 },
    { spawn: v(0, 0, -74), triggerZ: -75.5 },
    { spawn: v(0, 0, -113), triggerZ: -114.5 },
    { spawn: v(0, 0, -131), triggerZ: -132.5 },
    { spawn: v(0, 0, -143), triggerZ: -144.5 },
    { spawn: v(0, 0, -156), triggerZ: -157.5 },
    { spawn: v(0, 0, -181), triggerZ: -182.5 },
  ];

  private readonly group = new Group();
  private readonly hints: readonly RouteHint[] = [
    { from: 9, to: -26, text: 'WASD move  ·  SHIFT sprint  ·  SPACE jump (hold for height)' },
    { from: -12, to: -18, text: 'Low crate: jump it, or walk into it to climb' },
    { from: -28, to: -46, text: 'Sprint into the gap. Momentum carries the jump.' },
    { from: -47, to: -70, text: 'Red strips mark takeoff edges' },
    { from: -71, to: -99, text: 'Ctrl while sprinting to slide under the red ducts' },
    { from: -101, to: -112, text: 'Steer into the red wall in the air to WALL RUN  ·  SPACE to jump off' },
    { from: -113, to: -136, text: 'Walk into the barrier, or press E to vault it' },
    { from: -137, to: -146, text: 'Walk into the ledge to mantle up' },
    { from: -147, to: -176, text: 'Keep the momentum across the gaps' },
    { from: -177, to: -189, text: 'Chain the jumps. Do not stop.' },
    { from: -190, to: -200, text: 'Run through the red arch' },
  ];

  constructor(scene: Scene) {
    this.build();
    scene.add(this.group);
  }

  /** Contextual control hint for the given route position. */
  hintAt(z: number): string {
    for (const hint of this.hints) {
      if (z <= hint.from && z >= hint.to) return hint.text;
    }
    return '';
  }

  private solid(min: Vector3, max: Vector3, material: typeof materials.roof, wallRun = false): void {
    this.world.addBox(min, max, wallRun);
    this.group.add(boxMesh(min, max, material));
  }

  /** Visual-only geometry: no collision, so it never blocks or catches the player. */
  private decor(min: Vector3, max: Vector3, material: typeof materials.roof): void {
    this.group.add(boxMesh(min, max, material));
  }

  /** A rooftop spanning from `zNear` (closer to start) to `zFar`, with its top surface at `top`. */
  private roof(zNear: number, zFar: number, top: number): void {
    this.solid(v(ROOF_X0, top - ROOF_DEPTH, zFar), v(ROOF_X1, top, zNear), materials.roof);
  }

  /** Red strip on a takeoff edge, extending onto the roof behind it. */
  private jumpMarker(zEdge: number, top: number): void {
    this.decor(v(-3, top, zEdge), v(3, top + 0.03, zEdge + 0.8), materials.red);
  }

  private build(): void {
    // Section 1: movement tutorial
    this.roof(10, -30, 0);
    this.solid(v(-3, 0, -15.5), v(3, 0.6, -14), materials.red);
    this.solid(v(5, 0, 2), v(7, 0.8, 3.6), materials.vent);
    this.jumpMarker(-30, 0);

    this.roof(-33.5, -44, 0);
    this.jumpMarker(-44, 0);

    // Section 2: rooftop jumps
    this.roof(-48, -56, 0.8);
    this.jumpMarker(-56, 0.8);
    this.roof(-60.5, -68, 0);
    this.jumpMarker(-68, 0);

    // Section 3: slide under red ducts
    this.roof(-72.5, -100, 0);
    for (const centre of [-81, -89, -97]) {
      this.solid(v(-8, 1.1, centre - 0.5), v(8, 2.2, centre + 0.5), materials.red);
    }
    this.solid(v(-6.5, 0, -85.5), v(-4.5, 0.7, -84.5), materials.vent);
    this.solid(v(4.5, 0, -93.5), v(6.5, 0.7, -92.5), materials.vent);

    // Section 4: 11 m gap that a normal jump cannot cross, with a long red wall beside it
    this.decor(v(2, 0, -100), v(5, 0.03, -99.2), materials.red);
    this.solid(v(3.9, -3, -111), v(4.8, 4.5, -100), materials.red, true);
    this.roof(-111, -137, 0);

    // Section 5: vault barrier, mantle ledge, gap
    this.solid(v(-8, 0, -125.2), v(8, 1.1, -124), materials.red);
    this.solid(v(-8, 0, -141), v(8, 1.9, -137), materials.concrete);
    this.roof(-141, -150, 0);
    this.jumpMarker(-150, 0);
    this.roof(-154.5, -164, 0);
    this.jumpMarker(-164, 0);

    // Section 6: final sprint
    this.roof(-168.5, -175, 0.8);
    this.jumpMarker(-175, 0.8);
    this.roof(-179.5, -186, 0);
    this.jumpMarker(-186, 0);
    this.roof(-190, -200, 0);

    // Finish: red line across the roof and an arch above it
    this.decor(v(-8, 0, -197.5), v(8, 0.03, -196.5), materials.red);
    this.decor(v(-7.8, 0, -197.5), v(-7, 4.6, -196.5), materials.red);
    this.decor(v(7, 0, -197.5), v(7.8, 4.6, -196.5), materials.red);
    this.decor(v(-7.8, 4.2, -197.5), v(7.8, 4.6, -196.5), materials.red);
  }
}
