import { HW, clamp } from "../core/constants";
import { type CollisionWorld } from "../world/CollisionWorld";
import { type LevelSpec, type Platform } from "../world/levelSpec";
import { type PlayerInput, type PlayerState } from "./types";

export interface BotMemory {
  hold: number;
  vault: number;
  stuck: number;
  still: number;
}

export function freshBot(): BotMemory {
  return { hold: 0, vault: 0, stuck: 0, still: 0 };
}

/** A deterministic runner used to prove the route is completable. */
export function botInput(s: PlayerState, spec: LevelSpec, world: CollisionWorld, mem: BotMemory, dt: number): PlayerInput {
  const next = nextPlatform(spec, s.x);
  const wall = wallApproach(spec, s);
  let tz = next ? (next.z0 + next.z1) / 2 : s.z;
  let suppressEdge = false;
  let hop = false;

  if (wall && wall.wallFaceZ !== undefined && s.mode !== "wallrun") {
    tz = Math.min(wall.z1 - 0.36, wall.wallFaceZ - 0.5);
    suppressEdge = true;
    if (s.grounded && s.x > wall.x1 - 2.6 && s.speed > 7) hop = true;
  }

  const slide = spec.slideZones.some((z) => s.x > z.x0 && s.x < z.x1);
  if (slide) {
    const zone = spec.slideZones.find((z) => s.x > z.x0 && s.x < z.x1)!;
    tz = zone.z;
  }

  let vault = false;
  for (const v of spec.vaults) {
    if (Math.abs(s.x - v.x) < v.reach && Math.abs(s.z - v.z) < 4.5) {
      vault = true;
      tz = v.z;
    }
  }

  const dz = tz - s.z;
  let wx = 1;
  let wz = clamp(dz, -1, 1);
  if (Math.abs(dz) > 1.35) {
    wx = 0.42;
    wz = Math.sign(dz);
  }
  const m = Math.hypot(wx, wz) || 1;
  wx /= m;
  wz /= m;

  let jump = false;
  if (!suppressEdge && s.grounded && s.speed > 6.2 && !vault) {
    const fx = s.speed > 1 ? s.vx / s.speed : 1;
    const fz = s.speed > 1 ? s.vz / s.speed : 0;
    const px = s.x + fx * (HW + 0.18);
    const pz = s.z + fz * 0.05;
    const floor = world.surfaceBelow(px, pz, s.y + 0.3, 0.55);
    if (floor === null) jump = true;
  }
  if (hop) jump = true;

  if (s.grounded && s.speed < 0.45) mem.still += dt;
  else mem.still = 0;
  if (mem.still > 0.45) {
    jump = true;
    vault = true;
    mem.stuck += dt;
  }

  if (jump) mem.hold = Math.max(mem.hold, 0.2);
  if (vault) mem.vault = Math.max(mem.vault, 0.18);
  const holdJump = mem.hold > 0;
  const holdVault = mem.vault > 0;
  mem.hold = Math.max(0, mem.hold - dt);
  mem.vault = Math.max(0, mem.vault - dt);

  return {
    wishX: wx,
    wishZ: wz,
    sprint: true,
    jump: holdJump,
    jumpHeld: holdJump,
    slide: slide || s.mode === "slide",
    vault: holdVault,
  };
}

function wallApproach(spec: LevelSpec, s: PlayerState): Platform | null {
  for (let i = 0; i < spec.platforms.length; i++) {
    const p = spec.platforms[i];
    if (p.toNext !== "wall") continue;
    const landing = spec.platforms[i + 1];
    if (!landing) continue;
    if (s.x >= p.x0 + 1 && s.x < landing.x0 + 0.4) return p;
  }
  return null;
}

function nextPlatform(spec: LevelSpec, x: number): Platform | null {
  for (const p of spec.platforms) {
    if (p.x1 >= x - 0.2) return p;
  }
  return spec.platforms[spec.platforms.length - 1] ?? null;
}
