import { Vector3 } from 'three';
import { Box, CollisionWorld } from '../world/CollisionWorld';
import { MOVE, PlayerEvent } from './MoveConfig';
import { HALF_WIDTH, PlayerPhysics } from './PlayerPhysics';

/** How far beside the body the wall probe reaches. */
const WALL_PROBE = 0.15;

interface Climb {
  kind: 'vault' | 'mantle';
  t: number;
  duration: number;
  start: Vector3;
  end: Vector3;
  dirX: number;
  dirZ: number;
  speed: number;
}

/**
 * Wall running, vaulting and ledge mantling.
 * These moves take over the body's position or velocity while active.
 */
export class ParkourSystem {
  wallRunning = false;
  /** +1 when the wall is on the player's right, -1 when on the left, 0 when none. */
  wallSide = 0;
  private wallDirZ = -1;
  private wallTime = 0;
  /** One wall run per airtime; cleared on landing. Prevents infinite wall running. */
  private wallUsed = false;
  private climb: Climb | null = null;

  constructor(
    private readonly world: CollisionWorld,
    private readonly physics: PlayerPhysics,
    private readonly events: PlayerEvent[],
  ) {}

  get isClimbing(): boolean {
    return this.climb !== null;
  }

  /** 0..1 progress of the current vault or mantle. */
  get climbProgress(): number {
    return this.climb ? this.climb.t : 0;
  }

  reset(): void {
    this.wallRunning = false;
    this.wallSide = 0;
    this.wallTime = 0;
    this.wallUsed = false;
    this.climb = null;
  }

  /**
   * Starts or continues a wall run. Returns true while the wall run controls the body.
   * Gravity is mostly cancelled so the player glides along the wall.
   */
  updateWallRun(dt: number, feet: Vector3, vel: Vector3, height: number, grounded: boolean): boolean {
    if (grounded) {
      this.wallRunning = false;
      this.wallUsed = false;
      return false;
    }

    if (this.wallRunning) {
      if (this.detectWall(feet, height) !== this.wallSide || this.wallTime >= MOVE.wallRunMaxTime) {
        this.wallRunning = false;
        return false;
      }
      this.wallTime += dt;
      vel.x = this.wallSide * 2; // press gently into the wall to stay attached
      vel.z = this.wallDirZ * Math.max(Math.abs(vel.z), MOVE.wallRunSpeed);
      vel.y = Math.max(vel.y - MOVE.gravity * MOVE.wallRunGravityScale * dt, -MOVE.wallRunFallSpeed);
      return true;
    }

    if (this.wallUsed) return false;
    const side = this.detectWall(feet, height);
    if (side === 0 || Math.hypot(vel.x, vel.z) < MOVE.wallRunMinSpeed) return false;

    this.wallRunning = true;
    this.wallSide = side;
    this.wallDirZ = vel.z > 0 ? 1 : -1;
    this.wallTime = 0;
    this.wallUsed = true;
    vel.y = Math.max(vel.y, 0);
    this.events.push({ type: 'wallrun', value: 0 });
    return this.updateWallRun(dt, feet, vel, height, grounded);
  }

  /** Pushes the player off the wall. */
  wallJump(vel: Vector3): void {
    this.wallRunning = false;
    vel.x = -this.wallSide * MOVE.wallJumpPush;
    vel.y = MOVE.jumpVelocity * 0.95;
  }

  /** Returns +1 / -1 for a wall-run surface touching the right / left side of the body, else 0. */
  detectWall(feet: Vector3, height: number): number {
    const yMin = feet.y + 0.3;
    const yMax = feet.y + height * 0.8;
    const zMin = feet.z - HALF_WIDTH * 0.8;
    const zMax = feet.z + HALF_WIDTH * 0.8;
    const isWall = (box: Box): boolean => box.wallRun;

    const right = this.world.findOverlap(
      new Vector3(feet.x + HALF_WIDTH, yMin, zMin),
      new Vector3(feet.x + HALF_WIDTH + WALL_PROBE, yMax, zMax),
      isWall,
    );
    if (right) return 1;

    const left = this.world.findOverlap(
      new Vector3(feet.x - HALF_WIDTH - WALL_PROBE, yMin, zMin),
      new Vector3(feet.x - HALF_WIDTH, yMax, zMax),
      isWall,
    );
    return left ? -1 : 0;
  }

