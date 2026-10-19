import { F_SOLID, F_WALLRUN, LOOK_YAW } from "../core/constants";
import { type AABB, CollisionWorld } from "./CollisionWorld";

export type MatId = "concrete" | "glass" | "red" | "white" | "metal" | "vent" | "dark";

export interface Solid {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  mat: MatId;
  flags: number;
}

export interface Decor {
  kind: "box" | "flag" | "billboard";
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  mat: MatId | "flag" | "banner";
  text?: string;
  phase?: number;
}

export interface Platform {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  toNext: "jump" | "wall" | "end";
  /** Which long edges grow a railing. "min" means only the −Z edge. */
  rails: "both" | "min" | "max" | "none";
  railH: number;
  wallFaceZ?: number;
}

export interface Checkpoint {
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface HintVol {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  text: string;
}

export interface LevelSpec {
  platforms: Platform[];
  solids: Solid[];
  decor: Decor[];
  checkpoints: Checkpoint[];
  hints: HintVol[];
  slideZones: { x0: number; x1: number; z: number }[];
  vaults: { x: number; z: number; reach: number }[];
  finish: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  start: { x: number; y: number; z: number; yaw: number };
}

export function buildLevelSpec(): LevelSpec {
  const solids: Solid[] = [];
  const decor: Decor[] = [];

  const platforms: Platform[] = [
    plat("start", -2, 34, -12, 12, 0, "jump", "both", 0.48),
    plat("s1b", 38.5, 56, -8, 8, 0, "jump", "both", 0.46),
    plat("s2a", 60.8, 74, -7, 7, 0.3, "jump", "both", 0.42),
    plat("s2b", 79.4, 93, -7, 8, -0.2, "jump", "both", 0.42),
    plat("s2c", 97.6, 111, -5, 5, 0.35, "jump", "both", 0.42),
    plat("s2d", 116.2, 132, -8, 7, -0.9, "jump", "both", 0.42),
    plat("bridge", 135.6, 152, -1.2, 1.2, -0.9, "jump", "both", 0.82),
    plat("slide", 156.4, 218, -9, 9, 0, "jump", "both", 0.46),
    // Wall face sits just past +Z. Landing z covers the line the body runs on.
    plat("approach", 222.6, 236, -3.2, 5.45, 0, "wall", "min", 0.5),
    plat("wland", 250, 276, -2.2, 5.55, -1.3, "jump", "min", 0.42),
    plat("combo", 280.5, 308, -2, 8, -0.45, "jump", "both", 0.42),
    plat("combo2", 312.6, 326, -1, 7.55, -0.45, "wall", "min", 0.42),
    plat("land2", 340, 362, -0.4, 7.7, -1.7, "jump", "min", 0.42),
    plat("low", 366.4, 382, -5, 5, -0.55, "jump", "both", 0.4),
    plat("f1", 387, 400, -6, 6, -1.45, "jump", "both", 0.38),
    plat("f2", 405.2, 418, -6, 6, -2.55, "jump", "both", 0.38),
    plat("f3", 423.2, 436, -7, 7, -3.75, "jump", "both", 0.38),
    plat("finish", 441.4, 464, -9, 9, -5.05, "end", "both", 0.48),
  ];

  const byId = new Map(platforms.map((p) => [p.id, p]));
  for (const p of platforms) addBuilding(solids, p);
  for (const p of platforms) {
    if (p.toNext === "jump") addTakeoffStrip(decor, p);
  }

  // Designated wall-run faces. Face Z is the plane the player sticks to.
  byId.get("approach")!.wallFaceZ = 5.72;
  byId.get("combo2")!.wallFaceZ = 7.92;
  addWall(solids, decor, byId.get("approach")!, byId.get("wland")!, 5.72);
  addWall(solids, decor, byId.get("combo2")!, byId.get("land2")!, 7.92);

  // --- Section 1: vault, then a friendly gap, then a slide the player can learn ---
  addObstacle(solids, 15.2, 0, 0, 1.15, 0.86, 3.6, "red", F_SOLID);
  addDuct(solids, decor, byId.get("s1b")!, 44, 50.5, 1.08, false);
  scatterStartProps(solids, decor, byId.get("start")!);

  // --- Section 3: two full-width ducts. No way around. ---
  addDuct(solids, decor, byId.get("slide")!, 168, 182, 1.05, true);
  addDuct(solids, decor, byId.get("slide")!, 192, 206, 1.02, true);
  addVentClusters(solids, byId.get("slide")!);

  // --- Section 5: vault then a duct, then the second wall ---
  addObstacle(solids, 288.2, -0.45, 3, 1.15, 0.9, 8.6, "red", F_SOLID);
  addDuct(solids, decor, byId.get("combo")!, 296.5, 304.5, 1.04, true);

  addChevrons(decor, byId.get("approach")!, 1);
  addChevrons(decor, byId.get("combo2")!, 1);

  addFlags(decor, platforms);
  addFinishArch(solids, decor, byId.get("finish")!);
  addCheckpointMarkers(decor, platforms);

  const checkpoints: Checkpoint[] = [
    cp(0, byId.get("start")!, 5, 0),
    cp(1, byId.get("s1b")!, 52.5, 0),
    cp(2, byId.get("s2d")!, 124, -0.4),
    cp(3, byId.get("slide")!, 211, 0),
    cp(4, byId.get("wland")!, 262, 2.2),
    cp(5, byId.get("low")!, 374, 0),
  ];

  const hints: HintVol[] = [
    hint(byId.get("start")!, 2, 12, "WASD move   ·   Shift sprint   ·   Space jump"),
    hint(byId.get("start")!, 12, 18, "E  ·  Vault the red block"),
    hint(byId.get("start")!, 28, 34, "Sprint, then jump — speed carries you"),
    hint(byId.get("s1b")!, 42, 51, "Ctrl  ·  Slide under the vent"),
    hint(byId.get("approach")!, 224, 236, "Jump onto the red wall and ride it"),
    hint(byId.get("combo")!, 284, 296, "Vault, then slide — keep your speed"),
    hint(byId.get("combo2")!, 314, 326, "Ride the red wall to the next roof"),
    hint(byId.get("f1")!, 387, 400, "Final stretch — don't slow down"),
  ];

  const slideZones = [
    { x0: 42.6, x1: 51, z: 0 },
    { x0: 166.2, x1: 183, z: 0 },
    { x0: 190.2, x1: 207, z: 0 },
    { x0: 294.8, x1: 305.2, z: 3 },
  ];
  const vaults = [
    { x: 15.2, z: 0, reach: 1.45 },
    { x: 288.2, z: 3, reach: 1.6 },
  ];

  const fin = byId.get("finish")!;
  const finish = {
    minX: 452,
    maxX: 455.5,
    minY: fin.y - 0.2,
    maxY: fin.y + 3.2,
    minZ: fin.z0,
    maxZ: fin.z1,
  };

  return {
    platforms,
    solids,
    decor,
    checkpoints,
    hints,
    slideZones,
    vaults,
    finish,
    start: { x: 4.5, y: 0, z: 0, yaw: LOOK_YAW },
  };
}

export function buildCollisionWorld(spec: LevelSpec = buildLevelSpec()): CollisionWorld {
  const world = new CollisionWorld();
  spec.solids.forEach((s, i) => world.add(solidToAabb(s, i + 1)));
  return world;
}

export function solidToAabb(s: Solid, id: number): AABB {
  return {
    id,
    flags: s.flags,
    minX: s.x - s.sx / 2,
    maxX: s.x + s.sx / 2,
    minY: s.y,
    maxY: s.y + s.sy,
    minZ: s.z - s.sz / 2,
    maxZ: s.z + s.sz / 2,
  };
}

function plat(
  id: string,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  toNext: Platform["toNext"],
  rails: Platform["rails"],
  railH: number,
): Platform {
  return { id, x0, x1, z0, z1, y, toNext, rails, railH };
}

function addBuilding(solids: Solid[], p: Platform): void {
  const sx = p.x1 - p.x0;
  const sz = p.z1 - p.z0;
  const cx = (p.x0 + p.x1) / 2;
  const cz = (p.z0 + p.z1) / 2;
  const roofT = 0.45;
  const base = -36;
  solids.push(box(cx, base, cz, sx, p.y - roofT - base, sz, "glass", F_SOLID));
  solids.push(box(cx, p.y - roofT, cz, sx, roofT, sz, "concrete", F_SOLID));

  const rt = 0.16;
  const inset = 0.55;
  const railLen = Math.max(0.4, sx - inset * 2);
  if (p.rails === "both" || p.rails === "min") {
    solids.push(box(cx, p.y, p.z0 + rt / 2, railLen, p.railH, rt, "white", F_SOLID));
  }
  if (p.rails === "both" || p.rails === "max") {
    solids.push(box(cx, p.y, p.z1 - rt / 2, railLen, p.railH, rt, "white", F_SOLID));
  }
}

function addWall(solids: Solid[], decor: Decor[], approach: Platform, landing: Platform, faceZ: number): void {
  const x0 = approach.x1 - 14;
  const x1 = Math.min(landing.x1 - 2, landing.x0 + 22);
  const thickness = 1.35;
  const y0 = Math.min(approach.y, landing.y) - 10;
  const y1 = Math.max(approach.y, landing.y) + 6.2;
  solids.push(box((x0 + x1) / 2, y0, faceZ + thickness / 2, x1 - x0, y1 - y0, thickness, "red", F_WALLRUN));
  // A brighter band at run height so the route reads from the takeoff.
  decor.push({
    kind: "box",
    x: (x0 + x1) / 2,
    y: approach.y + 0.75,
    z: faceZ - 0.07,
    sx: x1 - x0 - 1,
    sy: 0.55,
    sz: 0.08,
    mat: "red",
  });
}

function addDuct(
  solids: Solid[],
  decor: Decor[],
  p: Platform,
  x0: number,
  x1: number,
  clear: number,
  fullWidth: boolean,
): void {
  const z0 = fullWidth ? p.z0 + 0.2 : -6;
  const z1 = fullWidth ? p.z1 - 0.2 : 6;
  const sy = 0.7;
  solids.push(box((x0 + x1) / 2, p.y + clear, (z0 + z1) / 2, x1 - x0, sy, z1 - z0, "vent", F_SOLID));
  decor.push({
    kind: "box",
    x: x0 + 0.12,
    y: p.y + clear - 0.02,
    z: (z0 + z1) / 2,
    sx: 0.18,
    sy: 0.08,
    sz: Math.min(4.5, z1 - z0),
    mat: "red",
  });
}

function addObstacle(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  mat: MatId,
  flags: number,
): void {
  solids.push(box(x, y, z, sx, sy, sz, mat, flags));
}

function addTakeoffStrip(decor: Decor[], p: Platform): void {
  const sz = Math.min(p.z1 - p.z0 - 0.8, 5.5);
  if (sz < 0.6) return;
  decor.push({
    kind: "box",
    x: p.x1 - 0.42,
    y: p.y + 0.02,
    z: (p.z0 + p.z1) / 2,
    sx: 0.55,
    sy: 0.025,
    sz,
    mat: "red",
  });
}

function scatterStartProps(solids: Solid[], decor: Decor[], p: Platform): void {
  solids.push(box(8.5, p.y, 7.4, 1.5, 1.05, 1.15, "metal", F_SOLID));
  solids.push(box(23.5, p.y, -7.6, 3.4, 2.5, 2.8, "white", F_SOLID));
  decor.push({
    kind: "box",
    x: 25.15,
    y: p.y + 0.35,
    z: -7.6,
    sx: 0.08,
    sy: 1.7,
    sz: 0.9,
    mat: "red",
  });
  solids.push(box(27, p.y, 6.2, 1.8, 0.9, 1.3, "metal", F_SOLID));
  decor.push({
    kind: "box",
    x: 11,
    y: p.y + 0.02,
    z: -4,
    sx: 2.4,
    sy: 0.03,
    sz: 2.4,
    mat: "metal",
  });
  decor.push({
    kind: "box",
    x: 20,
    y: p.y + 0.02,
    z: 4.5,
    sx: 3.2,
    sy: 0.03,
    sz: 1.8,
    mat: "metal",
  });
}

function addVentClusters(solids: Solid[], p: Platform): void {
  const spots = [
    { x: p.x0 + 8, z: -6.2 },
    { x: p.x0 + 22, z: 6.4 },
    { x: p.x0 + 48, z: -6.5 },
  ];
  for (const s of spots) {
    solids.push(box(s.x, p.y, s.z, 1.4, 1.15, 1.1, "metal", F_SOLID));
  }
}

function addChevrons(decor: Decor[], p: Platform, dir: number): void {
  for (let i = 0; i < 4; i++) {
    decor.push({
      kind: "box",
      x: p.x1 - 9 + i * 1.7,
      y: p.y + 0.025,
      z: p.z0 + 1.2 + i * 0.85 * dir,
      sx: 0.7,
      sy: 0.02,
      sz: 0.28,
      mat: "red",
    });
  }
}

function addFlags(decor: Decor[], platforms: Platform[]): void {
  const marks: { id: string; z: number; side: number }[] = [
    { id: "s2a", z: 1, side: 1 },
    { id: "s2b", z: 1, side: -1 },
    { id: "s2c", z: 1, side: 1 },
    { id: "s2d", z: 1, side: 1 },
    { id: "wland", z: 0.3, side: -1 },
    { id: "land2", z: 0.2, side: -1 },
    { id: "f1", z: 0, side: 1 },
    { id: "f2", z: 0, side: -1 },
    { id: "f3", z: 0, side: 1 },
  ];
  let phase = 0.4;
  for (const m of marks) {
    const p = platforms.find((q) => q.id === m.id);
    if (!p) continue;
    const z = m.side > 0 ? Math.min(p.z1 - 0.8, (p.z0 + p.z1) / 2 + 2.2) : Math.max(p.z0 + 0.8, (p.z0 + p.z1) / 2 - 2.2);
    decor.push({
      kind: "flag",
      x: p.x0 + Math.min(3.5, (p.x1 - p.x0) * 0.35),
      y: p.y,
      z: m.z === 0 ? z : p.z0 + (p.z1 - p.z0) * (0.5 + m.z * 0.15 * m.side),
      sx: 0.06,
      sy: 1.8,
      sz: 0.7,
      mat: "flag",
      phase,
    });
    phase += 0.7;
  }
}

function addFinishArch(solids: Solid[], decor: Decor[], p: Platform): void {
  const x = 453.2;
  const h = 3.6;
  solids.push(box(x, p.y, -4.3, 0.55, h, 0.55, "red", F_SOLID));
  solids.push(box(x, p.y, 4.3, 0.55, h, 0.55, "red", F_SOLID));
  decor.push({
    kind: "box",
    x,
    y: p.y + 3.15,
    z: 0,
    sx: 0.45,
    sy: 0.42,
    sz: 9.2,
    mat: "red",
  });
  decor.push({
    kind: "billboard",
    x,
    y: p.y + 3.15,
    z: 0,
    sx: 0.08,
    sy: 0.7,
    sz: 3.4,
    mat: "banner",
    text: "FINISH",
  });
}

function addCheckpointMarkers(decor: Decor[], platforms: Platform[]): void {
  const marks = [
    { id: "s1b", x: 52.5, z: 0 },
    { id: "s2d", x: 124, z: -0.4 },
    { id: "slide", x: 211, z: 0 },
    { id: "wland", x: 262, z: 2.2 },
    { id: "low", x: 374, z: 0 },
  ];
  for (const m of marks) {
    const p = platforms.find((q) => q.id === m.id)!;
    for (const side of [-1, 1]) {
      decor.push({
        kind: "box",
        x: m.x,
        y: p.y,
        z: m.z + side * 1.35,
        sx: 0.12,
        sy: 1.15,
        sz: 0.12,
        mat: "red",
      });
    }
  }
}

function cp(index: number, p: Platform, x: number, z: number): Checkpoint {
  return {
    index,
    x,
    y: p.y,
    z,
    yaw: LOOK_YAW,
    minX: x - 2.2,
    maxX: x + 2.2,
    minY: p.y - 0.4,
    maxY: p.y + 2.6,
    minZ: p.z0 + 0.3,
    maxZ: p.z1 - 0.3,
  };
}

function hint(p: Platform, x0: number, x1: number, text: string): HintVol {
  return {
    minX: x0,
    maxX: x1,
    minY: p.y - 0.5,
    maxY: p.y + 2.5,
    minZ: p.z0,
    maxZ: p.z1,
    text,
  };
}

function box(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  mat: MatId,
  flags: number,
): Solid {
  return { x, y, z, sx, sy, sz, mat, flags };
}
