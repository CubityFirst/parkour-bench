import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './CollisionWorld';
import { Checkpoint } from './Checkpoints';

type MatKey =
  | 'roof'
  | 'wall'
  | 'concrete'
  | 'glass'
  | 'red'
  | 'redDark'
  | 'metal'
  | 'dark'
  | 'trim';

export interface LevelOptions {
  /** Building depth below the roof surface. */
  depth?: number;
  /** Facade material. */
  facade?: MatKey;
  /** Which roof edges get a low parapet. */
  parapet?: 'both' | 'none' | 'plusZ' | 'minusZ';
}

export interface LevelResult {
  world: CollisionWorld;
  group: THREE.Group;
  spawn: THREE.Vector3;
  spawnYaw: number;
  checkpoints: Checkpoint[];
  finish: { x: number; z0: number; z1: number; y: number };
  killY: number;
  /** Distance of the route, used for the progress readout. */
  routeLength: number;
}

/** Deterministic PRNG so the level always looks the same. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the playable rooftop level.
 *
 * The route is a continuous line of white rooftops running along +X. Every
 * platform is created through `platform()` which adds the facade, the roof
 * slab, the parapet and the matching collider, so geometry and collision can
 * never drift apart.
 */
export class Level {
  readonly world = new CollisionWorld();
  readonly group = new THREE.Group();
  readonly checkpoints: Checkpoint[] = [];
  readonly finish = { x: 529.6, z0: -9, z1: 9, y: -1 };

  readonly spawn = new THREE.Vector3(2.5, 0, 0);
  readonly spawnYaw = -Math.PI / 2;
  readonly killY = -30;

