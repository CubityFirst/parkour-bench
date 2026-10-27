/**
 * Procedural background city (pure data, deterministic).
 *
 * The route buildings are hand-placed in LevelData; everything else is generated here on a
 * street grid. Buildings close to the route obey height rules so the play space stays fair:
 * anything the player could fall onto is below the respawn height, and anything taller is a
 * proper tower (a wall, never a reachable roof). A downtown cluster of glass skyscrapers sits
 * north of the route so the skyline is ahead of the runner for most of the level.
 */
import type { ExtraCollider } from './buildCollision.ts';
import type { Footprint, LevelDef, Style, Vec3 } from './LevelData.ts';

export type FacadeStyle = 'facadeWhite' | 'facadeGlass' | 'facadeConcrete';

export interface CityBox {
  min: Vec3;
  max: Vec3;
  style: Style;
}

export interface CityBuilding {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  height: number;
  style: FacadeStyle;
}

export interface Billboard {
  /** Centre of the panel. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Outward facing direction in plan view. */
  nx: number;
  nz: number;
  color: 'orange' | 'blue' | 'white';
}

export interface Crane {
  x: number;
  z: number;
  baseY: number;
  height: number;
  jib: number;
  yaw: number;
}

export interface CityData {
  buildings: CityBuilding[];
  /** Small boxes: rooftop machinery, penthouses, setback tiers. */
  props: CityBox[];
  billboards: Billboard[];
  cranes: Crane[];
  colliders: ExtraCollider[];
}

