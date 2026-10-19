import type { Carpet, GuidePoint, Layout, RoofMeta, Solid, SpawnPoint, Trigger } from '../player/types';

/** Route runs toward +X. Right of travel is +Z, left is −Z.
 *  A clean sprint is about a minute; the red edges are the intended jumps.
 */

const THICK = 2;

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  rails: RoofMeta['rails'];
}

function R(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  rails: RoofMeta['rails'],
): Box {
  return { x0, x1, z0, z1, y, rails };
}

const main = R(-8, 22, -11, 11, 40, 'both');
const tut = R(24.8, 40, -5, 5, 40, 'both');
const a = R(44.6, 58, -7, 7, 40.3, 'both');
const b = R(63.2, 78, -6.5, 6.5, 39.35, 'both');
const c = R(83.0, 98, -8, 8, 39.65, 'both');
const d = R(103.0, 118, -7, 7, 39.0, 'both');
const e = R(123.0, 142, -7, 7, 39.3, 'both');
const f = R(147.2, 166, -8, 8, 38.7, 'both');
const slide = R(169.6, 218, -8, 8, 38.7, 'both');
const wallStart = R(221.6, 238, -5.45, 8, 38.7, '+z');
const wallLand = R(249, 272, -5.05, 9, 37.4, '+z');
const combo = R(276.8, 304, -7, 7.4, 37.6, '-z');
const comboLand = R(315, 346, -8, 7.15, 36.3, '-z');
const ledgeY = 36.3 + 1.48;
const ledge = R(346, 368, -8, 7.15, ledgeY, 'both');
const n1 = R(372.8, 386, -6, 6, 37.35, 'both');
const n2 = R(390.6, 404, -6, 6, 36.9, 'both');
const n3 = R(408.6, 422, -6, 6, 36.5, 'both');
const n4 = R(426.6, 440, -6, 6, 36.15, 'both');
const n5 = R(444.6, 458, -6, 6, 35.85, 'both');
const n6 = R(462.6, 476, -6, 6, 35.55, 'both');
const n7 = R(480.6, 494, -6, 6, 35.3, 'both');
const finishRoof = R(498.6, 530, -12, 12, 35.0, 'both');

const PLAY = [main, tut, a, b, c, d, e, f, slide, wallStart, wallLand, combo, comboLand, ledge, n1, n2, n3, n4, n5, n6, n7, finishRoof];

let ids = 1;

function roofSolid(b: Box): Solid {
  return {
    id: ids++,
    minX: b.x0,
    minY: b.y - THICK,
    minZ: b.z0,
    maxX: b.x1,
    maxY: b.y,
    maxZ: b.z1,
    surface: 'roof',
  };
}

function box(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  surface: Solid['surface'],
  accent?: Solid['accent'],
): Solid {
  return { id: ids++, minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, surface, accent };
}

function hint(x0: number, x1: number, y: number, z0: number, z1: number, text: string): Trigger {
  return { minX: x0, maxX: x1, minY: y, maxY: y + 2.6, minZ: z0, maxZ: z1, type: 'hint', hint: text };
}

function carpet(edgeX: number, y: number, z: number, length = 3.2): Carpet {
  return { x: edgeX - length * 0.62, y: y + 0.03, z, length, width: 1.55 };
}

export function guideZ(guide: GuidePoint[], x: number): number {
  if (x <= guide[0].x) return guide[0].z;
  for (let i = 1; i < guide.length; i++) {
    const prev = guide[i - 1];
    const next = guide[i];
    if (x <= next.x) {
      const t = (x - prev.x) / Math.max(0.001, next.x - prev.x);
      return prev.z + (next.z - prev.z) * t;
    }
  }
  return guide[guide.length - 1].z;
}

