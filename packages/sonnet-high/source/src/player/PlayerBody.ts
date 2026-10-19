import * as THREE from 'three';
import { MoveState } from './PlayerController.ts';
import type { PlayerController } from './PlayerController.ts';
import type { FirstPersonCamera } from './FirstPersonCamera.ts';
import { MOVE } from './MovementConfig.ts';
import { SUN_DIRECTION } from '../world/Sky.ts';

/**
 * Low-poly first-person body: forearms that swing while sprinting and reach out when vaulting,
 * mantling or wall-running, plus legs/feet that become visible when looking down.
 *
 * It is drawn in a second pass with its own camera (depth cleared) so it can never clip into
 * level geometry, and everything is kept low in the frame so it does not obstruct the view.
 */

interface Arm {
  side: -1 | 1;
  group: THREE.Group;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  hand: THREE.Mesh;
  weight: number;
}

interface Leg {
  side: -1 | 1;
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  shoe: THREE.Mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Places a unit-height box mesh so it spans from point a to point b. */
function span(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thickness: number): void {
  tmpDir.subVectors(b, a);
  const len = Math.max(tmpDir.length(), 1e-4);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(thickness, len, thickness);
  tmpQuat.setFromUnitVectors(UP, tmpDir.multiplyScalar(1 / len));
  mesh.quaternion.copy(tmpQuat);
}

export class PlayerBody {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(80, 1, 0.02, 10);

  private readonly arms: Arm[] = [];
  private readonly legs: Leg[] = [];
  private readonly bodyRoot = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly materials: THREE.Material[] = [];
  private runBlend = 0;
  private slideBlend = 0;
  private airBlend = 0;

  constructor() {
    this.scene.add(this.camera);
    this.scene.add(this.bodyRoot);

    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8d98a6, 2.1));
    const sun = new THREE.DirectionalLight(0xfff2de, 2.6);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(5);
    this.scene.add(sun);

    const sleeve = this.mat(0xe7ebf0, 0.8);
    const skin = this.mat(0xd8a584, 0.7);
    const pants = this.mat(0x434c5a, 0.85);
    const shoe = this.mat(0xd0141c, 0.5);
    const sole = this.mat(0xf2f2f2, 0.6);

