import type { Solid } from './CollisionWorld';

export type MatId =
  | 'concrete'
  | 'roof'
  | 'red'
  | 'redGlow'
  | 'gray'
  | 'dark'
  | 'metal'
  | 'orange'
  | 'glass'
  | 'banner';

export interface CourseBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  mat: MatId;
  solid: boolean;
  vaultable?: boolean;
  wallRun?: boolean;
  windows?: boolean;
  rotY?: number;
}

export interface Trigger {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  kind: 'checkpoint' | 'finish' | 'hint';
  id: string;
  message?: string;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
}

export interface Flag {
  x: number;
  y: number;
  z: number;
  orange: boolean;
  phase: number;
}

export interface Platform {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  top: number;
  nearZ: number;
  farZ: number;
  minX: number;
  maxX: number;
}

export interface Course {
  boxes: CourseBox[];
  triggers: Trigger[];
  flags: Flag[];
  platforms: Platform[];
  spawn: { x: number; y: number; z: number; yaw: number };
  killY: number;
  play: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const boxes: CourseBox[] = [];
const triggers: Trigger[] = [];
const flags: Flag[] = [];
const platforms: Platform[] = [];

function add(b: CourseBox): void {
  boxes.push(b);
}

function building(p: Platform, mat: MatId = 'concrete', windows = true): void {
  add({
    x: p.x,
    y: p.top / 2,
    z: p.z,
    w: p.w,
    h: p.top,
    d: p.d,
    mat,
    solid: true,
    windows,
  });
}

function decal(x: number, top: number, z: number, w: number, d: number, mat: MatId = 'red'): void {
  add({
    x,
    y: top + 0.03,
    z,
    w,
    h: 0.04,
    d,
    mat,
    solid: false,
  });
}

function parapetX(p: Platform, side: 1 | -1): void {
  const t = 0.16;
  const h = 0.95;
  const x = side > 0 ? p.maxX - t / 2 : p.minX + t / 2;
  add({
    x,
    y: p.top + h / 2,
    z: p.z,
    w: t,
    h,
    d: Math.max(0.4, p.d - 0.3),
    mat: 'concrete',
    solid: true,
  });
}

function chevron(x: number, top: number, z: number): void {
  // Flat bars rotated in the mesh only. They are not colliders.
  add({ x, y: top + 0.045, z, w: 0.16, h: 0.035, d: 1.15, mat: 'redGlow', solid: false, rotY: 0.55 });
  add({ x, y: top + 0.045, z, w: 0.16, h: 0.035, d: 1.15, mat: 'redGlow', solid: false, rotY: -0.55 });
}

function flag(x: number, top: number, z: number, orange = true): void {
  flags.push({ x, y: top, z, orange, phase: (x * 0.3 + z * 0.1) % 6 });
}

function posts(p: Platform, z: number, name: string, id: string): void {
  const h = 1.35;
  const spread = Math.min(2.3, p.w * 0.28);
  for (const s of [-1, 1]) {
    add({
      x: p.x + s * spread,
      y: p.top + h / 2,
      z,
      w: 0.18,
      h,
      d: 0.18,
      mat: 'redGlow',
      solid: true,
    });
  }
  triggers.push({
    x: p.x,
    y: p.top + 1.6,
    z,
    w: p.w * 0.85,
    h: 3.2,
    d: 3.2,
    kind: 'checkpoint',
    id,
    message: name,
    spawnX: p.x,
    spawnY: p.top,
    spawnZ: z + 1.2,
  });
}

function hint(p: Platform, z: number, id: string, message: string, w = 8): void {
  triggers.push({
    x: p.x,
    y: p.top + 1.5,
    z,
    w,
    h: 3,
    d: 3.5,
    kind: 'hint',
    id,
    message,
    spawnX: p.x,
    spawnY: p.top,
    spawnZ: z,
  });
}

function duct(p: Platform, z: number, clearance = 1.04): void {
  const slabH = 0.42;
  const bottom = p.top + clearance;
  add({
    x: p.x,
    y: bottom + slabH / 2,
    z,
    w: p.w + 0.2,
    h: slabH,
    d: 2.5,
    mat: 'metal',
    solid: true,
  });
  add({
    x: p.x,
    y: bottom + slabH + 0.05,
    z: z + 1.05,
    w: p.w * 0.55,
    h: 0.08,
    d: 0.22,
    mat: 'redGlow',
    solid: false,
  });
  // Side housings sit outside the run line so the slide lane stays open.
  for (const s of [-1, 1]) {
    add({
      x: p.x + s * (p.w / 2 - 0.45),
      y: p.top + 0.55,
      z,
      w: 0.7,
      h: 1.1,
      d: 1.3,
      mat: 'gray',
      solid: true,
    });
  }
}

function vaultBar(p: Platform, z: number, height = 0.88): void {
  add({
    x: p.x,
    y: p.top + height / 2,
    z,
    w: p.w - 0.5,
    h: height,
    d: 0.72,
    mat: 'red',
    solid: true,
    vaultable: true,
  });
}

function ac(x: number, top: number, z: number, w = 1.15, h = 0.85, d = 0.9): void {
  add({ x, y: top + h / 2, z, w, h, d, mat: 'gray', solid: true });
  add({ x, y: top + h + 0.05, z, w: w * 0.75, h: 0.08, d: d * 0.7, mat: 'dark', solid: false });
}

let cursor = 10;

function place(id: string, w: number, d: number, top: number, gap: number, x = 0): Platform {
  const overlap = gap <= 0 ? 0.3 : 0;
  const nominalNear = cursor - gap;
  const farZ = nominalNear - d;
  const nearZ = nominalNear + overlap;
  const depth = nearZ - farZ;
  const z = (nearZ + farZ) / 2;
  cursor = farZ;
  const p: Platform = {
    id,
    x,
    z,
    w,
    d: depth,
    top,
    nearZ,
    farZ,
    minX: x - w / 2,
    maxX: x + w / 2,
  };
  platforms.push(p);
  building(p);
  return p;
}

function edgePad(p: Platform, end: 'near' | 'far'): void {
  const z = end === 'near' ? p.nearZ - 1.1 : p.farZ + 1.15;
  decal(p.x, p.top, z, Math.min(4.2, p.w * 0.55), 1.15, 'red');
}

function wallRun(faceX: number, z0: number, z1: number, side: 1 | -1): void {
  const length = Math.abs(z0 - z1);
  const z = (z0 + z1) / 2;
  const thick = 2.4;
  const height = 54;
  const x = side > 0 ? faceX + thick / 2 : faceX - thick / 2;
  add({
    x,
    y: height / 2,
    z,
    w: thick,
    h: height,
    d: length,
    mat: 'concrete',
    solid: true,
    wallRun: true,
    windows: true,
  });
  const panel = 0.07;
  const px = side > 0 ? faceX - panel / 2 - 0.01 : faceX + panel / 2 + 0.01;
  add({
    x: px,
    y: 30,
    z,
    w: panel,
    h: 16,
    d: length * 0.94,
    mat: 'redGlow',
    solid: false,
  });
}

function tower(x: number, z: number, w: number, d: number, top: number): void {
  add({
    x,
    y: top / 2,
    z,
    w,
    h: top,
    d,
    mat: 'glass',
    solid: true,
    windows: true,
  });
  add({
    x,
    y: top - 0.15,
    z,
    w: w + 0.4,
    h: 0.3,
    d: d + 0.4,
    mat: 'concrete',
    solid: false,
  });
}

export function buildCourse(): Course {
  boxes.length = 0;
  triggers.length = 0;
  flags.length = 0;
  platforms.length = 0;
  cursor = 10;

  // Section 1 — movement tutorial. Wide roof, vault, slide, short gap.
  const s1 = place('s1', 20, 38, 38, 0, 0);
  parapetX(s1, -1);
  parapetX(s1, 1);
  const spawnZ = s1.nearZ - 5;
  add({
    x: -6.4,
    y: s1.top + 1.55,
    z: spawnZ + 1.5,
    w: 4.2,
    h: 3.1,
    d: 3.6,
    mat: 'concrete',
    solid: true,
    windows: true,
  });
  add({
    x: -6.4,
    y: s1.top + 1.15,
    z: spawnZ + 1.5 - 1.82,
    w: 1.15,
    h: 2.15,
    d: 0.08,
    mat: 'red',
    solid: false,
  });
  ac(6.2, s1.top, spawnZ - 1, 1.4, 0.9, 1.1);
  ac(5.4, s1.top, spawnZ - 3.2, 0.9, 0.7, 0.8);
  vaultBar(s1, spawnZ - 12, 0.86);
  duct(s1, spawnZ - 22, 1.04);
  chevron(0, s1.top, s1.farZ + 5.5);
  edgePad(s1, 'far');
  hint(s1, spawnZ - 1, 'h-move', 'WASD MOVE   ·   SHIFT SPRINT   ·   SPACE JUMP', 12);
  hint(s1, spawnZ - 12, 'h-vault', 'E  VAULT', 6);
  hint(s1, spawnZ - 22, 'h-slide', 'CTRL  SLIDE', 6);
  flag(-8.2, s1.top, spawnZ - 4, true);
  flag(8.2, s1.top, s1.farZ + 3, false);

  // Section 2 — rooftop jumps. First gap is walkable; the next two want a sprint.
  const s2a = place('s2a', 16, 16, 38, 3.05, 0);
  parapetX(s2a, -1);
  parapetX(s2a, 1);
  edgePad(s2a, 'near');
  chevron(0, s2a.top, s2a.farZ + 4);
  posts(s2a, s2a.nearZ - 3.2, 'ROOFTOPS', 'cp1');
  flag(-6.4, s2a.top, s2a.z, true);
  flag(6.4, s2a.top, s2a.z, true);
  ac(-4.6, s2a.top, s2a.farZ + 3.5);

  const s2b = place('s2b', 14, 15, 36.55, 4.35, 0);
  parapetX(s2b, -1);
  parapetX(s2b, 1);
  edgePad(s2b, 'near');
  chevron(0, s2b.top, s2b.farZ + 3.6);
  hint(s2a, s2a.farZ + 3.2, 'h-gap', 'SPRINT AND JUMP', 6);
  flag(5.5, s2b.top, s2b.nearZ - 2, false);

  const s2c = place('s2c', 15, 14, 36.55, 4.7, 0);
  parapetX(s2c, -1);
  parapetX(s2c, 1);
  edgePad(s2c, 'near');
  posts(s2c, s2c.z, 'BRIDGE', 'cp2');
  ac(4.8, s2c.top, s2c.nearZ - 3);

  const bridge = place('bridge', 3.3, 16, 36.55, 0, 0);
  // Low side lips, short enough to step, mark the edges in red.
  for (const s of [-1, 1] as const) {
    add({
      x: bridge.x + s * 1.48,
      y: bridge.top + 0.08,
      z: bridge.z,
      w: 0.12,
      h: 0.08,
      d: bridge.d - 0.4,
      mat: 'redGlow',
      solid: false,
    });
  }
  decal(0, bridge.top, bridge.z, 0.45, bridge.d - 1.2, 'red');

  // Section 3 — sliding lane.
  const s3 = place('s3', 14, 40, 36.55, 0, 0);
  parapetX(s3, -1);
  parapetX(s3, 1);
  posts(s3, s3.nearZ - 3, 'VENTS', 'cp3');
  hint(s3, s3.nearZ - 6, 'h-vents', 'HOLD CTRL  ·  SLIDE THE VENTS', 8);
  const ductZs = [8, 16, 24, 32];
  for (const dz of ductZs) duct(s3, s3.nearZ - dz, 1.03);
  chevron(0, s3.top, s3.farZ + 3.5);
  flag(-5.6, s3.top, s3.z, true);
  flag(5.6, s3.top, s3.farZ + 4, false);

  // Section 4 — wall run on the right. Gap is past a normal jump.
  const s4a = place('s4a', 14, 18, 36.55, 0, 0);
  parapetX(s4a, -1);
  posts(s4a, s4a.nearZ - 3.2, 'WALL RUN', 'cp4');
  hint(s4a, s4a.z, 'h-wall', 'SPRINT THE RED WALL  ·  JUMP TO GRAB IT', 10);
  // Chevrons drift toward the right edge.
  chevron(2.2, s4a.top, s4a.nearZ - 7);
  chevron(4.4, s4a.top, s4a.nearZ - 11);
  chevron(6.1, s4a.top, s4a.farZ + 2.4);
  decal(5.6, s4a.top, s4a.z - 2, 2.2, s4a.d - 6, 'red');
  flag(6.4, s4a.top, s4a.nearZ - 2, false);

  const s4b = place('s4b', 14, 18, 36.55, 8.15, 0);
  parapetX(s4b, -1);
  edgePad(s4b, 'near');
  // Right edge stays open so the wall-run line can step onto the roof.
  decal(5.4, s4b.top, s4b.nearZ - 4, 2.4, 6, 'red');
  flag(-5.5, s4b.top, s4b.z, true);

  const faceR = s4a.maxX + 0.1;
  wallRun(faceR, s4a.farZ + 7.5, s4b.nearZ - 11, 1);

  // Section 5 — vault, slide, cross to the left wall, then mantle.
  const s5a = place('s5a', 16, 20, 36.55, 0, 0);
  parapetX(s5a, 1);
  posts(s5a, s5a.nearZ - 2.6, 'COMBINATION', 'cp5');
  vaultBar(s5a, s5a.nearZ - 8.5, 0.9);
  hint(s5a, s5a.nearZ - 8.5, 'h-vault2', 'E  VAULT  ·  KEEP YOUR SPEED', 8);
  duct(s5a, s5a.nearZ - 15, 1.02);
  ac(-5.2, s5a.top, s5a.farZ + 3.2);

  const s5b = place('s5b', 16, 32, 36.55, 0, 0);
  // Open on the left for the upcoming wall. Right parapet pushes the line over.
  parapetX(s5b, 1);
  hint(s5b, s5b.nearZ - 6, 'h-cross', 'CROSS TO THE LEFT RED WALL', 10);
  chevron(3.2, s5b.top, s5b.nearZ - 5);
  chevron(0.2, s5b.top, s5b.nearZ - 10);
  chevron(-2.6, s5b.top, s5b.nearZ - 15);
  chevron(-5.2, s5b.top, s5b.farZ + 3);
  decal(-5.2, s5b.top, s5b.z, 2.2, 14, 'red');
  flag(-6.6, s5b.top, s5b.farZ + 2, false);

  const s5c = place('s5c', 16, 16, 36.55, 7.7, 0);
  parapetX(s5c, 1);
  edgePad(s5c, 'near');
  decal(-5.3, s5c.top, s5c.nearZ - 4, 2.4, 6, 'red');

  const faceL = s5b.minX - 0.1;
  wallRun(faceL, s5b.farZ + 7.5, s5c.nearZ - 10, -1);

  // Mantle ledge: too high for a raw jump, close enough to grab.
  const s5d = place('s5d', 18, 16, 38.05, 2.15, 0);
  parapetX(s5d, -1);
  parapetX(s5d, 1);
  edgePad(s5d, 'near');
  add({
    x: s5d.x,
    y: s5d.top + 0.08,
    z: s5d.nearZ - 0.35,
    w: 5.5,
    h: 0.16,
    d: 0.45,
    mat: 'redGlow',
    solid: false,
  });
  hint(s5c, s5c.farZ + 3.2, 'h-mantle', 'JUMP TO THE RED LEDGE', 8);
  flag(-5.4, s5d.top, s5d.z, true);
  flag(5.4, s5d.top, s5d.z, true);
  posts(s5d, s5d.nearZ - 3.4, 'FINAL SPRINT', 'cp6');

  // Section 6 — final sprint.
  const f1 = place('f1', 13, 14, 38.05, 3.65, 0);
  parapetX(f1, -1);
  parapetX(f1, 1);
  edgePad(f1, 'near');
  chevron(0, f1.top, f1.farZ + 3.2);
  flag(-5, f1.top, f1.nearZ - 1.5, false);
  flag(5, f1.top, f1.nearZ - 1.5, true);

  const f2 = place('f2', 12, 13, 38.5, 4.35, 0);
  parapetX(f2, -1);
  parapetX(f2, 1);
  edgePad(f2, 'near');
  chevron(0, f2.top, f2.farZ + 3);
  flag(0, f2.top, f2.nearZ - 1.4, true);

  const f3 = place('f3', 16, 20, 38.5, 4.15, 0);
  parapetX(f3, -1);
  parapetX(f3, 1);
  edgePad(f3, 'near');
  const finishZ = f3.farZ + 6.5;
  const archH = 3.6;
  for (const s of [-1, 1]) {
    add({
      x: s * 2.15,
      y: f3.top + archH / 2,
      z: finishZ,
      w: 0.28,
      h: archH,
      d: 0.28,
      mat: 'redGlow',
      solid: true,
    });
  }
  add({
    x: 0,
    y: f3.top + archH,
    z: finishZ,
    w: 4.6,
    h: 0.28,
    d: 0.28,
    mat: 'redGlow',
    solid: true,
  });
  triggers.push({
    x: 0,
    y: f3.top + 1.6,
    z: finishZ,
    w: 15,
    h: 3.4,
    d: 3.2,
    kind: 'finish',
    id: 'finish',
    message: 'FINISH',
    spawnX: 0,
    spawnY: f3.top,
    spawnZ: finishZ,
  });
  flag(-6.4, f3.top, f3.nearZ - 2, true);
  flag(6.4, f3.top, f3.nearZ - 2, false);
  flag(-6.4, f3.top, finishZ + 2, true);
  flag(6.4, f3.top, finishZ + 2, false);

  // Flanking towers frame the roofs. Inner faces sit outside a sprint jump.
  tower(20, s1.z, 12, 18, 64);
  tower(-19, s2b.z, 11, 16, 72);
  tower(21, s3.z + 4, 13, 18, 58);
  tower(-20, s4b.z, 12, 16, 76);
  tower(22, s5d.z, 14, 18, 68);
  tower(-18, f2.z, 11, 14, 80);
  tower(16, 18, 14, 12, 52);
  tower(-16, 6, 12, 14, 48);

  // Red banners on the nearest towers.
  add({ x: 14.05, y: 44, z: s1.z, w: 0.08, h: 3.2, d: 6.5, mat: 'banner', solid: false });
  add({ x: -13.55, y: 46, z: s2b.z, w: 0.08, h: 2.6, d: 5.5, mat: 'orange', solid: false });

  // A crane beside the wall-run, visual only.
  const craneX = 24;
  const craneZ = s4a.z;
  add({ x: craneX, y: 26, z: craneZ, w: 0.45, h: 52, d: 0.45, mat: 'red', solid: false });
  add({ x: craneX, y: 51.2, z: craneZ, w: 0.7, h: 0.7, d: 0.7, mat: 'red', solid: false });
  add({ x: craneX - 6, y: 50.6, z: craneZ - 2, w: 14, h: 0.28, d: 0.28, mat: 'red', solid: false });
  add({ x: craneX - 12.4, y: 40, z: craneZ - 2, w: 0.08, h: 21, d: 0.08, mat: 'red', solid: false });

  // Background radio mast.
  add({ x: -26, y: 30, z: f3.z, w: 0.3, h: 60, d: 0.3, mat: 'dark', solid: false });
  add({ x: -26, y: 58, z: f3.z, w: 3.2, h: 0.12, d: 0.12, mat: 'dark', solid: false });

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of platforms) {
    minX = Math.min(minX, p.minX);
    maxX = Math.max(maxX, p.maxX);
    minZ = Math.min(minZ, p.farZ);
    maxZ = Math.max(maxZ, p.nearZ);
  }

  return {
    boxes: boxes.slice(),
    triggers: triggers.slice(),
    flags: flags.slice(),
    platforms: platforms.slice(),
    spawn: { x: 0, y: s1.top, z: spawnZ, yaw: 0 },
    killY: 22,
    play: { minX: minX - 6, maxX: maxX + 6, minZ: minZ - 8, maxZ: maxZ + 8 },
  };
}

export function courseSolids(course: Course): Solid[] {
  const solids: Solid[] = [];
  let id = 1;
  for (const b of course.boxes) {
    if (!b.solid || b.rotY) continue;
    solids.push({
      id: id++,
      minX: b.x - b.w / 2,
      maxX: b.x + b.w / 2,
      minY: b.y - b.h / 2,
      maxY: b.y + b.h / 2,
      minZ: b.z - b.d / 2,
      maxZ: b.z + b.d / 2,
      vaultable: !!b.vaultable,
      wallRun: !!b.wallRun,
    });
  }
  return solids;
}
