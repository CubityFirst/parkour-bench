import * as THREE from 'three';
import { Box } from '../world/CollisionWorld';
import type { PlayerController, PlayerInput } from './PlayerController';
import { MOVE } from './PlayerController';

const WALL = {
  minSpeed: 5,
  runSpeed: 9.5,      // minimum speed along the wall
  probe: 0.5,         // how far to the side we look for a wall
  maxTime: 1.4,
  gravity: 3.5,       // reduced gravity while running on a wall
  jumpOut: 6,
  jumpUp: 7,
};

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const hits: Box[] = [];

const smooth = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;

/** Wall running, vaulting and ledge mantling. */
export class ParkourSystem {
  // Wall run state
  wallNormal = new THREE.Vector3();
  wallDir = new THREE.Vector3();
  wallSpeed = 0;
  wallTime = 0;
  wallBox: Box | null = null;
  /** +1 wall on the right, -1 on the left. */
  wallSide = 0;
  wallCooldown = 0;

  // Traverse (vault / mantle) animation state
  travKind: 'vault' | 'mantle' = 'vault';
  travT = 0;
  travDur = 0.4;
  travFrom = new THREE.Vector3();
  travTo = new THREE.Vector3();
  travPeak = 0;
  travExit = new THREE.Vector3();

  constructor(private p: PlayerController) {}

  reset() { this.wallCooldown = 0; this.wallBox = null; this.travT = 0; }

  tick(dt: number) { this.wallCooldown -= dt; }

  // ---------------------------------------------------------------- wall run

  tryStartWallrun(): boolean {
    const { body, world } = this.p;
    const v = body.vel;
    if (this.wallCooldown > 0 || this.p.horizontalSpeed < WALL.minSpeed) return false;
    const r = body.radius;
    for (const dir of AXES) {
      const px = body.pos.x + dir.x * WALL.probe, pz = body.pos.z + dir.z * WALL.probe;
      world.query(px - r, body.pos.y + 0.3, pz - r, px + r, body.pos.y + body.height - 0.2, pz + r, hits);
      for (const b of hits) {
        if (!b.runnable || b === this.p.lastWall) continue;
        // Velocity component parallel to the wall must be substantial (no running head-on into it).
        const along = new THREE.Vector3(dir.x !== 0 ? 0 : v.x, 0, dir.z !== 0 ? 0 : v.z);
        const alongSpeed = along.length();
        if (alongSpeed < 4) continue;
        // Snap onto the wall face (the probe detects walls up to WALL.probe away).
        const axis = dir.x !== 0 ? 'x' : 'z';
        const snapped = dir[axis] > 0 ? b.min[axis] - r - 1e-3 : b.max[axis] + r + 1e-3;
        const sx = axis === 'x' ? snapped : body.pos.x, sz = axis === 'z' ? snapped : body.pos.z;
        if (!world.isFree(sx, body.pos.y, sz, r, body.height)) continue;
        body.pos.x = sx; body.pos.z = sz;
        this.wallNormal.copy(dir).negate();
        this.wallDir.copy(along).divideScalar(alongSpeed);
        this.wallSpeed = Math.max(alongSpeed, WALL.runSpeed);
        this.wallTime = 0;
        this.wallBox = b;
        this.wallSide = this.p.right.dot(dir) > 0 ? 1 : -1;
        v.y = THREE.MathUtils.clamp(v.y, 0.5, 3.5);
        this.p.state = 'wallrun';
        this.p.jumping = false;
        this.p.events.push({ type: 'wallStart' });
        return true;
      }
    }
    return false;
  }

  updateWallrun(dt: number, inp: PlayerInput) {
    const { body, world } = this.p;
    const v = body.vel;
    this.wallTime += dt;
    this.wallSpeed = Math.max(this.wallSpeed - 0.6 * dt, 7.5);

    // Wall jump: kick away from the wall while keeping forward momentum.
    if (this.p.jumpBuffer > 0) {
      v.copy(this.wallDir).multiplyScalar(this.wallSpeed).addScaledVector(this.wallNormal, WALL.jumpOut);
      v.y = WALL.jumpUp;
      this.p.jumpBuffer = 0;
      this.p.jumping = true;
      this.p.events.push({ type: 'jump' });
      this.endWallrun(false);
      return;
    }

    // Still touching the wall?
    const r = body.radius;
    const px = body.pos.x - this.wallNormal.x * 0.15, pz = body.pos.z - this.wallNormal.z * 0.15;
    world.query(px - r, body.pos.y + 0.2, pz - r, px + r, body.pos.y + body.height - 0.2, pz + r, hits);
    const touching = hits.includes(this.wallBox!);

    if (!touching || this.wallTime > WALL.maxTime || inp.forward <= 0 || body.grounded) {
      this.endWallrun(true);
      return;
    }
    // Run along the wall with a slight push into it so we stay attached.
    v.x = this.wallDir.x * this.wallSpeed - this.wallNormal.x * 0.8;
    v.z = this.wallDir.z * this.wallSpeed - this.wallNormal.z * 0.8;
    v.y -= WALL.gravity * dt * (this.wallTime > 0.9 ? 2.5 : 1);
  }