    for (const side of [-1, 1] as const) {
      const group = new THREE.Group();
      const upper = new THREE.Mesh(this.geometry, sleeve);
      const fore = new THREE.Mesh(this.geometry, sleeve);
      const hand = new THREE.Mesh(this.geometry, skin);
      group.add(upper, fore, hand);
      group.visible = false;
      this.camera.add(group);
      this.arms.push({ side, group, upper, fore, hand, weight: 0 });

      const thigh = new THREE.Mesh(this.geometry, pants);
      const shin = new THREE.Mesh(this.geometry, pants);
      const foot = new THREE.Mesh(this.geometry, shoe);
      const solePlate = new THREE.Mesh(this.geometry, sole);
      foot.add(solePlate);
      solePlate.scale.set(1.04, 0.2, 1.04);
      solePlate.position.y = -0.4;
      this.bodyRoot.add(thigh, shin, foot);
      this.legs.push({ side, thigh, shin, shoe: foot });
    }
  }

  private mat(color: number, roughness: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.materials.push(m);
    return m;
  }

  update(dt: number, ctrl: PlayerController, cam: FirstPersonCamera, yaw: number, pitch: number): void {
    // View-model camera mirrors the player camera orientation, sitting at the origin.
    const main = cam.camera;
    this.camera.fov = main.fov;
    this.camera.aspect = main.aspect;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(pitch, yaw, cam.roll, 'YXZ');

    const speed = ctrl.speedH;
    const state = ctrl.state;
    const grounded = state === MoveState.Ground;
    const k = 1 - Math.exp(-10 * dt);
    const runT = grounded ? Math.min(Math.max((speed - 2) / (MOVE.sprintSpeed - 2), 0), 1) : 0;
    this.runBlend += (runT - this.runBlend) * k;
    this.slideBlend += ((state === MoveState.Slide ? 1 : 0) - this.slideBlend) * k;
    const airT = state === MoveState.Air || state === MoveState.Vault || state === MoveState.Mantle ? 1 : 0;
    this.airBlend += (airT - this.airBlend) * k;

    this.updateArms(dt, ctrl, cam);
    this.updateLegs(ctrl, cam, yaw);
  }

  private updateArms(dt: number, ctrl: PlayerController, cam: FirstPersonCamera): void {
    const state = ctrl.state;
    const phase = cam.bobPhase * 1.0;
    const prog = ctrl.actionProgress;
    const pulse = Math.sin(prog * Math.PI);
    const k = 1 - Math.exp(-12 * dt);
    const reduce = cam.motionScale < 0.5 ? 0.5 : 1;

    for (const arm of this.arms) {
      const s = arm.side;
      // Target hand position in camera space and how visible the arm should be.
      let tx = s * 0.34;
      let ty = -0.34;
      let tz = -0.44;
      let w = 0;
      const swing = Math.sin(phase * 1.0 + (s === 1 ? Math.PI : 0));

      if (state === MoveState.Vault) {
        w = Math.min(1, pulse * 2.2);
        tx = s * lerp(0.28, 0.2, pulse);
        ty = lerp(-0.12, -0.46, pulse);
        tz = -0.5 - 0.12 * pulse;
      } else if (state === MoveState.Mantle) {
        w = Math.min(1, pulse * 2.2);
        tx = s * 0.26;
        ty = lerp(-0.02, -0.4, prog);
        tz = -0.6;
      } else if (state === MoveState.WallRun) {
        if (s === ctrl.wallSide) {
          w = 1;
          tx = s * 0.52;
          ty = -0.14 + swing * 0.03;
          tz = -0.46 - swing * 0.06;
        } else {
          w = 0.35;
          ty = -0.4;
        }
      } else if (state === MoveState.Ground && this.runBlend > 0.05) {
        w = this.runBlend * 0.9 * reduce;
        tx = s * 0.33;
        ty = -0.37 + 0.035 * Math.abs(swing);
        tz = -0.4 - 0.13 * swing * this.runBlend;
      } else if (state === MoveState.Air) {
        w = 0.3;
        tx = s * 0.4;
        ty = -0.4;
        tz = -0.36;
      }

      arm.weight += (w - arm.weight) * k;
      arm.group.visible = arm.weight > 0.02;
      if (!arm.group.visible) continue;

      // Slide the hand in from below the frame as the weight grows.
      const hide = 1 - arm.weight;
      const hand = tmpA.set(tx, ty - 0.45 * hide, tz + 0.05 * hide);
      const shoulder = tmpB.set(s * 0.3, -0.62, 0.22);
      const elbow = new THREE.Vector3().lerpVectors(shoulder, hand, 0.52);
      elbow.x += s * 0.1;
      elbow.y -= 0.06;

      span(arm.upper, shoulder, elbow, 0.1);
      span(arm.fore, elbow, hand, 0.085);
      // hand: a flat box continuing the forearm direction
      arm.hand.position.copy(hand).addScaledVector(tmpDir.subVectors(hand, elbow).normalize(), 0.04);
      arm.hand.scale.set(0.09, 0.05, 0.12);
      arm.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tmpDir);
    }
  }

  private updateLegs(ctrl: PlayerController, cam: FirstPersonCamera, yaw: number): void {
    const eye = cam.eye;
    this.bodyRoot.rotation.set(0, yaw, 0);
    this.bodyRoot.position.set(0, 0, 0);
    const phase = cam.bobPhase;
    const run = this.runBlend;
    const slide = this.slideBlend;
    const air = this.airBlend;
    const hipDrop = 0.72 * (eye / 1.65);

    for (const leg of this.legs) {
      const s = leg.side;
      const sw = Math.sin(phase + (s === 1 ? Math.PI : 0));
      const lift = Math.max(0, sw) * 0.22 * run;

      // standing / running pose
      const hip = tmpA.set(s * 0.12, -hipDrop, 0.12);
      const foot = tmpB.set(s * 0.12, -eye + lift, -0.04 - 0.34 * sw * run);

      // blend towards sliding pose (legs stretched out in front)
      const slideHip = new THREE.Vector3(s * 0.12, -0.34, 0.2);
      const slideFoot = new THREE.Vector3(s * 0.15 + (s === 1 ? 0.04 : -0.02), -eye + 0.06, -1.05 + (s === 1 ? -0.1 : 0.05));
      hip.lerp(slideHip, slide);
      foot.lerp(slideFoot, slide);

      // airborne: knees tucked a little
      const airFoot = new THREE.Vector3(s * 0.13, -eye + 0.38, -0.3 - (s === 1 ? 0.18 : 0));
      foot.lerp(airFoot, air * (1 - slide));

      const knee = new THREE.Vector3().lerpVectors(hip, foot, 0.5);
      knee.z -= 0.1 + 0.14 * air + 0.08 * run * Math.max(0, sw);
      knee.y += 0.02;

      span(leg.thigh, hip, knee, 0.15);
      span(leg.shin, knee, foot, 0.12);
      // shoe: a box pointing forward from the ankle
      leg.shoe.position.set(foot.x, foot.y + 0.04, foot.z - 0.07);
      leg.shoe.scale.set(0.12, 0.1, 0.3);
      leg.shoe.quaternion.identity();
      void ctrl;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
