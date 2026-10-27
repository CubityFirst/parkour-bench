import * as THREE from 'three';
import { COLORS } from '../game/GameState';
import { CollisionWorld } from './CollisionWorld';
import { CityGenerator } from './CityGenerator';

export interface Checkpoint {
  position: THREE.Vector3; // respawn point (feet)
  min: THREE.Vector3;
  max: THREE.Vector3;
  label: string;
}

export interface HintVolume {
  min: THREE.Vector3;
  max: THREE.Vector3;
  text: string;
}

/**
 * The complete rooftop level: six sections along +X.
 * Returns static geometry for rendering and boxes for collision.
 */
export class Level {
  group = new THREE.Group();
  collision = new CollisionWorld();
  checkpoints: Checkpoint[] = [];
  hints: HintVolume[] = [];
  finishZone: { min: THREE.Vector3; max: THREE.Vector3 } | null = null;
  city = new CityGenerator();
  anim: Array<(t: number) => void> = [];

  spawn = new THREE.Vector3(4, 0.05, 0);

  // Shared materials / geometry
  private matRoof = new THREE.MeshStandardMaterial({ color: COLORS.roof, roughness: 0.92, metalness: 0 });
  private matSide = new THREE.MeshStandardMaterial({ color: COLORS.concrete, roughness: 0.95 });
  private matSideGray = new THREE.MeshStandardMaterial({ color: COLORS.gray, roughness: 0.9 });
  private matDark = new THREE.MeshStandardMaterial({ color: COLORS.darkGray, roughness: 0.8 });
  private matRed = new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.55, metalness: 0.1 });
  private matRedDark = new THREE.MeshStandardMaterial({ color: COLORS.redDark, roughness: 0.6 });
  private matGlass = new THREE.MeshStandardMaterial({
    color: COLORS.wallGlass,
    roughness: 0.15,
    metalness: 0.55,
    transparent: true,
    opacity: 0.85,
  });
  private matYellow = new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.7 });
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

  /** Simple seeded decor rng so the run is deterministic. */
  constructor() {
    this.build();
    this.group.add(this.city.group);
  }

  // --------------------------------------------------------------------------
  // Building blocks
  // --------------------------------------------------------------------------

  /** Adds a solid building (roof top + tall body). Route runs along +X. */
  private building(x0: number, x1: number, z0: number, z1: number, topY: number): void {
    const w = x1 - x0;
    const d = z1 - z0;
    const depthBelow = 60;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;

    // Roof slab (visual, thin)
    const roof = new THREE.Mesh(this.boxGeo, this.matRoof);
    roof.scale.set(w, 0.6, d);
    roof.position.set(cx, topY - 0.3, cz);
    roof.receiveShadow = true;
    this.group.add(roof);

    // Body (collidable + visual)
    const bodyH = depthBelow + 0.6;
    const body = new THREE.Mesh(this.boxGeo, [
      this.matSideGray, this.matSideGray, this.matSide, this.matDark, this.matSideGray, this.matSideGray,
    ]);
    body.scale.set(w, bodyH, d);
    body.position.set(cx, topY - 0.6 - bodyH / 2, cz);
    body.receiveShadow = true;
    this.group.add(body);
    this.collision.addBox(new THREE.Vector3(cx, topY - 0.6 - bodyH / 2, cz), new THREE.Vector3(w, bodyH, d));

    // Parapet lips on the long side edges (visual + graceful wall contact)
    const lip = 0.25;
    for (const zEdge of [z0, z1]) {
      const c = new THREE.Mesh(this.boxGeo, this.matSideGray);
      c.scale.set(w, 0.3, lip);
      c.position.set(cx, topY + 0.15, zEdge === z0 ? z0 + lip / 2 : z1 - lip / 2);
      c.castShadow = false;
      c.receiveShadow = true;
      this.group.add(c);
    }
  }

  /** Freestanding decorative / collision block. */
  private block(
    x: number, y: number, z: number, w: number, h: number, d: number,
    mat: THREE.Material, collide = true, solidRoute = true
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.boxGeo, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y + h / 2, z);
    m.castShadow = h > 0.4;
    m.receiveShadow = true;
    this.group.add(m);
    if (collide) {
      this.collision.addBox(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(w, h, d));
    }
    void solidRoute;
    return m;
  }

  /** Vertical pipe (decor only). */
  private pipe(x: number, y: number, z: number, h: number, r = 0.12, mat: THREE.Material = this.matRed): void {
    const m = new THREE.Mesh(this.cylGeo, mat);
    m.scale.set(r * 2, h, r * 2);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    this.group.add(m);
    void mat;
  }

  /** Red AC/duct obstruction that must be vaulted. */
  private vaultBox(x: number, topY: number, w = 2.4, tag = true): void {
    this.block(x, topY, 0.4, w, 1.0, 1.6, this.matRed, true);
    if (tag) {
      // little side vents
      this.block(x - w / 2 - 0.15, topY, 0.4, 0.3, 1.3, 1.6, this.matRedDark, false);
    }
  }

  /** Horizontal red duct to slide under. clearance 1.05 above the roof. */
  private slideDuct(x: number, topY: number, z0: number, z1: number): void {
    const d = z1 - z0;
    const cz = (z0 + z1) / 2;
    // main duct box creates the low ceiling
    this.block(x, topY + 1.05, cz, 1.2, 1.0, d, this.matRed, true);
    // support legs
    for (const zz of [z0 + 0.4, z1 - 0.4]) {
      this.block(x, topY, zz, 0.25, 1.05, 0.25, this.matRedDark, true);
    }
  }

  /**
   * Roof edge marker: a red pipe + red curb slice to signal an upcoming jump.
   */
  private jumpMarker(x: number, topY: number, zCenter = 0): void {
    this.pipe(x - 0.6, topY, zCenter + 2.2, 1.6, 0.14);
    this.block(x - 0.3, topY, zCenter, 0.5, 0.28, 5.0, this.matRed, true);
  }

  private glassTower(x: number, z: number, w: number, d: number, h: number): void {
    const m = new THREE.Mesh(this.boxGeo, this.matGlass);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2 - 42, z);
    this.group.add(m);
    // white cap
    const cap = new THREE.Mesh(this.boxGeo, this.matRoof);
    cap.scale.set(w * 0.5, 1.4, d * 0.5);
    cap.position.set(x, h - 42 + 0.7, z);
    this.group.add(cap);
  }

  // --------------------------------------------------------------------------
  // Level construction
  // --------------------------------------------------------------------------
  private build(): void {
    // ===== Section 1 — Tutorial roof =======================================
    const aTop = 0;
    this.building(0, 26, -9, 9, aTop);
    this.spawn.set(4, aTop + 0.05, 0);

    // AC / decorative units
    this.block(9, aTop, -6, 2.2, 1.1, 2.2, this.matSideGray, true);
    this.block(9, aTop, 6.4, 2.4, 1.3, 2.4, this.matSideGray, true);
    this.pipe(7.5, aTop, 6.5, 2.6);
    // Red vault obstacle mid-roof
    this.vaultBox(13, aTop);
    // slide duct near the end of the tutorial roof
    this.slideDuct(21, aTop, -7.5, 7.5);
    // small gap marker
    this.jumpMarker(25.4, aTop);

    this.hints.push({
      min: new THREE.Vector3(2, -5, -8), max: new THREE.Vector3(7, 5, 8),
      text: 'Hold SHIFT to sprint',
    });
    this.hints.push({
      min: new THREE.Vector3(11, -5, -8), max: new THREE.Vector3(14.6, 5, 8),
      text: 'Press E to vault the red obstacle',
    });
    this.hints.push({
      min: new THREE.Vector3(18.5, -5, -8), max: new THREE.Vector3(20.5, 5, 8),
      text: 'Press CTRL (or C) to slide under the duct',
    });
    this.hints.push({
      min: new THREE.Vector3(24, -5, -8), max: new THREE.Vector3(26, 5, 8),
      text: 'SPACE at the edge to jump the gap',
    });

    // ===== Section 2 — Rooftop jumps =======================================
    const bTop = 0.8;
    this.building(30, 48, -9, 9, bTop);
    this.block(36, bTop, -5, 2.0, 1.4, 2.0, this.matSideGray, true);
    this.block(42, bTop, 5.8, 1.8, 0.9, 1.8, this.matRed, true); // vaultable red
    this.jumpMarker(46.6, bTop);

    const cTop = 1.6;
    this.building(53, 68, -9, 9, cTop);
    this.block(57, cTop, 5.4, 2.6, 2.2, 2.6, this.matSideGray, true);
    this.block(57, cTop + 2.2, 5.4, 0.2, 0.9, 0.2, this.matRed, false); // red trim
    this.jumpMarker(66.5, cTop);
    // decorative door
    this.block(60, cTop, -8.6, 1.8, 2.2, 0.9, this.matRed, false);

    this.addCheckpoint('The Heights', new THREE.Vector3(64, cTop + 0.05, 0),
      new THREE.Vector3(62, -6, -9), new THREE.Vector3(68, 8, 9));

    // ===== Section 3 — Sliding challenge ===================================
    const dTop = 2.4;
    this.building(72, 92, -9, 9, dTop);
    this.slideDuct(77, dTop, -7.5, 7.5);
    this.slideDuct(83, dTop, -7.5, 7.5);
    this.slideDuct(89, dTop, -7.5, 7.5);
    this.hints.push({
      min: new THREE.Vector3(72, -6, -9), max: new THREE.Vector3(92, 8, 9),
      text: 'Chain slides — keep your momentum',
    });
    this.addCheckpoint('Vent Alley', new THREE.Vector3(74, dTop + 0.05, 0),
      new THREE.Vector3(72.5, -6, -9), new THREE.Vector3(76, 8, 9));

    // ===== Section 4 — Wall run ============================================
    // Big 14m gap, crossable only by wall-running the red billboard wall.
    const wallZFace = 6.0; // wall occupies z 6.0..6.9 (thin fin)
    const wallMat = this.matRed;
    const wall = this.block(
      (92 + 107.6) / 2, dTop - 0.2, wallZFace + 0.45, 107.6 - 92, 4.4, 0.9, wallMat, true
    );
    wall.receiveShadow = true;
    // sign frame posts up top for looks
    this.block((92 + 107.6) / 2, dTop + 4.2, wallZFace + 0.45, 107.6 - 92, 0.4, 1.2, this.matRedDark, false);
    // orange billboard accent behind the wall
    this.block((92 + 107.6) / 2, dTop + 0.4, wallZFace + 1.1, 107.6 - 92 - 1.5, 3.2, 0.25, this.matYellow, false);

    this.hints.push({
      min: new THREE.Vector3(88, -6, -9), max: new THREE.Vector3(93, 8, 9),
      text: 'Jump onto the red wall and hold forward — SPACE to leap off',
    });
    this.addCheckpoint('The Billboard', new THREE.Vector3(73.6, dTop + 0.05, 0),
      new THREE.Vector3(72, -6, -9), new THREE.Vector3(75, 8, 9));

    const eTop = 2.4;
    this.building(106, 124, -9, 9, eTop);
    this.addCheckpoint('After the Wall', new THREE.Vector3(108, eTop + 0.05, 0),
      new THREE.Vector3(106.5, -6, -9), new THREE.Vector3(110, 8, 9));
    // vaultable red AC + pipe
    this.vaultBox(114, eTop);
    this.pipe(119, eTop, -4.2, 1.8);
    this.jumpMarker(122.4, eTop);

    // ===== Section 5 — Parkour combination =================================
    const fTop = 3.6;
    this.building(129, 147, -9, 9, fTop);
    this.slideDuct(133, fTop, -7.5, 7.5);
    this.vaultBox(139, fTop, 2.0);
    this.hints.push({
      min: new THREE.Vector3(129, -6, -9), max: new THREE.Vector3(147, 9, 9),
      text: 'Slide the duct, vault the red box, and keep the flow',
    });
    this.addCheckpoint('Red Room', new THREE.Vector3(131, fTop + 0.05, 0),
      new THREE.Vector3(129.5, -6, -9), new THREE.Vector3(133, 9, 9));

    // narrow bridge option between F and G
    const bridgeZ = 0;
    this.block((147 + 151) / 2, fTop + 0.2, bridgeZ, 151 - 147 + 0.4, 0.5, 2.2, this.matRed, true);

    const gTop = 5.0;
    this.building(151, 161, -8, 8, gTop);
    this.block(155, gTop, -4.5, 2.0, 1.0, 2.0, this.matSideGray, true);
    this.jumpMarker(159.6, gTop);
    this.addCheckpoint('Summit Ledge', new THREE.Vector3(153, gTop + 0.05, 0),
      new THREE.Vector3(151.5, -6, -8), new THREE.Vector3(156, 8, 8));

    // ===== Section 6 — Final sprint ========================================
    const hTop = 5.0;
    this.building(167, 179, -8, 8, hTop);
    this.block(170, hTop, 4.6, 1.6, 0.8, 1.6, this.matRed, true);
    this.jumpMarker(177.6, hTop);

    const iTop = 6.4;
    this.building(183, 203, -9, 9, iTop);
    this.addCheckpoint('Final Stretch', new THREE.Vector3(185, iTop + 0.05, 0),
      new THREE.Vector3(183.4, -6, -9), new THREE.Vector3(187, 8, 9));

    // Finish gate: two red posts and a banner across the roof
    this.finishGate(192, iTop);
    this.finishZone = {
      min: new THREE.Vector3(191.5, iTop - 2, -9),
      max: new THREE.Vector3(192.6, iTop + 6, 9),
    };

    // ===== Side flavor towers (non-collidable) =============================
    this.glassTower(-14, -34, 9, 9, 26);
    this.glassTower(24, -40, 11, 10, 34);
    this.glassTower(58, -44, 9, 12, 40);
    this.glassTower(100, -44, 12, 10, 46);
    this.glassTower(150, -46, 10, 12, 52);
    this.glassTower(190, -44, 12, 10, 44);
    this.glassTower(30, 30, 10, 11, 30);
    this.glassTower(90, 32, 12, 10, 38);
    this.glassTower(170, 30, 11, 12, 42);

    // street-level filler under the route (hidden by buildings above)
    // nothing needed; buildings go 60m deep.

    // Rooftop flag decorations on a couple roofs
    this.flag(35, bTop, -8.4);
    this.flag(84, dTop, -8.4);
    this.flag(158, gTop, -7.4);
    this.flag(200, iTop, -8.4);
  }

  private flag(x: number, baseY: number, z: number): void {
    this.pipe(x, baseY, z, 3.2, 0.06, this.matSideGray);
    const cloth = this.block(x + 0.75, baseY + 2.35, z, 1.5, 0.85, 0.06, this.matRed, false);
    this.anim.push((t) => {
      cloth.rotation.y = Math.sin(t * 2.2 + x * 0.4) * 0.22;
      cloth.position.y = baseY + 2.35 + 0.42 + Math.sin(t * 2.6 + x) * 0.04;
    });
  }

  /** Finish gate: posts + banner + blinking marker. */
  private finishGate(x: number, topY: number): void {
    const zSpan = 6;
    this.block(x, topY, -zSpan, 0.5, 4.2, 0.5, this.matRed, true);
    this.block(x, topY, zSpan, 0.5, 4.2, 0.5, this.matRed, true);
    const banner = this.block(x, topY + 3.1, 0, 0.5, 1.4, zSpan * 2, this.matRedDark, false);
    this.anim.push((t) => {
      const s = 1 + Math.sin(t * 3.4) * 0.06;
      banner.scale.y = 1.4 * s;
    });
    // ground stripe before the gate
    this.block(x - 1.4, topY, 0, 0.22, 0.1, zSpan * 2, this.matRed, false);
  }

  addCheckpoint(label: string, spawn: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): void {
    this.checkpoints.push({
      position: spawn.clone(),
      min: min.clone(),
      max: max.clone(),
      label,
    });
  }

  /** Visual pass for hintDebugging. */
  updateAnimations(t: number): void {
    for (const f of this.anim) f(t);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.group.clear();
  }

  playerStart(): THREE.Vector3 {
    return this.spawn.clone();
  }
}

function levelRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
void levelRng;
