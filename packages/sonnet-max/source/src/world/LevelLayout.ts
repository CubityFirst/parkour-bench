import { Frame, LevelBuilder } from './LevelBuilder.ts';
import type { Aabb, Heading, LevelLayout, RouteAct, V3 } from './LevelBuilder.ts';

export type { LevelLayout } from './LevelBuilder.ts';

/*
 * ROOFTOP FLOW - the course.
 *
 * Top view (north is up, the run goes N, then E, then S):
 *
 *      S3 alley ----- S4 wall run ----- S5 combination --+
 *          ^                                               |
 *          | (turn E on the big roof)                      v
 *      S2 rooftop jumps                                  S6 final sprint -> FINISH
 *          ^
 *      S1 movement  (start)
 *
 * Gaps are sized from the measured jump table (node tools/jump-table.mjs): at base sprint speed (9 m/s)
 * the player covers 5.25 m of centre travel on the flat, 6.45 m when landing 1.5 m lower, 7.35 m for 3 m.
 * Every gap on the intended route is <= ~6.1 m except the two wall-run gaps (12 m and 10 m), which can
 * not be jumped (max flat jump with full momentum is ~6.2 m).
 *
 * All heights are metres above street level. Roof tops sit around 49-62 m.
 */

const RED_GATE_WIDTH = 14;

function across(fr: Frame): Frame {
  // Frame whose forward is `fr`'s right: lets us author features that run across the route.
  return new Frame(fr.ox, fr.oz, ((fr.heading + 1) & 3) as Heading);
}

