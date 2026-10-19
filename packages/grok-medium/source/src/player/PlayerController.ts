import * as THREE from 'three';
import type { InputFrame, SpawnPoint, StepEvents } from '../game/types';
import { emptyEvents } from '../game/types';
import { clamp, damp, PHYS } from './constants';
import { accelerate, applyFriction, wishVector } from './PlayerPhysics';
import {
  canFit,
  floorNear,
  moveBody,
  type Body,
  type Solid,
} from '../world/CollisionWorld';
import type { Trigger } from '../world/course';
import { CheckpointSystem } from '../world/Checkpoints';
import {
  findMantle,
  findVault,
  probeWall,
  sampleAction,
  slideCeilingAhead,
  type ActionMove,
  type WallContact,
} from './ParkourSystem';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Feet sit at (x, y, z). The view object is the only look frame:
 * local -Z is forward, and movement reads that basis back out of the object.
 * Yaw 0 looks down world -Z. Positive yaw turns left (counter-clockwise from above).
 */
export class PlayerController {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  r = PHYS.radius;
  h = PHYS.standH;
  grounded = false;
  sliding = false;
  crouch = 0;
  speed = 0;
  wallSide = 0;
  actionKind: '' | 'vault' | 'mantle' = '';
  prompt = '';
  hint = '';
  teleportTick = 0;
  checkpoint = 0;
  // Camera, not a plain Object3D: Camera.getWorldDirection returns local -Z.
  // A plain object reports +Z, which would invert WASD.
  readonly view = new THREE.Camera();

  private coyote = 0;
  private jumpBuffer = 0;
  private jumpLive = false;
  private wall: WallContact | null = null;
  private wallCd = 0;
  private action: ActionMove | null = null;
  private stepAcc = 0;
  private slideX = 0;
  private slideZ = -1;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly solids: Solid[];
  private readonly triggers: Trigger[];
  private readonly killY: number;
  private readonly checkpoints: CheckpointSystem;

  constructor(solids: Solid[], triggers: Trigger[], spawn: SpawnPoint, killY: number) {
    this.solids = solids;
    this.triggers = triggers;
    this.killY = killY;
    this.checkpoints = new CheckpointSystem(spawn, triggers);
    this.view.rotation.order = 'YXZ';
    this.respawn(0, false);
  }

  get spawnPoint(): SpawnPoint {
    return this.checkpoints.current();
  }

