import * as THREE from "three";
import { Level, type WallRunSurface } from "../world/Level";
import { AudioManager } from "../audio/AudioManager";

type AirMove = { start: THREE.Vector3; end: THREE.Vector3; elapsed: number; duration: number; arc: number };
type WallRunState = { surface: WallRunSurface; side: number; targetX: number; remaining: number };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const smoothStep = (value: number): number => value * value * (3 - 2 * value);

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  reducedMotion = false;
  active = false;
  grounded = false;
  sliding = false;
  vaulting = false;
  wallRunning = false;
  speed = 0;

  private readonly keys = new Set<string>();
  private readonly edgeKeys = new Set<string>();
  private readonly radius = 0.34;
  private jumpBuffer = 0;
  private coyoteTime = 0;
  private slideTime = 0;
  private eyeHeight = 1.62;
  private bobPhase = 0;
  private landingKick = 0;
  private actionTime = 0;
  private stepTimer = 0;
  private vaultMove: AirMove | undefined;
  private mantleMove: AirMove | undefined;
  private wallRunState: WallRunState | undefined;
  private readonly arms: THREE.Group;
  private readonly armMaterials = {
    cloth: new THREE.MeshStandardMaterial({ color: 0xf5f7f3, roughness: 0.82 }),
    glove: new THREE.MeshStandardMaterial({ color: 0xe83b30, roughness: 0.62 })
  };

  onRestart: (() => void) | undefined;
  onAction: ((message: string) => void) | undefined;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly level: Level,
    private readonly audio: AudioManager
  ) {
    this.arms = this.createArms();
    this.camera.add(this.arms);
    this.arms.visible = false;
    this.bindInput();
    this.reset(level.startPosition, 0);
  }

  private createArms(): THREE.Group {
    const group = new THREE.Group();
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.15), this.armMaterials.cloth);
    const rightArm = leftArm.clone();
    leftArm.position.set(-0.35, -0.43, -0.7);
    rightArm.position.set(0.35, -0.43, -0.7);
    const leftGlove = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.13, 0.17), this.armMaterials.glove);
    const rightGlove = leftGlove.clone();
    leftGlove.position.set(-0.35, -0.66, -0.77);
    rightGlove.position.set(0.35, -0.66, -0.77);
    group.add(leftArm, rightArm, leftGlove, rightGlove);
    return group;
  }

  private bindInput(): void {
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
      const firstPress = !this.keys.has(event.code);
      this.keys.add(event.code);
      if (firstPress) this.edgeKeys.add(event.code);
      if (!this.active || !firstPress) return;
      if (event.code === "Space") this.jumpBuffer = 0.14;
      if (event.code === "KeyE") this.tryVault();
      if (event.code === "KeyR") this.onRestart?.();
    });
    window.addEventListener("keyup", (event: KeyboardEvent) => {
      this.keys.delete(event.code);
    });
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousemove", (event: MouseEvent) => {
      if (!this.active || document.pointerLockElement !== this.canvas) return;
      const amount = 0.00165 * this.sensitivity;
      this.yaw -= event.movementX * amount;
      this.pitch = clamp(this.pitch - event.movementY * amount, -1.42, 1.42);
    });
    this.canvas.addEventListener("click", () => {
      if (this.active && document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.keys.clear();
      this.edgeKeys.clear();
    }
  }

  reset(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
    this.sliding = false;
    this.vaulting = false;
    this.wallRunning = false;
    this.wallRunState = undefined;
    this.vaultMove = undefined;
    this.mantleMove = undefined;
    this.jumpBuffer = 0;
    this.coyoteTime = 0.12;
    this.slideTime = 0;
    this.eyeHeight = 1.62;
    this.speed = 0;
    this.landingKick = 0;
    this.actionTime = 0;
    this.arms.visible = false;
  }

  get checkpointRestartPressed(): boolean {
    return this.edgeKeys.has("KeyR");
  }

  step(dt: number): void {
    if (!this.active) return;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.actionTime = Math.max(0, this.actionTime - dt);
    this.landingKick = Math.max(0, this.landingKick - dt * 2.7);
    this.updateSlide(dt);
    this.updateMomentum(dt);
    this.tryStartJumpOrMantle();

    if (this.vaultMove) {
      this.advanceMove(this.vaultMove, dt, "vault");
      this.edgeKeys.clear();
      return;
    }
    if (this.mantleMove) {
      this.advanceMove(this.mantleMove, dt, "mantle");
      this.edgeKeys.clear();
      return;
    }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.grounded && !this.wallRunState && horizontalSpeed > 7.2 && this.velocity.z < -5) {
      const candidate = this.level.getWallRunSurface(this.position.x, this.position.y, this.position.z, this.radius);
      if (candidate) {
        this.wallRunState = { ...candidate, remaining: 1.62 };
        this.wallRunning = true;
        this.onAction?.("WALL RUN");
      }
    }

    if (this.wallRunState) {
      this.wallRunState.remaining -= dt;
      this.position.x += (this.wallRunState.targetX - this.position.x) * Math.min(1, dt * 16);
      this.velocity.x *= Math.exp(-dt * 14);
      this.velocity.z = Math.min(this.velocity.z, -12.2);
      if (this.jumpBuffer > 0) this.wallJump();
      else this.velocity.y = Math.max(this.velocity.y - 5.4 * dt, -2.2);
      if (this.wallRunState.remaining <= 0 || this.position.z < this.wallRunState.surface.minZ - 0.15) {
        this.wallRunState = undefined;
        this.wallRunning = false;
      }
    } else if (!this.grounded) {
      this.velocity.y -= 24 * dt;
      if (!this.keys.has("Space") && this.velocity.y > 0) this.velocity.y -= 17 * dt;
    }

    const oldX = this.position.x;
    const oldZ = this.position.z;
    const nextX = oldX + this.velocity.x * dt;
    const nextZ = oldZ + this.velocity.z * dt;
    const bodyHeight = this.sliding ? 0.74 : 1.72;
    const resolved = this.level.resolveHorizontal(oldX, oldZ, nextX, nextZ, this.position.y, bodyHeight, this.radius);
    this.position.x = resolved.x;
    this.position.z = resolved.y;
    if (Math.abs(this.position.x - nextX) > 0.001) this.velocity.x = 0;
    if (Math.abs(this.position.z - nextZ) > 0.001) this.velocity.z = 0;

    const beforeY = this.position.y;
    if (this.grounded) {
      const support = this.level.getSupport(this.position.x, this.position.z, this.position.y, this.radius);
      if (support) {
        this.position.y = support.top;
        this.velocity.y = 0;
        this.coyoteTime = 0.12;
      } else {
        this.grounded = false;
        this.velocity.y = Math.min(this.velocity.y, 0);
      }
    }
    if (!this.grounded) {
      const nextY = this.position.y + this.velocity.y * dt;
      const landing = this.velocity.y <= 0
        ? this.level.findLanding(this.position.x, this.position.z, this.position.y, nextY, this.radius)
        : undefined;
      if (landing) {
        const impact = this.velocity.y;
        this.position.y = landing.top;
        this.velocity.y = 0;
        this.grounded = true;
        this.coyoteTime = 0.12;
        if (impact < -5.2) {
          this.landingKick = Math.min(1, Math.abs(impact) / 18);
          this.audio.land(Math.abs(impact));
        }
      } else {
        this.position.y = nextY;
        this.coyoteTime = Math.max(0, this.coyoteTime - dt);
      }
    }
    if (beforeY < this.position.y - 0.1 && this.grounded) this.landingKick = Math.max(this.landingKick, 0.16);

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.updateFootsteps(dt);
    this.arms.visible = this.actionTime > 0;
    this.edgeKeys.clear();
  }

  private updateSlide(dt: number): void {
    const wantsSlide = this.keys.has("ControlLeft") || this.keys.has("ControlRight") || this.keys.has("KeyC");
    if (wantsSlide && this.grounded && !this.sliding && this.speed > 4.8) {
      this.sliding = true;
      this.slideTime = 0;
      this.onAction?.("SLIDE");
    }
    if (!this.sliding) return;
    this.slideTime += dt;
    if (this.jumpBuffer > 0 && this.grounded) return;
    const releasedLongEnough = !wantsSlide && this.slideTime > 0.28;
    const timedOut = this.slideTime > 1.45;
    if ((releasedLongEnough || timedOut || this.speed < 3.4) &&
        this.level.canOccupy(this.position.x, this.position.z, this.position.y, 1.72, this.radius)) {
      this.sliding = false;
    }
  }

  private updateMomentum(dt: number): void {
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const forwardInput = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const sideInput = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    let wishX = forwardX * forwardInput + rightX * sideInput;
    let wishZ = forwardZ * forwardInput + rightZ * sideInput;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 0) { wishX /= wishLength; wishZ /= wishLength; }

    if (this.sliding) {
      if (wishLength > 0) {
        this.velocity.x += wishX * 4.2 * dt;
        this.velocity.z += wishZ * 4.2 * dt;
      }
      const drag = Math.exp(-1.45 * dt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;
      return;
    }
    if (this.wallRunState) return;

    if (wishLength > 0) {
      const sprinting = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
      const maximum = sprinting ? 15.5 : 9.2;
      const acceleration = this.grounded ? 34 : 8.2;
      const currentAlong = this.velocity.x * wishX + this.velocity.z * wishZ;
      const change = clamp(maximum - currentAlong, -acceleration * dt, acceleration * dt);
      this.velocity.x += wishX * change;
      this.velocity.z += wishZ * change;
      if (this.grounded) {
        const along = this.velocity.x * wishX + this.velocity.z * wishZ;
        const sideX = this.velocity.x - wishX * along;
        const sideZ = this.velocity.z - wishZ * along;
        const sideDamp = Math.exp(-8.5 * dt);
        this.velocity.x = wishX * along + sideX * sideDamp;
        this.velocity.z = wishZ * along + sideZ * sideDamp;
      }
    } else if (this.grounded) {
      const friction = Math.exp(-5.5 * dt);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
    } else {
      const drag = Math.exp(-0.08 * dt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;
    }
  }

  private tryStartJumpOrMantle(): void {
    if (this.jumpBuffer <= 0) return;
    if (this.wallRunState) {
      this.wallJump();
      return;
    }
    if (this.grounded || this.coyoteTime > 0) {
      this.jumpBuffer = 0;
      this.sliding = false;
      this.grounded = false;
      this.velocity.y = 11.1;
      this.coyoteTime = 0;
      this.audio.jump();
      this.onAction?.("JUMP");
      return;
    }
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const target = this.level.findMantleTarget(this.position.x, this.position.y, this.position.z, forwardX, forwardZ, this.radius);
    if (target) {
      this.jumpBuffer = 0;
      this.mantleMove = { start: this.position.clone(), end: target, elapsed: 0, duration: 0.34, arc: 0.16 };
      this.vaulting = true;
      this.actionTime = 0.4;
      this.onAction?.("MANTLE");
    }
  }

  private wallJump(): void {
    if (!this.wallRunState) return;
    const side = this.wallRunState.side;
    this.velocity.x = -side * 5.8;
    this.velocity.z = Math.min(this.velocity.z, -8.2);
    this.velocity.y = 10.4;
    this.wallRunState = undefined;
    this.wallRunning = false;
    this.grounded = false;
    this.jumpBuffer = 0;
    this.audio.jump();
    this.onAction?.("WALL JUMP");
  }

  private tryVault(): void {
    if (!this.active || this.vaulting || !this.grounded || this.sliding) return;
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const target = this.level.findVaultTarget(this.position.x, this.position.z, forwardX, forwardZ, this.radius);
    if (!target) return;
    this.vaultMove = { start: this.position.clone(), end: target, elapsed: 0, duration: 0.48, arc: 0.8 };
    this.vaulting = true;
    this.actionTime = 0.56;
    const speed = Math.max(this.speed, 8);
    this.velocity.x = forwardX * speed;
    this.velocity.z = forwardZ * speed;
    this.velocity.y = 0;
    this.grounded = false;
    this.audio.vault();
    this.onAction?.("VAULT");
  }

  private advanceMove(move: AirMove, dt: number, kind: "vault" | "mantle"): void {
    move.elapsed += dt;
    const t = clamp(move.elapsed / move.duration, 0, 1);
    const eased = smoothStep(t);
    this.position.lerpVectors(move.start, move.end, eased);
    this.position.y += Math.sin(t * Math.PI) * move.arc;
    if (t < 1) return;

    this.position.copy(move.end);
    this.grounded = true;
    this.velocity.y = 0;
    this.coyoteTime = 0.12;
    if (kind === "vault") this.vaultMove = undefined;
    else this.mantleMove = undefined;
    this.vaulting = false;
    this.arms.visible = false;
  }

  private updateFootsteps(dt: number): void {
    if (this.grounded && this.speed > 2.1 && !this.sliding && !this.vaulting) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.audio.footstep(this.speed);
        this.stepTimer = this.speed > 11 ? 0.31 : 0.44;
      }
    } else {
      this.stepTimer = 0.08;
    }
    this.audio.setWind(this.active ? clamp((this.speed - 8) / 9, 0, 0.55) : 0);
  }

  updateCamera(dt: number): void {
    const targetEye = this.sliding ? 0.68 : 1.62;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-14 * dt));
    const sprintFactor = clamp((this.speed - 4) / 12, 0, 1);
    this.bobPhase += dt * (4.2 + this.speed * 0.66);
    const motion = this.reducedMotion ? 0.25 : 1;
    const bobAmount = this.grounded ? (0.012 + sprintFactor * 0.028) * motion : 0.006 * motion;
    const bobY = Math.sin(this.bobPhase * 2) * bobAmount;
    const bobX = Math.cos(this.bobPhase) * bobAmount * 0.32;
    const fovTarget = 76 + sprintFactor * 9;
    this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-5.5 * dt));
    this.camera.updateProjectionMatrix();
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    this.camera.position.set(
      this.position.x + rightX * bobX,
      this.position.y + this.eyeHeight + bobY - this.landingKick * 0.16 * motion,
      this.position.z + rightZ * bobX
    );
    const sideInput = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
    const wallTilt = this.wallRunState ? this.wallRunState.side * 0.055 : 0;
    const runRoll = this.reducedMotion ? 0 : -sideInput * 0.022;
    const landingRoll = this.landingKick * 0.018;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, wallTilt + runRoll + landingRoll, "YXZ");
    this.arms.visible = this.actionTime > 0;
    void forwardX;
    void forwardZ;
  }

  get currentAction(): string {
    if (this.wallRunning) return "WALL RUN";
    if (this.sliding) return "SLIDE";
    if (this.vaulting) return "VAULT";
    return "";
  }
}