export function createLevelLayout(): LevelLayout {
  const L = new LevelBuilder(0x5eed1a);
  const F1 = new Frame(0, 0, 0); // heading north: x = r, z = -f
  const F2 = new Frame(14, -193, 1); // heading east: x = 14 + f, z = -193 + r
  const F3 = new Frame(258, -169, 2); // heading south: x = 258 - r, z = -169 + f

  const route = (fr: Frame, f: number, r: number, y: number, act: RouteAct, extra: { steer?: number; label?: string } = {}) => {
    L.route.push({ x: fr.x(f, r), y, z: fr.z(f, r), act, ...extra });
  };
  const zone = (fr: Frame, f0: number, f1: number, r0: number, r1: number, y0: number, y1: number): Aabb =>
    fr.aabb(f0, f1, r0, r1, y0, y1);

  const WHITE_TINT: V3 = [1, 1, 1];
  const WARM: V3 = [1, 0.985, 0.96];
  const COOL: V3 = [0.93, 0.97, 1];
  const GLASS: V3 = [0.6, 0.8, 1];
  const STEEL: V3 = [0.78, 0.84, 0.9];

  // ============================================================================================
  // SECTION 1 - MOVEMENT (F1, north)
  // ============================================================================================
  L.chunk = 0;
  const R1_TOP = 62;
  const r1 = L.roof(F1, {
    name: 'R1 start roof',
    f0: -8,
    f1: 28,
    r0: -14,
    r1: 14,
    top: R1_TOP,
    style: 2,
    tint: WARM,
    open: { f1: true },
    lane: [-4, 4],
  });
  // Start-roof dressing: penthouse with a red door (behind the spawn, out of the opening view), railings,
  // pipes, crates. The area around the spawn is kept clear of random clutter.
  L.penthouse(-10.5, 5.4, R1_TOP, 4.2, 3.2, 3, 1, true);
  L.reserve({ x0: -13, x1: -8, z0: 3.6, z1: 7.2 });
  L.avoid.push({ x0: -14, x1: 14, z0: -3, z1: 8 });
  L.railing(across(F1), -14, 14, 7.55, R1_TOP); // back edge (f = -7.55)
  L.railing(F1, -6.5, 16, -13.55, R1_TOP);
  L.railing(F1, -6.5, 16, 13.55, R1_TOP);
  L.pipeRun(F1, 1, 24.5, -11.8, R1_TOP, 0.13);
  L.pipeRun(F1, 1, 24.5, 11.8, R1_TOP, 0.13);
  // Red scaffold tower + cabinet and a dark vent grate off to the left of the opening view.
  L.scaffoldTower(-9.4, -9, R1_TOP, 2.6, 9);
  L.reserve({ x0: -11.4, x1: -5.4, z0: -11.2, z1: -6.6 });
  L.grate(-6.4, -2.6, R1_TOP, 3.2, 2.8);
  L.reserve({ x0: -8.2, x1: -4.6, z0: -4.2, z1: -1.0 });
  L.crate(F1, 10.5, 11.4, -2.4, 2.4, R1_TOP, 0.7);
  L.crate(F1, 18, 19.2, -3, 3, R1_TOP, 1.1);
  L.edgeMarker(F1, 28, -4, 4, R1_TOP);
  L.scatter(r1, 9, ['ac', 'ac', 'vent', 'skylight', 'acBig', 'antenna']);
  L.flagPole(F1.x(2, 13), F1.z(2, 13), R1_TOP, 4.4, 'orange', 0.5);
  L.flagPole(F1.x(23, -13), F1.z(23, -13), R1_TOP, 4.4, 'red', -0.4);

  // Short gap, then the slide-gate roof between two taller buildings.
  const R1B_TOP = 62;
  L.roof(F1, {
    name: 'R1b service roof',
    f0: 31.2,
    f1: 70,
    r0: -8,
    r1: 8,
    top: R1B_TOP,
    style: 0,
    tint: COOL,
    open: { f0: true, f1: true, r0: true, r1: true },
    lane: [-5, 5],
  });
  L.tower(F1, 'S1 tower W', 31.2, 70, -42, -8, 71, 1, GLASS);
  L.tower(F1, 'S1 tower E', 31.2, 70, 8, 42, 71, 0, WHITE_TINT, 2);
  // Billboard on the east tower roof, facing the start roof so it is the first thing in view.
  L.sign(F1.x(33.5, 22), F1.z(33.5, 22), 71, 10, 4.6, F1.facing(2), 0);
  L.bulkhead(F1, 'S1 slide gate', 44, 46, -8.2, 8.2, R1B_TOP, 1.0, 4.4);
  L.pipeRun(F1, 33, 42.5, 7.1, R1B_TOP, 0.13);
  L.pipeRun(F1, 33, 42.5, -7.1, R1B_TOP, 0.13, 'redDark');
  L.edgeMarker(F1, 70, -4, 4, R1B_TOP);

  route(F1, -3, 0, R1_TOP, 'run', { label: 'start' });
  route(F1, 8.8, 0, R1_TOP, 'jump', { label: 'jump crate A' });
  route(F1, 16.4, 0, R1_TOP, 'vault', { label: 'vault crate B' });
  route(F1, 27.7, 0, R1_TOP, 'jump', { label: 'gap 1' });
  route(F1, 41, 0, R1B_TOP, 'slide', { label: 'slide gate' });
  route(F1, 47.6, 0, R1B_TOP, 'slideEnd');
  route(F1, 57.5, 0, R1B_TOP, 'run', { label: 'cp1' });
  route(F1, 69.7, 0, R1B_TOP, 'jump', { label: 'gap 2' });

  // Checkpoint 1 (after the tutorial).
  L.checkpoints.push({
    id: 1,
    name: 'CHECKPOINT 1',
    x: F1.x(57.5, 0),
    y: R1B_TOP,
    z: F1.z(57.5, 0),
    yaw: F1.yaw,
    gate: { x: F1.x(56, 0), y: R1B_TOP, z: F1.z(56, 0), width: 16, facing: F1.facing(0) },
    trigger: zone(F1, 55, 59, -8, 8, R1B_TOP - 1, R1B_TOP + 6),
    killY: 41,
  });

  L.sections.push({ index: 1, name: 'MOVEMENT', trigger: zone(F1, -8, 72, -14, 14, R1_TOP - 2, R1_TOP + 12) });
  L.hints.push(
    { id: 'move', text: 'MOVE', keys: ['W', 'A', 'S', 'D'], trigger: zone(F1, -8, 5, -14, 14, R1_TOP - 1, R1_TOP + 6), duration: 7 },
    { id: 'sprint', text: 'HOLD SHIFT TO SPRINT', keys: ['SHIFT'], trigger: zone(F1, 4.5, 9, -14, 14, R1_TOP - 1, R1_TOP + 6), duration: 5 },
    { id: 'jump', text: 'SPACE TO JUMP  /  HOLD FOR HEIGHT', keys: ['SPACE'], trigger: zone(F1, 9, 14.5, -14, 14, R1_TOP - 1, R1_TOP + 6), duration: 4 },
    { id: 'vault', text: 'E TO VAULT', keys: ['E'], trigger: zone(F1, 14.5, 18.5, -14, 14, R1_TOP - 1, R1_TOP + 6), duration: 4 },
    { id: 'edge', text: 'SPRINT + SPACE AT THE RED EDGE', keys: ['SHIFT', 'SPACE'], trigger: zone(F1, 21, 28, -14, 14, R1_TOP - 1, R1_TOP + 6), duration: 5 },
    { id: 'slide', text: 'SPRINT, THEN C / CTRL TO SLIDE', keys: ['SHIFT', 'C'], trigger: zone(F1, 33, 44, -8, 8, R1B_TOP - 1, R1B_TOP + 6), duration: 5 },
  );

  // ============================================================================================
  // SECTION 2 - ROOFTOP JUMPS (F1, north)
  // ============================================================================================
  L.chunk = 1;
  const R2A_TOP = 62;
  const r2a = L.roof(F1, {
    name: 'R2a',
    f0: 74.2,
    f1: 92,
    r0: -8,
    r1: 8,
    top: R2A_TOP,
    style: 0,
    tint: WHITE_TINT,
    accent: 2,
    open: { f0: true, f1: true },
  });
  L.edgeMarker(F1, 92, -4, 4, R2A_TOP);
  L.scatter(r2a, 4, ['ac', 'vent', 'ac', 'antenna']);
  L.flagPole(F1.x(77, 7), F1.z(77, 7), R2A_TOP, 4.8, 'orange', 0.3);

  const R2B_TOP = 60.5;
  const r2b = L.roof(F1, {
    name: 'R2b',
    f0: 97,
    f1: 110.5,
    r0: -7,
    r1: 7,
    top: R2B_TOP,
    style: 2,
    tint: COOL,
    open: { f0: true, f1: true },
  });
  L.edgeMarker(F1, 110.5, -3.5, 3.5, R2B_TOP);
  L.scatter(r2b, 3, ['ac', 'vent', 'skylight']);
  L.pipeRun(F1, 99.5, 108, -5.6, R2B_TOP, 0.13);

  // Stepping-stone pillar.
  const R2C_TOP = 59.6;
  const r2c = L.roof(F1, {
    name: 'R2c pillar',
    f0: 115.1,
    f1: 121.5,
    r0: -3.6,
    r1: 3.6,
    top: R2C_TOP,
    style: 1,
    tint: GLASS,
    open: { f0: true, f1: true },
  });
  L.edgeMarker(F1, 121.5, -2.6, 2.6, R2C_TOP);
  L.scatter(r2c, 1, ['antenna', 'vent']);

  const R2D_TOP = 59;
  const r2d = L.roof(F1, {
    name: 'R2d',
    f0: 126.1,
    f1: 141,
    r0: -6,
    r1: 6,
    top: R2D_TOP,
    style: 0,
    tint: WARM,
    open: { f0: true, f1: true },
  });
  L.edgeMarker(F1, 141, -3, 3, R2D_TOP);
  L.scatter(r2d, 3, ['ac', 'vent', 'antenna']);

  // Climbable ledge: 2.2 m above R2d, short gap, grabbed automatically on a near-miss.
  const R2E_TOP = 61.2;
  const r2e = L.roof(F1, {
    name: 'R2e climb roof',
    f0: 143.4,
    f1: 159,
    r0: -6,
    r1: 6,
    top: R2E_TOP,
    style: 0,
    tint: WARM,
    accent: 1,
    open: { f0: true, f1: true },
  });
  // Red coping on the ledge that must be climbed.
  L.fbox(F1, 143.4, 144.1, -6, 6, R2E_TOP, R2E_TOP + 0.03, 'red', { collide: false, shadow: false });
  L.fbox(F1, 143.2, 143.235, -6, 6, R2E_TOP - 0.4, R2E_TOP, 'red', { collide: false, shadow: false });
  L.scatter(r2e, 3, ['ac', 'vent', 'skylight']);

  L.beam(F1, 'bridge 1', 159, 173, -1.2, 1.2, R2E_TOP);

  const PLAZA_TOP = 61.2;
  const plaza = L.roof(F1, {
    name: 'R2f plaza',
    f0: 173,
    f1: 201,
    r0: -14,
    r1: 14,
    top: PLAZA_TOP,
    style: 2,
    tint: WHITE_TINT,
    open: { f0: true, r1: true },
    lane: [-3.4, 3.4],
  });
  // East edge: curbs on both sides of the alley mouth only (the alley centre line is f = 193).
  L.fbox(F1, 173, 186, 13.68, 14, PLAZA_TOP, PLAZA_TOP + 0.28, 'trim');
  L.fbox(F1, 200, 201, 13.68, 14, PLAZA_TOP, PLAZA_TOP + 0.28, 'trim');
  L.reserve({ x0: 8, x1: 14, z0: -201, z1: -185 });
  // Guide pipes: an L-shaped red line hugging the OUTSIDE of the right-hand turn (x = -3.8, then z = -197),
  // so the intended path never crosses it.
  L.pipeRun(F1, 175, 197, -3.8, PLAZA_TOP, 0.13);
  L.pipeRun(across(F1), -3.8, 12, -197, PLAZA_TOP, 0.13);
  L.scatter(plaza, 8, ['ac', 'ac', 'vent', 'acBig', 'tank', 'skylight', 'antenna']);
  L.scaffoldTower(F1.x(184, -9.5), F1.z(184, -9.5), PLAZA_TOP, 2.6, 8);
  L.railing(F1, 174, 200, -13.55, PLAZA_TOP);
  L.railing(across(F1), -13.5, -5, -200.55, PLAZA_TOP);
  L.flagPole(F1.x(197, -12), F1.z(197, -12), PLAZA_TOP, 5, 'red', -0.5);
  L.sign(-8, -199.4, PLAZA_TOP, 6, 2.8, 2, 1);

  route(F1, 91.7, 0, R2A_TOP, 'jump', { label: 'gap 3' });
  route(F1, 110.2, 0, R2B_TOP, 'jump', { label: 'gap 4' });
  route(F1, 121.2, 0, R2C_TOP, 'jump', { label: 'gap 5' });
  route(F1, 140.7, 0, R2D_TOP, 'jump', { label: 'climb' });
  route(F1, 166, 0, R2E_TOP, 'run', { label: 'bridge' });
  route(F1, 193, 0, PLAZA_TOP, 'run', { label: 'turn east' });
  route(F2, -3.5, 0, PLAZA_TOP, 'run', { label: 'cp2' });
  route(F2, -0.3, 0, PLAZA_TOP, 'jump', { label: 'alley mouth' });

  L.checkpoints.push({
    id: 2,
    name: 'CHECKPOINT 2',
    x: F2.x(-3.5, 0),
    y: PLAZA_TOP,
    z: F2.z(-3.5, 0),
    yaw: F2.yaw,
    gate: { x: F2.x(-5.5, 0), y: PLAZA_TOP, z: F2.z(-5.5, 0), width: RED_GATE_WIDTH, facing: F2.facing(0) },
    trigger: zone(F2, -9, -2, -7, 7, PLAZA_TOP - 1, PLAZA_TOP + 6),
    killY: 42,
  });
  L.sections.push({ index: 2, name: 'ROOFTOP JUMPS', trigger: zone(F1, 72, 173, -14, 14, 50, 80) });
  L.hints.push(
    { id: 'gap', text: 'RED EDGE = JUMP-OFF POINT', keys: [], trigger: zone(F1, 80, 90, -10, 10, R2A_TOP - 1, R2A_TOP + 6), duration: 4 },
    { id: 'climb', text: 'JUMP AT THE LEDGE - HOLD W TO PULL UP', keys: ['W'], trigger: zone(F1, 131, 141, -8, 8, R2D_TOP - 1, R2D_TOP + 6), duration: 5 },
    { id: 'turn', text: 'FOLLOW THE RED PIPE', keys: [], trigger: zone(F1, 177, 189, -14, 14, PLAZA_TOP - 1, PLAZA_TOP + 6), duration: 4 },
  );

  // ============================================================================================
  // SECTION 3 - SLIDING CHALLENGE (F2, east)
  // ============================================================================================
  L.chunk = 2;
  const R3A_TOP = 60;
  L.roof(F2, {
    name: 'R3a alley',
    f0: 3.6,
    f1: 75,
    r0: -7,
    r1: 7,
    top: R3A_TOP,
    style: 0,
    tint: COOL,
    open: { f0: true, f1: true, r0: true, r1: true },
    lane: [-5, 5],
  });
  L.tower(F2, 'S3 tower N', 3.6, 78, -62, -7, 74, 1, GLASS);
  L.tower(F2, 'S3 tower S', 3.6, 150, 7, 62, 74, 0, WARM, 1);
  const bulks: Array<[number, number]> = [
    [14, 15.6],
    [25.5, 27.1],
    [37, 38.4],
    [41.4, 42.8],
    [53, 54.6],
    [62, 67.5],
  ];
  bulks.forEach(([a, b], i) => L.bulkhead(F2, `vent bulkhead ${i + 1}`, a, b, -7.2, 7.2, R3A_TOP, 1.0, 4.2));
  L.pipeRun(F2, 5, 12, 6.1, R3A_TOP, 0.13);
  L.pipeRun(F2, 5, 12, -6.1, R3A_TOP, 0.13, 'redDark');
  L.pipeRun(F2, 69, 74, 6.1, R3A_TOP, 0.13);
  L.edgeMarker(F2, 75, -4, 4, R3A_TOP);

  route(F2, 10.8, 0, R3A_TOP, 'slide');
  route(F2, 17.2, 0, R3A_TOP, 'slideEnd');
  route(F2, 22.3, 0, R3A_TOP, 'slide');
  route(F2, 28.7, 0, R3A_TOP, 'slideEnd');
  route(F2, 33.8, 0, R3A_TOP, 'slide');
  route(F2, 44.4, 0, R3A_TOP, 'slideEnd');
  route(F2, 49.8, 0, R3A_TOP, 'slide');
  route(F2, 56.2, 0, R3A_TOP, 'slideEnd');
  route(F2, 58.8, 0, R3A_TOP, 'slide');
  route(F2, 69.2, 0, R3A_TOP, 'slideEnd');
  route(F2, 74.7, 0, R3A_TOP, 'jump', { label: 'gap 6' });

  L.sections.push({ index: 3, name: 'SLIDING', trigger: zone(F2, -2, 78, -7, 7, R3A_TOP - 2, R3A_TOP + 14) });
  L.hints.push(
    { id: 'alley', text: 'SLIDE UNDER THE DUCTS - KEEP YOUR SPEED', keys: ['C'], trigger: zone(F2, 4, 12, -7, 7, R3A_TOP - 1, R3A_TOP + 8), duration: 5 },
    { id: 'tunnel', text: 'LOW CEILING - STAY LOW UNTIL YOU CLEAR IT', keys: [], trigger: zone(F2, 56, 62, -7, 7, R3A_TOP - 1, R3A_TOP + 8), duration: 4 },
  );

  // ============================================================================================
  // SECTION 4 - WALL RUN (F2, east)
  // ============================================================================================
  L.chunk = 3;
  const R3B_TOP = 60;
  const r3b = L.roof(F2, {
    name: 'R3b',
    f0: 79,
    f1: 96,
    r0: -9,
    r1: 7,
    top: R3B_TOP,
    style: 2,
    tint: WHITE_TINT,
    open: { f0: true, f1: true, r1: true },
    lane: [-3.4, 6],
  });
  L.scatter(r3b, 3, ['ac', 'vent']);
  L.roof(F2, {
    name: 'R3b runway',
    f0: 96,
    f1: 110,
    r0: 2.4,
    r1: 7,
    top: R3B_TOP,
    style: 2,
    tint: WHITE_TINT,
    open: { f0: true, f1: true, r1: true },
    lane: [2.4, 7],
  });
  L.edgeMarker(F2, 110, 3.2, 6.4, R3B_TOP);
  L.fbox(F2, 96, 110, 2.6, 3.0, R3B_TOP, R3B_TOP + 0.03, 'red', { collide: false, shadow: false });

  const R4B_TOP = 59;
  const r4b = L.roof(F2, {
    name: 'R4b landing',
    f0: 122,
    f1: 150,
    r0: -9,
    r1: 7,
    top: R4B_TOP,
    style: 2,
    tint: WARM,
    open: { f0: true, f1: true, r1: true },
    lane: [-3.4, 6],
  });
  L.scatter(r4b, 3, ['ac', 'vent', 'acBig']);
  L.edgeMarker(F2, 150, -4, 4, R4B_TOP);
  L.wallPanel(F2, 'wall-run A', 98, 136, 7.0, 1, 57.5, 66.5);
  L.sign(F2.x(92, -7.5), F2.z(92, -7.5), R3B_TOP, 5, 2.4, F2.facing(2), 2);

  route(F2, 88.5, -1, R3B_TOP, 'run', { label: 'cp3' });
  route(F2, 97, 5.2, R3B_TOP, 'run', { label: 'runway' });
  route(F2, 109.6, 5.6, R3B_TOP, 'jumpWall', { steer: 1, label: 'wall run A' });
  route(F2, 121.5, 6.3, R4B_TOP + 1, 'wallEnd');
  route(F2, 137.5, -1, R4B_TOP, 'run', { label: 'cp4' });
  route(F2, 149.7, 0, R4B_TOP, 'jump', { label: 'gap 7' });

  L.checkpoints.push(
    {
      id: 3,
      name: 'CHECKPOINT 3',
      x: F2.x(88.5, -1),
      y: R3B_TOP,
      z: F2.z(88.5, -1),
      yaw: F2.yaw,
      gate: { x: F2.x(87, -1), y: R3B_TOP, z: F2.z(87, -1), width: 16, facing: F2.facing(0) },
      trigger: zone(F2, 85.5, 90, -9, 7, R3B_TOP - 1, R3B_TOP + 6),
      killY: 41,
    },
    {
      id: 4,
      name: 'CHECKPOINT 4',
      x: F2.x(137.5, -1),
      y: R4B_TOP,
      z: F2.z(137.5, -1),
      yaw: F2.yaw,
      gate: { x: F2.x(136, -1), y: R4B_TOP, z: F2.z(136, -1), width: 16, facing: F2.facing(0) },
      trigger: zone(F2, 134.5, 139, -9, 7, R4B_TOP - 1, R4B_TOP + 6),
      killY: 37.5,
    },
  );
  L.sections.push({ index: 4, name: 'WALL RUN', trigger: zone(F2, 78, 152, -10, 8, 50, 75) });
  L.hints.push({
    id: 'wall',
    text: 'JUMP ALONG THE RED WALL, HOLD W  -  SPACE TO JUMP OFF',
    keys: ['SPACE', 'W'],
    trigger: zone(F2, 92, 111, -10, 8, R3B_TOP - 1, R3B_TOP + 8),
    duration: 6,
  });

  // ============================================================================================
  // SECTION 5 - PARKOUR COMBINATION (F2, east)
  // ============================================================================================
  L.chunk = 4;
  const R5A_TOP = 59;
  const r5a = L.roof(F2, {
    name: 'R5a',
    f0: 154.5,
    f1: 172,
    r0: -7,
    r1: 5,
    top: R5A_TOP,
    style: 0,
    tint: COOL,
    accent: 1,
    open: { f0: true, f1: true },
  });
  L.crate(F2, 162.5, 163.7, -7, 5, R5A_TOP, 1.1);
  L.edgeMarker(F2, 172, -3, 3, R5A_TOP);
  L.scatter(r5a, 2, ['ac', 'vent']);

  const R5B_TOP = 57.5;
  L.beam(F2, 'bridge 2', 176.8, 192, -1.3, 2.1, R5B_TOP);
  L.tower(F2, 'S5 wall tower', 178, 230, -50, -1.3, 71.5, 1, GLASS);
  L.wallPanel(F2, 'wall-run B', 184, 205, -1.3, -1, 55.5, 64.5);
  L.edgeMarker(F2, 192, -0.6, 1.8, R5B_TOP, 0.9);

  const R5C_TOP = 56.5;
  L.roof(F2, {
    name: 'R5c',
    f0: 202,
    f1: 228,
    r0: -1.3,
    r1: 7,
    top: R5C_TOP,
    style: 2,
    tint: WHITE_TINT,
    open: { f0: true, f1: true, r0: true, r1: true },
    lane: [-1.3, 7],
  });
  L.tower(F2, 'S5 tower E', 200, 228, 7, 40, 66, 0, WARM);
  L.bulkhead(F2, 'vent bulkhead 7', 216, 217.6, -1.5, 7.2, R5C_TOP, 1.0, 4.2);
  L.pipeRun(F2, 208, 214, 5.9, R5C_TOP, 0.13);
  L.edgeMarker(F2, 228, 0, 6, R5C_TOP);

  const R5D_TOP = 55.5;
  const r5d = L.roof(F2, {
    name: 'R5d plaza',
    f0: 232,
    f1: 272,
    r0: -6,
    r1: 24,
    top: R5D_TOP,
    style: 2,
    tint: WHITE_TINT,
    open: { f0: true, r1: true },
    lane: [-1, 1],
    edgeClear: 4,
  });
  // Keep the diagonal from the landing zone to the south exit clear of clutter.
  {
    const a = F2.aabb(232, 258, -2, 24, 0, 1);
    L.avoid.push({ x0: a.min[0], x1: a.max[0], z0: a.min[2], z1: a.max[2] });
  }
  L.scatter(r5d, 7, ['ac', 'ac', 'acBig', 'vent', 'tank', 'skylight', 'antenna', 'flag']);
  // The exit edge on the south side (F3 f = 0) is open and gets a red marker; the north side gets a railing.
  L.railing(F2, 233, 272, -5.55, R5D_TOP);
  // Red chevron board on the plaza's north edge, facing south toward the final sprint.
  L.sign(F2.x(246, -4.2), F2.z(246, -4.2), R5D_TOP, 6, 2.6, F3.facing(2), 3);

  route(F2, 161, 0, R5A_TOP, 'vault', { label: 'vault wall' });
  route(F2, 171.7, 0, R5A_TOP, 'jump', { label: 'gap 8' });
  route(F2, 185, 0.4, R5B_TOP, 'run', { label: 'bridge 2' });
  route(F2, 191.7, -0.3, R5B_TOP, 'jumpWall', { steer: -1, label: 'wall run B' });
  route(F2, 201.4, -0.4, R5C_TOP + 1, 'wallEnd');
  route(F2, 212.8, 1, R5C_TOP, 'slide');
  route(F2, 219.6, 1, R5C_TOP, 'slideEnd');
  route(F2, 227.7, 1, R5C_TOP, 'jump', { label: 'gap 9' });
  route(F2, 238, 3, R5D_TOP, 'run', { label: 'cp5' });

  L.checkpoints.push({
    id: 5,
    name: 'CHECKPOINT 5',
    x: F2.x(238, 3),
    y: R5D_TOP,
    z: F2.z(238, 3),
    yaw: F3.yaw,
    gate: { x: F2.x(236.5, 0), y: R5D_TOP, z: F2.z(236.5, 0), width: 12, facing: F2.facing(0) },
    trigger: zone(F2, 233, 246, -6, 24, R5D_TOP - 1, R5D_TOP + 6),
    killY: 31,
  });
  L.sections.push({ index: 5, name: 'COMBINATION', trigger: zone(F2, 152, 231, -50, 40, 45, 80) });
  L.hints.push(
    { id: 'combo', text: 'VAULT  -  JUMP  -  WALL RUN  -  SLIDE  -  JUMP', keys: [], trigger: zone(F2, 151, 160, -8, 6, R5A_TOP - 1, R5A_TOP + 8), duration: 5 },
    { id: 'wall2', text: 'WALL RUN ON THE LEFT - STAY ON THE WALL SIDE', keys: ['W'], trigger: zone(F2, 180, 191, -2, 3, R5B_TOP - 1, R5B_TOP + 8), duration: 5 },
  );

  // ============================================================================================
  // SECTION 6 - FINAL SPRINT (F3, south)
  // ============================================================================================
  L.chunk = 5;
  L.edgeMarker(F3, 0, -4, 4, R5D_TOP);
  route(F3, -0.3, 0, R5D_TOP, 'jump', { label: 'gap 10' });

  const roofs6: Array<{ name: string; f0: number; f1: number; hw: number; top: number; style: number; tint: V3; accent?: number; scatter?: number }> = [
    { name: 'R6a', f0: 4.4, f1: 22, hw: 8, top: 55, style: 0, tint: COOL, accent: 2, scatter: 3 },
    { name: 'R6b', f0: 27.2, f1: 38.5, hw: 6, top: 54, style: 2, tint: WHITE_TINT, scatter: 2 },
    { name: 'R6c', f0: 44, f1: 52.5, hw: 5, top: 52.5, style: 1, tint: GLASS },
    { name: 'R6d', f0: 57.2, f1: 70.5, hw: 6, top: 53.7, style: 0, tint: WARM, accent: 1, scatter: 2 },
    { name: 'R6e', f0: 75.8, f1: 84.5, hw: 5, top: 52, style: 2, tint: STEEL },
    { name: 'R6f', f0: 90.2, f1: 98.5, hw: 5, top: 50.5, style: 0, tint: COOL, accent: 2 },
    { name: 'R6g', f0: 104.6, f1: 112, hw: 5, top: 49, style: 1, tint: GLASS },
  ];
  for (const d of roofs6) {
    const info = L.roof(F3, {
      name: d.name,
      f0: d.f0,
      f1: d.f1,
      r0: -d.hw,
      r1: d.hw,
      top: d.top,
      style: d.style,
      tint: d.tint,
      accent: d.accent ?? 0,
      open: { f0: true, f1: true },
    });
    if (d.scatter) L.scatter(info, d.scatter, ['ac', 'vent', 'ac', 'antenna']);
    L.edgeMarker(F3, d.f1, -Math.min(3, d.hw - 1.5), Math.min(3, d.hw - 1.5), d.top);
    if (d.name !== 'R6g') route(F3, d.f1 - 0.3, 0, d.top, 'jump', { label: `gap ${d.name}` });
  }
  // The climb onto R6d gets red coping like the section-2 ledge.
  L.fbox(F3, 57.2, 57.9, -6, 6, 53.7, 53.73, 'red', { collide: false, shadow: false });
  L.fbox(F3, 57.0, 57.035, -6, 6, 53.3, 53.7, 'red', { collide: false, shadow: false });

  const R6H_TOP = 49;
  L.beam(F3, 'bridge 3', 112, 126, -1.2, 1.2, R6H_TOP);
  const r6h = L.roof(F3, {
    name: 'R6h finish roof',
    f0: 126,
    f1: 172,
    r0: -14,
    r1: 14,
    top: R6H_TOP,
    style: 2,
    tint: WHITE_TINT,
    open: { f0: true },
    lane: [-4, 4],
  });
  L.scatter(r6h, 8, ['ac', 'ac', 'vent', 'acBig', 'tank', 'antenna', 'flag']);
  L.flagPole(F3.x(130, 12.5), F3.z(130, 12.5), R6H_TOP, 5.2, 'red', 0.4);
  L.flagPole(F3.x(130, -12.5), F3.z(130, -12.5), R6H_TOP, 5.2, 'orange', -0.4);
  route(F3, 140, 0, R6H_TOP, 'run');
  route(F3, 158, 0, R6H_TOP, 'finish');

  L.sections.push({ index: 6, name: 'FINAL SPRINT', trigger: zone(F3, -2, 174, -16, 16, 35, 75) });
  L.hints.push({
    id: 'final',
    text: 'FINAL SPRINT - DO NOT STOP',
    keys: [],
    trigger: zone(F3, -2, 8, -10, 10, R5D_TOP - 1, R5D_TOP + 8),
    duration: 5,
  });
  L.hints.push({
    id: 'momentum',
    text: 'KEEP SPRINTING - MOMENTUM BUILDS TOP SPEED',
    keys: ['SHIFT'],
    trigger: zone(F3, 90, 100, -8, 8, 48, 60),
    duration: 4,
  });

  // Finish line across the whole width of the last roof so it cannot be walked around.
  const finishF = 156;
  const finishPos = { x: F3.x(finishF, 0), y: R6H_TOP, z: F3.z(finishF, 0) };
  const finish = {
    ...finishPos,
    yaw: F3.yaw,
    width: 28,
    facing: F3.facing(0),
    trigger: zone(F3, finishF - 0.5, finishF + 0.5, -14, 14, R6H_TOP - 1, R6H_TOP + 8),
  };

  return {
    boxes: L.boxes,
    cyls: L.cyls,
    bars: L.bars,
    flags: L.flags,
    signs: L.signs,
    checkpoints: L.checkpoints,
    hints: L.hints,
    sections: L.sections,
    route: L.route,
    start: { x: F1.x(-3, 0), y: R1_TOP, z: F1.z(-3, 0), yaw: F1.yaw },
    finish,
    footprints: L.footprints,
    roofTops: L.roofTops,
  };
}