  endWallrun(pushOff: boolean) {
    if (this.p.state !== 'wallrun') return;
    if (pushOff) this.p.body.vel.addScaledVector(this.wallNormal, 1.2);
    this.p.state = 'move';
    this.p.lastWall = this.wallBox;
    this.wallCooldown = 0.25;
    this.p.events.push({ type: 'wallEnd' });
  }

  // ------------------------------------------------------ vault and mantle

  /**
   * Looks for a box directly in front of the player and, if it can be climbed
   * over (vault) or onto (mantle), starts a short scripted traversal.
   */
  tryTraverse(kind: 'vault' | 'mantle'): boolean {
    const { body, world, fwd } = this.p;
    const feet = body.pos.y;
    const r = body.radius;
    const maxRise = kind === 'vault' ? 1.5 : 2.1;
    const minRise = kind === 'vault' ? 0.3 : 0.45;

    // 1. Find the obstacle top directly ahead.
    let top = -Infinity;
    for (const d of [0.3, 0.55, 0.8, 1.05]) {
      const px = body.pos.x + fwd.x * d, pz = body.pos.z + fwd.z * d;
      world.query(px - r * 0.6, feet + 0.05, pz - r * 0.6, px + r * 0.6, feet + maxRise + 0.4, pz + r * 0.6, hits);
      for (const b of hits) top = Math.max(top, b.max.y);
      if (top > -Infinity) break;
    }
    if (top === -Infinity) return false;
    const rise = top - feet;
    if (rise < minRise || rise > maxRise) return false;

    // 2. Scan forward for a landing spot, making sure the path over the top is clear.
    let blocked = false;
    let landing: THREE.Vector3 | null = null;
    for (let d = 0.2; d <= 3.4; d += 0.15) {
      const px = body.pos.x + fwd.x * d, pz = body.pos.z + fwd.z * d;
      if (!world.isFree(px, top + 0.02, pz, r, 1.0)) return false; // wall above the obstacle
      const freeAtFeet = world.isFree(px, feet + 0.02, pz, r, MOVE.standHeight);
      if (!freeAtFeet) blocked = true;
      if (!blocked) continue;
      if (kind === 'vault' && freeAtFeet) { landing = new THREE.Vector3(px, feet, pz); break; }
      const onTop = !freeAtFeet && world.isFree(px, top + 0.02, pz, r, MOVE.standHeight) &&
        world.hasSupport(px, top + 0.01, pz, r * 0.5, 0.05);
      if (onTop && (kind === 'mantle' || d > 1.8)) { landing = new THREE.Vector3(px, top + 0.01, pz); break; }
    }
    if (!landing) return false;

    this.travKind = kind;
    this.travT = 0;
    this.travFrom.copy(body.pos);
    this.travTo.copy(landing);
    this.travPeak = top + 0.15;
    this.travDur = kind === 'vault' ? 0.38 : 0.28 + rise * 0.08;
    const exitSpeed = Math.max(this.p.horizontalSpeed, kind === 'vault' ? 7 : 4.5);
    this.travExit.copy(fwd).multiplyScalar(exitSpeed);
    body.vel.set(0, 0, 0);
    body.height = MOVE.standHeight;
    this.p.state = 'traverse';
    this.p.jumping = false;
    this.p.events.push({ type: kind });
    return true;
  }

  updateTraverse(dt: number) {
    const body = this.p.body;
    this.travT = Math.min(1, this.travT + dt / this.travDur);
    const t = this.travT;
    const from = this.travFrom, to = this.travTo;
    if (this.travKind === 'vault') {
      const e = smooth(t);
      body.pos.x = from.x + (to.x - from.x) * e;
      body.pos.z = from.z + (to.z - from.z) * e;
      body.pos.y = t < 0.5
        ? from.y + (this.travPeak - from.y) * easeOut(t / 0.5)
        : this.travPeak + (to.y - this.travPeak) * easeIn((t - 0.5) / 0.5);
    } else {
      // Mantle: pull up first, then roll forward onto the ledge.
      body.pos.y = from.y + (to.y - from.y) * easeOut(Math.min(1, t / 0.6));
      const e = smooth(THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1));
      body.pos.x = from.x + (to.x - from.x) * e;
      body.pos.z = from.z + (to.z - from.z) * e;
    }
    if (t >= 1) {
      body.pos.copy(to);
      body.vel.copy(this.travExit);
      body.grounded = false;
      this.p.state = 'move';
    }
  }

  /** 0..1 progress of the current traversal, for camera / arm animation. */
  get traverseProgress() { return this.travT; }
}