  private readonly buckets = new Map<MatKey, THREE.BufferGeometry[]>();
  private readonly materials: Record<MatKey, THREE.Material> = {
    roof: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.88, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xe6eaf0, roughness: 0.82, metalness: 0.03 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.92, metalness: 0.02 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8dbcd9,
      roughness: 0.1,
      metalness: 0.5,
      transparent: true,
      opacity: 0.66,
    }),
    red: new THREE.MeshStandardMaterial({ color: 0xd81c14, roughness: 0.45, metalness: 0.06 }),
    redDark: new THREE.MeshStandardMaterial({ color: 0xa8130c, roughness: 0.58, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb6bec7, roughness: 0.38, metalness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x6b7580, roughness: 0.62, metalness: 0.25 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xfdfdfd, roughness: 0.5, metalness: 0.1 }),
  };

  constructor() {
    this.build();
    this.buildMeshes();
  }

  // ------------------------------------------------------------------
  // Geometry helpers
  // ------------------------------------------------------------------
  private push(mat: MatKey, geo: THREE.BufferGeometry): void {
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(geo);
  }

  private box(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    mat: MatKey
  ): void {
    const g = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
    g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    this.push(mat, g);
  }

  private cyl(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    mat: MatKey,
    axis: 'x' | 'y' | 'z' = 'y'
  ): void {
    const g = new THREE.CylinderGeometry(radius, radius, height, 12, 1);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.push(mat, g);
  }

  private solid(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    options: { vaultable?: boolean; wallrun?: boolean; kind?: 'roof' | 'wall' | 'prop' | 'duct' | 'glass' | 'parapet' } = {}
  ): void {
    this.world.add(minX, minY, minZ, maxX, maxY, maxZ, options);
  }

  // ------------------------------------------------------------------
  // Level pieces
  // ------------------------------------------------------------------

  /** Creates a rooftop: facade, roof slab, parapet and collider. */
  private platform(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    top: number,
    options: LevelOptions = {}
  ): void {
    const depth = options.depth ?? 48;
    const facade = options.facade ?? 'wall';

    // Facade (the body of the building).
    this.box(x0, top - depth, z0, x1, top - 0.3, z1, facade);
    // Roof slab with a small overhang.
    this.box(x0 - 0.22, top - 0.3, z0 - 0.22, x1 + 0.22, top, z1 + 0.22, 'roof');
    // Thin dark band under the slab for a crisp silhouette.
    this.box(x0 - 0.16, top - 0.44, z0 - 0.16, x1 + 0.16, top - 0.3, z1 + 0.16, 'dark');

    // Collision: one box for the whole building.
    this.solid(x0, top - depth, z0, x1, top, z1, { kind: 'roof' });

    const parapet = options.parapet ?? 'both';
    if (parapet === 'both' || parapet === 'plusZ') {
      this.parapet(x0, x1, z1 - 0.3, top);
    }
    if (parapet === 'both' || parapet === 'minusZ') {
      this.parapet(x0, x1, z0 + 0.3, top);
    }
  }

  /** Low curb along a roof edge. */
  private parapet(x0: number, x1: number, z: number, top: number): void {
    this.box(x0, top, z - 0.22, x1, top + 0.38, z + 0.22, 'roof');
    this.box(x0, top + 0.38, z - 0.26, x1, top + 0.46, z + 0.26, 'redDark');
    this.solid(x0, top, z - 0.22, x1, top + 0.38, z + 0.22, { kind: 'parapet' });
  }

  /** Red painted marker on the roof surface (take-off / landing points). */
  private marker(x0: number, x1: number, z0: number, z1: number, top: number): void {
    this.box(x0, top + 0.005, z0, x1, top + 0.045, z1, 'red');
  }

  /** Red chevron pointing along +X. */
  private chevron(x: number, z: number, top: number, scale = 1): void {
    const w = 1.5 * scale;
    const l = 1.1 * scale;
    this.box(x - l * 0.5, top + 0.005, z - w * 0.5, x + l * 0.5, top + 0.04, z - w * 0.12, 'red');
    this.box(x - l * 0.5, top + 0.005, z + w * 0.12, x + l * 0.5, top + 0.04, z + w * 0.5, 'red');
  }

  /** Rooftop clutter: air handling units, vents and antennae. */
  private clutter(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    top: number,
    rand: () => number,
    count: number
  ): void {
    // The central lane of every roof is kept clear so the route always reads.
    const lane = 7.5;
    const edge = Math.min(Math.abs(z0), Math.abs(z1));
    if (edge < lane + 2) return;
    const spread = edge - lane - 1.6;

    for (let i = 0; i < count; i++) {
      const x = x0 + 2 + rand() * Math.max(1, x1 - x0 - 4);
      const side = rand() > 0.5 ? 1 : -1;
      const z = side * (lane + rand() * spread);
      const w = 1.4 + rand() * 1.6;
      const d = 1.1 + rand() * 1.1;
      const h = 0.7 + rand() * 0.6;
      this.box(x - w / 2, top, z - d / 2, x + w / 2, top + h, z + d / 2, 'metal');
      this.box(x - w / 2 + 0.1, top + h, z - d / 2 + 0.1, x + w / 2 - 0.1, top + h + 0.12, z + d / 2 - 0.1, 'dark');
      this.solid(x - w / 2, top, z - d / 2, x + w / 2, top + h, z + d / 2, {
        vaultable: h <= 1.3,
        kind: 'prop',
      });
    }
    // Vent pipes.
    for (let i = 0; i < Math.max(1, count - 1); i++) {
      const x = x0 + 3 + rand() * Math.max(1, x1 - x0 - 6);
      const side = rand() > 0.5 ? 1 : -1;
      const z = side * (lane + 0.4 + rand() * spread);
      const h = 1.1 + rand() * 1.4;
      this.cyl(x, top + h / 2, z, 0.22, h, 'metal');
      this.cyl(x, top + h + 0.08, z, 0.32, 0.16, 'dark');
    }
  }

  /** A red mast used as a landmark, like the cranes in the reference art. */
  private mast(x: number, z: number, top: number, height: number): void {
    this.cyl(x, top + height / 2, z, 0.22, height, 'red');
    this.box(x - 0.9, top + height - 1.2, z - 0.9, x + 0.9, top + height, z + 0.9, 'redDark');
    this.solid(x - 0.28, top, z - 0.28, x + 0.28, top + height, z + 0.28, { kind: 'prop' });
  }

  /** Waist high red block that can be vaulted. */
  private vaultBlock(x: number, z: number, top: number, w = 1.6, h = 1.05): void {
    this.box(x - w / 2, top, z - w / 2, x + w / 2, top + h, z + w / 2, 'red');
    this.box(x - w / 2 - 0.06, top + h - 0.16, z - w / 2 - 0.06, x + w / 2 + 0.06, top + h, z + w / 2 + 0.06, 'redDark');
    this.solid(x - w / 2, top, z - w / 2, x + w / 2, top + h, z + w / 2, {
      vaultable: true,
      kind: 'prop',
    });
  }

  /**
   * Elevated ventilation duct that has to be slid under. The duct body starts
   * above the sliding height so the player can pass while sliding, but it
   * blocks a running player.
   */
  private duct(x0: number, x1: number, z0: number, z1: number, top: number, height = 0.95): void {
    const bottom = top + 1.02;

    // Support legs (visual only, so they never trip the player).
    const legs = Math.max(2, Math.round((x1 - x0) / 3.5));
    for (let i = 0; i < legs; i++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / legs;
      this.box(x - 0.13, top, z0 + 0.1, x + 0.13, bottom, z0 + 0.42, 'metal');
      this.box(x - 0.13, top, z1 - 0.42, x + 0.13, bottom, z1 - 0.1, 'metal');
    }

    // The duct body.
    this.box(x0, bottom, z0, x1, bottom + height, z1, 'roof');
    this.box(x0 - 0.08, bottom, z0 - 0.08, x1 + 0.08, bottom + 0.22, z1 + 0.08, 'red');
    this.box(x0 + 0.12, bottom + 0.26, z0 + 0.12, x1 - 0.12, bottom + height - 0.08, z1 - 0.12, 'dark');
    this.solid(x0, bottom, z0, x1, bottom + height, z1, { kind: 'duct' });
  }

  /** The big wall-run panel. `face` is the side the player runs on. */
  private runWall(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    base: number,
    height: number,
    faceMinusZ: boolean
  ): void {
    this.box(x0, base - 48, z0, x1, base + height, z1, 'wall');
    // Red run panel on the face the player uses.
    const pz0 = faceMinusZ ? z0 - 0.06 : z1;
    const pz1 = faceMinusZ ? z0 : z1 + 0.06;
    this.box(x0 + 0.4, base + 0.2, pz0, x1 - 0.4, base + height - 0.8, pz1, 'red');
    // Dark trim on the panel edges.
    this.box(x0 + 0.4, base + height - 0.95, pz0, x1 - 0.4, base + height - 0.8, pz1, 'redDark');
    this.solid(x0, base - 48, z0, x1, base + height, z1, { wallrun: true, kind: 'wall' });
  }

  // ------------------------------------------------------------------
  // The level itself
  // ------------------------------------------------------------------
  private build(): void {
    const rand = mulberry32(20240517);

    // ---------------- Section 1 - movement tutorial -------------------
    this.platform(0, 26, -15, 15, 0);
    this.vaultBlock(9, 0, 0);
    this.chevron(14, 0, 0, 1.2);
    // Overhead beam: the only way past is a slide.
    this.box(17.5, 1.35, -15, 18.5, 2.25, 15, 'roof');
    this.box(17.35, 1.28, -15, 18.65, 1.42, 15, 'red');
    this.box(17.45, 2.25, -15, 18.55, 2.45, 15, 'metal');
    this.solid(17.5, 1.35, -15, 18.5, 2.45, 15, { kind: 'wall' });
    this.mast(23.5, -13.5, 0, 6.5);
    this.clutter(2, 25, -14, 14, 0, rand, 4);

    this.platform(30.5, 58, -15, 15, 0);
    this.marker(29.4, 30.5, -4.5, 4.5, 0);
    this.chevron(33, 0, 0, 1.2);
    this.clutter(33, 56, -14, 14, 0, rand, 5);
    this.mast(55, 13.5, 0, 7.5);
    this.checkpoints.push(new Checkpoint(0, 2.5, 0, 0, 'START'));
    this.checkpoints.push(new Checkpoint(1, 33, 0, 0, 'ROOFTOPS AHEAD'));

    // ---------------- Section 2 - rooftop jumps -------------------------
    this.platform(64, 96, -15, 15, 0.5, { facade: 'glass' });
    this.marker(57.4, 58, -4.5, 4.5, 0);
    this.marker(94.4, 96, -4.5, 4.5, 0.5);
    this.clutter(66, 94, -14, 14, 0.5, rand, 4);
    this.checkpoints.push(new Checkpoint(2, 66.5, 0.5, 0, 'JUMP THE GAPS'));

    this.platform(102, 131, -14, 14, 1.0);
    this.marker(100.4, 102, -4.5, 4.5, 0.5);
    this.marker(129.4, 131, -4.5, 4.5, 1.0);
    this.clutter(104, 129, -13, 13, 1.0, rand, 4);
    this.mast(128.5, 12.5, 1.0, 6);

    this.platform(137, 166, -14, 14, 0.4, { facade: 'glass' });
    this.marker(135.4, 137, -4.5, 4.5, 1.0);
    this.clutter(139, 164, -13, 13, 0.4, rand, 3);

    // ---------------- Section 3 - sliding challenge ----------------------
    this.platform(172, 210, -16, 16, 0.4);
    this.marker(165.4, 166, -4.5, 4.5, 0.4);
    this.marker(170.4, 172, -4.5, 4.5, 0.4);
    this.chevron(176, 0, 0.4, 1.3);
    // The low service duct that has to be slid under.
    this.duct(180, 192, -16, 16, 0.4);
    this.marker(178.6, 180, -5, 5, 0.4);
    this.marker(192, 193.4, -5, 5, 0.4);
    this.clutter(194, 208, -15, 15, 0.4, rand, 3);
    this.checkpoints.push(new Checkpoint(3, 175, 0.4, 0, 'SLIDE UNDER THE DUCTS'));

    this.platform(216, 244, -14, 14, 0.0);
    this.marker(208.4, 210, -4.5, 4.5, 0.4);
    this.marker(214.4, 216, -4.5, 4.5, 0.0);
    this.clutter(218, 242, -13, 13, 0, rand, 3);
    this.mast(241, -12.5, 0, 6.5);

    // ---------------- Section 4 - wall run --------------------------------
    // Wide approach roof.
    this.platform(250, 268, -12, 12, 0.0, { parapet: 'both' });
    this.marker(242.4, 244, -4.5, 4.5, 0);
    this.clutter(252, 266, -11, 11, 0, rand, 3);
    // Funnel walls guide the runner towards the red panel.
    this.box(258, 0, -12, 268, 2.6, 0, 'wall');
    this.box(258, 0, 6, 268, 2.6, 12, 'wall');
    this.box(257.8, 2.6, -12.2, 268.2, 2.85, 0.2, 'roof');
    this.box(257.8, 2.6, 5.8, 268.2, 2.85, 12.2, 'roof');
    this.solid(258, 0, -12, 268, 2.6, 0, { kind: 'wall' });
    this.solid(258, 0, 6, 268, 2.6, 12, { kind: 'wall' });
    this.chevron(260, 3, 0, 1.2);
    this.chevron(265, 3, 0, 1.2);

    // Narrow neck that leads straight onto the wall-run panel.
    this.platform(268, 274, 0, 6, 0.0, { parapet: 'minusZ' });
    this.marker(272.5, 274, 1, 5, 0);
    // The wall-run panel. Its face is flush with the neck.
    this.runWall(274, 292, 6, 12, 0, 6.5, true);
    this.checkpoints.push(new Checkpoint(4, 252.5, 0, 3.2, 'JUMP AT THE RED WALL'));

    this.platform(292, 324, -12, 12, 0.0, { facade: 'glass' });
    this.clutter(295, 322, -11, 11, 0, rand, 3);
    this.mast(320, -10.5, 0, 6.5);

    // ---------------- Section 5 - combination ------------------------------
    this.platform(326, 356, -13, 13, 0.3);
    this.marker(319.4, 320, -4.5, 4.5, 0);
    this.marker(324.4, 326, -4.5, 4.5, 0.3);
    this.vaultBlock(333, 0, 0.3);
    this.duct(344, 346, -13, 13, 0.3);
    this.marker(342.4, 344, -5, 5, 0.3);
    this.marker(346, 347.4, -5, 5, 0.3);
    this.clutter(348, 354, -12, 12, 0.3, rand, 2);
    this.checkpoints.push(new Checkpoint(5, 328.5, 0.3, 0, 'CHAIN YOUR MOVES'));

    // Second neck with the wall-run panel on the same side, so the route
    // keeps a consistent line.
    this.platform(362, 384, -12, 12, 0.9, { parapet: 'both' });
    this.vaultBlock(368, 3, 0.9, 1.5, 1.0);
    this.marker(354.4, 356, -4.5, 4.5, 0.3);
    this.marker(360.4, 362, -4.5, 4.5, 0.9);
    this.box(374, 0.9, -12, 384, 3.5, 0, 'wall');
    this.box(374, 0.9, 6, 384, 3.5, 12, 'wall');
    this.box(373.8, 3.5, -12.2, 384.2, 3.75, 0.2, 'roof');
    this.box(373.8, 3.5, 5.8, 384.2, 3.75, 12.2, 'roof');
    this.solid(374, 0.9, -12, 384, 3.5, 0, { kind: 'wall' });
    this.solid(374, 0.9, 6, 384, 3.5, 12, { kind: 'wall' });
    this.chevron(377, 3, 0.9, 1.2);
    this.chevron(382, 3, 0.9, 1.2);

    this.platform(384, 390, 0, 6, 0.9, { parapet: 'minusZ' });
    this.marker(388.5, 390, 1, 5, 0.9);
    this.runWall(390, 408, 6, 12, 0.9, 6.5, true);

    this.platform(408, 438, -12, 13, 0.2);
    this.duct(414, 416, -12, 13, 0.2);
    this.vaultBlock(424, 3, 0.2);
    this.marker(412.4, 414, -5, 5, 0.2);
    this.clutter(418, 436, -11, 12, 0.2, rand, 3);
    this.mast(435, 11, 0.2, 6.5);

    // ---------------- Section 6 - final sprint ------------------------------
    this.platform(442, 472, -12, 12, 0.2);
    this.marker(440.4, 442, -4.5, 4.5, 0.2);
    this.clutter(444, 470, -11, 11, 0.2, rand, 3);
    this.checkpoints.push(new Checkpoint(6, 444.5, 0.2, 0, 'FINAL SPRINT'));

    this.platform(478, 506, -12, 12, -0.4, { facade: 'glass' });
    this.marker(470.4, 472, -4.5, 4.5, 0.2);
    this.marker(476.4, 478, -4.5, 4.5, -0.4);
    this.clutter(480, 504, -11, 11, -0.4, rand, 3);

    this.platform(512, 556, -14, 14, -1.0);
    this.marker(506.4, 512, -4.5, 4.5, -0.4);
    this.marker(510.4, 512, -4.5, 4.5, -1.0);
    this.clutter(514, 540, -13, 13, -1.0, rand, 4);

    // Finish gate.
    this.box(529.2, -1, -8.4, 530.2, 5.2, -7.6, 'red');
    this.box(529.2, -1, 7.6, 530.2, 5.2, 8.4, 'red');
    this.box(529.0, 5.2, -8.4, 530.4, 6.4, 8.4, 'red');
    this.box(528.6, 4.6, -7.0, 530.6, 5.2, 7.0, 'redDark');
    this.box(528.8, -1, -7.0, 530.6, -0.9, 7.0, 'red');
    this.solid(529.2, -1, -8.4, 530.2, 5.2, -7.6, { kind: 'prop' });
    this.solid(529.2, -1, 7.6, 530.2, 5.2, 8.4, { kind: 'prop' });
    this.finish.x = 529.6;
    this.finish.y = -1;
    this.finish.z0 = -9;
    this.finish.z1 = 9;
  }

  private buildMeshes(): void {
    for (const [key, list] of this.buckets) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      const material = this.materials[key];
      if (merged) {
        for (const g of list) g.dispose();
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      } else {
        for (const g of list) {
          const mesh = new THREE.Mesh(g, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }
      }
    }
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
