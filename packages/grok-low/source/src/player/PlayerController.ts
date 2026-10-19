import * as THREE from "three";
import { clamp } from "../core/constants";
import { planarBasis } from "./basis";
import type { FirstPersonCamera } from "./FirstPersonCamera";
import type { PlayerInput } from "./types";

const RAD_PER_PX = 0.00215;

/** Keys and mouse. Jump and vault are edges, consumed on the first physics substep of the frame. */
export class PlayerController {
  sensitivity = 1;
  strafe = 0;

  private readonly keys = new Set<string>();
  private pendingJump = false;
  private pendingVault = false;
  private jumpHeld = false;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(private readonly view: FirstPersonCamera) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouse);
  }

  clearEdges(): void {
    this.pendingJump = false;
    this.pendingVault = false;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Space") {
      this.pendingJump = true;
      this.jumpHeld = true;
    }
    if (e.code === "KeyE") this.pendingVault = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === "Space") this.jumpHeld = false;
  };

  private onMouse = (e: MouseEvent): void => {
    if (document.pointerLockElement == null) return;
    const scale = RAD_PER_PX * this.sensitivity;
    this.view.mouseYaw -= e.movementX * scale;
    this.view.mousePitch -= e.movementY * scale;
    this.view.mousePitch = clamp(this.view.mousePitch, -1.25, 1.2);
  };

  /**
   * World-space wish from the camera's planar basis.
   * `right = forward × up`, so yaw −π/2 (looking +X) makes D strafe toward +Z.
   */
  sample(firstSubstep: boolean): PlayerInput {
    this.view.yaw.rotation.y = this.view.mouseYaw;
    this.view.pitch.rotation.x = this.view.mousePitch;
    this.view.yaw.updateMatrixWorld(true);
    planarBasis(this.view.camera, this.fwd, this.right);

    let forward = 0;
    let strafe = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forward -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;
    this.strafe = strafe;

    let wishX = this.fwd.x * forward + this.right.x * strafe;
    let wishZ = this.fwd.z * forward + this.right.z * strafe;
    const len = Math.hypot(wishX, wishZ);
    if (len > 1) {
      wishX /= len;
      wishZ /= len;
    }

    const jump = firstSubstep && this.pendingJump;
    const vault = firstSubstep && this.pendingVault;
    if (firstSubstep) {
      this.pendingJump = false;
      this.pendingVault = false;
    }

    return {
      wishX,
      wishZ,
      sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      jump,
      jumpHeld: this.jumpHeld,
      slide: this.keys.has("ControlLeft") || this.keys.has("ControlRight") || this.keys.has("KeyC"),
      vault,
    };
  }
}
