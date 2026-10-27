import * as THREE from 'three';
import { PlayerController } from './PlayerController';
import { GameState } from '../game/GameState';

/**
 * FirstPersonCamera — mouse look plus speed feedback effects:
 * head bob, strafe roll, wall-run roll, slide height, FOV kick, landing dip,
 * small-step smoothing. All effects respect the "reduce camera motion" setting.
 * Also renders simple low-poly hands for body visibility during moves.
 */

const EYE_STAND = 1.62;
const EYE_SLIDE = 0.84;
const BASE_FOV = 76;
const SPRINT_REF = 9.6;
const MOUSE_BASE = 0.0022;
const PITCH_BUMP = 0.05;

export class FirstPersonCamera {
  camera: THREE.PerspectiveCamera;

  private yaw = Math.PI;
  private pitch = 0;
  private roll = 0;

  // smoothing state
  private eyeH = EYE_STAND;
  private bobPhase = 0;
  private lastBobStep = 0;
  private strafeRoll = 0;
  private wallRoll = 0;
  private slideRoll = 0;
  private fov = BASE_FOV;
  private landSpringY = 0;
  private landSpringV = 0;
  private stepOffsetY = 0;
  private shakeRollImpulse = 0;
  private pitchImpulse = 0;
  private vaultArmT = 0;

  // hands
  private handsGroup = new THREE.Group();
  private leftArm!: THREE.Mesh;
  private rightArm!: THREE.Group;
  private handsArmed = true;

  private settings: { sensitivity: number; reduceMotion: boolean };

