import * as THREE from "three";
import { EYE_SLIDE, EYE_STAND, SLIDE_H, SPRINT_SPEED, STAND_H, clamp, lerp } from "../core/constants";
import { UP, createViewRig, planarBasis } from "./basis";
import type { PlayerState } from "./types";

/**
 * View rig: yaw, then pitch, then roll, then camera.
 * Movement reads this camera through `planarBasis` — the same helper the self-test uses.
 * Bob and roll never write yaw.
 */
export class FirstPersonCamera {
  readonly yaw: THREE.Object3D;
  readonly pitch: THREE.Object3D;
  readonly roll: THREE.Object3D;
  readonly camera: THREE.PerspectiveCamera;
  readonly feet: THREE.Group;
  mouseYaw: number;
  mousePitch: number;

  private readonly arms: THREE.Group;
  private readonly leftArm: THREE.Group;
  private readonly rightArm: THREE.Group;
  private readonly leftShoe: THREE.Object3D;
  private readonly rightShoe: THREE.Object3D;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private eye = EYE_STAND;
  private dip = 0;
  private bob = 0;
  private amp = 0;
  private bank = 0;
  private lean = 0;
  private fov = 76;

  constructor(aspect: number, yaw: number) {
    const rig = createViewRig(aspect);
    this.yaw = rig.yaw;
    this.pitch = rig.pitch;
    this.roll = rig.roll;
    this.camera = rig.camera;
    this.camera.fov = 76;
    this.mouseYaw = yaw;
    this.mousePitch = -0.08;
    this.yaw.rotation.y = yaw;
    this.pitch.rotation.x = this.mousePitch;

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.55, metalness: 0.04 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.42, metalness: 0.18 });
    this.leftArm = makeArm(white, red, -1);
    this.rightArm = makeArm(white, red, 1);
    this.arms = new THREE.Group();
    this.arms.add(this.leftArm, this.rightArm);
    this.camera.add(this.arms);

    this.leftShoe = makeShoe(red, white);
    this.rightShoe = makeShoe(red, white);
    this.leftShoe.position.set(-0.13, 0.06, 0.06);
    this.rightShoe.position.set(0.13, 0.06, 0.06);
    this.feet = new THREE.Group();
    this.feet.matrixAutoUpdate = false;
    this.feet.add(this.leftShoe, this.rightShoe);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Place the rig on a respawn without lerping across the city. */
  snap(s: PlayerState, yaw: number): void {
    this.mouseYaw = yaw;
    this.mousePitch = -0.08;
    this.eye = s.height < 1.2 ? EYE_SLIDE : EYE_STAND;
    this.dip = 0;
    this.bank = 0;
    this.lean = 0;
    this.amp = 0;
    this.yaw.position.set(s.x, s.y + this.eye, s.z);
    this.yaw.rotation.y = yaw;
    this.pitch.rotation.x = this.mousePitch;
    this.roll.rotation.z = 0;
    this.camera.position.set(0, 0, 0);
    this.yaw.updateMatrixWorld(true);
  }

  update(s: PlayerState, dt: number, reduce: boolean, strafe: number): void {
    const stance = clamp((s.height - SLIDE_H) / (STAND_H - SLIDE_H), 0, 1);
    const targetEye = lerp(EYE_SLIDE, EYE_STAND, stance);
    this.eye = lerp(this.eye, targetEye, 1 - Math.exp(-dt * 14));
    this.dip = Math.max(s.landKick * 0.055, this.dip * Math.exp(-dt * 8));

    this.yaw.position.set(s.x, s.y + this.eye - this.dip, s.z);
    this.yaw.rotation.y = this.mouseYaw;
    // Positive pitch looks up. Vaults lift the view; landings dip it.
    this.pitch.rotation.x = this.mousePitch + s.vaultBlend * 0.07 - s.landKick * 0.045;

    const bankScale = reduce ? 0.5 : 1;
    const targetBank = s.mode === "wallrun" ? -s.wallSide * 0.22 * bankScale : 0;
    this.bank = lerp(this.bank, targetBank, 1 - Math.exp(-dt * 8));
    const targetLean = reduce ? 0 : clamp(strafe, -1, 1) * 0.045;
    this.lean = lerp(this.lean, targetLean, 1 - Math.exp(-dt * 6));
    this.roll.rotation.z = this.bank + this.lean;

    const stepping = !reduce && s.grounded && s.speed > 1.4 && (s.mode === "ground" || s.mode === "crouch");
    if (stepping) {
      const rate = (s.mode === "crouch" ? 8.5 : 11.5) * (0.65 + s.speed / SPRINT_SPEED);
      this.bob += dt * rate;
      this.amp = lerp(this.amp, 0.026, 1 - Math.exp(-dt * 5));
    } else {
      this.amp = lerp(this.amp, 0, 1 - Math.exp(-dt * 7));
    }
    this.camera.position.set(Math.cos(this.bob) * this.amp * 0.45, Math.sin(this.bob * 2) * this.amp, 0);
    this.camera.rotation.set(0, 0, 0);

    const fovKick = reduce ? 5 : 14;
    const targetFov = 76 + fovKick * clamp((s.speed - 5.2) / (SPRINT_SPEED - 5.2), 0, 1);
    this.fov = lerp(this.fov, targetFov, 1 - Math.exp(-dt * 4));
    if (Math.abs(this.camera.fov - this.fov) > 0.04) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const swing = stepping ? Math.sin(this.bob) * 0.35 : 0;
    const reach = s.vaultBlend;
    this.arms.position.set(0, -crouchDrop(stance), 0);
    poseArm(this.leftArm, swing, reach);
    poseArm(this.rightArm, -swing, reach);

    this.yaw.updateMatrixWorld(true);
    planarBasis(this.camera, this.fwd, this.right);
    this.back.copy(this.fwd).negate();
    this.feet.matrix.makeBasis(this.right, UP, this.back);
    this.feet.matrix.setPosition(s.x, s.y + 0.02, s.z);
    this.feet.matrixWorldNeedsUpdate = true;

    const step = Math.sin(this.bob);
    const lift = stepping ? 0.07 : 0.02;
    this.leftShoe.position.set(-0.13, 0.05 + Math.max(0, step) * lift, 0.04 + step * 0.1);
    this.rightShoe.position.set(0.13, 0.05 + Math.max(0, -step) * lift, 0.04 - step * 0.1);
    this.feet.updateMatrixWorld(true);
  }
}

function crouchDrop(stance: number): number {
  return (1 - stance) * 0.16;
}

function makeArm(white: THREE.Material, red: THREE.Material, side: number): THREE.Group {
  const group = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.078, 0.32), white);
  sleeve.position.set(0, 0, -0.1);
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.05, 0.055), red);
  cuff.position.set(0, -0.012, -0.26);
  group.add(sleeve, cuff);
  group.position.set(side * 0.24, -0.3, -0.32);
  return group;
}

function poseArm(arm: THREE.Group, swing: number, reach: number): void {
  arm.rotation.x = -reach * 0.9 + swing * 0.45;
  arm.position.z = -0.32 - reach * 0.2;
}

function makeShoe(red: THREE.Material, white: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.028, 0.28), white);
  sole.position.y = 0.014;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.055, 0.2), red);
  upper.position.set(0, 0.05, -0.02);
  group.add(sole, upper);
  return group;
}
