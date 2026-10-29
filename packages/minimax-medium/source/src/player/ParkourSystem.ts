import * as THREE from 'three';
import { CollisionWorld, type Collider } from '../world/CollisionWorld';
import { CFG, type MoveIntent, type PlayerPhysics } from './PlayerPhysics';

export interface ParkourEvents {
  onJump?: () => void;
  onLand?: (impact: number) => void;
  onSlide?: () => void;
  onVault?: () => void;
  onMantle?: () => void;
  onWallRun?: () => void;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * All of the "special" movement: sliding, wall running, vaulting and
 * ledge recovery. The plain locomotion lives in PlayerPhysics.
 */
export class ParkourSystem {
  private readonly scratch: Collider[] = [];
  private slideCooldown = 0;
  /** Set when a slide ends while the key is still held - the key has to be
   *  released before another slide can start. */
  private slideLocked = false;

  constructor(
    private readonly physics: PlayerPhysics,
    private readonly world: CollisionWorld,
    private readonly events: ParkourEvents = {}
  ) {}

  update(dt: number, intent: MoveIntent & { slidePressed: boolean; interactPressed: boolean }): void {
    const p = this.physics;

    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    // ---------------------------------------------------------- slide
    if (!intent.slideHeld) this.slideLocked = false;
    const wantSlide = intent.slidePressed || (intent.slideHeld && !this.slideLocked);
    if (
      wantSlide &&
      !p.sliding &&
      p.grounded &&
      this.slideCooldown <= 0 &&
      (p.horizontalSpeed > 3.0 || this.lowObstacleAhead())
    ) {
      p.sliding = true;
      p.slideTimer = 0;
      p.heightTarget = CFG.slideHeight;
      this.events.onSlide?.();
    }

    if (p.sliding) {
      p.slideTimer += dt;
      const released = !intent.slideHeld;
      const slow = p.horizontalSpeed < 2.2;
      const timeout = p.slideTimer > 2.2;
      // a slide always lasts at least a moment, even on a quick tap
      const tooSoon = p.slideTimer < 0.22;
      if ((released || slow || timeout) && !tooSoon && p.canStand()) {
        p.sliding = false;
        p.heightTarget = CFG.standHeight;
        this.slideCooldown = 0.18;
        if (!released) this.slideLocked = true;
        // sliding out of a slide keeps the momentum alive
        const sp = p.horizontalSpeed;
        if (sp > 5) {
          const boost = Math.min(CFG.maxSpeed, sp * 1.12);
          const k = boost / sp;
          p.velocity.x *= k;
          p.velocity.z *= k;
        }
      }
    }

    if (p.action) return;

    // ----------------------------------------------------- wall running
    this.updateWallRun(dt, intent);

    // --------------------------------------------------------- vaulting
    if (intent.interactPressed && !p.action) {
      if (this.tryVault()) return;
    }

    // ---------------------------------------------------- ledge recovery
    if (!p.grounded && !p.wallRun && intent.moving && this.tryMantle()) {
      return;
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * True when a knee-high obstacle sits right in front of the player.
   * Lets the player drop into a slide even when they have already come to a
   * stop against it.
   */
  private lowObstacleAhead(): boolean {
    const p = this.physics;
    const fwd = p.forward;
    const right = p.right;
    const pos = p.position;

    this.world.query(
      pos.x - 1.6,
      pos.y - 0.5,
      pos.z - 1.6,
      pos.x + 1.6,
      pos.y + 2,
      pos.z + 1.6,
      this.scratch
    );

    for (const c of this.scratch) {
      const topRel = c.maxY - pos.y;
      const botRel = c.minY - pos.y;
      // not enough room to get underneath it
      if (botRel < CFG.slideHeight - 0.05) continue;
      // too tall to slide through
      if (topRel > CFG.standHeight - 0.1) continue;

      const cx = clamp(pos.x, c.minX, c.maxX);
      const cz = clamp(pos.z, c.minZ, c.maxZ);
      const rx = cx - pos.x;
      const rz = cz - pos.z;
      const along = rx * fwd.x + rz * fwd.z;
      const lateral = Math.abs(rx * right.x + rz * right.z);
      if (along < -0.05 || along > 0.9) continue;
      if (lateral > 1.0) continue;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Wall run
  // ------------------------------------------------------------------
  private updateWallRun(dt: number, intent: MoveIntent): void {
    const p = this.physics;

    if (p.wallRun) {
      const wr = p.wallRun;
      wr.time += dt;
      const gap = this.gapToWall(wr.collider, wr.normal);
      if (wr.time > CFG.wallRunDuration || p.horizontalSpeed < 2.4 || gap > 1.5) {
        p.wallRun = null;
      }
      return;
    }

    if (p.grounded || p.action || p.sliding) return;
    if (p.horizontalSpeed < CFG.wallRunMinSpeed) return;
    if (intent.wish.lengthSq() < 0.01 && p.horizontalSpeed < 7) return;

    const found = this.findWallRun();
    if (found) {
      p.wallRun = found;
      this.events.onWallRun?.();
    }
  }

  /** Distance from the player surface to the wall face along its normal. */
  private gapToWall(c: Collider, normal: THREE.Vector3): number {
    const p = this.physics.position;
    const r = CFG.radius;
    if (normal.x > 0.5) return p.x - r - c.maxX;
    if (normal.x < -0.5) return c.minX - (p.x + r);
    if (normal.z > 0.5) return p.z - r - c.maxZ;
    return c.minZ - (p.z + r);
  }

  /**
   * Looks for a wall-run panel alongside the player.
   *
   * A candidate face qualifies when the player is outside it, close enough to
   * touch it, the face runs alongside the direction of travel and the panel is
   * long enough to be worth running on.
   */
  private findWallRun(): PlayerPhysics['wallRun'] | null {
    const p = this.physics;
    const pos = p.position;
    const vel = p.velocity;
    const speed = Math.hypot(vel.x, vel.z);
    if (speed < 0.001) return null;
    const vx = vel.x / speed;
    const vz = vel.z / speed;

    this.world.query(
      pos.x - 4,
      pos.y - 2,
      pos.z - 4,
      pos.x + 4,
      pos.y + 3,
      pos.z + 4,
      this.scratch
    );

    let best: {
      collider: Collider;
      nx: number;
      nz: number;
      gap: number;
      tx: number;
      tz: number;
    } | null = null;

    for (const c of this.scratch) {
      if (c.tag !== 'wallrun') continue;
      // the panel has to span the body vertically
      if (c.maxY < pos.y + 0.6 || c.minY > pos.y + 1.6) continue;

      // The four vertical faces. `gap` is the distance from the player's
      // surface to the face, `nx/nz` is the normal pointing from the face
      // towards the player, `tx/tz` is the axis the face runs along.
      const r = CFG.radius;
      const faces = [
        { nx: 1, nz: 0, gap: pos.x - r - c.maxX, tx: 0, tz: 1 },
        { nx: -1, nz: 0, gap: c.minX - (pos.x + r), tx: 0, tz: 1 },
        { nx: 0, nz: 1, gap: pos.z - r - c.maxZ, tx: 1, tz: 0 },
        { nx: 0, nz: -1, gap: c.minZ - (pos.z + r), tx: 1, tz: 0 },
      ];

      for (const f of faces) {
        if (f.gap < -0.35 || f.gap > CFG.wallRunReach) continue;

        // the player has to be alongside the face, not past its end
        const along = f.tx !== 0 ? pos.x : pos.z;
        const min = f.tx !== 0 ? c.minX : c.minZ;
        const max = f.tx !== 0 ? c.maxX : c.maxZ;
        if (along < min - 1.2 || along > max + 1.2) continue;

        // the face has to be long enough to run along
        if (max - min < 3) continue;

        // and it has to run alongside the movement, not face the player
        if (Math.abs(f.nx * vx + f.nz * vz) > 0.62) continue;

        if (!best || f.gap < best.gap) {
          best = { collider: c, nx: f.nx, nz: f.nz, gap: f.gap, tx: f.tx, tz: f.tz };
        }
      }
    }

    if (!best) return null;

    const normal = new THREE.Vector3(best.nx, 0, best.nz);
    const tangent = new THREE.Vector3(
      best.tx !== 0 ? (vx >= 0 ? 1 : -1) : 0,
      0,
      best.tz !== 0 ? (vz >= 0 ? 1 : -1) : 0
    );

    // Snap the player onto the wall face so the run feels locked in.
    // The normal points from the wall towards the player, so the player has
    // to move *against* it to close the gap.
    const pull = best.gap - 0.04;
    if (pull > 0.02) {
      const tx = pos.x - normal.x * pull;
      const tz = pos.z - normal.z * pull;
      if (p.isFree(tx, pos.y + 0.05, tz)) {
        pos.x = tx;
        pos.z = tz;
      }
    }

    return {
      collider: best.collider,
      normal,
      tangent,
      time: 0,
      speed: Math.max(p.horizontalSpeed, 5),
    };
  }

  // ------------------------------------------------------------------
  // Vault
  // ------------------------------------------------------------------
  private tryVault(): boolean {
    const p = this.physics;
    if (p.sliding) return false;
    if (!p.grounded && p.airTime > 0.25) return false;

    const fwd = p.forward;
    const right = p.right;
    const pos = p.position;

    this.world.query(
      pos.x - 2.5,
      pos.y - 1,
      pos.z - 2.5,
      pos.x + 2.5,
      pos.y + 2,
      pos.z + 2.5,
      this.scratch
    );

    let bestTop = -Infinity;
    let bestAlong = 0;
    let bestDepth = 0;
    let bestCx = 0;
    let bestCz = 0;

    for (const c of this.scratch) {
      const top = c.maxY;
      if (top <= pos.y + CFG.vaultMinHeight || top > pos.y + CFG.vaultMaxHeight) continue;
      if (c.minY > pos.y + 0.25) continue; // floating obstacle

      const cx = clamp(pos.x, c.minX, c.maxX);
      const cz = clamp(pos.z, c.minZ, c.maxZ);
      const rx = cx - pos.x;
      const rz = cz - pos.z;
      const along = rx * fwd.x + rz * fwd.z;
      const lateral = Math.abs(rx * right.x + rz * right.z);
      if (along < 0.2 || along > 1.35) continue;
      if (lateral > 0.95) continue;

      const depth = Math.abs(fwd.x) * (c.maxX - c.minX) + Math.abs(fwd.z) * (c.maxZ - c.minZ);
      if (depth > CFG.vaultMaxDepth || depth < 0.15) continue;

      if (top > bestTop) {
        bestTop = top;
        bestAlong = along;
        bestDepth = depth;
        bestCx = cx;
        bestCz = cz;
      }
    }

    if (bestTop === -Infinity) return false;

    const dist = bestAlong + bestDepth + 0.8;
    const tx = pos.x + fwd.x * dist;
    const tz = pos.z + fwd.z * dist;
    if (!p.isFree(tx, pos.y + 0.06, tz)) return false;

    const exitSpeed = Math.max(p.horizontalSpeed, 4.5);
    p.startAction({
      type: 'vault',
      t: 0,
      duration: CFG.vaultDuration + bestDepth * 0.08,
      from: pos.clone(),
      to: new THREE.Vector3(tx, pos.y, tz),
      arc: bestTop - pos.y + 0.28,
      exitSpeed,
    });
    this.events.onVault?.();
    return true;
  }

  // ------------------------------------------------------------------
  // Ledge recovery (mantle)
  // ------------------------------------------------------------------
  private tryMantle(): boolean {
    const p = this.physics;
    const fwd = p.forward;
    const right = p.right;
    const pos = p.position;

    this.world.query(
      pos.x - 2,
      pos.y - 1.5,
      pos.z - 2,
      pos.x + 2,
      pos.y + 2,
      pos.z + 2,
      this.scratch
    );

    let bestTop = -Infinity;
    let bestCx = 0;
    let bestCz = 0;
    let bestC = null as Collider | null;

    for (const c of this.scratch) {
      const top = c.maxY;
      if (top < pos.y + 0.25 || top > pos.y + CFG.mantleMaxHeight) continue;
      if (c.minY > pos.y + 0.15) continue; // must be a wall that reaches below the feet

      const cx = clamp(pos.x, c.minX, c.maxX);
      const cz = clamp(pos.z, c.minZ, c.maxZ);
      const rx = cx - pos.x;
      const rz = cz - pos.z;
      const along = rx * fwd.x + rz * fwd.z;
      const lateral = Math.abs(rx * right.x + rz * right.z);
      if (along < 0.02 || along > 0.95) continue;
      if (lateral > 0.85) continue;

      if (top > bestTop) {
        bestTop = top;
        bestCx = cx;
        bestCz = cz;
        bestC = c;
      }
    }

    if (!bestC) return false;

    const tx = clamp(bestCx + fwd.x * 0.6, bestC.minX + 0.35, bestC.maxX - 0.35);
    const tz = clamp(bestCz + fwd.z * 0.6, bestC.minZ + 0.35, bestC.maxZ - 0.35);
    if (!p.isFree(tx, bestTop + 0.08, tz)) return false;

    const exitSpeed = Math.max(p.horizontalSpeed, 2.5);
    p.startAction({
      type: 'mantle',
      t: 0,
      duration: CFG.mantleDuration,
      from: pos.clone(),
      to: new THREE.Vector3(tx, bestTop + 0.02, tz),
      arc: 0,
      exitSpeed,
    });
    this.events.onMantle?.();
    return true;
  }
}
