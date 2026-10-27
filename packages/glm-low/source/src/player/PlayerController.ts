import * as THREE from 'three';
import { PLAYER, TIMING } from '../game/GameState';
import { CollisionWorld, GroundHit } from '../world/CollisionWorld';
import { FirstPersonCamera } from './FirstPersonCamera';
import { Input } from './Input';
import { Audio } from '../audio/AudioManager';

const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();

/**
 * Full fps movement controller:
 *  - fixed-step physics with axis-separated AABB collision
 *  - walk / sprint, jump (+auto hold boost, coyote time, buffer)
 *  - slide with collision height change, wall run / wall jump,
 *    vault over knee-high obstacles, and ledge mantle.
 */
export class PlayerController {
  readonly position = new THREE.Vector3();
  private velocity = new THREE.Vector3();

  private height: number = PLAYER.height;
  private targetHeight: number = PLAYER.height;
  private grounded = false;
  private coyote = 0;
  private jumpBufferT = 0;
  private jumpBoostTime = 0;
  private wantSlide = false;
  private slideT = 0;
  private wallCooldown = 0;
  private wallSide = 0; // -1 right wall / 1 left wall / 0 none (from camera view)
  private wallRunT = 0;
  private lastWallNormal = new THREE.Vector3();
  private vaultCooldown = 0;
  private wasAirForFx = true;
  private respawnPos = new THREE.Vector3(0, 20, 0);
  private stepTimer = 0;
  private slideSoundT = 0;
  // Opt-in by the game for HUD/UI messages.
  onRespawn: (() => void) | null = null;

  constructor(
    private collision: CollisionWorld,
    private cam: FirstPersonCamera,
    private input: Input,
    private audio: Audio
  ) {
    this.respawn(this.respawnPos, true);
  }

  setRespawn(p: THREE.Vector3): void {
    this.respawnPos.copy(p);
  }

