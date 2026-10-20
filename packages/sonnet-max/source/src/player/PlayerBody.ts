import * as THREE from 'three';
import { MOVE } from '../config.ts';
import type { PlayerController } from './PlayerController.ts';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const UP = new THREE.Vector3(0, 1, 0);

/** Two-bone IK: places the middle joint between `root` and `target`, bending toward `pole`. */
const ikDir = new THREE.Vector3();
const ikPerp = new THREE.Vector3();

function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, joint: THREE.Vector3, end: THREE.Vector3): void {
  const d = ikDir.copy(target).sub(root);
  let dist = d.length();
  const maxReach = l1 + l2 - 1e-3;
  const minReach = Math.abs(l1 - l2) + 1e-3;
  dist = clamp(dist, minReach, maxReach);
  if (d.lengthSq() < 1e-8) d.set(0, -1, 0);
  d.normalize();
  end.copy(root).addScaledVector(d, dist);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = ikPerp.copy(pole).addScaledVector(d, -pole.dot(d));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, -1).addScaledVector(d, d.z);
  perp.normalize();
  joint.copy(root).addScaledVector(d, a).addScaledVector(perp, h);
}

/** Orients a unit-height box so it spans from `a` to `b`. */
const segDir = new THREE.Vector3();
const FORWARD = new THREE.Vector3(0, 0, -1);

