import * as THREE from 'three';
import { CollisionWorld, Solid } from '../world/CollisionWorld';
import { MoveIntent, PlayerPhysics, TUNING } from './PlayerPhysics';

/** Per-step input the parkour layer needs, all in world space. */
export interface ParkourInput {
  /** Horizontal unit vector the camera is facing. */
  forwardX: number;
  forwardZ: number;
  /** Horizontal unit vector to the camera's right. */
  rightX: number;
  rightZ: number;
  /** Horizontal unit wish direction from WASD (zero if no movement keys). */
  wishX: number;
  wishZ: number;
  sprint: boolean;
  slideHeld: boolean;
  slidePressed: boolean;
  vaultPressed: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
}

export type ParkourMode = 'normal' | 'slide' | 'wallrun' | 'anim';

/** One-frame flags the controller reads to trigger sound and camera effects. */
export interface ParkourEvents {
  slideStart: boolean;
  wallStart: boolean;
  wallJump: boolean;
  vault: boolean;
  mantle: boolean;
}

interface WallHit {
  solid: Solid;
  /** Points from the wall toward the player. */
  normal: THREE.Vector3;
  /** Unit vector along the wall face. */
  tangent: THREE.Vector3;
}

interface LedgeAnim {
  kind: 'vault' | 'mantle';
  start: THREE.Vector3;
  target: THREE.Vector3;
  clearY: number;
  dir: THREE.Vector3;
  elapsed: number;
  duration: number;
  speedAfter: number;
}

/**
 * Reach of the probe slab used to detect walls beside the player. Generous on
 * purpose so a player running down the middle of a runway can still latch on.
 * The wall pull then draws them in until they touch the face.
 */
const WALL_PROBE = 0.8;
const WALL_MIN_SPEED = 6.5;
const WALL_MAX_TIME = 1.4;
const WALL_MIN_LENGTH = 3;
const WALL_RUN_SPEED = 9;
const WALL_PULL = 1.5;
const WALL_GRAVITY_SCALE = 0.12;
const WALL_MAX_FALL = 2.5;
const WALL_JUMP_UP = 8.4;
const WALL_JUMP_OUT = 7;

const SLIDE_MIN_SPEED = 4.5;
const SLIDE_STOP_SPEED = 2.2;
const SLIDE_START_BOOST = 1.08;
const SLIDE_MAX_START_SPEED = TUNING.sprintSpeed + 2;

const VAULT_MIN_TOP = 0.35;
const VAULT_MAX_TOP = 1.3;
const VAULT_MAX_DEPTH = 3.2;
const VAULT_DURATION = 0.42;
const MANTLE_MIN_TOP = 0.7;
const MANTLE_MAX_TOP = 1.5;
const MANTLE_DURATION = 0.5;

const STAND_GROW_RATE = 5.5;
const EPS = 1e-4;

function overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - EPS && b0 < a1 - EPS;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Parkour abilities: slide, wall run, vault (E), and ledge mantle.
 *
 * Each fixed step the controller calls `buildIntent()` (or `stepAnim()` while a
 * vault/mantle is animating), runs the core physics with the returned intent,
 * and then reads `events` for one-shot feedback.
 */
export class ParkourSystem {
  mode: ParkourMode = 'normal';
  /** +1 if the wall is on the player's right, -1 if on the left, 0 otherwise. Drives camera tilt. */
  wallSide = 0;
  /** 0..1 progress of the current vault/mantle, for procedural camera motion. */
  actionPulse = 0;
  readonly events: ParkourEvents = {
    slideStart: false,
    wallStart: false,
    wallJump: false,
    vault: false,
    mantle: false,
  };

  private wallTime = 0;
  private wallSolid: Solid | null = null;
  private wallNormal = new THREE.Vector3();
  private wallTangent = new THREE.Vector3();
  private wallRunDir = 1;
  private wallRunSpeed = WALL_RUN_SPEED;
  /** A wall that was run and left in the air. Cannot be run again until the player lands. */
  private blockedWall: Solid | null = null;
  private anim: LedgeAnim | null = null;