export function buildLayout(): Layout {
  const roofs: RoofMeta[] = PLAY.map((b) => ({ ...b }));
  const solids: Solid[] = PLAY.map(roofSolid);

  solids.push(box(10.2, main.y, -6, 10.95, main.y + 0.86, 6, 'red'));
  solids.push(box(15.6, main.y + 1.02, main.z0, 18.0, main.y + 2.35, main.z1, 'metal'));
  solids.push(box(4.4, main.y, 7.4, 6.5, main.y + 1.15, 8.8, 'concrete'));
  solids.push(box(-2.4, main.y, -9.5, -0.5, main.y + 1.2, -7.7, 'concrete'));
  solids.push(box(-6.6, main.y, -8.8, -3.7, main.y + 2.75, -5.3, 'concrete'));
  solids.push(box(48, a.y, 4.7, 49.8, a.y + 1.05, 6.2, 'concrete'));
  solids.push(box(88, c.y, -6.7, 90.1, c.y + 1.1, -5.1, 'concrete'));

  for (const x of [178, 190, 202, 212]) {
    solids.push(box(x, slide.y + 1.02, slide.z0, x + 2.3, slide.y + 2.4, slide.z1, 'metal'));
  }

  solids.push(box(228, 20, -6.95, 264, 64, -6.15, 'wall', 'maxZ'));
  solids.push(box(296, 20, 8.2, 338, 64, 9.0, 'wall', 'minZ'));

  solids.push(box(284.2, combo.y, combo.z0, 284.9, combo.y + 0.96, combo.z1, 'red'));
  solids.push(box(293.4, combo.y, combo.z0, 294.1, combo.y + 0.96, combo.z1, 'red'));
  solids.push(box(328.2, comboLand.y + 1.02, comboLand.z0, 330.6, comboLand.y + 2.35, comboLand.z1, 'metal'));

  const arch = 512;
  solids.push(box(arch, finishRoof.y, -3.6, arch + 0.75, finishRoof.y + 3.7, -2.75, 'red'));
  solids.push(box(arch, finishRoof.y, 2.75, arch + 0.75, finishRoof.y + 3.7, 3.6, 'red'));
  solids.push(box(arch - 0.15, finishRoof.y + 3.35, -3.6, arch + 0.9, finishRoof.y + 3.85, 3.6, 'red'));

  const checkpoints: SpawnPoint[] = [
    { x: 3.4, y: main.y, z: 0, yaw: -Math.PI / 2, label: 'Start' },
    { x: 32, y: tut.y, z: 0, yaw: -Math.PI / 2, label: 'Rhythm' },
    { x: 156, y: f.y, z: -4.7, yaw: -Math.PI / 2, label: 'Ducts' },
    { x: 216.3, y: slide.y, z: -5, yaw: -Math.PI / 2, label: 'Wall' },
    { x: 260, y: wallLand.y, z: 1.5, yaw: -Math.PI / 2, label: 'Combo' },
    { x: 356, y: ledge.y, z: 0, yaw: -Math.PI / 2, label: 'Sprint' },
  ];

  const triggers: Trigger[] = [
    { minX: 27, maxX: 38, minY: tut.y, maxY: tut.y + 3, minZ: -4, maxZ: 4, type: 'checkpoint', index: 1 },
    { minX: 150, maxX: 164, minY: f.y, maxY: f.y + 3, minZ: -7, maxZ: 0, type: 'checkpoint', index: 2 },
    { minX: 215.2, maxX: 217.8, minY: slide.y, maxY: slide.y + 3, minZ: -7, maxZ: 1, type: 'checkpoint', index: 3 },
    { minX: 254, maxX: 268, minY: wallLand.y, maxY: wallLand.y + 3, minZ: -3, maxZ: 6, type: 'checkpoint', index: 4 },
    { minX: 350, maxX: 366, minY: ledge.y, maxY: ledge.y + 3, minZ: -5, maxZ: 5, type: 'checkpoint', index: 5 },
    {
      minX: arch + 0.15,
      maxX: arch + 1.7,
      minY: finishRoof.y,
      maxY: finishRoof.y + 3.5,
      minZ: -2.6,
      maxZ: 2.6,
      type: 'finish',
    },
    hint(0, 9, main.y, -4, 4, 'WASD MOVE   ·   SHIFT SPRINT   ·   SPACE JUMP'),
    hint(13.2, 15.4, main.y, -2, 2, 'CTRL SLIDES UNDER LOW DUCTS'),
    hint(18.4, 22.2, main.y, -3, 3, 'HOLD SPACE THROUGH THE GAP'),
    hint(38, 40.2, tut.y, -3, 3, 'SPRINT — RED EDGES MARK THE JUMPS'),
    hint(170, 177, slide.y, -7, 0, 'SLIDE THE DUCTS AND KEEP YOUR SPEED'),
    hint(230, 237.5, wallStart.y, -5.6, -3, 'JUMP AT THE RED WALL, THEN SPACE TO LEAP OFF'),
    hint(280, 296, combo.y, -4, 6, 'E  ·  VAULT THE RED BARS'),
    hint(298, 304, combo.y, 5, 7.4, 'WALL-RUN THE RED FACE ACROSS THE GAP'),
    hint(338, 346.2, comboLand.y, -3, 4, 'JUMP INTO THE LEDGE TO CLIMB'),
    hint(500, arch, finishRoof.y, -4, 4, 'SPRINT THROUGH THE ARCH'),
  ];

  const takeoffs: Array<[Box, number]> = [
    [main, 0],
    [tut, 0],
    [a, 0],
    [b, -1.5],
    [c, -3],
    [d, -4],
    [e, -4.6],
    [f, -4.95],
    [slide, -5],
    [wallStart, -5.02],
    [wallLand, 4],
    [combo, 6.7],
    [ledge, 0],
    [n1, 0],
    [n2, 0],
    [n3, 0],
    [n4, 0],
    [n5, 0],
    [n6, 0],
    [n7, 0],
  ];
  const carpets: Carpet[] = takeoffs.map(([roof, z]) => carpet(roof.x1, roof.y, z));
  carpets.push({ x: arch - 6.5, y: finishRoof.y + 0.03, z: 0, length: 8, width: 2.3 });

  const guide: GuidePoint[] = [
    { x: 0, z: 0 },
    { x: 40, z: 0 },
    { x: 70, z: -1.2 },
    { x: 98, z: -3.2 },
    { x: 130, z: -4.5 },
    { x: 166, z: -4.95 },
    { x: 238, z: -5.02 },
    { x: 258, z: 0.5 },
    { x: 276, z: 3.2 },
    { x: 296, z: 6.15 },
    { x: 304, z: 6.9 },
    { x: 330, z: 2 },
    { x: 360, z: 0 },
    { x: 530, z: 0 },
  ];

  return {
    solids,
    triggers,
    checkpoints,
    carpets,
    roofs,
    guide,
    finish: { x: arch + 0.4, y: finishRoof.y, z: 0 },
  };
}
