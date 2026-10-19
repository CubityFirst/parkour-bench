import {
  F_WALLRUN,
  HW,
  SLIDE_H,
  STAND_H,
  VAULT_DUR,
  MANTLE_DUR,
  WALL_JUMP_OUT,
  WALL_JUMP_UP,
  WALL_MAX_TIME,
  WALL_MIN_SPEED,
  WALL_PROBE,
  WALL_SINK,
  clamp,
  lerp,
} from "../core/constants";
import {
  alongsideWall,
  faceNormal,
  gapToWall,
  type AABB,
  type CollisionWorld,
} from "../world/CollisionWorld";
import { type PlayerInput, type PlayerState, type StepEvents } from "./types";

interface Hurdle {
  box: AABB;
  fx: number;
  fz: number;
}

/** A low obstacle directly ahead that can be vaulted, not a building face. */
export function findHurdle(s: PlayerState, input: PlayerInput, world: CollisionWorld): Hurdle | null {
  const dir = forwardDir(s, input);
  if (!dir) return null;
  const reach = 1.15;
  let best: AABB | null = null;
  let bestAlong = reach;
  for (const b of world.boxes) {
    const top = b.maxY - s.y;
    if (top < 0.34 || top > 1.16) continue;
    const tall = b.maxY - b.minY;
    if (tall > 1.45 && b.minY < s.y - 0.25) continue;
    if (b.minY > s.y + 0.4) continue;
    const cx = clamp(s.x, b.minX, b.maxX);
    const cz = clamp(s.z, b.minZ, b.maxZ);
    const ox = cx - s.x;
    const oz = cz - s.z;
    const along = ox * dir.x + oz * dir.z;
    if (along < 0.02 || along > reach) continue;
    const lat = Math.abs(ox * -dir.z + oz * dir.x);
    if (lat > HW + 0.45) continue;
    if (along < bestAlong) {
      bestAlong = along;
      best = b;
    }
  }
  if (!best) return null;
  return { box: best, fx: dir.x, fz: dir.z };
}

export function ceilingAhead(s: PlayerState, input: PlayerInput, world: CollisionWorld): boolean {
  const dir = forwardDir(s, input);
  if (!dir) return false;
  for (const dist of [0.7, 1.4, 2.2]) {
    const x = s.x + dir.x * dist;
    const z = s.z + dir.z * dist;
    const blockedStand = world.overlaps(x, s.y, z, HW, STAND_H) !== null;
    const blockedSlide = world.overlaps(x, s.y, z, HW, SLIDE_H + 0.04) !== null;
    if (blockedStand && !blockedSlide) return true;
  }
  return false;
}

export function tryStartVault(
  s: PlayerState,
  input: PlayerInput,
  world: CollisionWorld,
  ev: StepEvents,
): boolean {
  if (s.mode === "wallrun" || s.mode === "vault" || s.mode === "mantle") return false;
  const hurdle = findHurdle(s, input, world);
  if (!hurdle) return false;
  const b = hurdle.box;
  const midX = (b.minX + b.maxX) / 2;
  const midZ = (b.minZ + b.maxZ) / 2;
  const halfAlong = Math.abs(hurdle.fx) * (b.maxX - b.minX) * 0.5 + Math.abs(hurdle.fz) * (b.maxZ - b.minZ) * 0.5;
  const centerAlong = (midX - s.x) * hurdle.fx + (midZ - s.z) * hurdle.fz;
  const endDist = centerAlong + halfAlong + HW + 0.3;
  const ex = s.x + hurdle.fx * endDist;
  const ez = s.z + hurdle.fz * endDist;
  const floor = world.surfaceBelow(ex, ez, b.maxY + 0.5, 2.2);
  const ey = (floor ?? s.y) + 0.02;
  const landH = world.overlaps(ex, ey, ez, HW, STAND_H) ? SLIDE_H : STAND_H;
  if (world.overlaps(ex, ey, ez, HW, landH)) return false;

  const sp = Math.max(Math.hypot(s.vx, s.vz), 8.2);
  s.mode = "vault";
  s.scriptT = 0;
  s.scriptDur = VAULT_DUR;
  s.s0x = s.x;
  s.s0y = s.y;
  s.s0z = s.z;
  s.s1x = ex;
  s.s1y = ey;
  s.s1z = ez;
  s.sArc = Math.max(0.22, b.maxY - s.y + 0.16);
  s.sVx = hurdle.fx * sp;
  s.sVz = hurdle.fz * sp;
  s.height = SLIDE_H;
  s.grounded = false;
  ev.vault = true;
  return true;
}