  reset(): void {
    this.mode = 'normal';
    this.wallSide = 0;
    this.actionPulse = 0;
    this.wallTime = 0;
    this.wallSolid = null;
    this.blockedWall = null;
    this.anim = null;
  }

  isAnimating(): boolean {
    return this.anim !== null;
  }

  get isSliding(): boolean {
    return this.mode === 'slide';
  }

  get isWallRunning(): boolean {
    return this.mode === 'wallrun';
  }

  /**
   * Decides the movement intent for this fixed step. May start a slide, wall run,
   * vault or mantle, and keeps the player's height in sync with the slide state.
   */
  buildIntent(dt: number, phys: PlayerPhysics, world: CollisionWorld, inp: ParkourInput): MoveIntent {
    this.events.slideStart = false;
    this.events.wallStart = false;
    this.events.wallJump = false;
    this.events.vault = false;
    this.events.mantle = false;

    if (phys.grounded) this.blockedWall = null;
    this.wallSide *= Math.max(0, 1 - dt * 6);
    this.actionPulse = 0;

    // Vault (E) works on the ground and in the air. Auto-mantle triggers when airborne,
    // falling or near the apex, and the player is pressing toward the ledge.
    if (inp.vaultPressed && this.tryStartLedge(phys, world, inp, 'vault')) {
      return this.idleIntent(inp);
    }
    if (!phys.grounded && this.mode !== 'wallrun' && phys.vel.y < 3) {
      const pressingForward = inp.wishX * inp.forwardX + inp.wishZ * inp.forwardZ > 0.5;
      if (pressingForward && this.tryStartLedge(phys, world, inp, 'mantle')) {
        return this.idleIntent(inp);
      }
    }

    // Wall run: continue an active run, or start one when airborne and fast enough.
    if (this.mode === 'wallrun') {
      if (this.updateWallRun(dt, phys, world, inp)) {
        this.updateStanding(dt, phys, world);
        return this.wallIntent(inp);
      }
    } else if (this.tryStartWallRun(phys, world)) {
      this.updateWallRun(dt, phys, world, inp);
      this.updateStanding(dt, phys, world);
      return this.wallIntent(inp);
    }

    this.updateSlide(phys, inp);
    this.updateStanding(dt, phys, world);

    return {
      wishX: inp.wishX,
      wishZ: inp.wishZ,
      sprint: inp.sprint,
      sliding: this.mode === 'slide',
      jumpPressed: inp.jumpPressed,
      jumpHeld: inp.jumpHeld,
      gravityScale: 1,
    };
  }

  /** Advances an active vault or mantle. The body is moved directly, not through collision. */
  stepAnim(dt: number, phys: PlayerPhysics): void {
    const a = this.anim;
    if (!a) return;

    a.elapsed += dt;
    const t = Math.min(1, a.elapsed / a.duration);
    this.actionPulse = Math.sin(Math.PI * t);

    // Phase 1 (first 45%): rise to clear the top. Phase 2: travel across at clear height,
    // and only descend over the last 30% so the body never clips the obstacle.
    const split = 0.45;
    if (t < split) {
      const k = easeOut(t / split);
      phys.pos.x = a.start.x;
      phys.pos.z = a.start.z;
      phys.pos.y = a.start.y + (a.clearY - a.start.y) * k;
    } else {
      const k = (t - split) / (1 - split);
      const h = easeInOut(k);
      phys.pos.x = a.start.x + (a.target.x - a.start.x) * h;
      phys.pos.z = a.start.z + (a.target.z - a.start.z) * h;
      const descend = THREE.MathUtils.clamp((k - 0.7) / 0.3, 0, 1);
      phys.pos.y = a.clearY + (a.target.y - a.clearY) * easeInOut(descend);
    }

    if (t >= 1) {
      phys.pos.copy(a.target);
      phys.vel.set(a.dir.x * a.speedAfter, -2, a.dir.z * a.speedAfter);
      phys.grounded = false;
      this.anim = null;
      this.mode = 'normal';
      this.actionPulse = 0;
    }
  }

