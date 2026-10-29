import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld';
import { MeshBuilder } from './MeshBuilder';
import type { MaterialSet } from './Materials';

export interface Checkpoint {
  position: THREE.Vector3;
  yaw: number;
  label: string;
}

export interface SectionDef {
  /** Player must pass this Z (moving towards -Z) to trigger the section. */
  z: number;
  name: string;
  hint: string;
}

export interface LevelData {
  group: THREE.Group;
  world: CollisionWorld;
  checkpoints: Checkpoint[];
  finish: { position: THREE.Vector3; radius: number };
  spawn: { position: THREE.Vector3; yaw: number };
  sections: SectionDef[];
  /** Emissive pads of the checkpoint arches, so they can light up. */
  checkpointPads: THREE.Mesh[];
  killY: number;
}

/**
 * Builds the whole playable level: a chain of rooftops strung along -Z with
 * the required gaps, a red wall-run facade, slide ducts, vault barriers and a
 * finish gate.
 *
 * Layout (looking down, +X is to the right, the route runs towards -Z):
 *
 *   START PLAZA  -34 ................. -22   (tutorial, split roof)
 *   JUMP 1       -40 ................. -58
 *   JUMP 2       -64 ................. -80
 *   JUMP 3       -86 ................. -104
 *   SLIDE        -110 ................ -134
 *   WALL RUN     -140 ................ -162   (runs along a red facade)
 *   COMBO        -200 ................ -226
 *   FINAL        -232 ................ -268
 *   FINISH       -274 ................ -296
 */