  respawn(p: THREE.Vector3, initial = false): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.height = PLAYER.height;
    this.targetHeight = PLAYER.height;
    this.grounded = false;
    this.wantSlide = false;
    this.slideT = 0;
    this.wallSide = 0;
    this.coyote = 0;
    this.jumpBufferT = 0;
    this.vaultCooldown = 0;
    this.wasAirForFx = !initial;
    // fov reset
    this.cam.camera.fov = 82;
    this.cam.camera.updateProjectionMatrix();
    if (!initial && this.onRespawn) this.onRespawn();
  }

  get isGrounded(): boolean {
    return this.grounded;
  }
  get speed(): number {
    return this.velocity.length();
  }
  get currentHeight(): number {
    return this.height;
  }
  get eyeY(): number {
    return this.position.y + this.height * PLAYER.eyeRatio;
  }
  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
  get sliding(): boolean {
    return this.slideT > 0;
  }
  get wallRunning(): boolean {
    return this.wallSide !== 0;
  }

  // ---------------------------------------------------------------------------
  // Frame update: consume mouse, then run fixed-step physics.
  // ---------------------------------------------------------------------------
  update(dt: number): void {
    this.input.consumeLook(
      (dx) => this.cam.addLook(dx, 0),
      (dy) => this.cam.addLook(0, dy)
    );

    // Fixed timestep sub-stepping.
    let t = Math.min(dt, TIMING.maxFrameDt);
    let guard = 0;
    while (t > 1e-5) {
      const dtStep = Math.min(TIMING.step, t);
      this.physicsStep(dtStep);
      t -= dtStep;
      if (++guard > TIMING.maxSubSteps * 4) break;
    }
    this.updateCamera(dt);
  }

  private physicsStep(dt: number): void {
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBufferT = Math.max(0, this.jumpBufferT - dt);
    this.jumpBoostTime = Math.max(0, this.jumpBoostTime - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.vaultCooldown = Math.max(0, this.vaultCooldown - dt);
    if (this.jumpBufferT === 0 && this.input.jumpPressed) this.jumpBufferT = PLAYER.jumpBuffer;
    if (this.grounded && this.input.jumpPressed) this.jumpBufferT = PLAYER.jumpBuffer;
    if (this.input.slidePressed) this.wantSlide = true;
    else if (!this.input.slideHeld) this.wantSlide = false;

    // Shelter: height lerp toward target (crouch transitions)
    this.height += (this.targetHeight - this.height) * Math.min(1, dt * 16);

    const wasWallSide = this.wallSide;
    this.wallSide = 0;

    if (this.grounded) {
      this.groundMove(dt);
      // Slide trigger when moving fast and holding crouch
      if (this.wantSlide && !this.sliding && this.horizontalSpeed > 4.5) {
        this.startSlide();
      }
      this.coyote = PLAYER.coyoteTime;
      this.jumpIfBuffered();
      this.vaultOrMantle(true);
      // Keep wallrun from retriggering instantly after leaving ground
      if (!this.sliding && this.wallRunT > 0) this.wallRunT = Math.max(0, this.wallRunT - dt * 2);
      if (this.horizontalSpeed < PLAYER.slideMinSpeed && this.sliding) this.endSlide();
      // Stand back up once there is headroom again (e.g. after sliding
      // under a duct).
      if (!this.sliding && this.targetHeight < PLAYER.height) {
        if (this.collision.headroom(this.position.x, this.position.y, this.position.z, PLAYER.height)) {
          this.targetHeight = PLAYER.height;
        }
      }
    } else {
      this.airMove(dt);
      this.tryWallRun(dt);
      if (this.wallSide !== 0 && wasWallSide !== this.wallSide && this.wallRunT < 0.05) {
        this.wallRunT = Math.min(PLAYER.wallRunDuration, this.wallRunT + dt * 2);
      }
      this.jumpIfBuffered();
      this.vaultOrMantle(false);
    }

    // Build the movement delta for this step.
    tmpTarget.copy(this.velocity).multiplyScalar(dt);
    const touched: CollisionWorld['boxes'] = [];
    const topY = this.position.y + this.height;
    const res = this.collision.moveAABB(
      this.position,
      tmpTarget,
      topY,
      this.height,
      touched
    );
    if (res.landed) {
      this.hitGround(res.landed, dt);
    } else if (res.hitCeiling) {
      this.velocity.y = Math.min(0, this.velocity.y);
    }

    // Ground probe: stick to floor while walking (but don't glue in the air)
    if (!this.grounded && this.velocity.y <= 0.01) {
      const gy = this.collision.groundBelow(this.position.x, this.position.z, this.position.y + 0.1);
      if (gy !== null && this.position.y - gy.y < 0.12) {
        this.position.y = gy.y;
        this.hitGround(gy, dt);
      }
    }

    // Fall out of the world
    if (this.position.y < PLAYER.fallRespawnY) {
      this.respawn(this.respawnPos);
    }

    // Footstep audio
    if (this.grounded && !this.sliding) {
      this.stepTimer += dt * this.horizontalSpeed;
      if (this.stepTimer > 1.65) {
        this.stepTimer = 0;
        this.audio.step(this.horizontalSpeed > 9);
      }
    } else {
      this.stepTimer = 1.1;
    }
    if (this.sliding) {
      this.slideSoundT += dt;
      if (this.slideSoundT > 0.35) {
        this.slideSoundT = 0;
        this.audio.slide();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Ground movement
  // --------------------------------------------------------------------------
  private groundMove(dt: number): void {
    this.moveDir(tmpDir);
    const sprinting = this.input.sprint && this.forwardAlign(tmpDir) > -0.2;
    const maxSpeed = this.sliding ? PLAYER.sprintSpeed + PLAYER.slideBoostSpeed : sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    // Accelerate along wish direction
    if (tmpDir.lengthSq() > 1e-5) {
      const cur = this.velocity.x * tmpDir.x + this.velocity.z * tmpDir.z;
      const add = Math.max(0, maxSpeed - cur) * Math.min(1, this.sliding ? dt * 6 : dt * PLAYER.accel / 12);
      // simpler: accelerate with friction-free formula
      this.velocity.x += tmpDir.x * dt * PLAYER.accel;
      this.velocity.z += tmpDir.z * dt * PLAYER.accel;
      // clamp toward maxSpeed
      const h = Math.hypot(this.velocity.x, this.velocity.z);
      const maxAllowed = this.sliding ? Math.max(PLAYER.sprintSpeed + PLAYER.slideBoostSpeed, h) : maxSpeed;
      if (h > maxAllowed) {
        const k = maxAllowed / h;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
      void cur;
      void add;
      // (camera-side strafe roll handled in camera update)
    } else {
      // friction when no input
      const h = Math.hypot(this.velocity.x, this.velocity.z);
      if (h > 0) {
        const drop = this.sliding ? PLAYER.slideFriction : PLAYER.friction;
        const newH = Math.max(0, h - drop * dt * (this.grounded ? 1 : 0));
        const k = newH / h;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
    }
    this.velocity.y -= PLAYER.gravity * dt;

    // While sliding, gentle friction above boost speed even with input
    if (this.sliding) {
      const h = Math.hypot(this.velocity.x, this.velocity.z);
      if (h > PLAYER.sprintSpeed) {
        const newH = Math.max(PLAYER.sprintSpeed, h - 3.0 * dt);
        const k = newH / h;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
      this.slideT -= dt;
      if (this.slideT <= 0 || h < PLAYER.slideMinSpeed) this.endSlide();
    }
  }

  private forwardAlign(dir: THREE.Vector3): number {
    if (dir.lengthSq() < 1e-5) return 0;
    tmpFlat.set(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    return dir.dot(tmpFlat);
  }

  // Compute intended horizontal movement direction in world space.
  private moveDir(out: THREE.Vector3): void {
    const input = this.input;
    out.set(0, 0, 0);
    // forward = -Z with yaw = 0
    const sinY = Math.sin(this.cam.yaw);
    const cosY = Math.cos(this.cam.yaw);
    if (input.forward) {
      out.x -= sinY;
      out.z -= cosY;
    }
    if (input.back) {
      out.x += sinY;
      out.z += cosY;
    }
    if (input.left) {
      out.x -= cosY;
      out.z += sinY;
    }
    if (input.right) {
      out.x += cosY;
      out.z -= sinY;
    }
    if (out.lengthSq() > 1e-6) out.normalize();
  }

  private startSlide(): void {
    this.slideT = 1.0;
    this.targetHeight = PLAYER.crouchHeight;
    this.cam.setSlideVisual(true);
    this.audio.slide(true);
    // Give slide a small speed boost along current velocity
    const h = Math.hypot(this.velocity.x, this.velocity.z);
    if (h > 0.5) {
      const boost = (PLAYER.slideBoostSpeed * Math.min(1, h / PLAYER.sprintSpeed)) * dt0();
      void boost;
      // simple approach: add directly
      const add = PLAYER.slideBoostSpeed * Math.min(1, h / PLAYER.sprintSpeed) * 0.55;
      this.velocity.x += (this.velocity.x / h) * add;
      this.velocity.z += (this.velocity.z / h) * add;
    }
  }

  private endSlide(): void {
    this.slideT = 0;
    this.cam.setSlideVisual(false);
    if (this.collision.headroom(this.position.x, this.position.y, this.position.z, PLAYER.height)) {
      this.targetHeight = PLAYER.height;
    } else {
      // stay crouched under a low ceiling
      setTimeoutSafe();
    }
  }

  // --------------------------------------------------------------------------
  // Air movement
  // --------------------------------------------------------------------------
  private airMove(dt: number): void {
    this.moveDir(tmpDir);
    // Limited air steering: pull velocity toward wish direction.
    if (tmpDir.lengthSq() > 1e-5) {
      const targetSpeed = this.input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      const turning = Math.min(1, dt * PLAYER.airAccel / 8);
      // steer the horizontal velocity toward the wish dir, preserve magnitude mostly
      const h = Math.hypot(this.velocity.x, this.velocity.z);
      const steer = targetSpeed * turning;
      this.velocity.x += tmpDir.x * steer * 0.5;
      this.velocity.z += tmpDir.z * steer * 0.5;
      const h2 = Math.hypot(this.velocity.x, this.velocity.z);
      const maxH = Math.max(h, targetSpeed * 1.25);
      if (h2 > maxH) {
        const k = maxH / h2;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
    }
    this.velocity.y -= PLAYER.gravity * dt;
  }

  // --------------------------------------------------------------------------
  // Jumping
  // --------------------------------------------------------------------------
  private jumpIfBuffered(): void {
    if (this.jumpBufferT <= 0) return;

    // Wall jump takes priority if we're touching a runnable wall
    if (!this.grounded && this.wallSide !== 0) {
      const n = this.lastWallNormal;
      const vp = new THREE.Vector3();
      // Jump away from wall
      vp.copy(n).multiplyScalar(PLAYER.wallJumpPush);
      this.velocity.x = vp.x + this.velocity.x * 0.25;
      this.velocity.z = vp.z + this.velocity.z * 0.25;
      this.velocity.y = PLAYER.wallJumpSpeed;
      this.wallSide = 0;
      this.wallRunT = 0;
      this.wallCooldown = 0.25;
      this.cam.vault(); // reuse small roll kick
      this.audio.jump();
      this.jumpBufferT = 0;
      this.grounded = false;
      return;
    }

    if (this.grounded || this.coyote > 0) {
      // Slide-hop: jump out of a slide keeps momentum.
      if (this.sliding) this.endSlide();
      this.velocity.y = PLAYER.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBufferT = 0;
      this.jumpBoostTime = 0.24; // hold Space for extra height
      this.cam.land(0.3);
      this.audio.jump();
    }
  }

  private boostJump(dt: number): void {
    // Applied while the button is held: extend up-drift.
    if (this.jumpBoostTime > 0 && this.input.jumpHeld && !this.grounded && this.velocity.y > 0) {
      this.velocity.y += PLAYER.jumpDurationBoost * PLAYER.gravity * dt;
    }
  }

  // --------------------------------------------------------------------------
  // Wall running
  // --------------------------------------------------------------------------
  private tryWallRun(dt: number): void {
    if (this.wallCooldown > 0 || this.velocity.y < -14) {
      this.wallRunT = 0;
      return;
    }
    const h = this.horizontalSpeed;
    if (h < PLAYER.wallRunMinSpeed) return;

    this.moveDir(tmpDir);
    void tmpDir;
    tmpFlat.set(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    tmpRight.set(-Math.cos(this.cam.yaw), 0, Math.sin(this.cam.yaw)); // camera right
    const overlap = this.velocity.dot(tmpFlat);
    void overlap;

    // Check both sides (right-hand wall first because that's most natural)
    for (const side of [-1, 1] as const) {
      sideDirIn.copy(tmpRight).multiplyScalar(side);
      const touch = this.collision.sideWall(this.position.x, this.position.y, this.position.z, sideDirIn);
      if (!touch) continue;
      // Wall must be roughly parallel to movement dir
      const wallTangent = new THREE.Vector3(-touch.normal.z, 0, touch.normal.x);
      const align = Math.abs(wallTangent.dot(this.velocity));
      if (align < h * 0.45) continue;
      // Face wall normal opposite to travel direction enough?
      if (touch.normal.dot(this.velocity) > 0.4 * h) continue;
      // Require the stick actually reachable
      this.wallSide = side;
      this.lastWallNormal.copy(touch.normal);
      // Once we run out of time we're dropped off the wall.
      if (this.wallRunT >= PLAYER.wallRunDuration) {
        this.wallSide = 0;
        this.wallCooldown = 0.55;
        // small push away so we detach cleanly
        this.velocity.x += touch.normal.x * 2.0;
        this.velocity.z += touch.normal.z * 2.0;
        return;
      }
      this.wallRunT += dt;
      // Compensate most of the gravity that airMove already applied:
      // wall running reduces effective gravity to ~15%, so the player can
      // sweep along a long wall without dropping into the gap.
      this.velocity.y += PLAYER.gravity * (1 - PLAYER.wallRunGravityFactor) * dt;
      const tangent = wallTangent;
      const currentTangent = this.velocity.x * tangent.x + this.velocity.z * tangent.z;
      // Gentle inward stick each frame (toward the wall), per-second scaled.
      this.velocity.x -= touch.normal.x * 2.0 * dt;
      this.velocity.z -= touch.normal.z * 2.0 * dt;
      // Tangent retention: don't lose speed while walling
      const targetTangent = Math.max(currentTangent, h * 0.97);
      const diff = targetTangent - currentTangent;
      this.velocity.x += tangent.x * diff * Math.min(1, dt * 10);
      this.velocity.z += tangent.z * diff * Math.min(1, dt * 10);
      this.velocity.y *= 0.995;
      // Wind / running feedback
      if (this.wallRunT < 0.06) {
        this.audio.wallRun();
      }
      this.jumpIfBuffered(); // wall jump during run
      return;
    }
    // No wall — decay run timer so we can't chain infinite walls instantly
    if (this.wallSide === 0) {
      this.wallRunT = Math.max(0, this.wallRunT - dt * 3);
    }
  }

  // --------------------------------------------------------------------------
  // Vault & ledge mantle
  // --------------------------------------------------------------------------
  private vaultOrMantle(_grounded: boolean): void {
    if (this.vaultCooldown > 0) return;
    if (!this.input.vaultPressed && !this.autoMantle()) return;

    // Find the obstacle in front of us
    const look = new THREE.Vector3(
      -Math.sin(this.cam.yaw),
      0,
      -Math.cos(this.cam.yaw)
    ).normalize();
    const feetY = this.position.y;

    // Scan boxes in a small region in front of the player.
    const px = this.position.x + look.x * 0.75;
    const pz = this.position.z + look.z * 0.75;
    const candidates = this.collision.near(px, feetY + 1, pz, 1.6);
    let best: { box: CollisionWorld['boxes'][number]; topY: number } | null = null;
    for (const b of candidates) {
      if (b.max.y <= feetY + 0.2 || b.max.y > feetY + 1.5) continue; // knee-high or chest-high
      // Is the box roughly in front of us in look direction?
      if (!boxInFront(b, look, this.position, 1.9)) continue;
      // Ceiling above the top of the obstacle must have headroom
      if (!this.collision.headroom(this.position.x, b.max.y + 0.02, this.position.z, this.height))
        continue;
      if (!best || b.max.y > best.topY) best = { box: b, topY: b.max.y };
    }
    if (!best) return;

    // Mantle onto it: pop us on top and preserve forward momentum.
    this.position.y = best.topY + 0.02;
    this.velocity.y = Math.max(this.velocity.y, 2.4);
    // Pull forward a bit
    this.velocity.x += look.x * PLAYER.vaultForward * 0.6;
    this.velocity.z += look.z * PLAYER.vaultForward * 0.6;
    this.grounded = true;
    this.cam.vault();
    this.audio.vault();
    this.vaultCooldown = 0.45;
    this.input.postUpdate();
  }

  private autoMantle(): boolean {
    // Ledge-recovery assist only while falling downward with some speed.
    return this.velocity.y < -2 && this.horizontalSpeed > 4;
  }

  // --------------------------------------------------------------------------
  // Landing
  // --------------------------------------------------------------------------
  private hitGround(g: GroundHit, dt: number): void {
    const fallSpeed = -this.velocity.y;
    this.velocity.y = 0;
    const wasAir = this.wasAirForFx;
    if (wasAir && fallSpeed > 3) {
      this.cam.land(Math.min(1, fallSpeed / 16));
      this.audio.land(Math.min(1, fallSpeed / 18));
      // Controlled friction on landing — mild horizontal damp.
      const k = fallSpeed > 13 ? 0.6 : fallSpeed > 7 ? 0.78 : 0.92;
      this.velocity.x *= k;
      this.velocity.z *= k;
    }
    void g;
    this.wasAirForFx = false;
    this.grounded = true;
    if (this.wallRunT > 0.15) {
      this.wallRunT = 0;
      this.wallCooldown = 0.3;
    }
    void dt;
  }

  // --------------------------------------------------------------------------
  // Camera positioning
  // --------------------------------------------------------------------------
  private updateCamera(dt: number): void {
    this.boostJump(dt);
    const speed = this.speed;
    this.moveDir(tmpDir);
    const strafe = this.strafeAmount();
    tmpTarget.set(this.position.x, this.eyeY, this.position.z);
    this.cam.update(tmpTarget, dt, {
      speed,
      sprinting: this.input.sprint && this.forwardAlign(tmpDir) > -0.2 && this.grounded,
      grounded: this.grounded,
      strafe,
      wallSide: this.wallSide,
      sliding: this.sliding,
    });
  }

  private strafeAmount(): number {
    let s = 0;
    if (this.input.left) s -= 1;
    if (this.input.right) s += 1;
    return s;
  }
}

const sideDirIn = new THREE.Vector3();

/** Cheap "is the box roughly in this direction" test (2D). */
function boxInFront(
  b: { min: THREE.Vector3; max: THREE.Vector3 },
  dir: THREE.Vector3,
  from: THREE.Vector3,
  reach: number
): boolean {
  const cx = (b.min.x + b.max.x) / 2 - from.x;
  const cz = (b.min.z + b.max.z) / 2 - from.z;
  const d = cx * dir.x + cz * dir.z;
  if (d < 0) return false;
  const dist = Math.hypot(cx, cz);
  void reach;
  return d > dist * 0.35;
}

function setTimeoutSafe(): void {
  // No-op: staying crouched is fine.
}

function dt0(): number {
  return 1 / 120;
}
