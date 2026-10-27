import * as THREE from 'three';
import type { CollisionWorld } from './CollisionWorld';
import { LevelBuilder, makeFrame, type Rect, type RouteFootprint } from './LevelBuilder';
import { billboardTexture } from './Materials';
import type { MeshBatcher } from './MeshBatcher';

export interface TriggerBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface CheckpointDef extends TriggerBox {
  name: string;
  spawn: THREE.Vector3;
  yaw: number;
}

export interface HintDef extends TriggerBox {
  id: string;
  text: string;
}

export interface LevelData {
  checkpoints: CheckpointDef[];
  hints: HintDef[];
  finish: TriggerBox & { beacon: THREE.Vector3 };
  killY: number;
  footprints: RouteFootprint[];
  /** Positions where landmark towers stand (for the city generator to avoid). */
  meshes: THREE.Object3D[];
}

/**
 * The hand-designed route. Three frames carry the route across the city:
 *
 *   Frame A  (heading -Z)  §1 tutorial roof, §2 rooftop jumps, §3 slide roof
 *   Frame B  (heading -X)  §4 wall-run gap, §5 combination run
 *   Frame C  (heading -Z)  §6 final sprint to the finish gate
 *
 * Coordinates below are (side, fwd): metres right of / along the route.
 * Gap sizes are chosen from the movement numbers in MovementConfig:
 * run-jump ≈ 4 m, sprint-jump ≈ 6.5 m, wall run ≈ 14 m.
 */
