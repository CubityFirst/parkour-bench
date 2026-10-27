import {
  BoxGeometry, CylinderGeometry, Group, Mesh, type Material, type MeshStandardMaterial,
} from 'three';
import type { TriggerBox } from './CollisionWorld';
import { CollisionWorld } from './CollisionWorld';
import { GeometryBatcher } from './GeometryBatcher';
import type { WorldMaterials } from './Materials';
import { Checkpoints, type Checkpoint } from './Checkpoints';

export interface HintZone {
  box: TriggerBox;
  text: string;
}

type Edge = 'xMin' | 'xMax' | 'zMin' | 'zMax';

export interface RoofDef {
  minX: number; maxX: number; minZ: number; maxZ: number; top: number;
  style?: 'facade' | 'glass';
  parapets?: Edge[];
}

/**
 * The playable route. Built from axis-aligned boxes; each box is registered
 * both as render geometry (batched) and as a collider.
 *
 * Route overview (player travels mostly toward -Z):
 *  1. Tutorial rooftop: barrier, slide duct, short gap
 *  2. Rooftop jumps of increasing length
 *  3. Slide challenge under red ventilation ducts
 *  4. Wall run along a red glass facade over a 12 m gap
 *  5. Combination: vault, jump, turn, wall run, slide, ledge climb
 *  6. Final sprint to the finish gate
 */
export class Level {
  readonly group = new Group();
  readonly world = new CollisionWorld();
  readonly hints: HintZone[] = [];
  readonly routeBounds: RoofDef[] = [];
  checkpoints!: Checkpoints;
  finish!: TriggerBox;
  finishMarkers: Mesh[] = [];
  readonly spawn = { x: 0, y: 40, z: 4, yaw: 0 };

  private batch: GeometryBatcher;
  private cylGeo = new CylinderGeometry(1, 1, 1, 16);
  private boxGeo = new BoxGeometry(1, 1, 1);

  constructor(private m: WorldMaterials) {
    this.batch = new GeometryBatcher(m.tiles as Map<Material, [number, number]>);
    this.build();
    this.batch.build(this.group, { castShadow: true, receiveShadow: true });
  }

  // ---------------------------------------------------------------- helpers