  constructor(
    private player: PlayerController,
    private gameState: GameState,
    domElement: HTMLElement,
    private onFootstep: (sprinting: boolean) => void
  ) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.08, 2200);
    this.camera.rotation.order = 'YXZ';
    this.settings = gameState.settings;
    this.buildHands();
    domElement.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === null) return;
    if (this.gameState.runState !== 'running') return;
    const s = this.settings.sensitivity * MOUSE_BASE;
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  };

  /** Snap yaw/pitch and springs from the player (respawn / run start). */
  snapToPlayer(): void {
    this.yaw = this.player.yaw;
    this.pitch = 0;
    this.roll = 0;
    this.landSpringY = 0;
    this.landSpringV = 0;
    this.stepOffsetY = 0;
    this.fov = BASE_FOV;
    this.eyeH = this.player.sliding() ? EYE_SLIDE : EYE_STAND;
    this.renderCamera(this.player.pos, this.eyeH, 0, 0, 0, 0, 0);
  }

  /** Landing impact spring kick. */
  onLand(impact: number): void {
    const k = Math.min(1, impact / 18);
    const scale = this.settings.reduceMotion ? 0.45 : 1;
    this.landSpringV -= (4 + 9 * k) * scale;
    this.shakeRollImpulse += (impact > 12 ? 1.2 : 0.5) * k * scale;
  }

  /** Small pitch kick on takeoff. */
  onJump(): void {
    this.pitchImpulse += this.settings.reduceMotion ? 0.35 : 0.9;
  }

  onVault(): void {
    this.vaultArmT = 1;
    this.pitchImpulse += this.settings.reduceMotion ? 0.4 : 1.1;
  }

  onMantle(): void {
    this.vaultArmT = Math.max(this.vaultArmT, 0.7);
  }

  // ------------------------------------------------------------- hands

  private buildHands(): void {
    const armMat = new THREE.MeshLambertMaterial({ color: 0xefece6 }); // white jacket sleeve
    const gloveMat = new THREE.MeshLambertMaterial({ color: 0xcf3a34 });

    const armGeo = new THREE.CapsuleGeometry(0.09, 0.30, 4, 10);

    const rightArm = new THREE.Group();
    const rArm = new THREE.Mesh(armGeo, armMat);
    rArm.rotation.x = -1.25;
    rightArm.add(rArm);
    const rGlove = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.15, 0.09), gloveMat);
    rGlove.position.set(0, -0.13, -0.28);
    rightArm.add(rGlove);
    rightArm.position.set(0.34, -0.42, -0.5);
    rightArm.rotation.set(0.35, -0.22, -0.12);
    rightArm.visible = false;
    this.rightArm = rightArm;

    const leftArm = new THREE.Mesh(armGeo, gloveMat);
    leftArm.rotation.x = -1.35;
    leftArm.position.set(-0.36, -0.4, -0.46);
    leftArm.visible = false;
    this.leftArm = leftArm;

    this.handsGroup.add(rightArm);
    this.handsGroup.add(leftArm);
  }

  /** Adds hands to the camera so they inherit all motion. */
  attachHands(): void {
    this.camera.add(this.handsGroup);
  }

  /** Shows hands (right while sprinting fast; both during vault/mantle/slide). */
  private updateHands(dt: number): void {
    const sprintArms = this.player.isSprinting() && this.player.phase === 'ground' && this.player.speed() > 7.6;
    const showRight = sprintArms || this.vaultArmT > 0;
    const showLeft = this.vaultArmT > 0 || this.player.sliding();
    this.rightArm.visible = showRight;
    this.leftArm.visible = showLeft;

    if (showRight) {
      const sway = Math.sin(this.bobPhase * 2) * 0.015;
      const rise = this.vaultArmT * 0.42;
      this.rightArm.position.set(0.34 + sway, -0.42 + rise, -0.5 - rise * 0.25);
      this.rightArm.rotation.x = 0.35 - rise * 1.1;
    }
    if (showLeft) {
      const rise = this.vaultArmT * 0.38;
      this.leftArm.position.set(-0.36, -0.4 - (this.player.sliding() ? 0.06 : 0) + rise, -0.46);
    }
    if (showRight || showLeft) {
      this.handsGroup.visible = true;
    } else {
      this.handsGroup.visible = false;
    }
    void dt;
    this.handsArmed = true;
  }

  // ------------------------------------------------------------- frame update

  update(dt: number): void {
    // Movement follows the camera look.
    this.player.yaw = this.yaw;
    this.player.pitch = this.pitch;

    const reduce = this.settings.reduceMotion ? 0.35 : 1;

    // Landing dip spring (damped).
    this.landSpringV += (this.landSpringY * -70 - this.landSpringV * 11) * dt;
    this.landSpringY += this.landSpringV * dt;

    this.shakeRollImpulse *= Math.max(0, 1 - 7 * dt);
    this.pitchImpulse *= Math.max(0, 1 - 10 * dt);
    if (this.vaultArmT > 0) this.vaultArmT = Math.max(0, this.vaultArmT - dt * 2.4);

    // Step smoothing: accumulate popped step-ups and release them smoothly.
    this.stepOffsetY += this.player.physics.steppedUp * 0.6;
    this.player.physics.steppedUp = 0;
    this.stepOffsetY *= Math.max(0, 1 - 8.5 * dt);
    if (Math.abs(this.stepOffsetY) < 0.0005) this.stepOffsetY = 0;

    const player = this.player;
    const pos = player.pos;
    const speed = player.speed();
    const vy = player.physics.vel.y;

    // Eye height
    const targetEye = player.physics.height < 1.6 ? EYE_SLIDE : EYE_STAND;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, 11 * dt);

    // Head bob (+ step events)
    const grounded = player.physics.grounded;
    const sprinting = player.isSprinting();
    if (grounded && speed > 0.6 && !player.wallRunning()) {
      this.bobPhase += speed * 1.42 * dt;
      const stepIdx = Math.floor(this.bobPhase / Math.PI);
      if (stepIdx !== this.lastBobStep) {
        this.lastBobStep = stepIdx;
        this.onFootstep(sprinting);
      }
    } else if (!grounded) {
      this.bobPhase += dt * 2.0;
    }
    const bobAmp = Math.min(1, speed / SPRINT_REF) * (sprinting ? 0.05 : 0.033) * reduce;
    const bobOffY = Math.sin(this.bobPhase * 2) * bobAmp;
    const bobOffX = Math.cos(this.bobPhase) * bobAmp * 0.6;

    // Rolls
    const strafeTarget = -player.inputStrafeVec * 0.024 * reduce;
    this.strafeRoll += (strafeTarget - this.strafeRoll) * Math.min(1, 8 * dt);
    const wallSide = player.wallSide();
    const wallTarget = wallSide !== 0 ? -wallSide * 0.21 * (this.settings.reduceMotion ? 0.55 : 1) : 0;
    this.wallRoll += (wallTarget - this.wallRoll) * Math.min(1, 7 * dt);
    const slideTarget = player.sliding() ? -0.05 * reduce : 0;
    this.slideRoll += (slideTarget - this.slideRoll) * Math.min(1, 9 * dt);
    this.roll = this.strafeRoll + this.wallRoll + this.slideRoll + this.shakeRollImpulse * 0.01;

    // FOV
    const speedNorm = Math.max(0, (speed - 5.5) / 5.5);
    const speedBoost = speedNorm * 10 * (this.settings.reduceMotion ? 0.55 : 1);
    const airBoost = !grounded && vy > 1 ? 1.4 * reduce : 0;
    const slideBoost = player.sliding() ? 3.4 * reduce : 0;
    const wallBoost = wallSide !== 0 ? 3.2 : 0;
    const targetFov = BASE_FOV + speedBoost * (0.9 + 0.5 * Math.min(1, speedNorm)) + airBoost + slideBoost + wallBoost;
    this.fov += (targetFov - this.fov) * Math.min(1, 5.5 * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const land = this.landSpringY * 0.05;
    this.renderCamera(pos, this.eyeH, bobOffY, bobOffX, land, this.stepOffsetY * 3, this.pitchImpulse * PITCH_BUMP);

    this.updateHands(dt);
  }

  private renderCamera(
    pos: THREE.Vector3,
    eyeH: number,
    bobY: number,
    bobX: number,
    landY: number,
    stepY: number,
    pitchImpulse: number
  ): void {
    const right = _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.set(
      pos.x + right.x * bobX,
      pos.y + eyeH + bobY + landY + stepY,
      pos.z + right.z * bobX
    );
    this.camera.rotation.set(
      this.pitch + pitchImpulse,
      this.yaw,
      this.roll
    );
  }
}

const _right = new THREE.Vector3();
