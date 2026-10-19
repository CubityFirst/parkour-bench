import * as THREE from 'three';
import { InputManager } from '../input/InputManager';
import { Settings } from '../game/GameState';
import { Level } from '../world/Level';
import { FirstPersonCamera } from './FirstPersonCamera';
import { ParkourInput, ParkourSystem } from './ParkourSystem';
import { PlayerPhysics } from './PlayerPhysics';

/** Optional callbacks so audio and UI can react to player actions. */
export interface PlayerHooks {
  onJump(): void;
  onLand(impactSpeed: number): void;
  onSlide(): void;
  onWallRun(): void;
  onWallJump(): void;
  onVault(): void;
  onMantle(): void;
  onCheckpoint(id: string): void;
  onFall(): void;
  onFinish(): void;
}

function inside(p: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
}

/**
 * Ties input, physics, parkour, the camera, checkpoints and the finish trigger
 * together. Movement runs on a fixed timestep (`fixedStep`). Rendering-only work
 * (camera, FOV, bob) runs per frame (`frameUpdate`).
 */
export class PlayerController {
  readonly physics = new PlayerPhysics();
  readonly parkour = new ParkourSystem();
  readonly camera: FirstPersonCamera;

  private spawn = new THREE.Vector3();
  private checkpointId: string | null = null;
  private finished = false;
  /** Latest settings from the frame loop, used for one-shot camera reactions. */
  private settings: Settings = { sensitivity: 1, reduceMotion: false };

  /** Latched one-shot inputs. Set in the frame loop, consumed by the next fixed step. */
  private pendingJump = false;
  private pendingSlide = false;
  private pendingVault = false;

  constructor(
    private readonly level: Level,
    private readonly input: InputManager,
    private readonly hooks: Partial<PlayerHooks>,
    aspect: number,
  ) {
    this.camera = new FirstPersonCamera(aspect);
    this.restart();
  }

  get speed(): number {
    return this.physics.speed;
  }

  get hasFinished(): boolean {
    return this.finished;
  }

  get currentCheckpoint(): string | null {
    return this.checkpointId;
  }

  /** Full restart from the level start. Clears checkpoints and the finished flag. */
  restart(): void {
    this.spawn.copy(this.level.spawn);
    this.checkpointId = null;
    this.finished = false;
    this.respawnAt();
    this.camera.setView(0, 0);
  }

  /** Respawn at the latest checkpoint. Velocity and parkour state are reset; the view is kept. */
  respawn(): void {
    this.respawnAt();
  }

  private respawnAt(): void {
    this.physics.reset(this.spawn);
    this.parkour.reset();
    this.pendingJump = false;
    this.pendingSlide = false;
    this.pendingVault = false;
  }

  /** Latches key presses for the next fixed step. Called once per rendered frame. */
  latchInput(): void {
    if (this.input.wasPressed('Space')) this.pendingJump = true;
    if (this.input.wasPressed('ControlLeft') || this.input.wasPressed('ControlRight') || this.input.wasPressed('KeyC')) {
      this.pendingSlide = true;
    }
    if (this.input.wasPressed('KeyE')) this.pendingVault = true;
  }

  /** One fixed-timestep physics update. */
  fixedStep(dt: number): void {
    if (this.finished) return;

    const parkourInput = this.buildParkourInput();
    this.pendingJump = false;
    this.pendingSlide = false;
    this.pendingVault = false;

    if (this.parkour.isAnimating()) {
      this.parkour.stepAnim(dt, this.physics);
    } else {
      const intent = this.parkour.buildIntent(dt, this.physics, this.level.world, parkourInput);
      this.dispatchParkourEvents();
      this.physics.step(dt, intent, this.level.world);
      this.dispatchPhysicsEvents();
    }

    this.checkTriggers();
  }

  /** Per-frame work: camera and presentation. `dt` is the render frame time. */
  frameUpdate(dt: number, settings: Settings): void {
    this.settings = settings;
    this.camera.update(dt, this.physics, this.parkour, settings);
  }

  private buildParkourInput(): ParkourInput {
    const fwd = this.camera.forward;
    const rt = this.camera.right;
    const axes = this.input.moveAxes();

    let wishX = fwd.x * axes.y + rt.x * axes.x;
    let wishZ = fwd.z * axes.y + rt.z * axes.x;
    const len = Math.hypot(wishX, wishZ);
    if (len > 1e-6) {
      wishX /= len;
      wishZ /= len;
    } else {
      wishX = 0;
      wishZ = 0;
    }

    return {
      forwardX: fwd.x,
      forwardZ: fwd.z,
      rightX: rt.x,
      rightZ: rt.z,
      wishX,
      wishZ,
      sprint: this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight'),
      slideHeld: this.input.isDown('ControlLeft') || this.input.isDown('ControlRight') || this.input.isDown('KeyC'),
      slidePressed: this.pendingSlide,
      vaultPressed: this.pendingVault,
      jumpPressed: this.pendingJump,
      jumpHeld: this.input.isDown('Space'),
    };
  }

  /** Parkour-only events. Physics events are checked after the step. */
  private dispatchParkourEvents(): void {
    const ev = this.parkour.events;
    if (ev.slideStart) this.hooks.onSlide?.();
    if (ev.wallStart) this.hooks.onWallRun?.();
    if (ev.wallJump) {
      this.hooks.onWallJump?.();
      this.camera.onJump(this.settings);
    }
    if (ev.vault) {
      this.hooks.onVault?.();
    }
    if (ev.mantle) {
      this.hooks.onMantle?.();
    }
  }

  private dispatchPhysicsEvents(): void {
    if (this.physics.jumpedThisStep) {
      this.hooks.onJump?.();
      this.camera.onJump(this.settings);
    }
    if (this.physics.landedThisStep) {
      this.hooks.onLand?.(this.physics.lastImpactSpeed);
      this.camera.onLand(this.physics.lastImpactSpeed, this.settings);
    }
  }

  private checkTriggers(): void {
    const p = this.physics.pos;

    if (p.y < this.level.killY) {
      this.hooks.onFall?.();
      this.respawn();
      return;
    }

    for (const cp of this.level.checkpoints) {
      if (cp.id === this.checkpointId) continue;
      if (inside(p, cp.min, cp.max)) {
        this.checkpointId = cp.id;
        this.spawn.copy(cp.spawn);
        this.hooks.onCheckpoint?.(cp.id);
      }
    }

    if (inside(p, this.level.finish.min, this.level.finish.max)) {
      this.finished = true;
      this.hooks.onFinish?.();
    }
  }
}
