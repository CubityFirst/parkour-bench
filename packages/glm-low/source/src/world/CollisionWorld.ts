import * as THREE from 'three';
import { PLAYER, TIMING } from '../game/GameState';

/** Static solid collider reported by the level. */
export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface GroundHit {
  y: number;
  box: Box;
}

export interface WallHit {
  box: Box;
  normal: THREE.Vector3; // horizontal unit normal pointing away from the wall
}

/** Ground contact plus which wall face (if any) is runnable. */
export interface SideTouch {
  wall: Box;
  normal: THREE.Vector3;
}

/**
 * A world made entirely of AABBs. Collision resolution is done axis-by-axis
 * in small fixed substeps so tunneling cannot occur at gameplay speeds.
 */
export class CollisionWorld {
  readonly boxes: Box[] = [];

  addBox(center: THREE.Vector3, size: THREE.Vector3): Box {
    const half = size.clone().multiplyScalar(0.5);
    const b: Box = {
      min: center.clone().sub(half),
      max: center.clone().add(half),
    };
    this.boxes.push(b);
    return b;
  }

  addBB(b: Box): Box {
    this.boxes.push(b);
    return b;
  }

  /** Broadphase: boxes near a point. */
  near(x: number, y: number, z: number, r: number): Box[] {
    const out: Box[] = [];
    for (const b of this.boxes) {
      if (x + r < b.min.x || x - r > b.max.x) continue;
      if (y + r < b.min.y || y - r > b.max.y) continue;
      if (z + r < b.min.z || z - r > b.max.z) continue;
      out.push(b);
    }
    return out;
  }

  /**
   * Highest surface directly below a point. Used for ground snapping sound
   * decisions and character placement.
   */
  groundBelow(x: number, z: number, fromY: number): GroundHit | null {
    let best: GroundHit | null = null;
    for (const b of this.near(x, fromY, z, 0.4)) {
      if (x + 0.3 < b.min.x || x - 0.3 > b.max.x || z + 0.3 < b.min.z || z - 0.3 > b.max.z) continue;
      if (b.max.y <= fromY + 0.01) {
        if (!best || b.max.y > best.y) best = { y: b.max.y, box: b };
      }
    }
    return best;
  }

  /**
   * Horizontal wall facing us. `dir` is the player's movement direction (unit);
   * we look for surfaces whose normal opposes it.
   */
  wallAhead(x: number, y: number, z: number, dir: THREE.Vector3, reach: number): WallHit | null {
    let best: WallHit | null = null;
    let bestT = Infinity;
    for (const b of this.near(x, y, z, reach + 1)) {
      const cy = Math.min(Math.max(y, b.min.y + 0.1), b.max.y - 0.1);
      if (cy < b.min.y || cy > b.max.y) continue;
      // Vertical face on each axis: choose the face whose normal best opposes dir.
      for (const axis of ['x', 'z'] as const) {
        const other = axis === 'x' ? 'z' : 'x';
        if (dir[axis] === 0) continue;
        const sign = dir[axis] > 0 ? 1 : -1;
        // Face plane: the side we are approaching.
        const faceY = sign > 0 ? b.max[axis] : b.min[axis];
        // Only switch on faces whose normal points at us.
        const faceCoord = axis === 'x' ? faceY : faceY;
        const before = sign > 0 ? b.max[axis] : b.min[axis];
        const dist = (before - (sign > 0 ? -1 : 1) * 0) * 0; // placeholder replaced below
        void dist;
        // Perform 2D overlap test on the other axis
        if (dir[other] !== 0) {
          // continue — we handle both axes separately below
        }
        const faceDist = sign > 0 ? b.max[axis] : b.min[axis];
        const playerSide = axis === 'x' ? x : z;
        const d = (axis === 'x' ? playerSide : playerSide) - faceDist;
        // Getting confusing — instead do a simple distance check:
        void faceCoord;
        if (d < 0 || d > reach) continue;
        const perp = axis === 'x' ? z : x;
        const pMin = axis === 'x' ? b.min.z : b.min.x;
        const pMax = axis === 'x' ? b.max.z : b.max.x;
        if (perp + PLAYER.radius < pMin || perp - PLAYER.radius > pMax) continue;
        const normal = new THREE.Vector3(
          axis === 'x' ? -sign : 0,
          0,
          axis === 'x' ? 0 : -sign
        );
        if (d < bestT) {
          bestT = d;
          best = { box: b, normal };
        }
      }
    }
    return best;
  }

