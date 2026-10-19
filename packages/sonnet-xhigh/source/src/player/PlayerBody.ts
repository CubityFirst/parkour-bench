/**
 * PlayerBody - low-poly body visualisation for the first-person view.
 *
 *  - Arms are drawn in a separate "view model" pass (depth cleared first) so they can
 *    never clip into world geometry or block the view: they only appear at the lower
 *    screen corners and move procedurally (sprint swing, slide, vault, mantle, wall run).
 *  - Legs live in the world and are only visible when looking down. They share the
 *    walk cycle phase of the controller. Invisible torso/head proxies cast the player's
 *    shadow onto the rooftop.
 */

import * as THREE from 'three';
import { MOVE } from './MovementConfig';
import { type PlayerController } from './PlayerController';
import { type FirstPersonCamera } from './FirstPersonCamera';

const SLEEVE = 0xd8dde4;
const SKIN = 0xe2b49b;
const PANTS = 0x4d5663;
const SHOE = 0xdc2a1f;
const D2R = Math.PI / 180;

function damp(a: number, b: number, rate: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-rate * dt));
}

interface ArmPose {
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
}

class Arm {
  readonly root = new THREE.Group();
  pose: ArmPose = { x: 0, y: -0.4, z: -0.1, pitch: -80 * D2R, yaw: 0, roll: 0 };

  constructor(readonly side: -1 | 1, sleeve: THREE.Material, skin: THREE.Material, band: THREE.Material, geos: THREE.BufferGeometry[]) {
    const upper = new THREE.BoxGeometry(0.105, 0.105, 0.42);
    upper.translate(0, 0, -0.21);
    const cuff = new THREE.BoxGeometry(0.112, 0.112, 0.05);
    cuff.translate(0, 0, -0.44);
    const hand = new THREE.BoxGeometry(0.095, 0.055, 0.13);
    hand.translate(0, -0.004, -0.53);
    const thumb = new THREE.BoxGeometry(0.03, 0.035, 0.07);
    thumb.translate(-side * 0.055, 0.004, -0.52);
    geos.push(upper, cuff, hand, thumb);
    this.root.add(
      new THREE.Mesh(upper, sleeve),
      new THREE.Mesh(cuff, band),
      new THREE.Mesh(hand, skin),
      new THREE.Mesh(thumb, skin),
    );
    this.root.rotation.order = 'YXZ';
  }

  apply(target: ArmPose, dt: number, rate: number): void {
    const p = this.pose;
    p.x = damp(p.x, target.x, rate, dt);
    p.y = damp(p.y, target.y, rate, dt);
    p.z = damp(p.z, target.z, rate, dt);
    p.pitch = damp(p.pitch, target.pitch, rate, dt);
    p.yaw = damp(p.yaw, target.yaw, rate, dt);
    p.roll = damp(p.roll, target.roll, rate, dt);
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
  }
}

class Leg {
  readonly hip = new THREE.Group();
  readonly knee = new THREE.Group();
  readonly ankle = new THREE.Group();

  constructor(side: -1 | 1, pants: THREE.Material, shoe: THREE.Material, geos: THREE.BufferGeometry[]) {
    const thigh = new THREE.BoxGeometry(0.135, 0.46, 0.15);
    thigh.translate(0, -0.23, 0);
    const shin = new THREE.BoxGeometry(0.115, 0.44, 0.125);
    shin.translate(0, -0.22, 0);
    const foot = new THREE.BoxGeometry(0.13, 0.095, 0.34);
    foot.translate(0, -0.047, -0.1);
    geos.push(thigh, shin, foot);
    const thighMesh = new THREE.Mesh(thigh, pants);
    const shinMesh = new THREE.Mesh(shin, pants);
    const footMesh = new THREE.Mesh(foot, shoe);
    thighMesh.castShadow = shinMesh.castShadow = footMesh.castShadow = true;
    this.hip.position.set(side * 0.13, 0, 0);
    this.hip.add(thighMesh, this.knee);
    this.knee.position.set(0, -0.46, 0);
    this.knee.add(shinMesh, this.ankle);
    this.ankle.position.set(0, -0.44, 0);
    this.ankle.add(footMesh);
  }
}

export class PlayerBody {
  /** Separate scene + camera for the arms (rendered after clearing depth). */
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(72, 16 / 9, 0.02, 10);
  /** World-space legs; add to the main scene. */
  readonly legs = new THREE.Group();

  private readonly arms: [Arm, Arm];
  private readonly legL: Leg;
  private readonly legR: Leg;
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;

  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly lights: THREE.Light[] = [];

  private bodyYaw = 0;
  private hipY = 0.92;
  private sway = 0;
  private lastYaw = 0;