/** Small, fast, seedable PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rectDistance(a: { x0: number; z0: number; x1: number; z1: number }, b: Footprint): number {
  const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1, 0);
  const dz = Math.max(b.z0 - a.z1, a.z0 - b.z1, 0);
  return Math.hypot(dx, dz);
}

const BLOCK = 72;
const STREET = 16;
const CITY_RADIUS = 1500;
const DOWNTOWN = { x: 120, z: -1000, r: 520 };
const UPTOWN = { x: 950, z: -260, r: 300 };

export function generateCity(def: LevelDef, seed = 20261027): CityData {
  const rand = mulberry32(seed);
  const range = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

  const buildings: CityBuilding[] = [];
  const props: CityBox[] = [];
  const billboards: Billboard[] = [];
  const colliders: ExtraCollider[] = [];

  const route = def.footprints;
  const b = def.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;

  const routeInfo = (r: { x0: number; z0: number; x1: number; z1: number }) => {
    let dist = Infinity;
    let top = 0;
    for (const f of route) {
      const d = rectDistance(r, f);
      if (d < dist) {
        dist = d;
        top = f.top;
      }
    }
    let lowOnly = false;
    for (const c of def.lowCorridors) {
      if (rectDistance(r, c) < 4) lowOnly = true;
    }
    return { dist, top, lowOnly };
  };

  const addBuilding = (x0: number, z0: number, x1: number, z1: number) => {
    const w = x1 - x0;
    const d = z1 - z0;
    if (w < 6 || d < 6) return;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const fromCenter = Math.hypot(mx - cx, mz - cz);
    const info = routeInfo({ x0, z0, x1, z1 });
    if (info.dist < 6) return;

    const downtown = Math.max(0, 1 - Math.hypot(mx - DOWNTOWN.x, mz - DOWNTOWN.z) / DOWNTOWN.r);
    const uptown = Math.max(0, 1 - Math.hypot(mx - UPTOWN.x, mz - UPTOWN.z) / UPTOWN.r);
    const cluster = Math.max(downtown, uptown * 0.8);

    let height: number;
    let style: FacadeStyle = pick(['facadeWhite', 'facadeWhite', 'facadeConcrete', 'facadeGlass'] as const);
    if (info.lowOnly) {
      height = range(5, 12);
    } else if (info.dist < 16) {
      // Right next to the route: below the respawn height, or a tower well above the roofs.
      if (info.dist > 10 && rand() < 0.22) {
        height = info.top + range(28, 60);
        style = rand() < 0.6 ? 'facadeGlass' : 'facadeWhite';
      } else {
        height = range(5, 13);
      }
    } else if (info.dist < 42) {
      if (rand() < 0.28) {
        height = info.top + range(24, 70);
        style = rand() < 0.55 ? 'facadeGlass' : style;
      } else {
        height = range(8, Math.max(10, info.top - 7));
      }
    } else if (cluster > 0 && rand() < 0.35 + cluster * 0.6) {
      height = 70 + cluster * range(60, 230);
      style = rand() < 0.75 ? 'facadeGlass' : 'facadeWhite';
    } else if (rand() < 0.05) {
      height = range(90, 170);
      style = rand() < 0.7 ? 'facadeGlass' : 'facadeWhite';
    } else {
      const near = fromCenter < 420;
      height = near ? range(14, 46) : range(18, 72);
    }
    height = Math.round(height * 2) / 2;
    buildings.push({ x0, z0, x1, z1, height, style });
    if (info.dist < 160) colliders.push({ min: [x0, 0, z0], max: [x1, height, z1], flags: 0 });

    // Setback tier on tall buildings.
    if (height > 60 && rand() < 0.45 && w > 14 && d > 14) {
      const ix = w * range(0.15, 0.28);
      const iz = d * range(0.15, 0.28);
      const th = height + range(8, 40);
      buildings.push({ x0: x0 + ix, z0: z0 + iz, x1: x1 - ix, z1: z1 - iz, height: th, style });
      height = th;
      if (rand() < 0.5) {
        props.push({ min: [mx - 0.5, height, mz - 0.5], max: [mx + 0.5, height + range(10, 24), mz + 0.5], style: 'grey' });
      }
    }

    // Rooftop machinery for buildings that are close enough to be seen in detail.
    if (fromCenter < 700) {
      const count = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < count; i++) {
        const pw = Math.min(w * 0.4, range(2, 6));
        const pd = Math.min(d * 0.4, range(2, 6));
        const px = range(x0 + 1, x1 - 1 - pw);
        const pz = range(z0 + 1, z1 - 1 - pd);
        const ph = rand() < 0.3 ? range(2.5, 4) : range(0.8, 1.8);
        props.push({ min: [px, height, pz], max: [px + pw, height + ph, pz + pd], style: rand() < 0.7 ? 'white' : 'grey' });
      }
      // Parapet ring.
      if (rand() < 0.6) {
        const t = 0.3;
        const ph = 0.7;
        props.push({ min: [x0, height, z0], max: [x1, height + ph, z0 + t], style: 'white' });
        props.push({ min: [x0, height, z1 - t], max: [x1, height + ph, z1], style: 'white' });
        props.push({ min: [x0, height, z0 + t], max: [x0 + t, height + ph, z1 - t], style: 'white' });
        props.push({ min: [x1 - t, height, z0 + t], max: [x1, height + ph, z1 - t], style: 'white' });
      }
    }

    // Occasional billboard near the top of a facade.
    if (fromCenter < 650 && height > 18 && rand() < 0.16) {
      const side = Math.floor(rand() * 4);
      const color = pick(['orange', 'orange', 'blue', 'white'] as const);
      const bh = Math.min(9, height * 0.25);
      const y = height - bh / 2 - range(1, 4);
      if (side < 2) {
        const bw = Math.min(w * 0.7, 18);
        billboards.push({ x: mx, y, z: side === 0 ? z1 + 0.35 : z0 - 0.35, w: bw, h: bh, nx: 0, nz: side === 0 ? 1 : -1, color });
      } else {
        const bw = Math.min(d * 0.7, 18);
        billboards.push({ x: side === 2 ? x1 + 0.35 : x0 - 0.35, y, z: mz, w: bw, h: bh, nx: side === 2 ? 1 : -1, nz: 0, color });
      }
    }
  };

  const gx0 = Math.floor((cx - CITY_RADIUS) / BLOCK);
  const gx1 = Math.ceil((cx + CITY_RADIUS) / BLOCK);
  const gz0 = Math.floor((cz - CITY_RADIUS) / BLOCK);
  const gz1 = Math.ceil((cz + CITY_RADIUS) / BLOCK);
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const bx0 = gx * BLOCK + STREET / 2;
      const bz0 = gz * BLOCK + STREET / 2;
      const size = BLOCK - STREET;
      const mx = bx0 + size / 2;
      const mz = bz0 + size / 2;
      if (Math.hypot(mx - cx, mz - cz) > CITY_RADIUS) continue;
      if (rand() < 0.06) continue; // an open plaza now and then
      // Split the block into 1-4 lots with small gaps between buildings.
      const split = rand();
      const gap = range(2, 5);
      if (split < 0.25) {
        addBuilding(bx0, bz0, bx0 + size, bz0 + size);
      } else if (split < 0.55) {
        const s = size * range(0.35, 0.65);
        if (rand() < 0.5) {
          addBuilding(bx0, bz0, bx0 + s - gap / 2, bz0 + size);
          addBuilding(bx0 + s + gap / 2, bz0, bx0 + size, bz0 + size);
        } else {
          addBuilding(bx0, bz0, bx0 + size, bz0 + s - gap / 2);
          addBuilding(bx0, bz0 + s + gap / 2, bx0 + size, bz0 + size);
        }
      } else {
        const sx = size * range(0.35, 0.65);
        const sz = size * range(0.35, 0.65);
        addBuilding(bx0, bz0, bx0 + sx - gap / 2, bz0 + sz - gap / 2);
        addBuilding(bx0 + sx + gap / 2, bz0, bx0 + size, bz0 + sz - gap / 2);
        addBuilding(bx0, bz0 + sz + gap / 2, bx0 + sx - gap / 2, bz0 + size);
        addBuilding(bx0 + sx + gap / 2, bz0 + sz + gap / 2, bx0 + size, bz0 + size);
      }
    }
  }

  const cranes: Crane[] = [
    { x: DOWNTOWN.x - 160, z: DOWNTOWN.z + 210, baseY: 0, height: 150, jib: 62, yaw: 0.6 },
    { x: DOWNTOWN.x + 260, z: DOWNTOWN.z + 60, baseY: 0, height: 190, jib: 70, yaw: 2.3 },
    { x: -320, z: 180, baseY: 0, height: 120, jib: 55, yaw: -0.9 },
  ];

  return { buildings, props, billboards, cranes, colliders };
}
