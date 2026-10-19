import * as THREE from 'three';

export interface CameraInput {
  pos: THREE.Vector3;       // interpolated feet position
  height: number;           // current collider height
  hSpeed: number;
  grounded: boolean;
  strafe: number;           // -1..1
  wallSide: number;         // -1 left, +1 right, 0 none
  sliding: boolean;
  tweenKind: 'mantle' | 'vault' | null;
  tweenProgress: number;
  sprinting: boolean;
}

/** Low-poly arms attached to the camera. Kept low and to the sides so they never block the view. */
class Arms {
  group = new THREE.Group();
  private arms: THREE.Group[] = [];
  private vis = 0;
  private reach = 0;

  constructor() {
    const sleeve = new THREE.MeshLambertMaterial({ color: 0xf1f3f5, depthTest: false });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe0b08c, depthTest: false });
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), sleeve);
      s.position.z = -0.25;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.13), skin);
      h.position.z = -0.56;
      for (const m of [s, h]) { m.renderOrder = 10; m.frustumCulled = false; arm.add(m); }
      arm.position.set(side * 0.3, -0.36, -0.2);
      this.group.add(arm);
      this.arms.push(arm);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  update(dt: number, targetVis: number, targetReach: number, phase: number, motion: number): void {
    const k = Math.min(1, 10 * dt);
    this.vis += (targetVis - this.vis) * k;
    this.reach += (targetReach - this.reach) * k;
    this.group.visible = this.vis > 0.02;
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const swing = Math.sin(phase * 2 + (i === 0 ? 0 : Math.PI)) * motion;
      arm.position.set(
        side * (0.3 - this.reach * 0.1),
        -0.36 - (1 - this.vis) * 0.35 + this.reach * 0.2 + swing * 0.04,
        -0.2 - this.reach * 0.05 + swing * 0.09,
      );
      arm.rotation.set(swing * 0.35 + this.reach * 0.25, side * -0.12, side * -0.05);
    });
  }
}

/** Camera with smooth feel: bob, FOV, roll, landing dip and slide/vault animation. */
export class FirstPersonCamera {
  camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  reduceMotion = false;

  private arms = new Arms();
  private eye = 1.6;
  private bobPhase = 0;
  private roll = 0;
  private fov = 75;
  private landDip = 0;
  private jumpKick = 0;
  private extraPitch = 0;
  private extraRoll = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.08, 2500);
    this.camera.rotation.order = 'YXZ';
    this.camera.add(this.arms.group);
  }

  get bobPhaseValue(): number { return this.bobPhase; }

  kickLand(impact: number): void { this.landDip = Math.max(this.landDip, Math.min(0.22, impact * 0.013)); }
  kickJump(): void { this.jumpKick = 0.05; }

  look(dx: number, dy: number, sens: number): void {
    const s = 0.0022 * sens;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  }

  forward(): THREE.Vector2 { return new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw)); }

  update(dt: number, c: CameraInput): void {
    const m = this.reduceMotion ? 0.25 : 1;
    const eyeTarget = c.height - 0.2;
    this.eye += (eyeTarget - this.eye) * Math.min(1, 14 * dt);

    // head bob only while running on the ground
    let bobY = 0, bobX = 0;
    if (c.grounded && c.hSpeed > 1 && !c.sliding) {
      this.bobPhase += c.hSpeed * dt * 0.62;
      const amp = Math.min(1, c.hSpeed / 10) * m;
      bobY = Math.sin(this.bobPhase * 2) * 0.03 * amp;
      bobX = Math.cos(this.bobPhase) * 0.018 * amp;
    }

    this.landDip -= this.landDip * Math.min(1, 9 * dt);
    this.jumpKick -= this.jumpKick * Math.min(1, 8 * dt);

    // vault / mantle: brief dip + roll
    let tw = 0;
    if (c.tweenKind) tw = Math.sin(Math.PI * c.tweenProgress);
    this.extraPitch += ((c.tweenKind === 'vault' ? -0.1 : c.tweenKind === 'mantle' ? 0.08 : 0) * tw * m - this.extraPitch) * Math.min(1, 12 * dt);
    this.extraRoll += ((c.tweenKind === 'vault' ? 0.05 : 0) * tw * m - this.extraRoll) * Math.min(1, 12 * dt);

    const speedF = Math.min(1, c.hSpeed / 10);
    const rollTarget = -c.strafe * 0.028 * speedF * m - c.wallSide * 0.17 * m + (c.sliding ? 0.03 * m : 0);
    this.roll += (rollTarget - this.roll) * Math.min(1, 7 * dt);

    const fovTarget = 75 + Math.max(0, Math.min(1, (c.hSpeed - 6) / 6)) * 14 * m + (c.sliding ? 4 * m : 0);
    this.fov += (fovTarget - this.fov) * Math.min(1, 5 * dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    this.camera.position.set(
      c.pos.x + rightX * bobX,
      c.pos.y + this.eye + bobY - this.landDip * m + this.jumpKick * 0.5 * m,
      c.pos.z + rightZ * bobX,
    );
    this.camera.rotation.set(
      this.pitch + this.extraPitch + this.landDip * 0.5 * m - this.jumpKick * 0.4 * m,
      this.yaw,
      this.roll + this.extraRoll,
    );

    const armVis = c.tweenKind ? 1 : c.sprinting && c.grounded ? 0.75 : c.sliding ? 0.55 : 0;
    this.arms.update(dt, armVis, c.tweenKind ? 1 : 0, this.bobPhase, c.sprinting ? 1 : 0.4);
  }

  dispose(): void { this.arms.dispose(); }
}
