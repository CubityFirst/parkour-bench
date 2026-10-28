import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './CollisionWorld';
import { FACADE_TILE_H, FACADE_TILE_W, Palette } from '../core/Materials';

export interface CheckpointSpec {
  position: THREE.Vector3;
  yaw: number;
  label: string;
}

export interface HintSpec {
  position: THREE.Vector3;
  radius: number;
  text: string;
}

export interface LevelData {
  group: THREE.Group;
  spawn: { position: THREE.Vector3; yaw: number };
  checkpoints: CheckpointSpec[];
  hints: HintSpec[];
  finish: { position: THREE.Vector3; radius: number };
  /** X positions where the HUD "section" label changes. */
  sections: Array<{ x: number; label: string }>;
  routeLength: number;
}

type Style = 'white' | 'glass' | 'dark';

interface RoofSpec {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
  style: Style;
}

const BASE_Y = -95;
const ROOF_SLAB = 0.4;
/** World size covered by one roof texture tile (in metres). */
const ROOF_TILE = 4;

/** The playable route, ordered from the start to the finish. */
const ROOFS: RoofSpec[] = [
  // ---- Section 1 : movement tutorial -------------------------------------
  { x0: -26, x1: 6, z0: -16, z1: 16, top: 0.0, style: 'white' },
  { x0: 11, x1: 40, z0: -16, z1: 16, top: 0.0, style: 'white' },
  // ---- Section 2 : rooftop jumps -----------------------------------------
  { x0: 46, x1: 72, z0: -14, z1: 14, top: 0.6, style: 'glass' },
  { x0: 78, x1: 100, z0: -12, z1: 12, top: -0.4, style: 'white' },
  { x0: 106, x1: 132, z0: -14, z1: 14, top: 0.2, style: 'dark' },
  // ---- Section 3 : sliding -----------------------------------------------
  { x0: 138, x1: 178, z0: -16, z1: 16, top: 0.2, style: 'white' },
  // ---- Section 4 : wall run ----------------------------------------------
  { x0: 189, x1: 232, z0: -16, z1: 16, top: 0.2, style: 'white' },
  // ---- Section 5 : combination -------------------------------------------
  { x0: 238, x1: 268, z0: -16, z1: 16, top: 0.2, style: 'glass' },
  { x0: 277, x1: 307, z0: -16, z1: 16, top: 0.2, style: 'white' },
  // ---- Section 6 : final sprint ------------------------------------------
  { x0: 313, x1: 339, z0: -14, z1: 14, top: 0.6, style: 'white' },
  { x0: 345, x1: 371, z0: -12, z1: 12, top: 0.0, style: 'dark' },
  { x0: 377, x1: 413, z0: -16, z1: 16, top: 0.6, style: 'white' },
];

/** Tall narrow towers that provide the wall running surfaces. */
const WALL_TOWERS = [
  { x0: 174, x1: 196, z0: 0.85, z1: 4.7, top: 17, bandTop: 3.4 },
  { x0: 266, x1: 288, z0: 0.85, z1: 4.7, top: 13, bandTop: 3.4 },
];

const FINISH_X = 401;

/**
 * Collects geometry per material and merges it into a handful of draw calls.
 * Collision boxes are registered separately in the CollisionWorld.
 */
class Builder {
  private buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();

  constructor(
    private world: CollisionWorld,
    private palette: Palette,
  ) {}

