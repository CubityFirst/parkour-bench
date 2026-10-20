import { PLAYER } from '../config.ts';
import type { PlayerController, PlayerInput } from '../player/PlayerController.ts';
import type { LevelLayout, RouteNode } from '../world/LevelBuilder.ts';

const wrap = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export interface AutopilotOptions {
  /** Per-node early-jump distance in metres (human error model). */
  lead?: number[];
  /** Per-node lateral aim offset in metres. */
  lateral?: number[];
  /** Maximum turn rate (rad/s). */
  turnRate?: number;
}

/**
 * Course-following autopilot used by the test tooling and the optional ?debug demo. It steers toward the
 * layout's route nodes and presses jump / slide / vault at the marked points - exactly the inputs a
 * player would produce, fed through the real PlayerController. Not used in normal play.
 */
export class Autopilot {
  readonly route: RouteNode[];
  index = 0;
  yaw = 0;
  private prevX = 0;
  private prevZ = 0;
  private sliding = false;
  private holdJump = 0;
  private time = 0;
  private wallSteerNode: RouteNode | null = null;
  private wallSteerUntil = 0;
  private readonly opts: AutopilotOptions;
  /** Set while the node under test should not be rescued by the mid-air ledge grab (margin analysis). */
  onJumpTriggered: ((nodeIndex: number) => void) | null = null;

  constructor(layout: LevelLayout, opts: AutopilotOptions = {}) {
    this.route = layout.route;
    this.opts = opts;
  }

  /** Begin following the route from `nodeIndex`, standing at (x, z) facing `yaw`. */
  start(x: number, z: number, yaw: number, nodeIndex: number): void {
    this.index = nodeIndex;
    this.prevX = x;
    this.prevZ = z;
    this.yaw = yaw;
    this.sliding = false;
    this.holdJump = 0;
    this.time = 0;
    this.wallSteerNode = null;
  }

  get done(): boolean {
    return this.index >= this.route.length;
  }

  /** Fill `input` for the next fixed tick. Edge flags are only set for one tick. */
  update(ctrl: PlayerController, input: PlayerInput, dt: number): void {
    const b = ctrl.body;
    this.time += dt;
    const node = this.route[this.index];
    const lead = this.opts.lead?.[this.index] ?? 0;
    const lateral = this.opts.lateral?.[this.index] ?? 0;

    // --- steering target ---
    let tx = b.x;
    let tz = b.z - 1;
    if (node) {
      tx = node.x;
      tz = node.z;
      if (lateral) {
        let dx = node.x - this.prevX;
        let dz = node.z - this.prevZ;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        tx += -dz * lateral;
        tz += dx * lateral;
      }
    }
    const dx = tx - b.x;
    const dz = tz - b.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.3) {
      const want = Math.atan2(-dx, -dz);
      const maxTurn = (this.opts.turnRate ?? 8) * dt;
      const diff = wrap(want - this.yaw);
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }

    input.yaw = this.yaw;
    input.moveY = 1;
    input.moveX = 0;
    input.sprint = true;
    input.jumpPressed = false;
    input.slidePressed = false;
    input.vaultPressed = false;

    if (node) {
      let ux = node.x - this.prevX;
      let uz = node.z - this.prevZ;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      const remaining = (node.x - b.x) * ux + (node.z - b.z) * uz;
      const trigger = Math.max(lead, 0.03 + ctrl.speed * dt * 0.55);
      let advance = false;
      switch (node.act) {
        case 'run':
          advance = remaining <= 1.2 || dist < 1.8;
          break;
        case 'jump':
        case 'jumpWall':
          if (remaining <= trigger) {
            if (b.onGround || ctrl.state === 'ground') {
              input.jumpPressed = true;
              input.jumpHeld = true;
              this.holdJump = this.time + 0.4;
              if (node.act === 'jumpWall') {
                this.wallSteerNode = node;
                this.wallSteerUntil = this.time + 1.6;
              }
              this.onJumpTriggered?.(this.index);
              advance = true;
            } else if (ctrl.state === 'air') {
              advance = true;
            }
          }
          break;
        case 'slide':
          if (remaining <= trigger + 0.07) {
            input.slidePressed = true;
            this.sliding = true;
            advance = true;
          }
          break;
        case 'slideEnd':
          if (remaining <= 0.1) {
            this.sliding = false;
            advance = true;
          }
          break;
        case 'vault':
          if (remaining <= trigger) {
            input.vaultPressed = true;
            advance = true;
          }
          break;
        case 'wallEnd':
          advance = remaining <= 0.5 || ctrl.state === 'ground';
          break;
        case 'finish':
          advance = false;
          break;
        default:
          advance = true;
      }
      if (advance) {
        this.prevX = node.x;
        this.prevZ = node.z;
        this.index++;
      }
    }

    // Lean toward the wall after a wall-jump node until the wall run has latched.
    if (this.wallSteerNode && this.time < this.wallSteerUntil && ctrl.state === 'air') {
      input.moveX = (this.wallSteerNode.steer ?? 0) * 0.55;
    }
    input.slideHeld = this.sliding;
    // Assert the held state every tick (the game loop re-reads the keyboard once per frame).
    input.jumpHeld = this.time <= this.holdJump;
  }

  /** Convenience for tools: is the player inside an AABB? */
  static overlaps(body: { x: number; y: number; z: number; height: number }, a: { min: number[]; max: number[] }): boolean {
    const hw = PLAYER.halfWidth;
    return (
      body.x - hw < a.max[0]! &&
      body.x + hw > a.min[0]! &&
      body.y < a.max[1]! &&
      body.y + body.height > a.min[1]! &&
      body.z - hw < a.max[2]! &&
      body.z + hw > a.min[2]!
    );
  }
}