export function buildLevel(world: CollisionWorld, batch: MeshBatcher): LevelData {
  const b = new LevelBuilder(world, batch);
  const checkpoints: CheckpointDef[] = [];
  const hints: HintDef[] = [];

  const trigger = (r: Rect, y0: number, y1: number): TriggerBox => ({
    min: new THREE.Vector3(r.minX, y0, r.minZ),
    max: new THREE.Vector3(r.maxX, y1, r.maxZ),
  });
  const checkpoint = (name: string, s0: number, s1: number, f0: number, f1: number, top: number, spawnSide: number, spawnFwd: number, yaw = b.forwardYaw) => {
    checkpoints.push({ name, ...trigger(b.rect(s0, s1, f0, f1), top - 2, top + 6), spawn: b.vec3(spawnSide, spawnFwd, top + 0.01), yaw });
  };
  const hint = (id: string, text: string, s0: number, s1: number, f0: number, f1: number, top: number) => {
    hints.push({ id, text, ...trigger(b.rect(s0, s1, f0, f1), top - 3, top + 6) });
  };

  const FA = makeFrame(0, 0, 0);
  const FB = makeFrame(8, -226.5, 1);
  const FC = makeFrame(-156.5, -236.5, 0);

  // ===========================================================================
  // §1 — Movement tutorial: big start roof with a barrier, a slide duct and a short gap.
  // ===========================================================================
  b.useFrame(FA);
  b.building(-9, 9, -8, 62, 0, { facade: 'officeWhite', parapets: ['left', 'right', 'back'], jumpEdges: ['front'] });
  b.stairHouse(-3.5, 3.5, -7.7, -4.6, 0, 'front');
  b.acUnit(-7, 3, 0);
  b.acUnit(-7, 6, 0);
  b.acUnit(7, 9, 0, 1.2, 1.2, 0.9);
  b.ventStack(6.6, -3, 0);
  b.ventStack(-6.8, 48, 0);
  b.acUnit(7.2, 30, 0);
  b.railing(-8.6, -8.6, 10, 20, 0.55, 0.5);
  // Tutorial obstacle: jump or vault.
  b.vaultBarrier(-8.7, 8.7, 22, 22.6, 0, 0.95);
  // Tutorial slide: a vent bank you can only pass by sliding.
  b.slideGate(-8.7, 8.7, 38, 40.5, 0, 1.0, 4.3, 'duct');
  checkpoint('Start', -9, 9, -8, 6, 0, 0, 0);
  hint('move', '[W][A][S][D] Move · [MOUSE] Look', -9, 9, -8, 5, 0);
  hint('sprint', 'Hold [SHIFT] to sprint', -9, 9, 5, 13, 0);
  hint('jump', '[SPACE] Jump (hold for height) · [E] Vault low obstacles', -9, 9, 13, 22, 0);
  hint('slide', 'Running? Press [C] or [CTRL] to slide under', -9, 9, 26, 38, 0);
  hint('gap', 'Sprint and [SPACE] to jump the gap', -9, 9, 44, 62, 0);

  // ===========================================================================
  // §2 — Rooftop jumps: widening gaps, a drop, a climb and a long jump.
  // ===========================================================================
  b.building(-7, 7, 65, 84, -0.5, { facade: 'officeGrid', parapets: ['left', 'right'], jumpEdges: ['front'] });
  b.acUnit(-5, 75, -0.5);
  b.acUnit(5, 79, -0.5, 1.2, 1.2, 0.9);
  checkpoint('Rooftop Jumps', -7, 7, 65, 72, -0.5, 0, 67.5);

  b.building(-5, 9, 88, 100, -1.0, { facade: 'glassBlue', roof: 'roofGray', parapets: ['left', 'right'], jumpEdges: ['front'] });
  b.acUnit(7, 93, -1.0);
  b.ventStack(-3.6, 96, -1.0);

  b.building(-6, 8, 104.5, 122, -2.5, { facade: 'officeWarm', parapets: ['left', 'right'] });
  b.acUnit(-4.5, 110, -2.5);
  hint('climb', 'Higher roof ahead: jump and hold [W] to grab the ledge', -6, 8, 105, 118, -2.5);

  b.building(-6, 8, 125.5, 142, -1.0, { facade: 'officeWhite', parapets: ['left', 'right'], ledgeEdges: ['back'], jumpEdges: ['front'] });
  b.waterTank(5.6, 136, -1.0, 1.3, 2.6);
  b.acUnit(-4.5, 131, -1.0);

  b.building(-8, 10, 147, 170, -3.0, { facade: 'officeGrid', parapets: ['left', 'right'], jumpEdges: ['front'] });
  b.acUnit(-6, 152, -3.0);
  b.acUnit(-6, 155, -3.0);
  b.acUnit(8, 160, -3.0);
  b.stairHouse(4.5, 9, 163, 167, -3.0, 'back');

  // ===========================================================================
  // §3 — Sliding challenge: a channel of low vent banks.
  // ===========================================================================
  b.building(-8, 8, 174, 216, -3.0, { facade: 'officeWhite', parapets: ['left', 'right'], jumpEdges: ['front'] });
  checkpoint('Vent Run', -8, 8, 174, 181, -3.0, 0, 177);
  hint('slide2', 'Slide under the vents — keep [C] held to keep sliding', -8, 8, 176, 185, -3.0);
  const machine = { side: 'white' as const, top: 'roofGray' as const, shadeBottom: 0.7, bottom: null };
  b.solid(-8, -5.5, 183, 210, -3.0, 1.6, machine);
  b.solid(5.5, 8, 183, 210, -3.0, 1.6, machine);
  b.acUnit(-6.75, 189, 1.6, 1.4, 1.2, 1.0);
  b.acUnit(-6.75, 201, 1.6, 1.4, 1.2, 1.0);
  b.acUnit(6.75, 194, 1.6, 1.4, 1.2, 1.0);
  b.pipe(-5.45, 183, -1.6, -5.45, 210, -1.6, 0.12, 'red');
  b.pipe(5.45, 183, -1.2, 5.45, 210, -1.2, 0.12, 'red');
  b.slideGate(-5.5, 5.5, 186, 188.5, -3.0, 1.0, 4.4, 'duct');
  b.slideGate(-5.5, 5.5, 195, 197.5, -3.0, 1.0, 4.4, 'duct');
  b.slideGate(-5.5, 5.5, 204, 206, -3.0, 1.0, 4.4, 'pipes');
  b.ventStack(-4, 213, -3.0);

  // ===========================================================================
  // §4 — Wall run: a 13 m gap beside a tall wall with red panels.
  // ===========================================================================
  b.useFrame(FB);
  b.building(-7.5, 7.9, 0, 38, -5.0, { facade: 'officeGrid', parapets: ['back'], jumpEdges: ['front'] });
  b.parapet(7.6, 7.9, 0, 24, -5.0);
  b.parapet(-7.5, -7.2, 17, 38, -5.0);
  b.acUnit(-5, 24, -5.0);
  b.acUnit(-5, 28, -5.0);
  b.ventStack(-5.5, 33, -5.0);
  checkpoint('Wall Run', -7.5, 7.9, 0, 17, -5.0, 3, 8);
  hint('wallrun', 'Sprint along the red wall, jump and hold [W] to wall-run · [SPACE] jumps off', -7.5, 7.9, 17, 36, -5.0);

  // The wall: a tall building whose face lines up with the runway.
  b.building(7.9, 24, 24, 60, 12, { facade: 'officeWhite', roof: 'roofGray' });
  for (let f = 27; f < 58; f += 5) b.deco(7.86, 7.9, f, f + 4.4, -4.7, -1.5, 'red');
  b.deco(7.84, 7.9, 26.5, 58.5, -1.5, -1.38, 'white');

  // Landing roof.
  b.building(-4, 7.9, 51, 76, -5.5, { facade: 'glassTeal', roof: 'roofGray', parapets: ['left'], ledgeEdges: ['back'], jumpEdges: ['front'] });
  b.parapet(7.6, 7.9, 60, 76, -5.5);

  // ===========================================================================
  // §5 — Combination: vault, jump, wall run (left), slide, climb, long jump.
  // ===========================================================================
  checkpoint('Combination', -4, 7.9, 51, 61, -5.5, 2, 56);
  hint('vault', '[E] (or [SPACE] while running) vaults the red barrier', -4, 7.9, 57, 64, -5.5);
  b.vaultBarrier(-3.7, 7.6, 64, 64.6, -5.5, 1.0);
  b.acUnit(-2.5, 70, -5.5, 1.2, 1.0, 0.9);

  b.building(-8.4, 4, 80.5, 98, -5.5, { facade: 'officeWhite', parapets: ['right'], jumpEdges: ['front'] });
  b.parapet(-8.4, -8.1, 80.5, 84, -5.5);
  hint('wallrun2', 'Wall-run on the left wall', -8.4, 4, 80.5, 92, -5.5);
  b.building(-24, -8.4, 84, 116, 8, { facade: 'glassBlue' });
  for (let f = 87; f < 114; f += 5) b.deco(-8.4, -8.36, f, f + 4.4, -5.2, -2.0, 'red');

  b.building(-8.4, 3, 108, 130, -6.0, { facade: 'officeGrid', parapets: ['right'] });
  b.parapet(-8.4, -8.1, 116, 130, -6.0);
  b.slideGate(-8.1, 2.7, 119, 121, -6.0, 1.0, 3.9, 'pipes');
  hint('combo', 'Slide the pipes, then jump + hold [W] to climb the wall', -8.4, 3, 108, 118, -6.0);

  b.building(-8.4, 6, 130, 150, -3.6, { facade: 'officeWarm', parapets: ['left', 'right'], ledgeEdges: ['back'], jumpEdges: ['front'] });
  b.acUnit(-6, 140, -3.6);
  b.acUnit(4.5, 136, -3.6);
  b.ventStack(4, 146, -3.6);

  b.building(-6, 10, 155, 174, -5.1, { facade: 'officeWhite', parapets: ['left', 'front'] });
  b.parapet(9.7, 10, 155, 162.5, -5.1);
  b.parapet(9.7, 10, 166.5, 173.7, -5.1);
  b.deco(9.55, 10, 162.5, 166.5, -5.1, -5.075, 'red');
  b.acUnit(-3.5, 170, -5.1);
  b.stairHouse(-5.7, -1.5, 157, 161, -5.1, 'front');
  checkpoint('Final Sprint', -6, 10, 155, 174, -5.1, 3, 164.5, 0);
  hint('final', 'Final sprint — turn right, cross the bridge, reach the red gate', -6, 10, 155, 174, -5.1);

  // ===========================================================================
  // §6 — Final sprint: narrow bridge, descending jumps, finish gate.
  // ===========================================================================
  b.useFrame(FC);
  b.solid(-0.8, 0.8, 0, 14, -5.45, -5.1, { side: 'metal', top: 'concrete', bottom: 'darkMetal' });
  b.deco(-0.45, 0.45, 0.4, 13.6, -6.3, -5.45, { side: 'darkMetal', bottom: 'darkMetal' });
  b.deco(-0.8, 0.8, 0, 0.35, -5.1, -5.08, 'red');

  b.building(-7, 7, 14, 28, -5.1, { facade: 'glassBlue', roof: 'roofGray', parapets: ['left', 'right'], jumpEdges: ['front'] });
  b.acUnit(-5, 20, -5.1);
  b.acUnit(5, 23, -5.1);

  b.building(-6, 8, 32.5, 46, -7.1, { facade: 'officeGrid', parapets: ['left', 'right'], jumpEdges: ['front'] });
  b.vaultBarrier(-5.7, 7.7, 39, 39.5, -7.1, 0.9);

  b.building(-7, 7, 51, 64, -8.1, { facade: 'officeWhite', parapets: ['left', 'right'], jumpEdges: ['front'] });
  b.ventStack(-5, 56, -8.1);
  b.acUnit(5.2, 59, -8.1);

  b.building(-10, 10, 68, 104, -10.1, { facade: 'glassTeal', roof: 'roofGray', parapets: ['left', 'right', 'front'] });
  // Finish gate.
  const qTop = -10.1;
  b.solid(-6.6, -5.6, 79.5, 80.5, qTop, qTop + 5.2, { side: 'red', shadeBottom: 0.8, bottom: null });
  b.solid(5.6, 6.6, 79.5, 80.5, qTop, qTop + 5.2, { side: 'red', shadeBottom: 0.8, bottom: null });
  b.solid(-6.6, 6.6, 79.5, 80.5, qTop + 5.2, qTop + 6.0, { side: 'red', bottom: 'red' });
  for (let i = 0; i < 11; i++) {
    const s = -5.5 + i;
    b.deco(s, s + 1, 79.6, 80.4, qTop, qTop + 0.025, i % 2 === 0 ? 'red' : 'white');
  }
  // Helipad marking past the gate.
  const pad = b.vec3(0, 93, qTop + 0.02);
  const ring = new THREE.RingGeometry(4.2, 4.8, 48).rotateX(-Math.PI / 2);
  batch.geometry(ring, new THREE.Matrix4().makeTranslation(pad.x, pad.y, pad.z), 'red');
  b.deco(-1.6, -1.0, 91, 95, qTop, qTop + 0.022, 'white');
  b.deco(1.0, 1.6, 91, 95, qTop, qTop + 0.022, 'white');
  b.deco(-1.0, 1.0, 92.7, 93.3, qTop, qTop + 0.022, 'white');
  const finishRect = b.rect(-10, 10, 80, 104);
  const finish = {
    min: new THREE.Vector3(finishRect.minX, qTop - 2, finishRect.minZ),
    max: new THREE.Vector3(finishRect.maxX, qTop + 8, finishRect.maxZ),
    beacon: b.vec3(0, 80, qTop),
  };

  // ===========================================================================
  // Route-side billboards with made-up brands.
  // ===========================================================================
  b.useFrame(FB);
  b.billboard(9.5, 22.5, 26, 12.3, 18.5, billboardTexture('KITE AIR', 'fly light · city to coast', '#f28a1f', '#ffffff'), 'back');
  b.billboard(-22.5, -10, 86, 8.3, 14, billboardTexture('NOVA', 'glass that thinks for you', '#1f6fd1', '#ffffff'), 'back');
  b.useFrame(FA);
  b.building(-26, -12, 150, 168, 26, { facade: 'glassTeal', roof: 'roofGray' });
  b.billboard(-25, -13, 150, 26.3, 32, billboardTexture('ORBIT', 'run the city · 104.6 FM', '#ffffff', '#e0211b'), 'back');

  return {
    checkpoints,
    hints,
    finish,
    killY: -24,
    footprints: b.footprints,
    meshes: b.extraMeshes,
  };
}
