import * as THREE from 'three';
import { SpawnPoint } from '../player/PlayerController';
import { Aabb, CollisionWorld } from './CollisionWorld';
import { Materials, UNIT_BOX } from './Materials';

/**
 * The playable rooftop course. Built from a cursor that moves along +X, so section
 * lengths are easy to tune. The route runs along the X axis at Z = 0, and the player
 * starts facing +X.
 */

/** Platforms are 12 m wide, centred on Z = 0. */
const HALF_WIDTH = 6;
/** Thickness of the solid below each rooftop slab. */
const SLAB_DEPTH = 14;
/** Yaw that faces the player along +X. */
const FACING_PLUS_X = -Math.PI / 2;
/** Falling below this height respawns the player at the last checkpoint. */
const FALL_Y = -25;

export interface Checkpoint {
  id: number;
  label: string;
  spawn: SpawnPoint;
  /** Volume that activates the checkpoint when the player enters it. */
  trigger: Aabb;
}

export interface Section {
  name: string;
  hint: string;
  startX: number;
}

export interface LevelData {
  group: THREE.Group;
  world: CollisionWorld;
  spawn: SpawnPoint;
  checkpoints: Checkpoint[];
  sections: Section[];
  /** Crossing this volume completes the level. */
  finish: Aabb;
  fallY: number;
  /** Total course length along +X, used for city placement. */
  length: number;
}

class LevelBuilder {
  readonly group = new THREE.Group();
  readonly world = new CollisionWorld();
  readonly checkpoints: Checkpoint[] = [];
  readonly sections: Section[] = [];
  /** Current X position where the next piece of course is placed. */
  cursorX = 0;

  constructor(private readonly mats: Materials) {}