  constructor(env: THREE.Texture | null) {
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
    const band = new THREE.MeshStandardMaterial({ color: 0xe0231c, roughness: 0.5, emissive: 0x551008 });
    const pants = new THREE.MeshStandardMaterial({ color: PANTS, roughness: 0.85 });
    const shoe = new THREE.MeshStandardMaterial({ color: SHOE, roughness: 0.55, emissive: 0x3a0804 });
    // Invisible but shadow-casting proxy for torso and head.
    const proxy = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.mats.push(sleeve, skin, band, pants, shoe, proxy);

    // ---- view model scene
    this.viewScene.environment = env;
    this.viewScene.environmentIntensity = 0.9;
    const hemi = new THREE.HemisphereLight(0xdcecff, 0xc9ccd0, 1.4);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(0.5, 1, 0.4);
    this.viewScene.add(hemi, sun);
    this.lights.push(hemi, sun);

    const armL = new Arm(-1, sleeve, skin, band, this.geos);
    const armR = new Arm(1, sleeve, skin, band, this.geos);
    this.arms = [armL, armR];
    this.viewScene.add(armL.root, armR.root);

    // ---- legs
    this.legL = new Leg(-1, pants, shoe, this.geos);
    this.legR = new Leg(1, pants, shoe, this.geos);
    this.legs.add(this.legL.hip, this.legR.hip);

    const torsoGeo = new THREE.BoxGeometry(0.46, 1, 0.26);
    const headGeo = new THREE.SphereGeometry(0.12, 10, 8);
    this.geos.push(torsoGeo, headGeo);
    this.torso = new THREE.Mesh(torsoGeo, proxy);
    this.head = new THREE.Mesh(headGeo, proxy);
    this.torso.castShadow = true;
    this.head.castShadow = true;
    this.legs.add(this.torso, this.head);
    this.legs.traverse((o) => { o.frustumCulled = false; });
  }

  update(dt: number, ctrl: PlayerController, cam: FirstPersonCamera, alpha: number): void {
    const p = ctrl.physics;
    const state = ctrl.state;
    const speed = p.horizontalSpeed;
    const speedT = Math.min(speed / MOVE.sprintSpeed, 1.1);
    const phase = ctrl.stridePhase;
    const script = ctrl.parkour.active;
    const wall = ctrl.parkour.wall;
    const sprinting = ctrl.sprinting && speed > 6;

    // Keep the view model camera in sync with the main camera lens.
    this.viewCamera.fov = cam.camera.fov;
    this.viewCamera.aspect = cam.camera.aspect;
    this.viewCamera.updateProjectionMatrix();

    // ---- subtle sway from turning the camera
    const yawRate = (cam.yaw - this.lastYaw) / Math.max(dt, 1e-4);
    this.lastYaw = cam.yaw;
    this.sway = damp(this.sway, Math.max(-4, Math.min(4, yawRate)) * 0.012, 8, dt);
    const motion = cam.motion;

    // ---- arm poses
    for (const arm of this.arms) {
      const s = arm.side;
      const t: ArmPose = { x: s * 0.26, y: -0.3, z: -0.1, pitch: -80 * D2R, yaw: 0, roll: 0 };
      let rate = 12;
      if (script && script.kind === 'vault') {
        const u = script.progress;
        const plant = Math.sin(Math.min(1, u * 1.15) * Math.PI);
        t.x = s * 0.2;
        t.y = -0.36 + 0.02 * plant;
        t.z = -0.16 - 0.1 * plant;
        t.pitch = (-52 + 38 * plant) * D2R;
        t.yaw = -s * 6 * D2R;
        rate = 22;
      } else if (script && script.kind === 'mantle') {
        const u = script.progress;
        const reach = 1 - Math.min(1, u * 1.6);
        t.x = s * 0.2;
        t.y = -0.34 + 0.1 * reach;
        t.z = -0.12 - 0.08 * reach;
        t.pitch = (-36 + 44 * reach) * D2R;
        t.yaw = -s * 5 * D2R;
        rate = 20;
      } else if (state === 'wallrun' && wall.active) {
        if (s === wall.side) {
          // Hand on the wall.
          t.x = s * 0.3;
          t.y = -0.3;
          t.z = -0.16;
          t.pitch = -12 * D2R;
          t.yaw = -s * 52 * D2R;
          t.roll = s * 8 * D2R;
        } else {
          const swing = Math.sin(phase * 1.1 + 1);
          t.pitch = (-60 + swing * 26) * D2R;
          t.x = s * 0.24;
        }
        rate = 14;
      } else if (state === 'slide') {
        t.x = s * 0.3;
        t.y = -0.3;
        t.z = -0.12;
        t.pitch = -12 * D2R;
        t.yaw = -s * 10 * D2R;
        t.roll = s * 4 * D2R;
        rate = 14;
      } else if (state === 'air') {
        t.x = s * 0.3;
        t.y = -0.3;
        t.pitch = -25 * D2R + Math.sin(phase * 0.5 + (s > 0 ? 0 : Math.PI)) * 0.05;
        t.yaw = -s * 7 * D2R;
        t.roll = s * 7 * D2R;
        rate = 8;
      } else {
        // Running: arms pump with the stride and only peek in at the bottom corners.
        const swing = Math.sin(phase + (s > 0 ? 0 : Math.PI));
        const amp = (sprinting ? 1 : 0.55) * speedT;
        t.pitch = (-76 + swing * 46 * amp + (sprinting ? 14 : 0)) * D2R;
        t.x = s * (0.25 + 0.025 * swing * amp);
        t.y = -0.3 + 0.04 * Math.abs(swing) * amp;
        t.z = -0.08 - 0.05 * swing * amp;
        t.yaw = -s * 4 * D2R * amp;
        rate = 16;
      }
      t.x += this.sway;
      // reduced motion: damp the swing amplitude by blending towards the rest pose
      if (motion < 1) {
        t.pitch = THREE.MathUtils.lerp(-78 * D2R, t.pitch, 0.45 + 0.55 * motion);
      }
      arm.apply(t, dt, rate);
    }

    // ---- legs
    this.updateLegs(dt, ctrl, cam, speedT, phase, state, alpha);
  }