  /**
   * Vault (E): finds a low obstacle directly ahead and carries the body over it to the far side.
   * Returns true if the vault started.
   */
  tryVault(feet: Vector3, vel: Vector3, dirX: number, dirZ: number): boolean {
    const reach = MOVE.vaultReach;
    const probeMin = new Vector3(
      feet.x - HALF_WIDTH + Math.min(0, dirX * reach),
      feet.y + 0.05,
      feet.z - HALF_WIDTH + Math.min(0, dirZ * reach),
    );
    const probeMax = new Vector3(
      feet.x + HALF_WIDTH + Math.max(0, dirX * reach),
      feet.y + 0.2,
      feet.z + HALF_WIDTH + Math.max(0, dirZ * reach),
    );
    const box = this.world.findOverlap(probeMin, probeMax, (candidate) =>
      candidate.max.y > feet.y + 0.3 &&
      candidate.max.y <= feet.y + MOVE.vaultMaxHeight &&
      candidate.min.y <= feet.y + 0.35,
    );
    if (!box) return false;

    let endX = feet.x;
    let endZ = feet.z;
    if (Math.abs(dirZ) >= Math.abs(dirX)) {
      endZ = dirZ < 0 ? box.min.z - HALF_WIDTH - 0.3 : box.max.z + HALF_WIDTH + 0.3;
    } else {
      endX = dirX < 0 ? box.min.x - HALF_WIDTH - 0.3 : box.max.x + HALF_WIDTH + 0.3;
    }
    const end = new Vector3(endX, box.max.y + 0.02, endZ);
    if (this.physics.overlapsBody(end, MOVE.standHeight)) return false;

    const speed = Math.max(Math.hypot(vel.x, vel.z), 6);
    this.startClimb('vault', feet, end, dirX, dirZ, speed, MOVE.vaultDuration);
    return true;
  }

  /**
   * Ledge recovery: called when walking or falling into a solid whose top is a short
   * distance above the feet. Pulls the body up onto the top. Returns true if it started.
   */
  tryMantle(box: Box, feet: Vector3, vel: Vector3, wishX: number, wishZ: number): boolean {
    const rise = box.max.y - feet.y;
    if (box.min.y > feet.y + 0.35 || rise <= 0.3 || rise > MOVE.mantleMaxHeight) return false;

    let endX = Math.min(Math.max(feet.x, box.min.x + HALF_WIDTH), box.max.x - HALF_WIDTH);
    let endZ = Math.min(Math.max(feet.z, box.min.z + HALF_WIDTH), box.max.z - HALF_WIDTH);
    if (Math.abs(wishZ) >= Math.abs(wishX)) {
      endZ = wishZ < 0 ? box.max.z - HALF_WIDTH - 0.3 : box.min.z + HALF_WIDTH + 0.3;
    } else {
      endX = wishX < 0 ? box.max.x - HALF_WIDTH - 0.3 : box.min.x + HALF_WIDTH + 0.3;
    }
    const end = new Vector3(endX, box.max.y + 0.02, endZ);
    if (this.physics.overlapsBody(end, MOVE.standHeight)) return false;

    const speed = Math.hypot(vel.x, vel.z) * 0.4;
    this.startClimb('mantle', feet, end, wishX, wishZ, Math.max(speed, 2), MOVE.mantleDuration);
    return true;
  }

  /**
   * Advances an active vault or mantle, moving the body along a smooth path.
   * Returns true while the climb is still running (physics should be skipped).
   */
  updateClimb(dt: number, feet: Vector3, vel: Vector3): boolean {
    const climb = this.climb;
    if (!climb) return false;

    climb.t = Math.min(1, climb.t + dt / climb.duration);
    const s = climb.t * climb.t * (3 - 2 * climb.t);
    feet.x = climb.start.x + (climb.end.x - climb.start.x) * s;
    feet.z = climb.start.z + (climb.end.z - climb.start.z) * s;
    feet.y = climb.start.y + (climb.end.y - climb.start.y) * s
      + (climb.kind === 'vault' ? Math.sin(Math.PI * climb.t) * 0.2 : 0);
    vel.set(0, 0, 0);

    if (climb.t < 1) return true;

    this.climb = null;
    vel.set(climb.dirX * climb.speed, 0, climb.dirZ * climb.speed);
    return false;
  }

  private startClimb(
    kind: 'vault' | 'mantle',
    from: Vector3,
    to: Vector3,
    dirX: number,
    dirZ: number,
    speed: number,
    duration: number,
  ): void {
    const length = Math.hypot(dirX, dirZ) || 1;
    this.climb = {
      kind,
      t: 0,
      duration,
      start: from.clone(),
      end: to.clone(),
      dirX: dirX / length,
      dirZ: dirZ / length,
      speed,
    };
    this.events.push({ type: kind, value: 0 });
  }
}