  /** Adds a solid box to collision and draws it. Min/max are world-space corners. */
  solid(min: [number, number, number], max: [number, number, number], material: THREE.Material, red = false): void {
    this.world.add(min, max, red);
    const mesh = new THREE.Mesh(UNIT_BOX, material);
    mesh.scale.set(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  section(name: string, hint: string): void {
    this.sections.push({ name, hint, startX: this.cursorX });
  }

  /** A walkable rooftop slab at height `top`, with low railings along both edges. */
  roof(length: number, top: number): number {
    const x0 = this.cursorX;
    const x1 = x0 + length;
    this.solid([x0, top - SLAB_DEPTH, -HALF_WIDTH], [x1, top, HALF_WIDTH], this.mats.white);
    // Railings sit at the edges, well away from the racing line.
    this.solid([x0, top, HALF_WIDTH - 0.25], [x1, top + 0.9, HALF_WIDTH], this.mats.concrete);
    this.solid([x0, top, -HALF_WIDTH], [x1, top + 0.9, -HALF_WIDTH + 0.25], this.mats.concrete);
    this.cursorX = x1;
    return x0;
  }

  gap(length: number): void {
    this.cursorX += length;
  }

  /** A red vault obstacle spanning the full width of the course. */
  vaultBlock(x0: number, width: number, top: number): void {
    this.solid([x0, top - 1, -HALF_WIDTH], [x0 + width, top, HALF_WIDTH], this.mats.red, true);
  }

  /** Red ventilation duct overhead, with posts at the edges. Clear for a slide, not for a stand. */
  slideBar(x0: number, width: number, roofTop: number): void {
    const barBottom = roofTop + 1.15;
    const barTop = roofTop + 1.6;
    this.solid([x0, barBottom, -HALF_WIDTH], [x0 + width, barTop, HALF_WIDTH], this.mats.red, true);
    this.solid([x0, roofTop, -HALF_WIDTH + 0.4], [x0 + width, barBottom, -HALF_WIDTH + 0.9], this.mats.dark);
    this.solid([x0, roofTop, HALF_WIDTH - 0.9], [x0 + width, barBottom, HALF_WIDTH - 0.4], this.mats.dark);
  }

  /** Low air-conditioning unit to clear with a jump or vault. Visually grey, placed off the centre line. */
  acUnit(x0: number, z0: number, roofTop: number): void {
    this.solid([x0, roofTop, z0], [x0 + 2.2, roofTop + 1.0, z0 + 1.6], this.mats.concrete);
  }

  /** Thin red strip on the rooftop marking a takeoff edge. Walkable, so it cannot block the route. */
  takeoffMarker(x1: number, roofTop: number): void {
    this.solid([x1 - 1.4, roofTop, -2.5], [x1 - 0.2, roofTop + 0.04, 2.5], this.mats.red, true);
  }

  checkpoint(id: number, label: string, x: number, roofTop: number): void {
    const spawn: SpawnPoint = { x: x + 2, y: roofTop, z: 0, yaw: FACING_PLUS_X };
    this.checkpoints.push({
      id,
      label,
      spawn,
      trigger: { minX: x, maxX: x + 4, minY: roofTop - 2, maxY: roofTop + 4, minZ: -HALF_WIDTH, maxZ: HALF_WIDTH },
    });
  }
}

/**
 * Builds the complete level. The course is six sections with checkpoints after the
 * first few, ending with a red finish gate.
 */
export function buildLevel(mats: Materials): LevelData {
  const b = new LevelBuilder(mats);

  // Section 1: Movement tutorial. Learn sprint, jump, a vault and a short gap.
  b.section('Movement Tutorial', 'WASD move  ·  SHIFT sprint  ·  SPACE jump  ·  E vault red obstacles');
  let x = b.roof(30, 0);
  b.checkpoint(1, 'Start', x, 0);
  b.acUnit(x + 4, 4, 0);
  b.vaultBlock(x + 14, 1.6, 0.95);
  b.gap(4);

  // Section 2: Rooftop jumps. Sprint and jump between roofs, with red takeoff markers.
  b.section('Rooftop Jumps', 'Build speed, then SPACE at the red markers');
  x = b.roof(12, 0);
  b.checkpoint(2, 'Rooftop Jumps', x, 0);
  b.takeoffMarker(b.cursorX, 0);
  b.gap(4.5);
  x = b.roof(10, 0);
  b.takeoffMarker(b.cursorX, 0);
  b.gap(4.5);
  x = b.roof(9, 1);
  b.acUnit(x + 5, -4.5, 1);
  b.takeoffMarker(b.cursorX, 1);
  b.gap(4.5);
  b.roof(12, 0);

  // Section 3: Sliding challenge. Slide under the red ducts while keeping momentum.
  b.section('Sliding Challenge', 'CTRL (or C) slide under the red ducts');
  x = b.cursorX;
  b.checkpoint(3, 'Sliding Challenge', x, 0);
  b.roof(44, 0);
  b.slideBar(x + 6, 2, 0);
  b.acUnit(x + 13, -3, 0);
  b.slideBar(x + 18, 2, 0);
  b.acUnit(x + 25, 2.5, 0);
  b.slideBar(x + 30, 2, 0);
  b.slideBar(x + 38, 2, 0);

  // Section 4: Wall run. A gap too wide to jump, with a red wall running along it.
  b.section('Wall Run', 'Jump off the edge beside the red wall and keep running');
  const wallRunRoof = b.roof(12, 0);
  b.checkpoint(4, 'Wall Run', wallRunRoof, 0);
  const gapStart = b.cursorX;
  b.gap(9);
  // Wall on the right-hand side of the route, reaching above the rooftops so it is always runnable.
  b.solid([gapStart, -3, 0.36], [gapStart + 9, 4.2, 0.9], mats.red, true);
  b.roof(10, -0.4);

  // Section 5: Parkour combination. Vault, mantle a ledge, then slide under a duct.
  b.section('Parkour Combination', 'Vault the red block  ·  mantle the ledge  ·  slide the duct');
  x = b.roof(12, -0.4);
  b.checkpoint(5, 'Parkour', x, -0.4);
  b.vaultBlock(x + 6, 1.6, 0.6);
  // Ledge: a block 1.5 m above the roof, which needs a mantle to climb onto.
  b.solid([b.cursorX, -13.6, -HALF_WIDTH], [b.cursorX + 10, 1.1, HALF_WIDTH], mats.white);
  b.cursorX += 10;
  b.gap(4);
  x = b.roof(12, -0.4);
  b.slideBar(x + 4, 2, -0.4);

  // Section 6: Final sprint. A few quick jumps to the finish gate.
  b.section('Final Sprint', 'Hold speed to the red gate');
  x = b.roof(8, -0.4);
  b.checkpoint(6, 'Final Sprint', x, -0.4);
  b.gap(5);
  b.roof(8, 0);
  b.takeoffMarker(b.cursorX, 0);
  b.gap(4.5);
  b.roof(8, 0.8);
  b.takeoffMarker(b.cursorX, 0.8);
  b.gap(4.5);
  const finishRoof = b.roof(14, 0.8);

  // Red finish gate: two pillars and a crossbar. Its trigger covers the approach to the far pillars.
  const finishX = finishRoof + 12;
  b.solid([finishX, 0.8, -HALF_WIDTH + 0.5], [finishX + 0.6, 4.8, -HALF_WIDTH + 1.1], mats.red, true);
  b.solid([finishX, 0.8, HALF_WIDTH - 1.1], [finishX + 0.6, 4.8, HALF_WIDTH - 0.5], mats.red, true);
  b.solid([finishX, 4.2, -HALF_WIDTH + 0.5], [finishX + 0.6, 4.8, HALF_WIDTH - 0.5], mats.red, true);

  const first = b.checkpoints[0];
  const spawn = first.spawn;

  return {
    group: b.group,
    world: b.world,
    spawn,
    checkpoints: b.checkpoints,
    sections: b.sections,
    finish: { minX: finishX, maxX: finishX + 0.6, minY: 0, maxY: 6, minZ: -HALF_WIDTH, maxZ: HALF_WIDTH },
    fallY: FALL_Y,
    length: b.cursorX,
  };
}
