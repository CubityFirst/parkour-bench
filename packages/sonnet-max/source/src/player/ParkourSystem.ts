import { LEDGE, PLAYER, WALL } from '../config.ts';
import { Flag, createRayHit } from '../world/CollisionWorld.ts';
import type { Collider, CollisionWorld } from '../world/CollisionWorld.ts';
import type { PlayerBody } from './PlayerPhysics.ts';

/** Result of a wall probe. Normals point from the wall toward the player. */
export interface WallContact {
  collider: Collider;
  /** -1 = wall on the player's left, +1 = right (relative to travel direction). */
  side: -1 | 1;
  nx: number;
  nz: number;
  /** Unit tangent along the wall in the direction of travel. */
  tx: number;
  tz: number;
  /** Gap between the player's flank and the wall surface. */
  gap: number;
}

export type ScriptedKind = 'vault' | 'mantle';

const smooth = (u: number) => u * u * (3 - 2 * u);
const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);

/**
 * A fully pre-validated, collision-free motion that carries the player over an obstacle (vault)
 * or up onto a ledge (mantle). While it plays the body is placed directly on the curve, so the
 * move cannot clip or tunnel regardless of frame rate.
 */
export class ScriptedMove {
  readonly kind: ScriptedKind;
  readonly target: Collider;
  readonly dirX: number;
  readonly dirZ: number;
  readonly duration: number;
  readonly exitSpeed: number;
  /** Feet height at the start / end of the curve. */
  readonly startY: number;
  readonly endY: number;
  /** Height of the obstacle top above the start (drives camera animation). */
  readonly rise: number;
  /** True when the end pose only has crouch headroom. */
  endCrouched = false;
  t = 0;

  private readonly sx: number;
  private readonly sz: number;
  /** Horizontal travel (m) along dir at the moment the body touches the near face (mantle). */
  private readonly approach: number;
  /** Total horizontal travel along dir. */
  private readonly length: number;
  private readonly topY: number;

  constructor(
    kind: ScriptedKind,
    target: Collider,
    sx: number,
    sy: number,
    sz: number,
    dirX: number,
    dirZ: number,
    approach: number,
    length: number,
    topY: number,
    duration: number,
    exitSpeed: number,
  ) {
    this.kind = kind;
    this.target = target;
    this.sx = sx;
    this.sz = sz;
    this.startY = sy;
    this.dirX = dirX;
    this.dirZ = dirZ;
    this.approach = approach;
    this.length = length;
    this.topY = topY;
    this.duration = duration;
    this.exitSpeed = exitSpeed;
    this.rise = topY - sy;
    this.endY = topY + (kind === 'vault' ? 0.04 : 0);
  }

  get progress(): number {
    return Math.min(1, this.t / this.duration);
  }

  /** Evaluate the feet position at normalised time `u` (0..1). */
  sample(u: number, out: { x: number; y: number; z: number }): void {
    let s: number;
    let y: number;
    if (this.kind === 'vault') {
      // Constant forward speed (momentum is preserved); height eases up before the near face,
      // hops over the top, and hands back to gravity at the far side.
      s = this.length * u;
      const riseDist = Math.max(0.5, Math.min(this.approach + 0.15, this.length * 0.45));
      const k = easeOutCubic(Math.min(1, s / riseDist));
      const base = this.startY + (this.topY + 0.05 - this.startY) * k;
      const hopU = Math.max(0, (s - riseDist) / Math.max(0.01, this.length - riseDist));
      y = base + 0.1 * Math.sin(Math.PI * Math.min(1, hopU));
    } else {
      // Mantle: haul up the face, then press forward onto the surface.
      const split = 0.58;
      if (u < split) {
        const k = smooth(u / split);
        s = this.approach * Math.min(1, (u / split) * 2.2);
        y = this.startY + (this.topY + 0.02 - this.startY) * k;
      } else {
        const k = smooth((u - split) / (1 - split));
        s = this.approach + (this.length - this.approach) * k;
        y = this.topY + 0.02 - 0.02 * k;
      }
    }
    out.x = this.sx + this.dirX * s;
    out.z = this.sz + this.dirZ * s;
    out.y = y;
  }
}

interface LedgeCandidate {
  collider: Collider;
  near: number;
  far: number;
  floating: boolean;
}

const scratchPos = { x: 0, y: 0, z: 0 };

/**
 * Stateless detection helpers for wall-running, vaulting and mantling.
 * The PlayerController owns the state machine and decides when to call them.
 */
export class ParkourSystem {
  private readonly world: CollisionWorld;
  private readonly overlaps: Collider[] = [];
  private readonly pathScratch: Collider[] = [];
  private readonly candidates: LedgeCandidate[] = [];
  private readonly ray = createRayHit();

  constructor(world: CollisionWorld) {
    this.world = world;
  }

  // -------------------------------------------------------------------------------------------
  // Wall running
  // -------------------------------------------------------------------------------------------