function placeSegment(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thickness: number): void {
  const dir = segDir.copy(b).sub(a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
  mesh.scale.set(thickness, len, thickness);
}

interface Limb {
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  end: THREE.Group; // hand or shoe
  joint: THREE.Vector3;
  tip: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Stylised low-poly arms and legs rendered in the first-person view scene (depth-cleared, so they can
 * never poke through walls). Arms appear during sprinting, vaulting, mantling, sliding and wall-running;
 * legs and shoes show up when the player looks down. Everything is driven procedurally from the
 * controller state - there are no animation clips.
 */
export class PlayerBodyView {
  readonly group = new THREE.Group();
  readonly arms: Limb[] = [];
  readonly legs: Limb[] = [];
  readonly legRoot = new THREE.Group();
  readonly cameraRig = new THREE.Group();
  private phase = 0;
  private armSwing = 0;
  private shade = 0;
  private readonly disposables: Array<{ dispose(): void }> = [];
  // Shoulders sit low and BEHIND the camera so only forearms and hands ever enter the bottom of the view.
  readonly shoulders = [new THREE.Vector3(-0.24, -0.44, 0.24), new THREE.Vector3(0.24, -0.44, 0.24)];
  private readonly hips = [new THREE.Vector3(-0.1, 0.92, 0.02), new THREE.Vector3(0.1, 0.92, 0.02)];
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  enabled = true;

  constructor() {
    const sleeve = this.mat(0xeef1f5, 0.85);
    const skin = this.mat(0xd9a785, 0.75);
    const cuff = this.mat(0xe0150f, 0.5);
    const pants = this.mat(0xdfe4ea, 0.85);
    const shoe = this.mat(0xd8140e, 0.5);
    shoe.emissive.set(0x5a0300);
    shoe.emissiveIntensity = 0.8;
    const sole = this.mat(0xf6f7f8, 0.8);

    const box = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(box);

    // ---- arms (camera space) ----
    for (let i = 0; i < 2; i++) {
      const upper = new THREE.Mesh(box, sleeve);
      const lower = new THREE.Mesh(box, sleeve);
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(box, skin);
      palm.scale.set(0.085, 0.05, 0.11);
      palm.position.set(0, 0, -0.045);
      const thumb = new THREE.Mesh(box, skin);
      thumb.scale.set(0.028, 0.03, 0.06);
      thumb.position.set(i === 0 ? 0.045 : -0.045, 0.01, -0.03);
      const band = new THREE.Mesh(box, cuff);
      band.scale.set(0.095, 0.07, 0.05);
      band.position.set(0, 0.0, 0.02);
      hand.add(palm, thumb, band);
      this.cameraRig.add(upper, lower, hand);
      this.arms.push({ upper, lower, end: hand, joint: new THREE.Vector3(), tip: new THREE.Vector3(), target: new THREE.Vector3(i === 0 ? -0.2 : 0.2, -0.8, 0.2) });
    }

    // ---- legs (body space) ----
    for (let i = 0; i < 2; i++) {
      const upper = new THREE.Mesh(box, pants);
      const lower = new THREE.Mesh(box, pants);
      const foot = new THREE.Group();
      const upperShoe = new THREE.Mesh(box, shoe);
      upperShoe.scale.set(0.11, 0.1, 0.27);
      upperShoe.position.set(0, 0.07, -0.07);
      const soleMesh = new THREE.Mesh(box, sole);
      soleMesh.scale.set(0.115, 0.04, 0.29);
      soleMesh.position.set(0, 0.0, -0.07);
      foot.add(upperShoe, soleMesh);
      this.legRoot.add(upper, lower, foot);
      this.legs.push({ upper, lower, end: foot, joint: new THREE.Vector3(), tip: new THREE.Vector3(), target: new THREE.Vector3(i === 0 ? -0.11 : 0.11, 0, -0.05) });
    }

    this.group.add(this.cameraRig, this.legRoot);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });
  }

  private mat(color: number, roughness: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.disposables.push(m);
    return m;
  }

  /** 0 = in sunlight, 1 = in shadow: dims the view-model sun so arms in shade do not glow. */
  setShade(k: number): void {
    this.shade = k;
  }

  get sunScale(): number {
    return 1 - 0.85 * this.shade;
  }

  /**
   * Update from the controller state. `camera` is the main render camera (the rig is parented to it
   * each frame); `feet` the interpolated feet position; `yaw` the facing.
   */
  update(dt: number, camera: THREE.PerspectiveCamera, feet: THREE.Vector3, yaw: number, player: PlayerController): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const b = player.body;
    const speed = b.horizontalSpeed;
    const speedK = clamp(speed / MOVE.sprintSpeed, 0, 1.25);

    // Gait phase.
    if (player.state === 'ground' || player.state === 'wallrun') this.phase += dt * (4 + speed * 0.95);

    // Camera rig follows the camera exactly.
    this.cameraRig.position.copy(camera.position);
    this.cameraRig.quaternion.copy(camera.quaternion);
    this.legRoot.position.copy(feet);
    this.legRoot.rotation.set(0, yaw, 0);

    // ---------------- arms ----------------
    const sprinting = player.state === 'ground' && speed > 6.2;
    const sm = player.scripted;
    const swing = Math.sin(this.phase);
    const swing2 = Math.sin(this.phase + Math.PI);
    const wantSwing = sprinting ? 1 : 0;
    this.armSwing += (wantSwing - this.armSwing) * damp(7, dt);

    const wallSide = player.state === 'wallrun' && player.wall ? player.wall.side : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1; // -1 left, +1 right
      const t = this.arms[i]!.target;
      const want = this.tmpB;
      const phaseSwing = i === 0 ? swing : swing2;
      if (sm?.kind === 'vault') {
        const u = sm.progress;
        const plant = Math.sin(Math.PI * clamp(u * 1.35, 0, 1));
        want.set(side * 0.22, -0.25 + 0.13 * plant, -0.62 - 0.1 * plant);
      } else if (sm?.kind === 'mantle') {
        const u = sm.progress;
        const grip = clamp(u / 0.58, 0, 1);
        want.set(side * 0.24, 0.12 - 0.42 * grip * grip, -0.55 + 0.1 * grip);
      } else if (wallSide !== 0 && side === wallSide) {
        want.set(side * 0.45, -0.12 + 0.03 * phaseSwing, -0.5);
      } else if (player.state === 'slide') {
        want.set(side * 0.32, -0.23, -0.5);
      } else if (player.state === 'air') {
        want.set(side * 0.44, -0.2 + 0.03 * Math.sin(this.phase * 0.4 + i), -0.6);
      } else if (this.armSwing > 0.05) {
        const a = this.armSwing;
        // Hidden -> sprint pose. Hands pump between z = -0.4 and -0.7 near the bottom corners.
        want.set(
          side * (0.2 + 0.09 * a),
          -0.8 + (0.58 + 0.05 * phaseSwing) * a,
          0.2 - (0.75 + 0.15 * phaseSwing) * a,
        );
      } else {
        want.set(side * 0.2, -0.8, 0.2);
      }
      const rate = sm ? 20 : 11;
      t.x += (want.x - t.x) * damp(rate, dt);
      t.y += (want.y - t.y) * damp(rate, dt);
      t.z += (want.z - t.z) * damp(rate, dt);

      const arm = this.arms[i]!;
      this.pole.set(side * 0.7, -0.5, 0.6).normalize();
      solveTwoBone(this.shoulders[i]!, t, 0.4, 0.38, this.pole, arm.joint, arm.tip);
      placeSegment(arm.upper, this.shoulders[i]!, arm.joint, 0.072);
      placeSegment(arm.lower, arm.joint, arm.tip, 0.064);
      arm.end.position.copy(arm.tip);
      // Point the hand along the forearm direction.
      this.tmpA.copy(arm.tip).sub(arm.joint).normalize();
      arm.end.quaternion.setFromUnitVectors(FORWARD, this.tmpA);
    }

    // ---------------- legs ----------------
    const lift = 0.1 + 0.22 * speedK;
    const stride = 0.16 + 0.28 * speedK;
    const slideBlend = player.state === 'slide' ? 1 : 0;
    const airBlend = player.state === 'air' || player.state === 'scripted' ? 1 : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const leg = this.legs[i]!;
      const hip = this.hips[i]!;
      const t = leg.target;
      const want = this.tmpB;
      const ph = this.phase + (i === 0 ? 0 : Math.PI);
      if (slideBlend) {
        hip.set(side * 0.1, 0.34, 0.28);
        want.set(side * 0.13, 0.16 + 0.015 * Math.sin(this.phase * 0.7 + i), -0.72);
      } else if (airBlend) {
        hip.set(side * 0.1, 0.9, 0.02);
        if (i === 0) want.set(-0.12, 0.42 + 0.02 * Math.sin(this.phase * 0.5), -0.34);
        else want.set(0.12, 0.2, 0.2);
      } else if (speed > 0.9) {
        hip.set(side * 0.1, 0.9 - 0.02 * speedK, 0.02);
        want.set(side * 0.11, Math.max(0, Math.cos(ph)) * lift, -Math.sin(ph) * stride);
      } else {
        hip.set(side * 0.1, 0.92, 0.02);
        want.set(side * 0.13, 0, -0.04);
      }
      const rate = airBlend || slideBlend ? 12 : 22;
      t.x += (want.x - t.x) * damp(rate, dt);
      t.y += (want.y - t.y) * damp(rate, dt);
      t.z += (want.z - t.z) * damp(rate, dt);
      this.pole.set(0, 0.25, -1).normalize();
      solveTwoBone(hip, t, 0.47, 0.47, this.pole, leg.joint, leg.tip);
      placeSegment(leg.upper, hip, leg.joint, 0.15);
      placeSegment(leg.lower, leg.joint, leg.tip, 0.12);
      leg.end.position.copy(leg.tip);
      // Keep the shoe roughly level, tilted a touch by the stride.
      leg.end.rotation.set(slideBlend ? 0.45 : -0.2 * Math.sin(ph), 0, 0);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