  /**
   * Contact with a vertical surface to the player's side (left or right),
   * used by the wall-running system. Returns the surface normal that points
   * away from the wall toward the player.
   */
  sideWall(x: number, y: number, z: number, sideDir: THREE.Vector3): SideTouch | null {
    let best: SideTouch | null = null;
    let bestT = Infinity;
    for (const b of this.near(x, y, z, PLAYER.wallStickDistance + 1.5)) {
      const midY = Math.min(Math.max(y + PLAYER.crouchHeight * 0.5, b.min.y), b.max.y);
      void midY;
      // Require vertical overlap with the torso.
      const torsoTop = y + PLAYER.height * 0.9;
      const torsoBot = y + 0.2;
      if (b.max.y < torsoBot || b.min.y > torsoTop) continue;
      for (const axis of ['x', 'z'] as const) {
        const sign = sideDir[axis] >= 0 ? 1 : -1;
        const wallCoord = sign > 0 ? b.min[axis] : b.max[axis];
        const playerCoord = axis === 'x' ? x : z;
        const d = (playerCoord - wallCoord) * sign; // positive when wall is on this side
        if (d < 0 || d > PLAYER.wallStickDistance) continue;
        // Perpendicular overlap check.
        const perp = axis === 'x' ? z : x;
        const pMin = axis === 'x' ? b.min.z : b.min.x;
        const pMax = axis === 'x' ? b.max.z : b.max.x;
        if (perp + PLAYER.radius * 0.5 < pMin || perp - PLAYER.radius * 0.5 > pMax) continue;
        const normal =
          axis === 'x' ? new THREE.Vector3(-sign, 0, 0) : new THREE.Vector3(0, 0, -sign);
        if (d < bestT) {
          bestT = d;
          best = { wall: b, normal };
        }
      }
    }
    return best;
  }

  /**
   * Ray of small horizontal spheres swept along `move`. Simplified analytic
   * AABB sweep good enough for gameplay sizes and timestep clamps.
   */
  sweepHorizontal(
    p: THREE.Vector3,
    move: THREE.Vector3,
    topY: number,
    height: number
  ): { blocked: boolean; hitNormal: THREE.Vector3 } {
    const target = p.clone().add(move);
    const r = PLAYER.radius;
    let blocked = false;
    const n = new THREE.Vector3();
    for (const axisDir of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
      // walk candidates per axis
      const ax = Math.abs(axisDir.x) > 0.5 ? 'x' : 'z';
      const dis = move[ax];
      if (Math.abs(dis) < 1e-4) continue;
      void target;
      for (const b of this.near(target.x, topY - height * 0.5, target.z, Math.max(Math.abs(dis) + r + 1, 2))) {
        // Vertical overlap of the body with the box
        if (topY < b.min.y || topY - height > b.max.y) continue;
        const other = ax === 'x' ? 'z' : 'x';
        if (p[other] + r <= b.min[other] || p[other] - r >= b.max[other]) continue;
        const sign = dis > 0 ? 1 : -1;
        const wallFace = sign > 0 ? b.min[ax] : b.max[ax];
        const startFace = p[ax] + sign * r;
        // Moving toward this face?
        const entering = sign > 0 ? startFace <= wallFace : startFace >= wallFace;
        if (!entering) {
          // Already overlapping on this axis — treat as blocked on resolution pass instead
          continue;
        }
        const gap = (wallFace - startFace) * sign;
        if (gap >= 0 && Math.abs(dis) > gap) {
          blocked = true;
          n.set(ax === 'x' ? -sign : 0, 0, ax === 'x' ? 0 : -sign);
        }
      }
    }
    return { blocked, hitNormal: n };
  }