  private idleIntent(inp: ParkourInput): MoveIntent {
    return {
      wishX: 0,
      wishZ: 0,
      sprint: inp.sprint,
      sliding: false,
      jumpPressed: false,
      jumpHeld: false,
      gravityScale: 1,
    };
  }

  private wallIntent(inp: ParkourInput): MoveIntent {
    return {
      wishX: 0,
      wishZ: 0,
      sprint: true,
      sliding: false,
      jumpPressed: false,
      jumpHeld: inp.jumpHeld,
      gravityScale: WALL_GRAVITY_SCALE,
    };
  }

  // ---------------------------------------------------------------- slide

  private updateSlide(phys: PlayerPhysics, inp: ParkourInput): void {
    if (this.mode === 'slide') {
      if (!phys.grounded || inp.jumpPressed || phys.speed < SLIDE_STOP_SPEED) {
        this.mode = 'normal';
      }
      return;
    }
    if (inp.slidePressed && phys.grounded && phys.speed >= SLIDE_MIN_SPEED) {
      this.mode = 'slide';
      this.events.slideStart = true;
      // Keep momentum and give a small boost so the slide feels committed.
      const boosted = Math.min(phys.speed * SLIDE_START_BOOST, SLIDE_MAX_START_SPEED);
      const s = phys.speed;
      if (s > 1e-6) {
        phys.vel.x *= boosted / s;
        phys.vel.z *= boosted / s;
      }
    }
  }

  /**
   * Eases the collision height toward the slide or stand height. Shrinking is
   * immediate. Growing only happens when there is headroom, so the player never
   * gets stuck inside a ceiling.
   */
  private updateStanding(dt: number, phys: PlayerPhysics, world: CollisionWorld): void {
    const target = this.mode === 'slide' ? TUNING.slideHeight : TUNING.standHeight;
    if (target < phys.height) {
      phys.height = target;
      return;
    }
    if (target > phys.height) {
      const next = Math.min(target, phys.height + dt * STAND_GROW_RATE);
      const min = new THREE.Vector3(phys.pos.x - TUNING.halfWidth, phys.pos.y, phys.pos.z - TUNING.halfWidth);
      const max = new THREE.Vector3(phys.pos.x + TUNING.halfWidth, phys.pos.y + next, phys.pos.z + TUNING.halfWidth);
      if (!world.overlaps(min, max)) phys.height = next;
    }
  }

  // ------------------------------------------------------------- wall run

  private tryStartWallRun(phys: PlayerPhysics, world: CollisionWorld): boolean {
    if (phys.grounded || this.mode !== 'normal' || phys.speed < WALL_MIN_SPEED) return false;
    const hit = this.findWall(phys, world);
    if (!hit || hit.solid === this.blockedWall) return false;

    this.mode = 'wallrun';
    this.wallTime = 0;
    this.wallSolid = hit.solid;
    this.wallNormal.copy(hit.normal);
    this.wallTangent.copy(hit.tangent);
    const along = phys.vel.x * hit.tangent.x + phys.vel.z * hit.tangent.z;
    this.wallRunDir = along >= 0 ? 1 : -1;
    this.wallRunSpeed = Math.min(Math.max(phys.speed * 0.95, WALL_RUN_SPEED), TUNING.sprintSpeed + 2);
    this.events.wallStart = true;
    return true;
  }