export function tryMantle(s: PlayerState, input: PlayerInput, world: CollisionWorld, ev: StepEvents): boolean {
  if (s.grounded || s.mode !== "air" || s.vy < -8.5) return false;
  const dir = forwardDir(s, input);
  if (!dir) return false;
  // Already rising clear of the ledge: let the jump land.
  const hit = probeFacade(world, s, dir.x, dir.z);
  if (!hit) return false;
  const top = hit.box.maxY;
  const reach = top - s.y;
  if (reach < 0.85 || reach > 1.72) return false;
  if ((hit.box.flags & F_WALLRUN) !== 0) return false;
  if (s.vy > 1.5 && s.y + s.vy * 0.18 > top - 0.05) return false;

  const dist = hit.dist + HW + 0.34;
  const lx = s.x + dir.x * dist;
  const lz = s.z + dir.z * dist;
  const floor = world.surfaceBelow(lx, lz, top + 0.15, 0.6);
  if (floor === null || floor < top - 0.2) return false;
  if (world.overlaps(lx, top + 0.03, lz, HW, STAND_H)) return false;

  const sp = Math.max(4.2, Math.hypot(s.vx, s.vz) * 0.62);
  s.mode = "mantle";
  s.scriptT = 0;
  s.scriptDur = MANTLE_DUR;
  s.s0x = s.x;
  s.s0y = s.y;
  s.s0z = s.z;
  s.s1x = lx;
  s.s1y = top + 0.02;
  s.s1z = lz;
  s.sArc = 0.08;
  s.sVx = dir.x * sp;
  s.sVz = dir.z * sp;
  s.grounded = false;
  ev.mantle = true;
  return true;
}

export function advanceScript(s: PlayerState, world: CollisionWorld, dt: number, _ev: StepEvents): void {
  s.scriptT += dt;
  const p = clamp(s.scriptT / Math.max(0.05, s.scriptDur), 0, 1);
  const ease = p * p * (3 - 2 * p);
  if (s.mode === "mantle") {
    if (p < 0.58) {
      const u = p / 0.58;
      const su = u * u * (3 - 2 * u);
      s.x = s.s0x;
      s.z = s.s0z;
      s.y = lerp(s.s0y, s.s1y + 0.05, su);
    } else {
      const u = (p - 0.58) / 0.42;
      s.y = s.s1y;
      s.x = lerp(s.s0x, s.s1x, u);
      s.z = lerp(s.s0z, s.s1z, u);
    }
  } else {
    s.x = lerp(s.s0x, s.s1x, ease);
    s.z = lerp(s.s0z, s.s1z, ease);
    s.y = lerp(s.s0y, s.s1y, ease) + Math.sin(p * Math.PI) * s.sArc;
  }
  s.vaultBlend = Math.sin(Math.min(1, p) * Math.PI);
  s.vx = s.sVx;
  s.vz = s.sVz;
  s.vy = 0;
  s.speed = Math.hypot(s.vx, s.vz);

  if (world.overlaps(s.x, s.y, s.z, HW, s.height)) {
    s.y += 0.18;
    if (world.overlaps(s.x, s.y, s.z, HW, s.height)) {
      s.mode = "air";
      s.vy = 3.5;
      s.vaultBlend = 0;
      return;
    }
  }

  if (p >= 1) {
    const floor = world.surfaceBelow(s.x, s.z, s.s1y + 0.4, 1.2);
    s.y = (floor ?? s.s1y) + 0.02;
    s.vx = s.sVx;
    s.vz = s.sVz;
    s.vy = 0;
    s.height = world.overlaps(s.x, s.y, s.z, HW, STAND_H) ? SLIDE_H : STAND_H;
    s.mode = s.height < STAND_H - 0.05 ? "crouch" : "ground";
    s.grounded = true;
    s.coyote = 0.13;
    s.vaultBlend = 0;
    s.jumpLatched = false;
  }
}

export function tryStartWall(
  s: PlayerState,
  _input: PlayerInput,
  world: CollisionWorld,
  ev: StepEvents,
): boolean {
  if (s.mode !== "air" || s.grounded || s.wallCd > 0) return false;
  if (s.airWall > WALL_MAX_TIME) return false;
  const sp = Math.hypot(s.vx, s.vz);
  if (sp < WALL_MIN_SPEED) return false;
  const fx = s.vx / sp;
  const fz = s.vz / sp;
  // right = forward × up. For forward (fx, 0, fz), right = (−fz, 0, fx).
  // Check: forward (0,0,−1) → right (1, 0, 0).
  const sides = [
    { x: -fz, z: fx, side: 1 },
    { x: fz, z: -fx, side: -1 },
  ];
  for (const side of sides) {
    const hit = probeRunnable(world, s, side.x, side.z);
    if (!hit) continue;
    if (hit.box.id === s.banWall) continue;
    const into = s.vx * hit.nx + s.vz * hit.nz;
    if (into > 1.5) continue;
    const tx = -hit.nz;
    const tz = hit.nx;
    const along = Math.abs(tx * s.vx + tz * s.vz);
    if (along < 4.6) continue;

    s.mode = "wallrun";
    s.wallId = hit.box.id;
    s.wallNx = hit.nx;
    s.wallNz = hit.nz;
    s.wallSide = side.side;
    s.wallT = 0;
    s.grounded = false;
    s.coyote = 0;
    const floor = world.surfaceBelow(s.x, s.z, s.y + 0.5, 3);
    s.wallBaseY = floor ?? s.y - 0.4;
    if (s.vy < 0) s.vy = Math.max(s.vy, -0.4);
    s.wallJumpLock = true;
    s.jumpBuffer = 0;
    ev.wallOn = true;
    return true;
  }
  return false;
}

