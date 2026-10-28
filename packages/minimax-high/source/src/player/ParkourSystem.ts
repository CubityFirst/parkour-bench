import * as THREE from 'three';
import { PHYS } from '../core/Config';
import { clamp, easeInOutCubic, smoothstep } from '../core/MathUtil';
import { CollisionWorld, Collider } from '../world/CollisionWorld';
import { PhysicsBody } from './PlayerPhysics';

export interface VaultTarget {
  collider: Collider;
  /** Height of the top surface of the obstacle. */
  top: number;
  /** Horizontal unit vector pointing from the player towards the obstacle. */
  dir: THREE.Vector3;
  /** Distance from the player to the near face of the obstacle. */
  distance: number;
}

export interface WallTarget {
  collider: Collider;
  /** Normal pointing away from the wall surface, towards the player. */
  normal: THREE.Vector3;
  /** Distance from the player's body to the wall surface. */
  distance: number;
  /** Height of the wall above the player's feet. */
  height: number;
}

/**
 * Detection helpers for the parkour moves: what can be vaulted, where are the
 * reachable ledges and which wall is close enough to be run on.
 */
export class ParkourSystem {
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpNormal = new THREE.Vector3();

  /**
   * Finds a waist-high obstacle directly in front of the player that can be
   * vaulted over.
   */
  findVaultTarget(
    world: CollisionWorld,
    body: PhysicsBody,
    forward: THREE.Vector3
  ): VaultTarget | null {
    const pos = body.position;
    const probeX = pos.x + forward.x * (body.radius + 0.35);
    const probeZ = pos.z + forward.z * (body.radius + 0.35);
    const pad = body.radius + 0.25;

    let best: VaultTarget | null = null;
    let bestDistance = Infinity;

    for (let i = 0; i < world.colliders.length; i++) {
      const c = world.colliders[i];
      const rise = c.maxY - pos.y;
      if (rise < PHYS.vaultMinHeight || rise > PHYS.vaultMaxHeight) continue;

      // The obstacle has to be in front of the player.
      const cx = (c.minX + c.maxX) * 0.5;
      const cz = (c.minZ + c.maxZ) * 0.5;
      const toCentre = this.tmpDir.set(cx - pos.x, 0, cz - pos.z);
      if (toCentre.lengthSq() < 1e-6) continue;
      const forwardness = toCentre.normalize().dot(forward);
      if (forwardness < 0.25) continue;

      // Probe box in front of the player.
      if (
        c.maxX < probeX - pad ||
        c.minX > probeX + pad ||
        c.maxZ < probeZ - pad ||
        c.minZ > probeZ + pad
      ) {
        continue;
      }

      const distance = this.distanceToNearFace(c, pos, this.tmpNormal);
      if (distance > PHYS.vaultReach) continue;

      // We need room to stand on top of the obstacle.
      const topX = clamp(pos.x + forward.x * 0.2, c.minX, c.maxX);
      const topZ = clamp(pos.z + forward.z * 0.2, c.minZ, c.maxZ);
      if (!world.hasHeadroom(topX, topZ, c.maxY, PHYS.standHeight, body.radius * 0.8)) continue;

      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          collider: c,
          top: c.maxY,
          dir: forward.clone(),
          distance,
        };
      }
    }
    return best;
  }

  /**
   * Finds a ledge the player can pull themselves up onto. Used when the player
   * is just below a rooftop edge.
   */
  findMantleTarget(
    world: CollisionWorld,
    body: PhysicsBody,
    forward: THREE.Vector3
  ): VaultTarget | null {
    const pos = body.position;
    let best: VaultTarget | null = null;
    let bestDistance = Infinity;

    for (let i = 0; i < world.colliders.length; i++) {
      const c = world.colliders[i];
      if (c.vaultable) continue;

      // The ledge has to sit above the player's feet, but within reach.
      const rise = c.maxY - pos.y;
      if (rise < 0.12 || rise > PHYS.mantleMaxHeight) continue;

      // Nearest point of the box footprint (the player has to be outside it).
      const nx = clamp(pos.x, c.minX, c.maxX);
      const nz = clamp(pos.z, c.minZ, c.maxZ);
      const dx = nx - pos.x;
      const dz = nz - pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.12) continue;
      if (distance > PHYS.mantleReach) continue;

      const dirX = dx / distance;
      const dirZ = dz / distance;
      if (dirX * forward.x + dirZ * forward.z < 0.15) continue;

      // There has to be room to stand on top of the ledge.
      const topX = nx + dirX * 0.4;
      const topZ = nz + dirZ * 0.4;
      if (!world.hasHeadroom(topX, topZ, c.maxY, PHYS.standHeight, body.radius * 0.8)) continue;

      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          collider: c,
          top: c.maxY,
          dir: new THREE.Vector3(dirX, 0, dirZ),
          distance,
        };
      }
    }
    return best;
  }

  /**
   * Finds a runnable vertical surface close to the player.
   *
   * Only surfaces that are marked as wall-run panels (the red ones) can be
   * run on. Marked panels are grabbed from further away, as long as the
   * player is already running along them.
   */
  findWall(
    world: CollisionWorld,
    body: PhysicsBody,
    _forward: THREE.Vector3,
    assistReach = PHYS.wallAssistReach
  ): WallTarget | null {
    const pos = body.position;
    const speed = Math.hypot(body.velocity.x, body.velocity.z);
    let best: WallTarget | null = null;
    let bestDistance = Infinity;

    for (let i = 0; i < world.colliders.length; i++) {
      const c = world.colliders[i];
      if (!c.wallrun) continue;
      const height = c.maxY - c.minY;
      if (height < PHYS.wallMinHeight) continue;
      // The wall has to span the player's chest.
      if (c.minY > pos.y + body.height * 0.75) continue;
      if (c.maxY < pos.y + 0.45) continue;

      const distance = this.distanceToNearFace(c, pos, this.tmpNormal);
      if (distance < -0.05) continue;
      if (distance > assistReach) continue;

      // Far away panels are only grabbed when the player is already running
      // along the wall.
      if (distance > PHYS.wallReach) {
        if (speed < 4) continue;
        const alongX = c.maxX - c.minX >= c.maxZ - c.minZ;
        const along = alongX
          ? Math.abs(body.velocity.x)
          : Math.abs(body.velocity.z);
        if (along / speed < 0.5) continue;
      }

      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          collider: c,
          normal: this.tmpNormal.clone(),
          distance,
          height: c.maxY - pos.y,
        };
      }
    }
    return best;
  }

  /**
   * Distance from the player's body to the closest face of a box, also
   * returning the face normal (pointing towards the player) in `outNormal`.
   * Returns 0 when the player is already touching or overlapping the box.
   */
  distanceToNearFace(c: Collider, pos: THREE.Vector3, outNormal: THREE.Vector3): number {
    const r = 0.35;
    const minX = pos.x - r;
    const maxX = pos.x + r;
    const minZ = pos.z - r;
    const maxZ = pos.z + r;

    // Positive gaps mean the box lies fully on that side of the player.
    const gapPlusX = c.minX - maxX;
    const gapMinusX = minX - c.maxX;
    const gapPlusZ = c.minZ - maxZ;
    const gapMinusZ = minZ - c.maxZ;

    const best = Math.max(gapPlusX, gapMinusX, gapPlusZ, gapMinusZ);
    if (best > 0) {
      if (best === gapPlusX) {
        outNormal.set(-1, 0, 0);
        return gapPlusX;
      }
      if (best === gapMinusX) {
        outNormal.set(1, 0, 0);
        return gapMinusX;
      }
      if (best === gapPlusZ) {
        outNormal.set(0, 0, -1);
        return gapPlusZ;
      }
      outNormal.set(0, 0, 1);
      return gapMinusZ;
    }

    // The footprints overlap: the player is touching the box.
    const overlapX = Math.min(maxX, c.maxX) - Math.max(minX, c.minX);
    const overlapZ = Math.min(maxZ, c.maxZ) - Math.max(minZ, c.minZ);
    if (overlapX <= overlapZ) {
      outNormal.set(pos.x < (c.minX + c.maxX) * 0.5 ? -1 : 1, 0, 0);
    } else {
      outNormal.set(0, 0, pos.z < (c.minZ + c.maxZ) * 0.5 ? -1 : 1);
    }
    return 0;
  }
}