  private bucket(key: string): { mat: THREE.Material; geos: THREE.BufferGeometry[] } {
    let b = this.buckets.get(key);
    if (!b) {
      const mat = (this.palette as unknown as Record<string, THREE.Material>)[key];
      b = { mat, geos: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  private push(key: string, geo: THREE.BufferGeometry): void {
    this.bucket(key).geos.push(geo);
  }

  box(key: string, w: number, h: number, d: number, x: number, y: number, z: number): void {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    this.push(key, g);
  }

  /** Box with facade UVs baked in so the window grid keeps a constant scale. */
  facade(key: string, w: number, h: number, d: number, x: number, y: number, z: number): void {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(g, w, h, d, FACADE_TILE_W, FACADE_TILE_H);
    g.translate(x, y, z);
    this.push(key, g);
  }

  /** Box with roof deck UVs baked in so the panel grid keeps a constant scale. */
  roofDeck(key: string, w: number, h: number, d: number, x: number, y: number, z: number): void {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(g, w, h, d, ROOF_TILE, ROOF_TILE);
    g.translate(x, y, z);
    this.push(key, g);
  }

  cylinder(key: string, radius: number, height: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y'): void {
    const g = new THREE.CylinderGeometry(radius, radius, height, 12, 1);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.push(key, g);
  }

  /** Tapered mast (antennas, flag poles). */
  mast(key: string, radiusTop: number, radiusBottom: number, height: number, x: number, y: number, z: number): void {
    const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 8, 1);
    g.translate(x, y + height / 2, z);
    this.push(key, g);
  }

  collider(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
    this.world.add(minX, minY, minZ, maxX, maxY, maxZ);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [key, bucket] of this.buckets) {
      if (!bucket.geos.length) continue;
      const merged = mergeGeometries(bucket.geos, false);
      bucket.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `level-${key}`;
      group.add(mesh);
    }
    return group;
  }
}

/** Bake tileable UVs so textures keep a constant world scale on every box. */
function scaleBoxUVs(geo: THREE.BufferGeometry, w: number, h: number, d: number, tileU: number, tileV: number): void {
  const uv = geo.getAttribute('uv');
  // Per face: [u axis length, v axis length] in world units.
  const faces: Array<[number, number]> = [
    [d, h], // +X
    [d, h], // -X
    [w, d], // +Y
    [w, d], // -Y
    [w, h], // +Z
    [w, h], // -Z
  ];
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (4 vertices each)
  for (let face = 0; face < 6; face++) {
    const su = faces[face][0] / tileU;
    const sv = faces[face][1] / tileV;
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

function styleKey(style: Style): string {
  return style === 'glass' ? 'facadeGlass' : style === 'dark' ? 'facadeDark' : 'facade';
}

/**
 * Builds the whole playable level: twelve rooftops, two wall-run towers,
 * duct corridors, vault crates, route markers, checkpoints and the finish.
 */
export function buildLevel(world: CollisionWorld, palette: Palette): LevelData {
  const b = new Builder(world, palette);
  const checkpoints: CheckpointSpec[] = [];
  const hints: HintSpec[] = [];

  // ------------------------------------------------------------------
  // Rooftops
  // ------------------------------------------------------------------
  for (const roof of ROOFS) {
    const w = roof.x1 - roof.x0;
    const d = roof.z1 - roof.z0;
    const cx = (roof.x0 + roof.x1) / 2;
    const cz = (roof.z0 + roof.z1) / 2;

    // Tower body (facade) down into the city.
    b.facade(styleKey(roof.style), w, roof.top - ROOF_SLAB - BASE_Y, d, cx, (BASE_Y + roof.top - ROOF_SLAB) / 2, cz);
    b.collider(roof.x0, BASE_Y, roof.z0, roof.x1, roof.top - ROOF_SLAB, roof.z1);

    // Roof deck.
    b.roofDeck('roof', w + 0.5, ROOF_SLAB, d + 0.5, cx, roof.top - ROOF_SLAB / 2, cz);
    b.collider(roof.x0 - 0.25, roof.top - ROOF_SLAB, roof.z0 - 0.25, roof.x1 + 0.25, roof.top, roof.z1 + 0.25);

    // Parapets along the long sides (never across the running line).
    for (const side of [-1, 1]) {
      const z = side < 0 ? roof.z0 - 0.05 : roof.z1 + 0.05;
      b.box('white', w + 0.5, 0.86, 0.3, cx, roof.top + 0.43, z);
      b.box('grey', w + 0.55, 0.08, 0.42, cx, roof.top + 0.9, z);
      b.collider(roof.x0 - 0.25, roof.top, z - 0.15, roof.x1 + 0.25, roof.top + 0.9, z + 0.15);
    }
  }

  // ------------------------------------------------------------------
  // Wall run towers
  // ------------------------------------------------------------------
  for (const tower of WALL_TOWERS) {
    const w = tower.x1 - tower.x0;
    const d = tower.z1 - tower.z0;
    const cx = (tower.x0 + tower.x1) / 2;
    const cz = (tower.z0 + tower.z1) / 2;

    // Upper part: normal facade.
    b.facade('facade', w, tower.top - tower.bandTop, d, cx, (tower.bandTop + tower.top) / 2, cz);
    // Lower part: red runner-vision band that marks the wall run surface.
    b.box('red', w, tower.bandTop, d, cx, tower.bandTop / 2, cz);
    b.box('dark', w + 0.12, 0.16, d + 0.12, cx, tower.bandTop + 0.08, cz);

    // One single collider for the whole tower: the wall run surface is the
    // full height, and the red band must never read as a mantle ledge.
    b.collider(tower.x0, BASE_Y, tower.z0, tower.x1, tower.top, tower.z1);
  }

  // ------------------------------------------------------------------
  // Section 1 — tutorial
  // ------------------------------------------------------------------
  const r1 = ROOFS[0];

  // Decorative red pipe run along the far edge.
  for (let x = r1.x0 + 3; x < r1.x1 - 2; x += 6) {
    b.cylinder('red', 0.13, 5.6, x, r1.top + 0.5, r1.z1 - 1.4, 'x');
    b.cylinder('grey', 0.2, 0.5, x + 2.8, r1.top + 0.5, r1.z1 - 1.4, 'x');
  }

  // First vault crate.
  b.box('white', 1.3, 1.0, 3.4, -16, r1.top + 0.5, 0);
  b.box('red', 1.42, 0.16, 3.5, -16, r1.top + 1.02, 0);
  b.collider(-16.65, r1.top, -1.7, -15.35, r1.top + 1.0, 1.7);

  // First slide duct.
  addDuct(b, -11, r1, 1.0);
  b.collider(-11.7, r1.top + 1.0, r1.z0, -10.3, r1.top + 2.4, r1.z1);

  // Raised pad to teach the jump.
  b.box('white', 2.6, 0.45, 5.0, -6.5, r1.top + 0.225, 0);
  b.box('red', 2.7, 0.1, 5.1, -6.5, r1.top + 0.47, 0);
  b.collider(-7.8, r1.top, -2.5, -5.2, r1.top + 0.45, 2.5);

  addTakeoffMarker(b, r1.x1, r1, 0);
  addLandingMarker(b, ROOFS[1].x0, ROOFS[1], 0);

  // ------------------------------------------------------------------
  // Section 2 — rooftop jumps
  // ------------------------------------------------------------------
  const r2 = ROOFS[1];
  addAcUnits(b, r2, [16, 22, 30, 36], 0);
  addPipeRun(b, r2, 0);
  addTakeoffMarker(b, r2.x1, r2, 0);
  addLandingMarker(b, ROOFS[2].x0, ROOFS[2], 0);

  const r3 = ROOFS[2];
  addAcUnits(b, r3, [52, 60, 68], 0);
  addDoorHut(b, r3, 50.5, r3.z0 + 3.2);
  addTakeoffMarker(b, r3.x1, r3, 0);
  addLandingMarker(b, ROOFS[3].x0, ROOFS[3], 0);

  const r4 = ROOFS[3];
  addAcUnits(b, r4, [84, 94], 0);
  addPipeRun(b, r4, 0);
  addTakeoffMarker(b, r4.x1, r4, 0);
  addLandingMarker(b, ROOFS[4].x0, ROOFS[4], 0);

  const r5 = ROOFS[4];
  addAcUnits(b, r5, [112, 120, 128], 0);
  addDoorHut(b, r5, 109, r5.z0 + 3.2);
  addTakeoffMarker(b, r5.x1, r5, 0);
  addLandingMarker(b, ROOFS[5].x0, ROOFS[5], 0);

  // ------------------------------------------------------------------
  // Section 3 — sliding corridor
  // ------------------------------------------------------------------
  const r6 = ROOFS[5];
  for (const x of [147, 153, 159, 165]) {
    addDuct(b, x, r6, 1.05);
    b.collider(x - 0.7, r6.top + 1.05, r6.z0, x + 0.7, r6.top + 2.5, r6.z1);
  }
  addPipeRun(b, r6, 0);
  addTakeoffMarker(b, r6.x1, r6, 0);
  addLandingMarker(b, ROOFS[6].x0, ROOFS[6], 0);

  // ------------------------------------------------------------------
  // Section 4 — wall run
  // ------------------------------------------------------------------
  const r7 = ROOFS[6];
  addAcUnits(b, r7, [196, 206, 216, 226], 0);
  addDoorHut(b, r7, 193, r7.z0 + 3.2);
  addTakeoffMarker(b, r7.x1, r7, 0);
  addLandingMarker(b, ROOFS[7].x0, ROOFS[7], 0);

  // ------------------------------------------------------------------
  // Section 5 — combination
  // ------------------------------------------------------------------
  const r8 = ROOFS[7];
  b.box('white', 1.2, 1.1, 4.2, 243, r8.top + 0.55, 0);
  b.box('red', 1.32, 0.16, 4.3, 243, r8.top + 1.12, 0);
  b.collider(242.4, r8.top, -2.1, 243.6, r8.top + 1.1, 2.1);

  addDuct(b, 249, r8, 1.05);
  b.collider(248.3, r8.top + 1.05, r8.z0, 249.7, r8.top + 2.5, r8.z1);

  b.box('white', 1.2, 1.1, 4.2, 255, r8.top + 0.55, 0);
  b.box('red', 1.32, 0.16, 4.3, 255, r8.top + 1.12, 0);
  b.collider(254.4, r8.top, -2.1, 255.6, r8.top + 1.1, 2.1);

  addAcUnits(b, r8, [261], 0);
  addTakeoffMarker(b, r8.x1, r8, 0);
  addLandingMarker(b, ROOFS[8].x0, ROOFS[8], 0);

  const r9 = ROOFS[8];
  addDuct(b, 293, r9, 1.05);
  b.collider(292.3, r9.top + 1.05, r9.z0, 293.7, r9.top + 2.5, r9.z1);
  addAcUnits(b, r9, [299, 304], 0);
  addPipeRun(b, r9, 0);
  addTakeoffMarker(b, r9.x1, r9, 0);
  addLandingMarker(b, ROOFS[9].x0, ROOFS[9], 0);

  // ------------------------------------------------------------------
  // Section 6 — final sprint
  // ------------------------------------------------------------------
  const r10 = ROOFS[9];
  addAcUnits(b, r10, [318, 326, 334], 0);
  addTakeoffMarker(b, r10.x1, r10, 0);
  addLandingMarker(b, ROOFS[10].x0, ROOFS[10], 0);

  const r11 = ROOFS[10];
  addAcUnits(b, r11, [350, 360], 0);
  addPipeRun(b, r11, 0);
  addTakeoffMarker(b, r11.x1, r11, 0);
  addLandingMarker(b, ROOFS[11].x0, ROOFS[11], 0);

  const r12 = ROOFS[11];
  addAcUnits(b, r12, [384, 392], 0);
  addDoorHut(b, r12, 380, r12.z0 + 3.2);
  addPipeRun(b, r12, 0);

  // ------------------------------------------------------------------
  // City dressing: masts and signage that break up the white facades
  // ------------------------------------------------------------------
  addMast(b, ROOFS[1], 24, ROOFS[1].z1 - 2.2, 7.5);
  addMast(b, ROOFS[2], 66, ROOFS[2].z0 + 2.4, 9.5);
  addMast(b, ROOFS[4], 126, ROOFS[4].z1 - 2.4, 6.5);
  addMast(b, ROOFS[6], 226, ROOFS[6].z0 + 2.6, 8.5);
  addMast(b, ROOFS[8], 302, ROOFS[8].z1 - 2.4, 7.0);
  addMast(b, ROOFS[11], 408, ROOFS[11].z0 + 2.6, 9.0);

  addSignage(b, 20, -16, ROOFS[1].z1, 9, 3.4, 1);
  addSignage(b, 60, -12, ROOFS[2].z1, 11, 4.2, 1);
  addSignage(b, 88, -26, ROOFS[3].z0, 7, 2.6, -1);
  addSignage(b, 118, -14, ROOFS[4].z1, 12, 4.6, 1);
  addSignage(b, 158, -18, ROOFS[5].z1, 10, 3.8, 1);
  addSignage(b, 212, -15, ROOFS[6].z1, 14, 5.2, 1);
  addSignage(b, 252, -13, ROOFS[7].z1, 9, 3.4, 1);
  addSignage(b, 292, -17, ROOFS[8].z1, 11, 4.0, 1);
  addSignage(b, 326, -11, ROOFS[9].z1, 8, 3.0, 1);
  addSignage(b, 392, -12, ROOFS[11].z1, 13, 4.8, 1);

  // ------------------------------------------------------------------
  // Finish gate
  // ------------------------------------------------------------------
  const finishRoof = r12;
  b.box('red', 0.45, 5.2, 0.45, FINISH_X, finishRoof.top + 2.6, -4.2);
  b.box('red', 0.45, 5.2, 0.45, FINISH_X, finishRoof.top + 2.6, 4.2);
  b.box('red', 0.55, 0.7, 9.3, FINISH_X, finishRoof.top + 5.1, 0);
  b.box('redBright', 1.6, 0.06, 8.6, FINISH_X, finishRoof.top + 0.03, 0);
  b.collider(FINISH_X - 0.25, finishRoof.top, -4.5, FINISH_X + 0.25, finishRoof.top + 5.5, -3.95);
  b.collider(FINISH_X - 0.25, finishRoof.top, 3.95, FINISH_X + 0.25, finishRoof.top + 5.5, 4.45);

  // ------------------------------------------------------------------
  // Checkpoints
  // ------------------------------------------------------------------
  checkpoints.push({ position: new THREE.Vector3(-23, ROOFS[0].top, 0), yaw: -Math.PI / 2, label: 'START' });
  checkpoints.push({ position: new THREE.Vector3(14, ROOFS[1].top, 0), yaw: -Math.PI / 2, label: 'SECTION 2' });
  checkpoints.push({ position: new THREE.Vector3(141, ROOFS[5].top, 0), yaw: -Math.PI / 2, label: 'SECTION 3' });
  checkpoints.push({ position: new THREE.Vector3(192, ROOFS[6].top, 0), yaw: -Math.PI / 2, label: 'SECTION 4' });
  checkpoints.push({ position: new THREE.Vector3(241, ROOFS[7].top, 0), yaw: -Math.PI / 2, label: 'SECTION 5' });
  checkpoints.push({ position: new THREE.Vector3(316, ROOFS[9].top, 0), yaw: -Math.PI / 2, label: 'SECTION 6' });

  // Checkpoint arches.
  for (const cp of checkpoints) {
    b.box('red', 0.28, 3.2, 0.28, cp.position.x, cp.position.y + 1.6, -3.4);
    b.box('red', 0.28, 3.2, 0.28, cp.position.x, cp.position.y + 1.6, 3.4);
    b.box('red', 0.34, 0.26, 7.2, cp.position.x, cp.position.y + 3.3, 0);
  }

  // ------------------------------------------------------------------
  // Hints
  // ------------------------------------------------------------------
  hints.push({ position: new THREE.Vector3(-20, ROOFS[0].top, 0), radius: 6, text: 'WASD move · Shift sprint' });
  hints.push({ position: new THREE.Vector3(-16.5, ROOFS[0].top, 0), radius: 4.5, text: 'E — Vault the crate' });
  hints.push({ position: new THREE.Vector3(-11, ROOFS[0].top, 0), radius: 5, text: 'Ctrl — Slide under the duct' });
  hints.push({ position: new THREE.Vector3(-6.5, ROOFS[0].top, 0), radius: 4, text: 'Space — Jump' });
  hints.push({ position: new THREE.Vector3(2, ROOFS[0].top, 0), radius: 7, text: 'Sprint + jump clears the gap' });
  hints.push({ position: new THREE.Vector3(38, ROOFS[1].top, 0), radius: 7, text: 'Keep your speed — jump the gap' });
  hints.push({ position: new THREE.Vector3(70, ROOFS[2].top, 0), radius: 7, text: 'Chase the red markers' });
  hints.push({ position: new THREE.Vector3(143, ROOFS[5].top, 0), radius: 8, text: 'Hold Ctrl to slide the ducts' });
  hints.push({ position: new THREE.Vector3(172, ROOFS[5].top, 0), radius: 9, text: 'Sprint + jump at the edge, hug the red wall' });
  hints.push({ position: new THREE.Vector3(241, ROOFS[7].top, 0), radius: 7, text: 'Vault · Slide · Wall run' });
  hints.push({ position: new THREE.Vector3(380, ROOFS[11].top, 0), radius: 9, text: 'Final sprint — go!' });

  // ------------------------------------------------------------------
  const group = b.build();
  const spawn = new THREE.Vector3(-23, ROOFS[0].top + 0.02, 0);

  const sections = [
    { x: -26, label: 'SECTION 1 / 6 · TUTORIAL' },
    { x: 46, label: 'SECTION 2 / 6 · ROOFTOP JUMPS' },
    { x: 138, label: 'SECTION 3 / 6 · SLIDE' },
    { x: 189, label: 'SECTION 4 / 6 · WALL RUN' },
    { x: 238, label: 'SECTION 5 / 6 · COMBINATION' },
    { x: 313, label: 'SECTION 6 / 6 · FINAL SPRINT' },
  ];

  return {
    group,
    spawn: { position: spawn, yaw: -Math.PI / 2 },
    checkpoints,
    hints,
    finish: { position: new THREE.Vector3(FINISH_X, ROOFS[11].top, 0), radius: 4.5 },
    sections,
    routeLength: FINISH_X - spawn.x,
  };
}

// ----------------------------------------------------------------------
// Prop helpers
// ----------------------------------------------------------------------

/** Overhead ventilation duct: white body with a red warning lip. */
function addDuct(b: Builder, x: number, roof: RoofSpec, clearance: number): void {
  const bottom = roof.top + clearance;
  const depth = 1.4;
  const zc = (roof.z0 + roof.z1) / 2;
  const len = roof.z1 - roof.z0;
  b.box('white', depth, 1.35, len, x, bottom + 0.675, zc);
  b.box('red', depth + 0.06, 0.22, len, x, bottom + 0.11, zc);
  b.box('grey', depth + 0.2, 0.16, len, x, bottom + 1.4, zc);
}

/** Red stripe across the roof that marks a jump take-off point. */
function addTakeoffMarker(b: Builder, x: number, roof: RoofSpec, z: number): void {
  b.box('red', 0.75, 0.05, roof.z1 - roof.z0 - 2.4, x - 1.3, roof.top + 0.025, z);
  b.box('red', 0.16, 2.3, 0.16, x - 1.3, roof.top + 1.15, roof.z1 - 1.6);
  b.box('red', 0.1, 0.7, 1.2, x - 1.3, roof.top + 2.05, roof.z1 - 2.1);
}

/** Red stripe that marks the safe landing zone of a jump. */
function addLandingMarker(b: Builder, x: number, roof: RoofSpec, z: number): void {
  b.box('red', 0.75, 0.05, roof.z1 - roof.z0 - 2.4, x + 1.3, roof.top + 0.025, z);
}

/** Air conditioning units / vents, kept out of the running line. */
function addAcUnits(b: Builder, roof: RoofSpec, xs: number[], z: number): void {
  xs.forEach((x, i) => {
    const w = 1.5 + ((Math.abs(x) * 7) % 3) * 0.3;
    const h = 0.85 + ((Math.abs(x) * 13) % 5) * 0.09;
    const d = 1.3;
    const zz = roof.z0 + 3.2 + (i % 2) * 2.6 + z;
    b.box('grey', w, h, d, x, roof.top + h / 2, zz);
    b.box('dark', w * 0.72, 0.12, d * 0.72, x, roof.top + h + 0.06, zz);
    b.collider(x - w / 2, roof.top, zz - d / 2, x + w / 2, roof.top + h, zz + d / 2);
  });
}

/** A run of red pipes along the roof. */
function addPipeRun(b: Builder, roof: RoofSpec, z: number): void {
  const zPos = z + roof.z0 + 1.8;
  let x = roof.x0 + 2;
  while (x < roof.x1 - 2) {
    const len = Math.min(5.5, roof.x1 - 2 - x);
    b.cylinder('red', 0.11, len, x + len / 2, roof.top + 0.42, zPos, 'x');
    b.cylinder('grey', 0.17, 0.28, x + len / 2, roof.top + 0.42, zPos, 'x');
    x += len + 0.4;
  }
  b.collider(roof.x0 + 2, roof.top, zPos - 0.16, roof.x1 - 2, roof.top + 0.56, zPos + 0.16);
}

/** Small utility hut with a red door — a runner-vision landmark. */
function addDoorHut(b: Builder, roof: RoofSpec, x: number, z: number): void {
  b.box('white', 3.0, 2.7, 2.4, x, roof.top + 1.35, z);
  b.box('grey', 3.3, 0.16, 2.7, x, roof.top + 2.76, z);
  b.box('red', 0.12, 2.05, 1.0, x - 1.55, roof.top + 1.02, z);
  b.box('dark', 0.06, 0.06, 0.34, x - 1.62, roof.top + 1.02, z + 0.32);
  b.collider(x - 1.5, roof.top, z - 1.2, x + 1.5, roof.top + 2.7, z + 1.2);
}

/** Antenna mast that gives the rooftops a silhouette. */
function addMast(b: Builder, roof: RoofSpec, x: number, z: number, height: number): void {
  b.mast('grey', 0.05, 0.12, height, x, roof.top, z);
  b.mast('red', 0.09, 0.09, 1.1, x, roof.top + height, z);
  b.box('red', 1.6, 0.1, 0.1, x, roof.top + height * 0.62, z);
  b.box('red', 1.1, 0.1, 0.1, x, roof.top + height * 0.78, z);
  b.collider(x - 0.15, roof.top, z - 0.15, x + 0.15, roof.top + height, z + 0.15);
}

/** Large coloured signage panel on a facade — pure city dressing. */
function addSignage(b: Builder, x: number, y: number, z: number, width: number, height: number, side: -1 | 1): void {
  b.box('red', width, height, 0.18, x, y, z + side * 0.12);
  b.box('white', width * 0.92, height * 0.22, 0.22, x, y + height * 0.18, z + side * 0.14);
}