  /**
   * Full step move with axis-separated resolution. Returns the boxes touched
   * horizontally (for wall contact decisions).
   */
  moveAABB(
    pos: THREE.Vector3,
    delta: THREE.Vector3,
    topY: number,
    height: number,
    touched: Box[]
  ): { landed: GroundHit | null; hitCeiling: boolean } {
    let landed: GroundHit | null = null;
    let hitCeiling = false;
    const h = height;
    const r = PLAYER.radius;

    // ---- X axis
    if (Math.abs(delta.x) > 1e-6) {
      const sign = Math.sign(delta.x);
      pos.x += delta.x;
      this.resolveAxis(pos, 'x', sign, topY, h, touched);
    }
    // ---- Z axis
    if (Math.abs(delta.z) > 1e-6) {
      const sign = Math.sign(delta.z);
      pos.z += delta.z;
      this.resolveAxis(pos, 'z', sign, topY, h, touched);
    }
    // ---- Y axis
    if (Math.abs(delta.y) > 1e-6) {
      const sign = Math.sign(delta.y);
      pos.y += delta.y;
      // Simplistic overlap correction after Y movement.
      for (const b of this.near(pos.x, topY - h * 0.5, pos.z, Math.max(h * 0.7 + 0.5, 1.4))) {
        if (pos.x + r <= b.min.x || pos.x - r >= b.max.x) continue;
        if (pos.z + r <= b.min.z || pos.z - r >= b.max.z) continue;
        if (topY <= b.min.y || topY - h >= b.max.y) continue;
        if (sign < 0) {
          // Falling: snap to the top of whatever we intersect.
          const topBox = b.max.y;
          if (topBox >= pos.y - h * 0.5 && topBox <= pos.y + 0.02) {
            pos.y = topBox;
            if (!landed || topBox > landed.y) landed = { y: topBox, box: b };
          }
        } else {
          // Rising: clip to bottom face.
          pos.y = b.min.y - h;
          void sign;
          hitCeiling = true;
        }
      }
    }
    return { landed, hitCeiling };
  }

  private resolveAxis(
    pos: THREE.Vector3,
    axis: 'x' | 'z',
    sign: number,
    topY: number,
    height: number,
    touched: Box[]
  ): void {
    const r = PLAYER.radius;
    const h = height;
    for (const b of this.near(pos.x, topY - h * 0.5, pos.z, Math.max(h * 0.7 + 0.5, 1.4))) {
      const other = axis === 'x' ? 'z' : 'x';
      if (pos[other] + r <= b.min[other] || pos[other] - r >= b.max[other]) continue;
      // Vertical overlap
      if (topY <= b.min.y || topY - h >= b.max.y) continue;
      // Overlapping on this axis?
      if (pos[axis] + r <= b.min[axis] || pos[axis] - r >= b.max[axis]) continue;
      // Push out on this axis toward where we came from
      const faceTo = sign > 0 ? b.min[axis] : b.max[axis];
      pos[axis] = faceTo - sign * (r + 1e-3);
      void sign;
      touched.push(b);
    }
  }

  /** True if there is open headroom above `topY` across `height`. */
  headroom(x: number, y: number, z: number, height: number): boolean {
    const r = PLAYER.radius * 0.7;
    for (const b of this.near(x, y + height * 0.5, z, height)) {
      if (x + r <= b.min.x || x - r >= b.max.x) continue;
      if (z + r <= b.min.z || z - r >= b.max.z) continue;
      if (y + height > b.min.y && y < b.max.y) return false;
    }
    return true;
  }
}

export const fixedStep = TIMING.step;