  /** Returns true while the wall run continues. Sets the velocity for this step. */
  private updateWallRun(dt: number, phys: PlayerPhysics, world: CollisionWorld, inp: ParkourInput): boolean {
    this.wallTime += dt;
    const hit = this.findWall(phys, world);
    const stillOnWall = hit !== null && hit.solid === this.wallSolid;

    if (phys.grounded || !stillOnWall || this.wallTime > WALL_MAX_TIME) {
      this.endWallRun(!phys.grounded);
      return false;
    }

    // Normal points at the player, so its negation points at the wall: dot with right gives +1 for a right-hand wall.
    this.wallSide = -(this.wallNormal.x * inp.rightX + this.wallNormal.z * inp.rightZ);

    if (inp.jumpPressed) {
      const along = this.wallRunSpeed * 0.5 * this.wallRunDir;
      phys.impulse(
        new THREE.Vector3(
          this.wallNormal.x * WALL_JUMP_OUT + this.wallTangent.x * along,
          0,
          this.wallNormal.z * WALL_JUMP_OUT + this.wallTangent.z * along,
        ),
        WALL_JUMP_UP,
      );
      this.events.wallJump = true;
      this.endWallRun(true);
      return false;
    }

    // Run along the face at constant speed, pressed lightly into the wall so contact persists.
    const along = this.wallRunSpeed * this.wallRunDir;
    phys.vel.x = this.wallTangent.x * along - this.wallNormal.x * WALL_PULL;
    phys.vel.z = this.wallTangent.z * along - this.wallNormal.z * WALL_PULL;
    if (phys.vel.y < -WALL_MAX_FALL) phys.vel.y = -WALL_MAX_FALL;
    return true;
  }

  /** Marks the wall as used when the run ends in the air, so it cannot be re-run without landing. */
  private endWallRun(blockSameWall: boolean): void {
    if (blockSameWall) this.blockedWall = this.wallSolid;
    this.mode = 'normal';
    this.wallSolid = null;
    this.wallTime = 0;
  }

  /**
   * Finds a wall-runnable solid immediately beside the player. Only solids flagged
   * `wallRun` count, and they must be tall and long enough to ride.
   */
  private findWall(phys: PlayerPhysics, world: CollisionWorld): WallHit | null {
    const p = phys.pos;
    const hw = TUNING.halfWidth;
    const y0 = p.y + 0.35;
    const y1 = p.y + phys.height - 0.2;
    const sides: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (const [dx, dz] of sides) {
      const minX = dx > 0 ? p.x + hw : dx < 0 ? p.x - hw - WALL_PROBE : p.x - hw;
      const maxX = dx > 0 ? p.x + hw + WALL_PROBE : dx < 0 ? p.x - hw : p.x + hw;
      const minZ = dz > 0 ? p.z + hw : dz < 0 ? p.z - hw - WALL_PROBE : p.z - hw;
      const maxZ = dz > 0 ? p.z + hw + WALL_PROBE : dz < 0 ? p.z - hw : p.z + hw;

      for (const s of world.solids) {
        if (!s.wallRun) continue;
        if (!overlap(minX, maxX, s.min.x, s.max.x)) continue;
        if (!overlap(minZ, maxZ, s.min.z, s.max.z)) continue;
        if (!overlap(y0, y1, s.min.y, s.max.y)) continue;
        if (s.max.y < p.y + 1.0) continue;

        const alongZ = dx !== 0;
        const length = alongZ ? s.max.z - s.min.z : s.max.x - s.min.x;
        if (length < WALL_MIN_LENGTH) continue;

        return {
          solid: s,
          normal: new THREE.Vector3(-dx, 0, -dz),
          tangent: new THREE.Vector3(alongZ ? 0 : 1, 0, alongZ ? 1 : 0),
        };
      }
    }
    return null;
  }

  // ------------------------------------------------------- vault / mantle