export function buildLevel(materials: MaterialSet): LevelData {
  const group = new THREE.Group();
  group.name = 'level';
  const world = new CollisionWorld();
  const builder = new MeshBuilder(materials);
  const checkpointPads: THREE.Mesh[] = [];

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  /** A rooftop: solid body from the street up plus a roof slab on top. */
  const platform = (
    xMin: number,
    xMax: number,
    zNear: number,
    zFar: number,
    top: number
  ) => {
    const w = xMax - xMin;
    const d = zNear - zFar;
    const cx = (xMin + xMax) / 2;
    const cz = (zNear + zFar) / 2;

    // body (facade) + roof slab
    builder.box('white', cx, (top - 0.45) / 2, cz, w, top - 0.45, d);
    builder.box('roof', cx, top - 0.225, cz, w, 0.45, d);

    // horizontal window bands
    for (let i = 0; i < 3; i++) {
      const y = top * (0.18 + i * 0.24);
      if (y > top - 3) continue;
      builder.box('glass', cx, y, zNear + 0.06, w * 0.86, 1.5, 0.12);
      builder.box('glass', cx, y, zFar - 0.06, w * 0.86, 1.5, 0.12);
      builder.box('glass', xMin + 0.06, y, cz, 0.12, 1.5, d * 0.86);
      builder.box('glass', xMax - 0.06, y, cz, 0.12, 1.5, d * 0.86);
    }

    // roof edge kerb (visual only)
    builder.box('concrete', cx, top + 0.02, zNear - 0.12, w, 0.05, 0.24);
    builder.box('concrete', cx, top + 0.02, zFar + 0.12, w, 0.05, 0.24);
    builder.box('concrete', xMin + 0.12, top + 0.02, cz, 0.24, 0.05, d);
    builder.box('concrete', xMax - 0.12, top + 0.02, cz, 0.24, 0.05, d);

    world.add(xMin, -60, zFar, xMax, top, zNear);
  };

  /** Painted red strip on the roof marking a take-off / landing zone. */
  const stripe = (xMin: number, xMax: number, z: number, top: number, depth = 0.9) => {
    builder.box('red', (xMin + xMax) / 2, top + 0.035, z, xMax - xMin, 0.07, depth);
  };

  /** Thin painted line - used where a full stripe would be too heavy. */
  const paintLine = (xMin: number, xMax: number, z: number, top: number, depth = 0.25) => {
    builder.box('red', (xMin + xMax) / 2, top + 0.035, z, xMax - xMin, 0.07, depth);
  };

  /**
   * Take-off marker just inside the far (+/-Z) edge of a platform.
   * `width` limits the painted band so it guides rather than dominates.
   */
  const takeoff = (
    xMin: number,
    xMax: number,
    farEdgeZ: number,
    top: number,
    arrowX?: number,
    width = 6
  ) => {
    const cx = arrowX ?? (xMin + xMax) / 2;
    const w = Math.min(width, xMax - xMin);
    stripe(cx - w / 2, cx + w / 2, farEdgeZ + 0.7, top, 0.5);
    builder.arrow('red', cx, top + 0.05, farEdgeZ + 1.9, 0, -1, 2.6);
  };

  /** Low barrier that can be vaulted with E. */
  const vaultBarrier = (
    xMin: number,
    xMax: number,
    z: number,
    top: number,
    height = 0.95,
    depth = 0.6
  ) => {
    const cx = (xMin + xMax) / 2;
    builder.box('concrete', cx, top + height / 2, z, xMax - xMin, height, depth);
    builder.box('red', cx, top + height + 0.06, z, xMax - xMin + 0.08, 0.14, depth + 0.08);
    world.add(xMin, top - 1, z - depth / 2, xMax, top + height, z + depth / 2);
  };

  /**
   * Ventilation duct raised on legs - there is knee high clearance underneath,
   * so the only way through is to slide.
   */
  const duct = (
    xMin: number,
    xMax: number,
    z: number,
    top: number,
    clearance = 1.0,
    height = 0.7,
    depth = 1.4
  ) => {
    const cx = (xMin + xMax) / 2;
    const w = xMax - xMin;
    const bodyY = top + clearance + height / 2;
    builder.box('metal', cx, bodyY, z, w, height, depth);
    builder.box('concrete', cx, top + clearance + height + 0.05, z, w + 0.1, 0.12, depth + 0.1);
    // Red bands on both long faces mark it as a slide-through.
    builder.box('red', cx, top + clearance + height * 0.55, z - depth / 2 - 0.03, w, 0.18, 0.06);
    builder.box('red', cx, top + clearance + height * 0.55, z + depth / 2 + 0.03, w, 0.18, 0.06);
    // A red stripe on the roof in front of the duct points at the gap.
    builder.box('red', cx, top + 0.04, z + depth / 2 + 0.55, w * 0.9, 0.07, 0.22);

    // legs
    const legX = Math.max(2, Math.round(w / 4));
    for (let i = 0; i <= legX; i++) {
      const lx = xMin + (i / legX) * w;
      builder.box('metal', lx, top + clearance / 2, z - depth / 2 + 0.15, 0.13, clearance, 0.13);
      builder.box('metal', lx, top + clearance / 2, z + depth / 2 - 0.15, 0.13, clearance, 0.13);
    }

    world.add(xMin, top + clearance, z - depth / 2, xMax, top + clearance + height, z + depth / 2);
  };

  /** Air conditioning unit - pure decoration. */
  const acUnit = (x: number, z: number, top: number, rotY = 0) => {
    builder.box('metal', x, top + 0.48, z, 1.5, 0.95, 1.9, rotY);
    builder.box('dark', x, top + 0.99, z, 1.2, 0.08, 1.5, rotY);
    builder.box('concrete', x, top + 0.05, z, 1.9, 0.1, 2.3, rotY);
  };

  /** A bank of smaller rooftop vents. */
  const ventBank = (x: number, z: number, top: number, count = 3) => {
    for (let i = 0; i < count; i++) {
      const ox = (i - (count - 1) / 2) * 1.15;
      builder.box('metal', x + ox, top + 0.32, z, 0.8, 0.62, 0.8);
      builder.box('dark', x + ox, top + 0.66, z, 0.66, 0.08, 0.66);
    }
  };

  /** Antenna mast with guy wires implied by the taper. */
  const antenna = (x: number, z: number, top: number, height = 6) => {
    builder.cylinder('metal', x, top + height / 2, z, 0.07, height, 'y', 8);
    builder.box('metal', x, top + height * 0.62, z, 1.1, 0.07, 0.07);
    builder.box('metal', x, top + height * 0.82, z, 0.8, 0.07, 0.07);
    builder.box('concrete', x, top + 0.08, z, 0.7, 0.16, 0.7);
  };

  /** Rooftop skylight - a low glass box with a white frame. */
  const skylight = (x: number, z: number, top: number, w = 2.4, d = 3.2) => {
    builder.box('white', x, top + 0.16, z, w, 0.32, d);
    builder.box('glass', x, top + 0.36, z, w - 0.35, 0.16, d - 0.35);
  };

  /** Service pipe running across the roof - mostly metal with a red band. */
  const redPipe = (x: number, z: number, top: number, length: number, alongZ = true) => {
    const mid = alongZ ? { x, z } : { x, z };
    if (alongZ) {
      builder.cylinder('metal', mid.x, top + 0.2, mid.z, 0.14, length, 'z', 10);
      builder.cylinder('red', mid.x, top + 0.2, mid.z, 0.155, 1.1, 'z', 10);
      builder.box('metal', mid.x, top + 0.06, mid.z - length / 2 + 0.5, 0.45, 0.12, 0.45);
      builder.box('metal', mid.x, top + 0.06, mid.z + length / 2 - 0.5, 0.45, 0.12, 0.45);
    } else {
      builder.cylinder('metal', mid.x, top + 0.2, mid.z, 0.14, length, 'x', 10);
      builder.cylinder('red', mid.x, top + 0.2, mid.z, 0.155, 1.1, 'x', 10);
      builder.box('metal', mid.x - length / 2 + 0.5, top + 0.06, mid.z, 0.45, 0.12, 0.45);
      builder.box('metal', mid.x + length / 2 - 0.5, top + 0.06, mid.z, 0.45, 0.12, 0.45);
    }
  };

  /** Guard rail running along X at a fixed Z. */
  const railX = (xMin: number, xMax: number, z: number, top: number) => {
    const cx = (xMin + xMax) / 2;
    const len = xMax - xMin;
    builder.box('metal', cx, top + 0.55, z, len, 0.08, 0.08);
    builder.box('metal', cx, top + 0.98, z, len, 0.06, 0.06);
    const posts = Math.max(2, Math.round(len / 3));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      builder.box('metal', xMin + t * len, top + 0.52, z, 0.09, 1.05, 0.09);
    }
    world.add(xMin, top, z - 0.12, xMax, top + 1.05, z + 0.12);
  };

  /** Guard rail running along Z at a fixed X. */
  const railZ = (zMin: number, zMax: number, x: number, top: number) => {
    const cz = (zMin + zMax) / 2;
    const len = zMax - zMin;
    builder.box('metal', x, top + 0.55, cz, 0.08, 0.08, len);
    builder.box('metal', x, top + 0.98, cz, 0.06, 0.06, len);
    const posts = Math.max(2, Math.round(len / 3));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      builder.box('metal', x, top + 0.52, zMin + t * len, 0.09, 1.05, 0.09);
    }
    world.add(x - 0.12, top, zMin, x + 0.12, top + 1.05, zMax);
  };

  /** Marker pole used to flag the start of a section. */
  const markerPole = (x: number, z: number, top: number) => {
    builder.cylinder('red', x, top + 2.2, z, 0.11, 4.4, 'y', 10);
    builder.box('red', x + 0.55, top + 3.7, z, 1.1, 0.7, 0.08);
    world.add(x - 0.14, top, z - 0.14, x + 0.14, top + 4.4, z + 0.14);
  };

  // ---------------------------------------------------------------
  // Section 1 - tutorial plaza
  // ---------------------------------------------------------------
  platform(-14, 14, 6, -22, 40);
  platform(-9, 14, -26.5, -34, 40);

  // Start pad - a red runner's launch platform flanked by marker poles.
  builder.box('red', 0, 40.04, 4, 7, 0.08, 6);
  builder.box('red', 0, 40.04, 1.2, 3.4, 0.08, 0.6);
  markerPole(-6, 3, 40);
  markerPole(6, 3, 40);

  vaultBarrier(-3, 3, -6, 40, 0.9, 0.55);
  duct(-5, 5, -15, 40);
  acUnit(-11, -2, 40);
  acUnit(11, -12, 40);
  ventBank(10, -4, 40, 2);
  skylight(-9, -19, 40);
  antenna(12.5, -17, 40, 7);
  redPipe(-12, -8, 40, 9, true);
  railX(-14, -11.8, -18, 40);
  railX(11.8, 14, -18, 40);
  takeoff(-9, 14, -22, 40, 0);
  takeoff(-9, 14, -34, 40, 0);

  // ---------------------------------------------------------------
  // Section 2 - rooftop jumps
  // ---------------------------------------------------------------
  platform(-10, 10, -40, -58, 41);
  platform(2, 20, -64, -80, 41);
  platform(-10, 8, -86, -104, 40);

  takeoff(-10, 10, -58, 41, 5);
  takeoff(2, 20, -80, 41, 5);
  takeoff(-10, 8, -104, 40, -1);

  acUnit(-7, -46, 41);
  acUnit(17, -70, 41);
  acUnit(-7, -95, 40);
  ventBank(7, -44, 41, 3);
  ventBank(4, -75, 41, 2);
  skylight(6, -52, 41, 2.2, 3);
  skylight(-6, -100, 40, 2.2, 3);
  antenna(-8, -52, 41, 8);
  antenna(18, -92, 40, 6);
  redPipe(8, -66, 41, 12, true);
  redPipe(-8, -68, 41, 12, true);
  railZ(-57.4, -40.4, -10, 41);
  railZ(-79.4, -64.4, 20, 41);
  railZ(-103.4, -86.4, -10, 40);

  // ---------------------------------------------------------------
  // Section 3 - sliding challenge
  // ---------------------------------------------------------------
  platform(-12, 12, -110, -130, 40);
  duct(-11, 11, -114, 40);
  duct(-11, 11, -119, 40);
  duct(-11, 11, -124, 40);
  paintLine(-11, 11, -116, 40);
  paintLine(-11, 11, -121, 40);
  paintLine(-11, 11, -126, 40);
  acUnit(-9, -111.5, 40);
  acUnit(9, -111.5, 40);
  ventBank(0, -127, 40, 3);
  skylight(-9, -122, 40, 2, 2.6);
  antenna(10, -128, 40, 7);
  railZ(-129.4, -110.4, -12, 40);
  // A narrow ledge leads to the wall-run roof.
  platform(-4, 2, -134, -140, 40);
  takeoff(-4, 2, -140, 40, -1);
  builder.box('red', -1, 40.04, -132, 1.4, 0.08, 6);
  markerPole(-10.6, -112, 40);

  // ---------------------------------------------------------------
  // Section 4 - wall run
  // ---------------------------------------------------------------
  // A narrow rooftop flush against a taller building. The red panel on that
  // building's west face is the wall-run surface; the gap to the next roof is
  // far too wide to jump.
  platform(-3.6, 0.4, -140, -162, 40);

  // The neighbouring tower: set back so the city stays visible past the
  // route, with a row of red fins marking the wall-run surface.
  builder.box('white', -8, 20, -156.5, 3, 40, 33);
  builder.box('concrete', -8, 40.2, -156.5, 3.3, 0.4, 33.3);
  for (let i = 0; i < 5; i++) {
    builder.box('glass', -6.5, 8 + i * 6, -156.5, 0.12, 2, 30);
  }

  // Red fins: the wall-run surface reads as a row of red blades rather than
  // a flat slab, so the drop stays visible.
  for (let i = 0; i < 15; i++) {
    const z = -141.5 - i * 2.2;
    builder.box('red', -3.9, 41.6, z, 0.3, 4.2, 0.5);
    builder.box('redDark', -3.9, 43.6, z, 0.36, 0.18, 0.6);
  }
  builder.box('red', -3.9, 43.5, -156.5, 0.34, 0.5, 33);
  // The collider is the flat plane the fins stand on.
  world.add(-4.05, 37, -174, -3.75, 45, -140, 'wallrun');

  // Guide stripe along the wall so the route reads clearly.
  builder.box('red', -2.4, 40.04, -151, 1.1, 0.08, 21);
  takeoff(-3.6, 0.4, -162, 40, -2.4);

  // Landing platform after the wall-run gap.
  platform(-8, 16, -174, -194, 40);
  stripe(-4, -1, -175, 40, 0.9);
  builder.arrow('red', -2.5, 40.05, -175.6, 0, -1, 2.4);
  acUnit(11, -180, 40);
  acUnit(7, -188, 40);
  railZ(-161.4, -140.4, 0, 40);
  railZ(-193.4, -174.4, 16, 40);
  takeoff(-8, 12, -194, 40, 0);

  // ---------------------------------------------------------------
  // Section 5 - parkour combination
  // ---------------------------------------------------------------
  // Vault -> slide -> mantle, all on the natural running line.
  platform(-12, 26, -200, -226, 40);
  vaultBarrier(-6, 6, -206, 40, 0.92, 0.55);
  duct(-7, 9, -212, 40);
  // A mantle ledge: a raised block the player has to climb over.
  builder.box('concrete', -2, 40.75, -218.5, 14, 1.5, 3);
  builder.box('red', -2, 41.56, -218.5, 14.1, 0.12, 3.1);
  world.add(-9, 40, -220, 5, 41.5, -217);
  builder.arrow('red', -2, 40.05, -222.0, 0, -1, 2.4);
  // Painted hint on the roof in front of the ledge.
  builder.box('red', -2, 40.04, -215.4, 8, 0.07, 0.3);
  acUnit(20, -203, 40);
  ventBank(16, -210, 40, 3);
  skylight(10, -222, 40, 2.4, 3);
  antenna(22, -220, 40, 8);
  redPipe(6, -224, 40, 12, true);
  railZ(-225.4, -200.4, 26, 40);
  takeoff(-8, 8, -226, 40, -2);

  // ---------------------------------------------------------------
  // Section 6 - final sprint
  // ---------------------------------------------------------------
  platform(-10, 14, -232, -268, 40);
  vaultBarrier(-6, 4, -240, 40, 0.9, 0.5);
  duct(-7, 11, -248, 40);
  vaultBarrier(-4, 6, -256, 40, 0.9, 0.5);
  stripe(-10, 14, -262, 40, 0.6);
  builder.arrow('red', -2, 40.05, -266.6, 0, -1, 2.4);
  acUnit(9, -235, 40);
  acUnit(-7, -234, 40);
  ventBank(-6, -244, 40, 3);
  ventBank(10, -262, 40, 2);
  skylight(4, -242, 40, 2.2, 3);
  antenna(12, -244, 40, 9);
  redPipe(-8, -258, 40, 12, true);
  railZ(-267.4, -232.4, -10, 40);
  takeoff(-8, 8, -268, 40, 0);

  // finish roof
  platform(-8, 8, -274, -296, 40);
  takeoff(-8, 8, -296, 40, 0);
  builder.arrow('red', 0, 40.05, -277, 0, -1, 2.6);
  acUnit(-5, -292, 40);
  acUnit(5, -292, 40);
  antenna(-6, -278, 40, 8);
  ventBank(0, -292, 40, 4);

  // finish gate
  builder.box('red', -4.2, 42.2, -286, 0.5, 4.4, 0.5);
  builder.box('red', 4.2, 42.2, -286, 0.5, 4.4, 0.5);
  builder.box('red', 0, 44.3, -286, 9.4, 0.55, 0.6);
  builder.box('redDark', 0, 43.3, -286, 8.6, 0.35, 0.35);
  world.add(-4.5, 40, -286.4, -3.9, 44.5, -285.6);
  world.add(3.9, 40, -286.4, 4.5, 44.5, -285.6);

  // ---------------------------------------------------------------
  // Checkpoints
  // ---------------------------------------------------------------
  const checkpoints: Checkpoint[] = [];
  const addCheckpoint = (
    x: number,
    z: number,
    top: number,
    label: string,
    withArch = true
  ) => {
    const padGeo = new THREE.BoxGeometry(2.6, 0.08, 2.6);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0xff3341,
      emissive: 0xff2030,
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0.1,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(x, top + 0.05, z);
    pad.receiveShadow = false;
    group.add(pad);
    checkpointPads.push(pad);

    if (withArch) {
      builder.box('red', x - 1.7, top + 1.3, z, 0.18, 2.6, 0.18);
      builder.box('red', x + 1.7, top + 1.3, z, 0.18, 2.6, 0.18);
      builder.box('red', x, top + 2.62, z, 3.6, 0.16, 0.22);
    }

    checkpoints.push({ position: new THREE.Vector3(x, top, z), yaw: 0, label });
  };

  // The start is marked with a pad only - an arch here would block the view
  // straight down the route.
  addCheckpoint(0, 0, 40, 'START', false);
  addCheckpoint(0, -43, 41, 'JUMPS');
  addCheckpoint(-1, -89, 40, 'JUMPS');
  addCheckpoint(0, -112, 40, 'SLIDE');
  addCheckpoint(11.5, -175, 40, 'WALL RUN');
  addCheckpoint(12, -203, 40, 'COMBO');
  addCheckpoint(2, -235, 40, 'FINAL');

  // ---------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------
  const sections: SectionDef[] = [
    { z: 99, name: 'SECTION 1 · WARM UP', hint: 'SHIFT SPRINT · SPACE JUMP · CTRL SLIDE · E VAULT' },
    { z: -36, name: 'SECTION 2 · ROOFTOP JUMPS', hint: 'KEEP YOUR SPEED UP · RED MARKS THE TAKE-OFF' },
    { z: -108, name: 'SECTION 3 · SLIDING', hint: 'HOLD CTRL TO SLIDE UNDER THE DUCTS' },
    { z: -137, name: 'SECTION 4 · WALL RUN', hint: 'JUMP AT THE RED WALL AND RUN ALONG IT' },
    { z: -197, name: 'SECTION 5 · COMBINATION', hint: 'VAULT WITH E · MANTLE LEDGES · KEEP FLOWING' },
    { z: -229, name: 'SECTION 6 · FINAL SPRINT', hint: 'EVERYTHING YOU HAVE GOT' },
  ];

  builder.build(group);

  return {
    group,
    world,
    checkpoints,
    finish: { position: new THREE.Vector3(0, 40, -286), radius: 3.2 },
    spawn: { position: new THREE.Vector3(0, 40, 5.4), yaw: 0 },
    sections,
    checkpointPads,
    killY: -6,
  };
}