  /**
   * Looks for a runnable wall alongside the player.
   * `vdx/vdz` is the unit travel direction; `reach` is the max gap between the player's flank and the wall.
   */
  findWall(
    b: PlayerBody,
    vdx: number,
    vdz: number,
    reach: number,
    ignore: Collider | null,
    requireApproach: boolean,
  ): WallContact | null {
    const hw = PLAYER.halfWidth;
    const y0 = b.y + 0.35;
    const y1 = b.y + Math.max(0.9, b.height - 0.2);
    let best: WallContact | null = null;

    for (let axis = 0; axis < 2; axis++) {
      for (let sign = -1; sign <= 1; sign += 2) {
        // Direction from the player toward the wall.
        const dx = axis === 0 ? sign : 0;
        const dz = axis === 1 ? sign : 0;
        const approach = vdx * dx + vdz * dz; // >0: moving toward the wall
        if (requireApproach) {
          if (approach > WALL.maxApproach) continue;
          if (approach < -0.3) continue;
        }

        let minX: number, maxX: number, minZ: number, maxZ: number;
        if (axis === 0) {
          minX = sign > 0 ? b.x + hw : b.x - hw - reach;
          maxX = sign > 0 ? b.x + hw + reach : b.x - hw;
          minZ = b.z - hw * 0.7;
          maxZ = b.z + hw * 0.7;
        } else {
          minZ = sign > 0 ? b.z + hw : b.z - hw - reach;
          maxZ = sign > 0 ? b.z + hw + reach : b.z - hw;
          minX = b.x - hw * 0.7;
          maxX = b.x + hw * 0.7;
        }
        const list = this.overlaps;
        list.length = 0;
        this.world.collectOverlaps(minX, y0, minZ, maxX, y1, maxZ, list);
        for (const c of list) {
          if ((c.flags & Flag.WallRun) === 0 || c === ignore) continue;
          // The runnable face must actually face the player (not the far side of a thick panel).
          let gap: number;
          if (axis === 0) gap = sign > 0 ? c.minX - (b.x + hw) : b.x - hw - c.maxX;
          else gap = sign > 0 ? c.minZ - (b.z + hw) : b.z - hw - c.maxZ;
          if (gap < -0.05) continue;
          if (best && gap >= best.gap) continue;

          const nx = -dx;
          const nz = -dz;
          // Tangent along the wall, aligned with travel direction.
          let tx = -nz;
          let tz = nx;
          if (tx * vdx + tz * vdz < 0) {
            tx = -tx;
            tz = -tz;
          }
          // Side: right-hand vector of the travel direction is (-vdz, vdx).
          const side: -1 | 1 = dx * -vdz + dz * vdx > 0 ? 1 : -1;
          best = { collider: c, side, nx, nz, tx, tz, gap };
        }
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Vaulting and mantling
  // -------------------------------------------------------------------------------------------

  /**
   * Finds a vault or mantle in front of the player and returns a validated motion, or null.
   * `grounded` selects the rise limits; `allowVault` enables low-obstacle vaults.
   */
  findLedge(
    b: PlayerBody,
    fx: number,
    fz: number,
    speed: number,
    grounded: boolean,
    allowVault: boolean,
    allowMantle: boolean,
    /** Speed used to size the probe distance (defaults to `speed`); lets callers ask for a short reach. */
    reachSpeed: number = speed,
  ): ScriptedMove | null {
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) return null;
    const dx = fx / len;
    const dz = fz / len;
    const hw = PLAYER.halfWidth;
    const reach = LEDGE.reachBase + LEDGE.reachPerSpeed * Math.min(reachSpeed, 10);
    const maxDist = hw + reach;
    const maxRise = grounded ? LEDGE.mantleMaxRiseGround : LEDGE.mantleMaxRiseAir;

    // Probe volume: bounding box of the swept body plus the vertical band that matters.
    const ex = b.x + dx * maxDist;
    const ez = b.z + dz * maxDist;
    const list = this.overlaps;
    list.length = 0;
    this.world.collectOverlaps(
      Math.min(b.x, ex) - hw,
      b.y + 0.2,
      Math.min(b.z, ez) - hw,
      Math.max(b.x, ex) + hw,
      b.y + maxRise + 0.05,
      Math.max(b.z, ez) + hw,
      list,
    );
    if (list.length === 0) return null;

    // Perpendicular offsets so the probe is as wide as the body.
    const px = -dz;
    const pz = dx;
    const cands = this.candidates;
    cands.length = 0;
    for (const c of list) {
      if (c.flags & Flag.NoGrab) continue;
      const rise = c.maxY - b.y;
      if (rise < Math.min(LEDGE.vaultMinRise, LEDGE.mantleMinRise) - 1e-6 || rise > maxRise) continue;
      // Floating blocks (ducts hung above the floor) are slid under, never vaulted.
      const floating = c.minY > b.y + 0.7;
      let near = Infinity;
      let far = -Infinity;
      for (let k = -1; k <= 1; k++) {
        const ox = b.x + px * k * 0.22;
        const oz = b.z + pz * k * 0.22;
        if (!this.rayXZ(ox, oz, dx, dz, c)) continue;
        if (this.ray.t > maxDist) continue;
        if (this.ray.t < near) near = this.ray.t;
        if (this.ray.tExit > far) far = this.ray.tExit;
      }
      if (near === Infinity) continue;
      // Already standing over/in it - nothing to climb.
      if (near <= 1e-4) continue;
      cands.push({ collider: c, near, far, floating });
    }
    if (cands.length === 0) return null;
    cands.sort((a, b2) => a.near - b2.near);

    for (const cand of cands) {
      const c = cand.collider;
      const rise = c.maxY - b.y;
      const depth = cand.far - cand.near;
      const vaultable =
        allowVault &&
        !cand.floating &&
        rise >= LEDGE.vaultMinRise &&
        rise <= LEDGE.vaultMaxRise &&
        depth <= LEDGE.vaultMaxDepth;
      let kind: ScriptedKind | null = null;
      if (vaultable) kind = 'vault';
      else if (allowMantle && rise >= LEDGE.mantleMinRise && depth >= LEDGE.mantleMinDepth) kind = 'mantle';
      if (!kind) continue;

      const move = this.plan(b, kind, c, dx, dz, cand.near, cand.far, speed);
      if (move) return move;
    }
    return null;
  }

  private plan(
    b: PlayerBody,
    kind: ScriptedKind,
    c: Collider,
    dx: number,
    dz: number,
    near: number,
    far: number,
    speed: number,
  ): ScriptedMove | null {
    const hw = PLAYER.halfWidth;
    const top = c.maxY;
    const approach = Math.max(0, near - hw - 0.03);
    let length: number;
    let duration: number;
    let exitSpeed: number;

    if (kind === 'vault') {
      length = far + hw + 0.14;
      const v = Math.max(speed, LEDGE.vaultSpeedMin);
      duration = Math.min(0.62, Math.max(0.3, length / v));
      exitSpeed = Math.max(speed * 0.98, LEDGE.vaultSpeedMin);
    } else {
      const depth = far - near;
      const stand = Math.min(0.5, depth * 0.5);
      length = near + stand;
      duration = 0.44 + 0.2 * (top - b.y);
      exitSpeed = LEDGE.mantleExitSpeed;
    }

    const move = new ScriptedMove(kind, c, b.x, b.y, b.z, dx, dz, approach, length, top, duration, exitSpeed);

    // Validate: sample the curve and make sure the body never intersects anything but the target.
    const steps = 18;
    const probeHeight = kind === 'vault' ? 1.05 : 1.25;
    for (let i = 0; i <= steps; i++) {
      move.sample(i / steps, scratchPos);
      if (!this.clearOfOthers(scratchPos.x, scratchPos.y + 0.06, scratchPos.z, probeHeight, c)) return null;
    }

    // The end pose must have room to stand (vault) or at least crouch (mantle).
    move.sample(1, scratchPos);
    const hwb = PLAYER.halfWidth;
    const room = (h: number) =>
      this.world.firstOverlap(
        scratchPos.x - hwb,
        scratchPos.y + 0.002,
        scratchPos.z - hwb,
        scratchPos.x + hwb,
        scratchPos.y + h,
        scratchPos.z + hwb,
      ) === null;
    if (!room(PLAYER.standHeight)) {
      if (kind === 'mantle' && room(PLAYER.slideHeight)) move.endCrouched = true;
      else return null;
    }
    return move;
  }

  /** True if an AABB (given by feet pos + height) overlaps no collider other than `except`. */
  private clearOfOthers(x: number, y: number, z: number, height: number, except: Collider): boolean {
    const hw = PLAYER.halfWidth;
    const scratch = this.pathScratch;
    scratch.length = 0;
    this.world.collectOverlaps(x - hw, y, z - hw, x + hw, y + height, z + hw, scratch);
    for (const c of scratch) if (c !== except) return false;
    return true;
  }

  /** 2D (XZ plane) ray vs collider footprint. Fills this.ray.t / tExit. */
  private rayXZ(ox: number, oz: number, dx: number, dz: number, c: Collider): boolean {
    let tMin = 0;
    let tMax = Infinity;
    if (Math.abs(dx) < 1e-9) {
      if (ox <= c.minX || ox >= c.maxX) return false;
    } else {
      let t1 = (c.minX - ox) / dx;
      let t2 = (c.maxX - ox) / dx;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return false;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz <= c.minZ || oz >= c.maxZ) return false;
    } else {
      let t1 = (c.minZ - oz) / dz;
      let t2 = (c.maxZ - oz) / dz;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return false;
    }
    this.ray.t = tMin;
    this.ray.tExit = tMax;
    return true;
  }
}