  private updateLegs(
    dt: number, ctrl: PlayerController, cam: FirstPersonCamera,
    speedT: number, phase: number, state: string, alpha: number,
  ): void {
    const p = ctrl.physics;
    const slideAmt = state === 'slide' ? 1 : 0;

    // Body yaw: follows the camera, but along the velocity while sliding / wall running.
    let targetYaw = cam.yaw;
    if ((state === 'slide' || state === 'wallrun') && p.horizontalSpeed > 1) {
      targetYaw = Math.atan2(-p.vx, -p.vz);
    }
    let d = targetYaw - this.bodyYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.bodyYaw += d * (1 - Math.exp(-dt * 12));
    const feetX = ctrl.prevX + (p.x - ctrl.prevX) * alpha;
    const feetY = ctrl.prevY + (p.y - ctrl.prevY) * alpha;
    const feetZ = ctrl.prevZ + (p.z - ctrl.prevZ) * alpha;
    this.legs.position.set(feetX, feetY, feetZ);
    this.legs.rotation.set(0, this.bodyYaw, 0);

    // Hip height
    const hipTarget = state === 'slide' ? 0.3 : (state === 'vault' ? 0.8 : (state === 'mantle' ? 0.9 : 0.92));
    this.hipY = damp(this.hipY, hipTarget, 14, dt);
    const forwardOffset = -0.2 - slideAmt * 0.05;

    let thighL = 0, thighR = 0, kneeL = 0, kneeR = 0, ankleL = 0, ankleR = 0;
    const amp = 0.85 * Math.min(speedT, 1);
    if (state === 'ground') {
      const a = Math.sin(phase);
      const b = Math.sin(phase + Math.PI);
      thighL = a * amp;
      thighR = b * amp;
      kneeL = -Math.max(0, -Math.cos(phase)) * 1.2 * Math.min(speedT, 1) - 0.08;
      kneeR = -Math.max(0, Math.cos(phase)) * 1.2 * Math.min(speedT, 1) - 0.08;
    } else if (state === 'air') {
      thighL = 0.75; kneeL = -0.9;
      thighR = -0.3; kneeR = -0.5;
    } else if (state === 'slide') {
      thighL = 1.42; kneeL = -0.05; ankleL = -1.05;
      thighR = 1.34; kneeR = -0.1; ankleR = -1.0;
    } else if (state === 'wallrun') {
      const a = Math.sin(phase * 1.2);
      thighL = a * 0.9; thighR = -a * 0.9;
      kneeL = -Math.max(0, -Math.cos(phase * 1.2)) * 1.1;
      kneeR = -Math.max(0, Math.cos(phase * 1.2)) * 1.1;
    } else if (state === 'vault') {
      thighL = 1.25; kneeL = -1.5;
      thighR = 0.7; kneeR = -0.9;
    } else if (state === 'mantle') {
      const a = Math.sin(performance.now() * 0.012);
      thighL = 0.5 + a * 0.3; kneeL = -0.9;
      thighR = 0.2 - a * 0.3; kneeR = -0.5;
    }
    this.legL.hip.position.set(-0.13, this.hipY, forwardOffset);
    this.legR.hip.position.set(0.13, this.hipY, forwardOffset);
    this.legL.hip.rotation.x = thighL;
    this.legR.hip.rotation.x = thighR;
    this.legL.knee.rotation.x = kneeL;
    this.legR.knee.rotation.x = kneeR;
    this.legL.ankle.rotation.x = ankleL;
    this.legR.ankle.rotation.x = ankleR;

    // Torso / head proxies (shadow only)
    const headY = cam.eyePosition.y - feetY;
    this.head.position.set(0, headY, 0);
    const top = Math.max(this.hipY + 0.25, headY - 0.14);
    const height = top - this.hipY;
    this.torso.position.set(0, this.hipY + height / 2, 0);
    this.torso.scale.set(1, height, 1);
    const lean = state === 'slide' ? -0.35 : speedT * 0.12;
    this.torso.rotation.x = -lean * 0.5;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const l of this.lights) l.dispose();
    this.viewScene.clear();
    this.legs.clear();
  }
}