  addLook(dx: number, dy: number, sensitivity: number): void {
    const s = 0.00215 * sensitivity;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.35, 1.35);
  }

  respawn(index?: number, countTeleport = true): void {
    if (index !== undefined) {
      this.checkpoints.index = clamp(index, 0, this.checkpoints.spawns.length - 1);
    }
    this.checkpoint = this.checkpoints.index;
    const s = this.spawnPoint;
    this.x = s.x;
    this.y = s.y;
    this.z = s.z;
    this.yaw = s.yaw;
    this.pitch = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.h = PHYS.standH;
    this.sliding = false;
    this.crouch = 0;
    this.grounded = true;
    this.coyote = PHYS.coyote;
    this.jumpBuffer = 0;
    this.jumpLive = false;
    this.wall = null;
    this.wallSide = 0;
    this.wallCd = 0;
    this.action = null;
    this.actionKind = '';
    this.prompt = '';
    this.stepAcc = 0;
    if (countTeleport) this.teleportTick++;
    this.syncView();
  }

  /** Basis currently stored on the view. Call after syncView. */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    return { fx: this.fwd.x, fz: this.fwd.z, rx: this.right.x, rz: this.right.z };
  }

  update(dt: number, input: InputFrame): StepEvents {
    const ev = emptyEvents();
    this.syncView();
    this.readBasis();
    const fx = this.fwd.x;
    const fz = this.fwd.z;
    const rx = this.right.x;
    const rz = this.right.z;
    this.prompt = '';

    if (this.coyote > 0) this.coyote -= dt;
    if (this.wallCd > 0) this.wallCd -= dt;
    if (input.jumpPressed) this.jumpBuffer = PHYS.jumpBuffer;
    else if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

    if (this.action) {
      this.stepAction(dt, ev);
      this.finishFrame(dt, ev);
      return ev;
    }

    const speed = Math.hypot(this.vx, this.vz);
    this.speed = speed;

    if (!this.grounded && this.jumpBuffer <= 0) {
      const mantle = findMantle(this.solids, this.x, this.y, this.z, this.r, fx, fz);
      const reaching = input.forward > 0.1 || this.vy > -1;
      if (mantle && reaching) {
        this.action = mantle;
        this.actionKind = 'mantle';
        ev.mantle = true;
        this.wall = null;
        this.wallSide = 0;
        this.stepAction(dt, ev);
        this.finishFrame(dt, ev);
        return ev;
      }
    }

    if (this.wall) {
      this.stepWall(dt, input, fx, fz, ev);
      this.finishFrame(dt, ev);
      return ev;
    } else if (!this.grounded && this.wallCd <= 0 && speed > PHYS.wallMinSpeed && input.forward > 0.15) {
      const hit = probeWall(this.solids, this.x, this.y, this.z, fx, fz, rx, rz);
      const away = hit ? this.vx * hit.nx + this.vz * hit.nz : 0;
      if (hit && away < 3) {
        const under = floorNear(this.solids, this.x, this.z, this.y, 2.2, 0.45);
        this.wall = {
          ...hit,
          ignoreFloorId: under ? under.id : -1,
          attachY: this.y,
          time: 0,
        };
        this.wallSide = hit.side;
        this.stickToWall();
        ev.wall = true;
        this.stepWall(dt, input, fx, fz, ev);
        this.finishFrame(dt, ev);
        return ev;
      }
    }

    const vaultReady = findVault(this.solids, this.x, this.y, this.z, this.r, fx, fz, speed);
    if (vaultReady && (this.grounded || this.coyote > 0)) this.prompt = 'E  VAULT';
    if (vaultReady && input.vaultPressed && (this.grounded || this.coyote > 0)) {
      this.action = vaultReady;
      this.actionKind = 'vault';
      this.sliding = false;
      ev.vault = true;
      this.stepAction(dt, ev);
      this.finishFrame(dt, ev);
      return ev;
    }

    const low = slideCeilingAhead(this.solids, this.x, this.y, this.z, this.r, fx, fz);
    if (!this.sliding && input.slide && this.grounded && (speed > 5.2 || low)) {
      this.sliding = true;
      const sm = Math.hypot(this.vx, this.vz);
      if (sm > 0.4) {
        this.slideX = this.vx / sm;
        this.slideZ = this.vz / sm;
      } else {
        this.slideX = fx;
        this.slideZ = fz;
      }
      this.h = PHYS.slideH;
      ev.slideOn = true;
    }

    if (this.sliding) {
      this.h = PHYS.slideH;
      const release = !input.slide && speed < 7.5;
      if ((release || speed < 1.4) && canFit(this.solids, this.x, this.y, this.z, this.r, PHYS.standH)) {
        this.sliding = false;
        this.h = PHYS.standH;
      }
    } else {
      this.h = PHYS.standH;
    }

    const canJump = this.grounded || this.coyote > 0;
    if (this.jumpBuffer > 0 && canJump) {
      this.vy = PHYS.jumpV;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpLive = true;
      ev.jumped = true;
      if (this.sliding && canFit(this.solids, this.x, this.y, this.z, this.r, PHYS.standH)) {
        this.sliding = false;
        this.h = PHYS.standH;
      }
    } else if (this.jumpLive && !input.jumpHeld && this.vy > 0) {
      this.vy *= 0.45;
      this.jumpLive = false;
    }

    this.drive(dt, input, fx, fz, rx, rz);

    if (!this.grounded) this.vy += -PHYS.gravity * dt;
    else if (!ev.jumped) this.vy = -1.2;

    const prevVy = this.vy;
    const was = this.grounded;
    const body = this.body();
    const moved = moveBody(body, this.solids, dt, !this.sliding);
    this.copyBody(body);
    this.grounded = moved.grounded;
    if (this.grounded) {
      this.coyote = PHYS.coyote;
      this.jumpLive = false;
      if (!was) {
        ev.landed = true;
        ev.impact = Math.max(0, -prevVy);
        const keep = ev.impact > 9 ? 0.94 : 0.985;
        this.vx *= keep;
        this.vz *= keep;
      }
    }

    if (this.grounded && !this.sliding && this.speed > 2.2) {
      this.stepAcc += dt * Math.max(this.speed, 4);
      const stride = this.speed > 8 ? 4.6 : 3.3;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        ev.footstep = true;
      }
    } else if (!this.grounded) {
      this.stepAcc = Math.min(this.stepAcc, 1);
    }

    this.finishFrame(dt, ev);
    return ev;
  }

  private drive(
    dt: number,
    input: InputFrame,
    fx: number,
    fz: number,
    rx: number,
    rz: number,
  ): void {
    if (this.sliding && Math.hypot(this.vx, this.vz) > 3.1) {
      const wish = wishVector(fx, fz, rx, rz, input.forward, input.strafe);
      if (wish.mag > 0.2) {
        const turn = 1.6 * dt;
        this.slideX += (wish.wx - this.slideX) * turn;
        this.slideZ += (wish.wz - this.slideZ) * turn;
        const m = Math.hypot(this.slideX, this.slideZ) || 1;
        this.slideX /= m;
        this.slideZ /= m;
      }
      let spd = Math.hypot(this.vx, this.vz);
      spd = Math.max(0, spd - PHYS.slideDecel * dt);
      this.vx = this.slideX * spd;
      this.vz = this.slideZ * spd;
      this.speed = spd;
      return;
    }

    const wish = wishVector(fx, fz, rx, rz, input.forward, input.strafe);
    const sprint = input.sprint && input.forward > 0.2 && !this.sliding;
    const capped = this.sliding ? PHYS.crawl : sprint ? PHYS.sprint : PHYS.walk;
    if (this.grounded) {
      const fr = applyFriction(this.vx, this.vz, dt, this.sliding ? 1.2 : PHYS.friction);
      this.vx = fr.vx;
      this.vz = fr.vz;
      if (wish.mag > 0) {
        const a = accelerate(this.vx, this.vz, wish.wx, wish.wz, capped * wish.mag, PHYS.groundAccel, dt);
        this.vx = a.vx;
        this.vz = a.vz;
      }
    } else if (wish.mag > 0) {
      const a = accelerate(this.vx, this.vz, wish.wx, wish.wz, PHYS.walk * wish.mag, PHYS.airAccel, dt);
      this.vx = a.vx;
      this.vz = a.vz;
    }
    const cap = PHYS.sprint + 2.5;
    const hs = Math.hypot(this.vx, this.vz);
    if (hs > cap) {
      this.vx = (this.vx / hs) * cap;
      this.vz = (this.vz / hs) * cap;
    }
    this.speed = Math.hypot(this.vx, this.vz);
  }

  private stepWall(
    dt: number,
    input: InputFrame,
    fx: number,
    fz: number,
    ev: StepEvents,
  ): boolean {
    const w = this.wall;
    if (!w) return true;
    w.time += dt;
    const tx = -w.nz;
    const tz = w.nx;
    const align = fx * tx + fz * tz;
    const sx = align >= 0 ? tx : -tx;
    const sz = align >= 0 ? tz : -tz;
    let spd = Math.max(PHYS.wallMinSpeed + 1.6, Math.hypot(this.vx, this.vz));
    spd = Math.min(PHYS.sprint + 0.3, Math.max(PHYS.wallMinSpeed, spd - 0.35 * dt));
    this.vx = sx * spd;
    this.vz = sz * spd;
    this.vy = 0;
    // Height stays locked while attached. A sprint jump leaves the feet above the
    // next roof; the landing probe below pulls them down onto it.
    this.y = w.attachY;
    this.speed = spd;
    this.wallSide = w.side;
    this.grounded = false;

    const solid = this.solids.find((s) => s.id === w.id);
    let offWall = false;
    if (solid) {
      if (w.axis === 'x') offWall = this.z < solid.minZ + 0.4 || this.z > solid.maxZ - 0.4;
      else offWall = this.x < solid.minX + 0.4 || this.x > solid.maxX - 0.4;
    }

    const leave =
      w.time > PHYS.wallMaxTime ||
      input.forward < -0.2 ||
      spd < PHYS.wallMinSpeed - 0.4 ||
      offWall;

    if (w.time > 0.16 && !input.jumpPressed && !leave) {
      const floor = floorNear(this.solids, this.x, this.z, this.y, 1.75, 0.35);
      if (floor && floor.id !== w.ignoreFloorId && floor.id !== w.id) {
        const deck = this.solids.find((s) => s.id === floor.id);
        const broad =
          !!deck &&
          deck.maxX - deck.minX > 1.4 &&
          deck.maxZ - deck.minZ > 1.4 &&
          !deck.wallRun &&
          !deck.vaultable;
        if (broad) {
          this.y = floor.y;
          this.vy = 0;
          this.grounded = true;
          this.coyote = PHYS.coyote;
          this.wall = null;
          this.wallSide = 0;
          this.wallCd = 0.28;
          ev.landed = true;
          ev.impact = 2;
          return true;
        }
      }
    }

    if (input.jumpPressed || leave) {
      if (input.jumpPressed) {
        this.vx += w.nx * 5.1;
        this.vz += w.nz * 5.1;
        this.vy = PHYS.jumpV * 0.95;
        this.jumpBuffer = 0;
        this.coyote = 0;
        ev.jumped = true;
      }
      this.wall = null;
      this.wallSide = 0;
      this.wallCd = input.jumpPressed ? 0.38 : 0.16;
      this.grounded = false;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      return true;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.stickToWall();
    return false;
  }

  private stickToWall(): void {
    const w = this.wall;
    if (!w) return;
    const stick = this.r + 0.02;
    if (w.axis === 'x') this.x = w.face + w.nx * stick;
    else this.z = w.face + w.nz * stick;
  }

  private stepAction(dt: number, ev: StepEvents): void {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    const u = Math.min(1, a.t / a.dur);
    const p = sampleAction(a, u);
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.vy = 0;
    this.grounded = false;
    if (a.kind === 'vault') {
      this.vx = a.vx;
      this.vz = a.vz;
      this.speed = Math.hypot(a.vx, a.vz);
    } else {
      const dx = a.x1 - a.x0;
      const dz = a.z1 - a.z0;
      const m = Math.hypot(dx, dz) || 1;
      const spd = Math.max(PHYS.walk, Math.hypot(this.vx, this.vz));
      this.vx = (dx / m) * spd;
      this.vz = (dz / m) * spd;
      this.speed = spd;
    }
    if (u >= 1) {
      this.x = a.x1;
      this.y = a.y1;
      this.z = a.z1;
      this.grounded = true;
      this.coyote = PHYS.coyote;
      this.h = PHYS.standH;
      this.sliding = false;
      if (a.kind === 'vault') {
        this.vx = a.vx;
        this.vz = a.vz;
      }
      this.action = null;
      this.actionKind = '';
      ev.landed = true;
      ev.impact = 1.5;
    }
  }

  private finishFrame(dt: number, ev: StepEvents): void {
    const targetCrouch = this.sliding || this.h < (PHYS.standH + PHYS.slideH) * 0.5 ? 1 : 0;
    this.crouch = damp(this.crouch, targetCrouch, 14, dt);
    this.speed = Math.hypot(this.vx, this.vz);

    if (this.y < this.killY) {
      this.respawn();
      ev.respawn = true;
      return;
    }

    const scan = this.checkpoints.scan(this.x, this.y, this.z, this.r, this.h, this.triggers);
    this.hint = scan.hint;
    this.checkpoint = this.checkpoints.index;
    if (scan.finish) ev.finish = true;
    if (scan.checkpointId) {
      ev.checkpointId = scan.checkpointId;
      ev.checkpointName = scan.checkpointName;
    }
    this.syncView();
  }

  private body(): Body {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      vx: this.vx,
      vy: this.vy,
      vz: this.vz,
      r: this.r,
      h: this.h,
    };
  }

  private copyBody(b: Body): void {
    this.x = b.x;
    this.y = b.y;
    this.z = b.z;
    this.vx = b.vx;
    this.vy = b.vy;
    this.vz = b.vz;
  }

  syncView(): void {
    this.view.rotation.order = 'YXZ';
    this.view.rotation.y = this.yaw;
    this.view.rotation.x = this.pitch;
    this.view.rotation.z = 0;
    this.view.position.set(this.x, this.y, this.z);
    this.view.updateMatrixWorld(true);
  }

  private readBasis(): void {
    this.view.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-8) this.fwd.set(0, 0, -1);
    else this.fwd.normalize();
    this.right.crossVectors(this.fwd, UP).normalize();
  }
}