  /** Solid box: rendered and collidable. */
  private solid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
    mat: Material | { side: Material; top?: Material }, tag?: string): void {
    this.batch.addBox(minX, minY, minZ, maxX, maxY, maxZ, mat as Material, ['ny']);
    this.world.add(minX, minY, minZ, maxX, maxY, maxZ, tag);
  }

  /** Render-only box (decals, trims). */
  private deco(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mat: Material): void {
    this.batch.addBox(minX, minY, minZ, maxX, maxY, maxZ, mat, ['ny']);
  }

  private roof(r: RoofDef): void {
    const m = this.m;
    const side = r.style === 'glass' ? m.glass : m.facade;
    this.solid(r.minX, 0, r.minZ, r.maxX, r.top, r.maxZ, { side, top: m.roof });
    this.routeBounds.push(r);
    // Cornice band just below the roof edge (visual).
    const t = r.top, o = 0.12;
    this.batch.addBox(r.minX - o, t - 0.55, r.minZ - o, r.maxX + o, t - 0.05, r.maxZ + o, m.trim, ['py', 'ny']);
    this.batch.addBox(r.minX - o, t - 0.05, r.minZ - o, r.maxX + o, t, r.maxZ + o, m.trim, ['ny']);
    const p = 0.3, h = 0.32;
    for (const e of r.parapets ?? []) {
      if (e === 'xMin') this.solid(r.minX, t, r.minZ, r.minX + p, t + h, r.maxZ, m.trim);
      if (e === 'xMax') this.solid(r.maxX - p, t, r.minZ, r.maxX, t + h, r.maxZ, m.trim);
      if (e === 'zMin') this.solid(r.minX, t, r.minZ, r.maxX, t + h, r.minZ + p, m.trim);
      if (e === 'zMax') this.solid(r.minX, t, r.maxZ - p, r.maxX, t + h, r.maxZ, m.trim);
    }
  }

  /** Red floor stripe that marks takeoff points and the route. */
  private stripe(minX: number, minZ: number, maxX: number, maxZ: number, y: number): void {
    this.deco(minX, y, minZ, maxX, y + 0.012, maxZ, this.m.red);
  }

  private hint(minX: number, minZ: number, maxX: number, maxZ: number, text: string): void {
    this.hints.push({ box: { minX, minY: 20, minZ, maxX, maxY: 80, maxZ }, text });
  }

  /** Rooftop air-conditioning unit with a grate top. */
  private acUnit(x: number, z: number, y: number, w = 1.6, d = 1.2, h = 1.1): void {
    this.solid(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, { side: this.m.gray, top: this.m.grate });
    const fan = new Mesh(this.cylGeo, this.m.darkGray);
    fan.scale.set(Math.min(w, d) * 0.32, 0.04, Math.min(w, d) * 0.32);
    fan.position.set(x, y + h + 0.02, z);
    this.group.add(fan);
  }

  /** Small stair/elevator housing with a red door. doorFace: which side gets the door. */
  private housing(minX: number, minZ: number, maxX: number, maxZ: number, y: number, h: number, doorFace: Edge): void {
    this.solid(minX, y, minZ, maxX, y + h, maxZ, { side: this.m.white, top: this.m.roof });
    this.deco(minX - 0.08, y + h - 0.1, minZ - 0.08, maxX + 0.08, y + h + 0.08, maxZ + 0.08, this.m.trim);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, dw = 0.55, dh = 2.1, t = 0.06;
    if (doorFace === 'xMin') this.deco(minX - t, y, cz - dw, minX, y + dh, cz + dw, this.m.red);
    if (doorFace === 'xMax') this.deco(maxX, y, cz - dw, maxX + t, y + dh, cz + dw, this.m.red);
    if (doorFace === 'zMin') this.deco(cx - dw, y, minZ - t, cx + dw, y + dh, minZ, this.m.red);
    if (doorFace === 'zMax') this.deco(cx - dw, y, maxZ, cx + dw, y + dh, maxZ + t, this.m.red);
  }

  private waterTank(x: number, z: number, y: number): void {
    const r = 1.3, h = 2.4, leg = 1.2;
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      this.solid(x + lx - 0.08, y, z + lz - 0.08, x + lx + 0.08, y + leg, z + lz + 0.08, this.m.darkGray);
    }
    const tank = new Mesh(this.cylGeo, this.m.white);
    tank.scale.set(r, h, r);
    tank.position.set(x, y + leg + h / 2, z);
    tank.castShadow = tank.receiveShadow = true;
    this.group.add(tank);
    this.world.add(x - r * 0.9, y + leg, z - r * 0.9, x + r * 0.9, y + leg + h, z + r * 0.9);
  }

  /** Red pipe run (cylinder) along X or Z with box collision. */
  private pipe(axis: 'x' | 'z', a0: number, a1: number, cx: number, cy: number, radius: number, mat: Material, collide = true): void {
    const p = new Mesh(this.cylGeo, mat);
    const len = Math.abs(a1 - a0), mid = (a0 + a1) / 2;
    p.scale.set(radius, len, radius);
    if (axis === 'x') { p.rotation.z = Math.PI / 2; p.position.set(mid, cy, cx); }
    else { p.rotation.x = Math.PI / 2; p.position.set(cx, cy, mid); }
    p.castShadow = true; p.receiveShadow = true;
    this.group.add(p);
    if (!collide) return;
    if (axis === 'x') this.world.add(Math.min(a0, a1), cy - radius, cx - radius, Math.max(a0, a1), cy + radius, cx + radius);
    else this.world.add(cx - radius, cy - radius, Math.min(a0, a1), cx + radius, cy + radius, Math.max(a0, a1));
  }

  /** Big red ventilation duct you must slide under (spans X between x0..x1). */
  private slideDuct(x0: number, x1: number, z: number, floor: number, depth = 1.6): void {
    const bottom = floor + 1.05, top = floor + 4.0;
    this.solid(x0, bottom, z - depth / 2, x1, top, z + depth / 2, this.m.red, 'duct');
    // Seams
    for (let x = x0 + 2; x < x1 - 0.5; x += 2.5) {
      this.deco(x, bottom - 0.04, z - depth / 2 - 0.04, x + 0.12, top + 0.04, z + depth / 2 + 0.04, this.m.redDark);
    }
    // Hazard-ish underside lip to read the clearance
    this.deco(x0, bottom - 0.06, z - depth / 2 - 0.02, x1, bottom, z + depth / 2 + 0.02, this.m.darkGray);
  }

  private checkpointMarker(x: number, y: number, z: number): Mesh[] {
    const pole = new Mesh(this.boxGeo, this.m.checkpointOff);
    pole.scale.set(0.12, 2.6, 0.12);
    pole.position.set(x, y + 1.3, z);
    const flag = new Mesh(this.boxGeo, this.m.checkpointOff);
    flag.scale.set(0.9, 0.5, 0.05);
    flag.position.set(x + 0.5, y + 2.3, z);
    const pad = new Mesh(this.cylGeo, this.m.checkpointOff);
    pad.scale.set(0.9, 0.03, 0.9);
    pad.position.set(x, y + 0.015, z);
    for (const o of [pole, flag, pad]) { o.castShadow = true; this.group.add(o); }
    this.world.add(x - 0.06, y, z - 0.06, x + 0.06, y + 2.6, z + 0.06);
    return [pole, flag, pad];
  }

  private makeCheckpoint(name: string, trig: [number, number, number, number], y: number,
    spawn: { x: number; z: number; yaw: number }, marker: [number, number]): Checkpoint {
    return {
      name,
      trigger: { minX: trig[0], minY: y - 1, minZ: trig[1], maxX: trig[2], maxY: y + 6, maxZ: trig[3] },
      spawn: { x: spawn.x, y, z: spawn.z, yaw: spawn.yaw },
      markers: this.checkpointMarker(marker[0], y, marker[1]),
      activated: false,
    };
  }

  // ---------------------------------------------------------------- level

  private build(): void {
    const m = this.m;
    const cps: Checkpoint[] = [];

    // ===== Section 1: Movement tutorial =========================================
    const y1 = 40;
    this.roof({ minX: -12, maxX: 12, minZ: -40, maxZ: 10, top: y1, parapets: ['xMin', 'xMax', 'zMax'] });
    // Low red barrier: jump it or vault it (E)
    this.solid(-4, y1, -9, 4, y1 + 0.75, -8.3, m.red, 'vault');
    // Slide duct with side blocks so the slide is the natural line
    this.slideDuct(-6, 6, -24, y1, 1.5);
    this.solid(-11.7, y1, -25, -6, y1 + 2.4, -23, { side: m.gray, top: m.grate });
    this.solid(6, y1, -25, 11.7, y1 + 2.4, -23, { side: m.gray, top: m.grate });
    this.stripe(-3, -39.7, 3, -39.1, y1);
    this.stripe(-0.25, -36, 0.25, -30, y1);
    // Props
    this.housing(6.5, 1, 11.4, 7, y1, 3, 'xMin');
    this.acUnit(-9, 6, y1); this.acUnit(-9, 3.4, y1); this.acUnit(-9, -16, y1, 2, 1.4, 1.2);
    this.waterTank(9, -14, y1);
    this.pipe('z', 8, -2, -11.4, y1 + 0.6, 0.18, m.redDark);
    this.hint(-12, -5, 12, 10, 'WASD move  ·  SHIFT sprint  ·  SPACE jump (hold for height)');
    this.hint(-12, -14, 12, -5, 'Jump the red barrier, or press E to VAULT it');
    this.hint(-12, -30, 12, -14, 'Sprint, then press CTRL / C to SLIDE under the duct');
    this.hint(-12, -40, 12, -30, 'Sprint and JUMP the gap at the red line');

    // ===== Section 2: Rooftop jumps ============================================
    this.roof({ minX: -8, maxX: 8, minZ: -58, maxZ: -43, top: 40, parapets: ['xMin', 'xMax'] });
    cps.push(this.makeCheckpoint('ROOFTOPS', [-8, -50, 8, -43], 40, { x: 0, z: -47, yaw: 0 }, [-6.5, -46]));
    this.stripe(-3, -57.7, 3, -57.1, 40);
    this.acUnit(5.5, -52, 40); this.acUnit(-5.5, -54, 40);

    this.roof({ minX: -7, maxX: 7, minZ: -75, maxZ: -62.5, top: 39, parapets: ['xMin', 'xMax'] });
    this.stripe(-3, -74.7, 3, -74.1, 39);
    this.housing(3.5, -71, 6.6, -66, 39, 2.8, 'xMin');

    this.roof({ minX: -6, maxX: 6, minZ: -92, maxZ: -80, top: 38.5, style: 'glass', parapets: ['xMin', 'xMax'] });
    this.stripe(-3, -91.7, 3, -91.1, 38.5);
    this.acUnit(-4, -86, 38.5, 1.4, 1.4, 1);

    this.roof({ minX: -7, maxX: 7, minZ: -110, maxZ: -96, top: 39.5, parapets: ['xMin', 'xMax', 'zMax'] });
    // Red ledge cap: this roof is higher, grab it if you come up short
    this.deco(-7, 39.3, -96.05, 7, 39.52, -95.9, m.red);
    this.acUnit(-4.5, -101, 39.5); this.acUnit(4.5, -104, 39.5);
    this.hint(-8, -58, 8, -43, 'Hold SHIFT for long jumps - take off from the red lines');
    this.hint(-8, -110, 8, -58, 'Come up short? Keep holding W to grab and climb the ledge');

    // Narrow bridge
    this.solid(-0.8, 38.9, -125.2, 0.8, 39.5, -109.8, { side: m.darkGray, top: m.roof });
    this.solid(-0.92, 39.5, -125, -0.8, 40.5, -110, m.white);
    this.solid(0.8, 39.5, -125, 0.92, 40.5, -110, m.white);
    this.stripe(-0.12, -124, 0.12, -111, 39.5);

    // ===== Section 3: Slide challenge ==========================================
    const y3 = 39.5;
    this.roof({ minX: -8, maxX: 3, minZ: -162, maxZ: -125, top: y3, parapets: ['xMin'] });
    cps.push(this.makeCheckpoint('SLIDE ALLEY', [-8, -133, 3, -125], y3, { x: -2.5, z: -129, yaw: 0 }, [-6.8, -128]));
    this.slideDuct(-7.7, 3, -137, y3);
    this.slideDuct(-7.7, 3, -145, y3);
    this.slideDuct(-7.7, 3, -153, y3);
    this.pipe('z', -127, -160, -7.5, y3 + 4.3, 0.25, m.redDark, false);
    this.hint(-8, -155, 3, -125, 'Slide under the ducts (CTRL / C) - jump out of a slide to keep speed');

    // ===== Section 4: Wall run =================================================
    // Tall glass tower whose west face is the wall-run surface.
    this.solid(3, 0, -192, 13, 64, -145, { side: m.glass, top: m.roof }, 'wallrun');
    this.batch.addBox(2.97, 39.9, -184, 3.0, 43.8, -156, m.red, ['ny', 'px']);
    for (let z = -183; z < -156; z += 4) this.batch.addBox(2.95, 41.6, z, 2.97, 41.75, z + 2.4, m.white, ['ny', 'px']);
    this.stripe(1.7, -162, 2.4, -155, y3);
    this.stripe(1.2, -162.2, 2.7, -161.7, y3);
    this.hint(-8, -163, 3, -155, 'Sprint along the red wall, JUMP toward it and hold W to WALL RUN');

    this.roof({ minX: -8, maxX: 3, minZ: -200, maxZ: -174, top: 38, parapets: ['xMin'] });
    cps.push(this.makeCheckpoint('WALL RUN', [-8, -187, 3, -174], 38, { x: -2, z: -181, yaw: 0 }, [-6.8, -178]));

    // ===== Section 5: Combination ==============================================
    // Vault barrier on the landing roof
    this.solid(-7.7, 38, -192.6, 3, 39, -192, m.red, 'vault');
    this.stripe(-3, -199.7, 3, -199.1, 38);
    this.hint(-8, -200, 3, -187, 'Vault the barrier (E) and jump to the next roof');

    // Turn roof
    this.roof({ minX: -20, maxX: 3, minZ: -219, maxZ: -204, top: 38, parapets: ['xMax'] });
    this.solid(-14, 38, -219, 3, 38.32, -218.7, m.trim); // parapet only where no wall
    this.stripe(-19.7, -218.6, -4, -218.1, 38); // guide line along the wall
    this.deco(-4.6, 38, -218.6, -4, 38.012, -210, m.red);
    this.acUnit(0, -208, 38); this.acUnit(-6, -207, 38, 2, 1.2, 1.2);
    this.hint(-20, -219, 3, -204, 'Turn LEFT - wall run along the red wall');

    // Second wall-run tower (its north face at z = -219)
    this.solid(-42, 0, -232, -14, 60, -219, { side: m.facade, top: m.roof }, 'wallrun');
    this.batch.addBox(-38, 38.4, -219, -16.5, 42.2, -218.97, m.red, ['ny', 'nz']);

    // Landing roof with a slide duct, then a ledge climb
    const y9 = 37.5;
    this.roof({ minX: -58, maxX: -32, minZ: -219, maxZ: -200, top: y9, parapets: ['zMax'] });
    this.solid(-47, y9 + 1.05, -219, -45.4, y9 + 4, -200.3, m.red, 'duct');
    this.deco(-47, y9 + 0.99, -219, -45.4, y9 + 1.05, -200.3, m.darkGray);
    this.stripe(-57.7, -212, -57.1, -206, y9);
    this.hint(-58, -219, -32, -200, 'Slide under the duct, then jump and hold W to CLIMB the ledge');

    // Higher roof: climb its ledge
    const y10 = 40;
    this.roof({ minX: -76, maxX: -61, minZ: -222, maxZ: -196, top: y10, parapets: ['zMax', 'xMin'] });
    this.deco(-61.05, y10 - 0.25, -216, -60.9, y10 + 0.01, -202, m.red);
    cps.push(this.makeCheckpoint('FINAL SPRINT', [-76, -222, -61, -196], y10, { x: -68, z: -206, yaw: 0 }, [-62.5, -199]));
    this.housing(-75.5, -204, -71, -198, y10, 3, 'xMax');
    this.stripe(-68.3, -221.7, -67.7, -212, y10);
    this.hint(-76, -222, -61, -196, 'Final sprint - head for the red finish gate');

    // ===== Section 6: Final sprint ============================================
    this.roof({ minX: -74, maxX: -63, minZ: -240, maxZ: -226, top: 39.5, parapets: ['xMin', 'xMax'] });
    this.solid(-73.7, 39.5, -233.6, -63.3, 40.6, -233, m.red, 'vault');
    this.stripe(-71, -239.7, -65, -239.1, 39.5);

    this.roof({ minX: -73, maxX: -64, minZ: -262, maxZ: -244.5, top: 39, style: 'glass', parapets: ['xMin', 'xMax'] });
    this.solid(-72.7, 40.05, -253.8, -64.3, 43, -252.4, m.red, 'duct');
    this.stripe(-71, -261.7, -65, -261.1, 39);

    const yF = 38.5;
    this.roof({ minX: -76, maxX: -61, minZ: -300, maxZ: -267, top: yF, parapets: ['xMin', 'xMax', 'zMin'] });
    // Finish gate
    this.solid(-73, yF, -285.4, -72, yF + 5, -284.6, m.red);
    this.solid(-65, yF, -285.4, -64, yF + 5, -284.6, m.red);
    this.solid(-73, yF + 5, -285.4, -64, yF + 5.8, -284.6, m.red);
    const banner = new Mesh(this.boxGeo, m.checkpointOn);
    banner.scale.set(7.6, 0.25, 0.1);
    banner.position.set(-68.5, yF + 4.6, -285);
    this.group.add(banner);
    this.finishMarkers.push(banner);
    for (let i = 0; i < 8; i++) this.stripe(-72 + i, -285.3, -71.5 + i, -284.7, yF);
    for (let i = 0; i < 8; i++) this.deco(-71.5 + i, yF, -285.3, -71 + i, yF + 0.012, -284.7, m.white);
    this.finish = { minX: -76, minY: yF - 1, minZ: -286, maxX: -61, maxY: yF + 8, maxZ: -284 };
    this.acUnit(-74, -294, yF); this.acUnit(-63, -292, yF); this.housing(-72, -299.5, -65, -296, yF, 3, 'zMax');
    this.hint(-76, -300, -61, -267, 'Cross the finish line!');

    this.checkpoints = new Checkpoints(cps, this.spawn, m.checkpointOff as MeshStandardMaterial, m.checkpointOn as MeshStandardMaterial);
  }

  hintAt(x: number, y: number, z: number): string | null {
    for (const h of this.hints) {
      const b = h.box;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y >= b.minY && y <= b.maxY) return h.text;
    }
    return null;
  }
}