/**
 * A scripted, short movement used for vaults and ledge mantles.
 * The player is moved along a smooth arc so the motion always looks
 * intentional and never clips through geometry.
 */
export class Traversal {
  kind: 'vault' | 'mantle' = 'vault';
  elapsed = 0;
  duration = PHYS.vaultDuration;
  readonly start = new THREE.Vector3();
  readonly end = new THREE.Vector3();
  readonly dir = new THREE.Vector3();
  apex = 0;
  active = false;

  begin(
    kind: 'vault' | 'mantle',
    start: THREE.Vector3,
    end: THREE.Vector3,
    apex: number,
    dir: THREE.Vector3,
    duration: number
  ): void {
    this.kind = kind;
    this.start.copy(start);
    this.end.copy(end);
    this.apex = apex;
    this.dir.copy(dir);
    this.duration = duration;
    this.elapsed = 0;
    this.active = true;
  }

  /** Advances the traversal and writes the new position into `out`. */
  update(dt: number, out: THREE.Vector3): boolean {
    this.elapsed += dt;
    const t = clamp(this.elapsed / this.duration, 0, 1);
    const h = easeInOutCubic(t);

    out.x = this.start.x + (this.end.x - this.start.x) * h;
    out.z = this.start.z + (this.end.z - this.start.z) * h;

    if (t < 0.5) {
      out.y = this.start.y + (this.apex - this.start.y) * smoothstep(t / 0.5);
    } else {
      out.y = this.apex + (this.end.y - this.apex) * smoothstep((t - 0.5) / 0.5);
    }

    if (t >= 1) {
      this.active = false;
      return true;
    }
    return false;
  }
}