  /**
   * Looks for a ledge or low obstacle directly ahead. On success it starts the
   * animation and returns true. Vault uses the low band and needs a thin obstacle.
   * Mantle uses the higher band and lands on top of the ledge.
   */
  private tryStartLedge(
    phys: PlayerPhysics,
    world: CollisionWorld,
    inp: ParkourInput,
    kind: 'vault' | 'mantle',
  ): boolean {
    // Use the wish direction if moving, otherwise the camera direction, snapped to an axis.
    let dx = inp.wishX;
    let dz = inp.wishZ;
    if (dx === 0 && dz === 0) {
      dx = inp.forwardX;
      dz = inp.forwardZ;
    }
    const snapX = Math.abs(dx) >= Math.abs(dz);
    const axisX = snapX ? Math.sign(dx) || 1 : 0;
    const axisZ = snapX ? 0 : Math.sign(dz) || 1;

    const p = phys.pos;
    const hw = TUNING.halfWidth;
    const minTop = kind === 'vault' ? VAULT_MIN_TOP : MANTLE_MIN_TOP;
    const maxTop = kind === 'vault' ? VAULT_MAX_TOP : MANTLE_MAX_TOP;
    const probeX = p.x + axisX * (hw + 0.3);
    const probeZ = p.z + axisZ * (hw + 0.3);

    let target: Solid | null = null;
    for (const s of world.solids) {
      if (probeX < s.min.x - 0.05 || probeX > s.max.x + 0.05) continue;
      if (probeZ < s.min.z - 0.05 || probeZ > s.max.z + 0.05) continue;
      if (s.min.y > p.y + 0.6) continue;
      const rel = s.max.y - p.y;
      if (rel < minTop || rel > maxTop) continue;
      if (!target || s.max.y > target.max.y) target = s;
    }
    if (!target) return false;

    const topY = target.max.y + 0.02;
    const nearX = axisX > 0 ? target.min.x : target.max.x;
    const farX = axisX > 0 ? target.max.x : target.min.x;
    const nearZ = axisZ > 0 ? target.min.z : target.max.z;
    const farZ = axisZ > 0 ? target.max.z : target.min.z;

    let landX: number;
    let landZ: number;
    if (kind === 'vault') {
      const depth = Math.abs(farX - nearX) + Math.abs(farZ - nearZ);
      if (depth > VAULT_MAX_DEPTH) return false;
      // Land just past the far face, aligned with the player's lateral position.
      landX = axisX !== 0 ? farX + axisX * (hw + 0.45) : p.x;
      landZ = axisZ !== 0 ? farZ + axisZ * (hw + 0.45) : p.z;
    } else {
      // Land on the top of the ledge, just past its near edge.
      landX = axisX !== 0 ? nearX + axisX * (hw + 0.45) : p.x;
      landZ = axisZ !== 0 ? nearZ + axisZ * (hw + 0.45) : p.z;
    }

    // The landing needs a surface under it (the ledge for a mantle, the roof beyond
    // the crate for a vault) and clear headroom above that surface.
    const landY = this.supportTop(world, landX, landZ, topY + 0.05);
    if (landY === null) return false;
    const clearMin = new THREE.Vector3(landX - hw, landY + 0.01, landZ - hw);
    const clearMax = new THREE.Vector3(landX + hw, landY + TUNING.standHeight, landZ + hw);
    if (world.overlaps(clearMin, clearMax)) return false;

    const dir = new THREE.Vector3(axisX, 0, axisZ);
    const speed = phys.speed;
    this.anim = {
      kind,
      start: p.clone(),
      target: new THREE.Vector3(landX, landY + 0.02, landZ),
      clearY: Math.max(p.y, topY) + 0.2,
      dir,
      elapsed: 0,
      duration: kind === 'vault' ? VAULT_DURATION : MANTLE_DURATION,
      speedAfter: kind === 'vault' ? Math.max(speed, 6) : Math.max(speed * 0.5, 2),
    };
    this.mode = 'anim';
    this.wallSolid = null;
    if (kind === 'vault') this.events.vault = true;
    else this.events.mantle = true;
    return true;
  }

  /**
   * Highest solid top at or below `maxY` that the player's footprint sits on at (x, z).
   * Returns null if nothing supports that spot.
   */
  private supportTop(world: CollisionWorld, x: number, z: number, maxY: number): number | null {
    const hw = TUNING.halfWidth;
    let best: number | null = null;
    for (const s of world.solids) {
      if (s.max.y > maxY) continue;
      if (x + hw < s.min.x || x - hw > s.max.x) continue;
      if (z + hw < s.min.z || z - hw > s.max.z) continue;
      if (best === null || s.max.y > best) best = s.max.y;
    }
    return best;
  }
}
