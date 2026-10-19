import * as THREE from 'three';
import { Box } from '../world/CollisionWorld';
import { PlayerPhysics, RADIUS, STAND_H } from './PlayerPhysics';

export type Mode = 'normal' | 'slide' | 'wallrun' | 'tween';

export interface WallHit { box: Box; nx: number; nz: number; }

interface Tween {
  kind: 'mantle' | 'vault';
  t: number; dur: number;
  from: THREE.Vector3; to: THREE.Vector3;
  arc: number;
  dirX: number; dirZ: number; exitSpeed: number;
}

const REACH_MIN = 0.5;   // ledge must be at least this far above the feet
const REACH_MAX = 2.0;   // ...and at most this far (hands reach above the head)
const VAULT_MAX = 1.4;   // highest obstacle that can be vaulted

/** State and detection for slide, wall-run, mantle and vault. Movement integration lives in PlayerController. */
export class ParkourSystem {
  mode: Mode = 'normal';

  // slide
  slideDirX = 0; slideDirZ = -1; slideSpeed = 0;

  // wall run
  wallTime = 0; wallSide = 0; wallSpeed = 0;
  wallNx = 0; wallNz = 0; wallTx = 0; wallTz = 0;
  wallBox: Box | null = null;

  tween: Tween | null = null;

  reset(): void {
    this.mode = 'normal';
    this.tween = null;
    this.wallBox = null;
    this.wallSide = 0;
    this.slideSpeed = 0;
  }

  /**
   * Finds a runnable vertical wall touching the body (within 0.45 m of the
   * collider). Returns the outward normal (pointing to the player).
   */
  detectWall(p: PlayerPhysics, exclude: Box | null): WallHit | null {
    const x = p.pos.x, y = p.pos.y, z = p.pos.z;
    const m = RADIUS + 0.45;
    for (const b of p.world.runnables) {
      if (b === exclude) continue;
      if (y + 0.4 >= b.maxY || y + STAND_H <= b.minY) continue;
      if (x + m <= b.minX || x - m >= b.maxX || z + m <= b.minZ || z - m >= b.maxZ) continue;
      let nx = 0, nz = 0, dx = 0, dz = 0;
      if (x <= b.minX) { nx = -1; dx = b.minX - x; } else if (x >= b.maxX) { nx = 1; dx = x - b.maxX; }
      if (z <= b.minZ) { nz = -1; dz = b.minZ - z; } else if (z >= b.maxZ) { nz = 1; dz = z - b.maxZ; }
      if (nx !== 0 && nz !== 0) continue; // corner: ignore
      if (nx === 0 && nz === 0) continue;
      const dist = nx !== 0 ? dx : dz;
      if (dist > m) continue;
      return { box: b, nx, nz };
    }
    return null;
  }

  /** Ledge just in front of an airborne player that can be mantled onto. */
  startMantleIfAny(p: PlayerPhysics, dirX: number, dirZ: number, exitSpeed: number): boolean {
    const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
    const cx = px + dirX * 0.35, cz = pz + dirZ * 0.35;
    for (const b of p.world.boxes) {
      const rise = b.maxY - py;
      if (rise < REACH_MIN || rise > REACH_MAX) continue;
      if (cx + RADIUS <= b.minX || cx - RADIUS >= b.maxX || cz + RADIUS <= b.minZ || cz - RADIUS >= b.maxZ) continue;
      if (py + STAND_H <= b.minY) continue;
      const tx = px + dirX * 0.7, tz = pz + dirZ * 0.7;
      if (!p.world.pointInside(tx, b.maxY - 0.05, tz)) continue;
      if (!p.isFree(tx, b.maxY, tz)) continue;
      this.tween = {
        kind: 'mantle', t: 0, dur: 0.22 + rise * 0.1,
        from: p.pos.clone(), to: new THREE.Vector3(tx, b.maxY, tz),
        arc: 0, dirX, dirZ, exitSpeed,
      };
      this.mode = 'tween';
      return true;
    }
    return false;
  }

  /** Low obstacle directly ahead: arc over it and land on the far side. */
  startVaultIfAny(p: PlayerPhysics, dirX: number, dirZ: number, speed: number): boolean {
    const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
    let obstacle: Box | null = null;
    for (let s = 0.3; s <= 1.4 && !obstacle; s += 0.2) {
      const sx = px + dirX * s, sz = pz + dirZ * s;
      for (const b of p.world.boxes) {
        if (sx > b.minX && sx < b.maxX && sz > b.minZ && sz < b.maxZ) {
          const rise = b.maxY - py;
          if (rise > 0.25 && rise <= VAULT_MAX && b.minY < py + 0.5) { obstacle = b; break; }
        }
      }
    }
    if (!obstacle) return false;
    const top = obstacle.maxY;
    for (let d = 1.0; d <= 4.2; d += 0.2) {
      const tx = px + dirX * d, tz = pz + dirZ * d;
      if (!p.isFree(tx, py, tz)) continue;
      if (!p.world.pointInside(tx, py - 0.2, tz)) continue; // need ground to land on
      // clearance above the obstacle along the path
      let clear = true;
      for (let s = 0.4; s <= d; s += 0.4) {
        if (!p.isFree(px + dirX * s, top + 0.02, pz + dirZ * s, STAND_H - 0.2)) { clear = false; break; }
      }
      if (!clear) return false;
      this.tween = {
        kind: 'vault', t: 0, dur: 0.38 + d * 0.04,
        from: p.pos.clone(), to: new THREE.Vector3(tx, py, tz),
        arc: top - py + 0.35, dirX, dirZ, exitSpeed: Math.max(speed, 6.5),
      };
      this.mode = 'tween';
      return true;
    }
    return false;
  }

  /** Advances an active mantle/vault. Returns true when finished. */
  stepTween(dt: number, p: PlayerPhysics): boolean {
    const tw = this.tween!;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const t = tw.t;
    const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
    if (tw.kind === 'mantle') {
      const yP = smooth(t * 1.5);
      const hP = smooth((t - 0.25) / 0.75);
      p.pos.set(
        tw.from.x + (tw.to.x - tw.from.x) * hP,
        tw.from.y + (tw.to.y - tw.from.y) * yP,
        tw.from.z + (tw.to.z - tw.from.z) * hP,
      );
    } else {
      const e = smooth(t);
      p.pos.set(
        tw.from.x + (tw.to.x - tw.from.x) * t,
        tw.from.y + Math.sin(Math.PI * e) * tw.arc,
        tw.from.z + (tw.to.z - tw.from.z) * t,
      );
    }
    p.vel.set(0, 0, 0);
    return t >= 1;
  }

  get tweenProgress(): number { return this.tween ? this.tween.t : 0; }
}