export function stepWallRun(
  s: PlayerState,
  input: PlayerInput,
  world: CollisionWorld,
  dt: number,
  ev: StepEvents,
): void {
  s.wallT += dt;
  s.airWall += dt;
  const sp = Math.max(Math.hypot(s.vx, s.vz), 8.4);
  let tx = -s.wallNz;
  let tz = s.wallNx;
  if (tx * s.vx + tz * s.vz < 0) {
    tx = -tx;
    tz = -tz;
  }
  s.vx = tx * sp;
  s.vz = tz * sp;
  s.vy = -WALL_SINK;
  s.prompt = "wall";
  s.grounded = false;

  if (!input.jumpHeld) s.wallJumpLock = false;
  if (input.jumpHeld && !s.wallJumpLock && s.wallT > 0.16) {
    launchOffWall(s, ev);
    return;
  }
  if (s.wallT > WALL_MAX_TIME) {
    releaseWall(s, ev, 0);
    return;
  }

  const box = world.boxById(s.wallId);
  if (!box || !alongsideWall(s.x, s.z, box, s.wallNx, s.wallNz)) {
    releaseWall(s, ev, 0);
    return;
  }
  const gap = gapToWall(s.x, s.z, HW, box, s.wallNx, s.wallNz);
  if (gap > WALL_PROBE || gap < -0.45) {
    releaseWall(s, ev, 0);
    return;
  }
  const corr = gap - 0.03;
  s.x -= s.wallNx * corr;
  s.z -= s.wallNz * corr;

  const floor = world.surfaceBelow(s.x, s.z, s.y + 0.25, 4.2);
  if (
    s.wallT > 0.32 &&
    floor !== null &&
    floor < s.wallBaseY - 0.65 &&
    s.y - floor > 0.12 &&
    s.y - floor < 4.1
  ) {
    releaseWall(s, ev, 2.4);
  }
}

export function launchOffWall(s: PlayerState, ev: StepEvents): void {
  const sp = Math.max(Math.hypot(s.vx, s.vz), 8);
  let tx = -s.wallNz;
  let tz = s.wallNx;
  if (tx * s.vx + tz * s.vz < 0) {
    tx = -tx;
    tz = -tz;
  }
  s.vx = tx * sp + s.wallNx * WALL_JUMP_OUT;
  s.vz = tz * sp + s.wallNz * WALL_JUMP_OUT;
  s.vy = WALL_JUMP_UP;
  releaseWall(s, ev, s.vy);
  s.jumpBuffer = 0;
  s.jumpLatched = true;
  s.jumpCut = false;
  s.jumpAir = 0;
  ev.jump = true;
}

function releaseWall(s: PlayerState, ev: StepEvents, popVy: number): void {
  s.banWall = s.wallId;
  s.wallCd = 0.28;
  s.mode = "air";
  s.grounded = false;
  s.coyote = 0;
  s.wallId = 0;
  if (popVy !== 0) s.vy = popVy;
  ev.wallOff = true;
  s.prompt = null;
}

function probeRunnable(
  world: CollisionWorld,
  s: PlayerState,
  dx: number,
  dz: number,
): { box: AABB; nx: number; nz: number } | null {
  const dist = HW + 0.62;
  const sampleY = [0.45, 1.05, 1.55];
  let found: AABB | null = null;
  for (const h of sampleY) {
    const box = world.overlaps(s.x + dx * dist, s.y + h, s.z + dz * dist, 0.1, 0.22);
    if (!box || (box.flags & F_WALLRUN) === 0) continue;
    found = box;
    break;
  }
  if (!found) return null;
  const n = faceNormal(s.x, s.z, found);
  return { box: found, nx: n.x, nz: n.z };
}

function probeFacade(
  world: CollisionWorld,
  s: PlayerState,
  fx: number,
  fz: number,
): { box: AABB; dist: number } | null {
  const steps = 8;
  const maxDist = 0.72;
  for (let i = 1; i <= steps; i++) {
    const d = (i / steps) * maxDist;
    const box = world.overlaps(s.x + fx * d, s.y + 0.25, s.z + fz * d, HW, 1.15);
    if (!box) continue;
    if (box.maxY < s.y + 0.8) continue;
    return { box, dist: Math.max(0, d - maxDist / steps) };
  }
  return null;
}

function forwardDir(s: PlayerState, input: PlayerInput): { x: number; z: number } | null {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp > 1.4) return { x: s.vx / sp, z: s.vz / sp };
  const wish = Math.hypot(input.wishX, input.wishZ);
  if (wish > 0.2) return { x: input.wishX / wish, z: input.wishZ / wish };
  return null;
}
