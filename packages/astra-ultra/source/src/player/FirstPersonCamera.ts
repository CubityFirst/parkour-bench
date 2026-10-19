import { BoxGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';

export interface CameraState {
  position: Vector3;
  yaw: number;
  pitch: number;
  speed: number;
  grounded: boolean;
  crouched: boolean;
  action: string;
  strafe: number;
  wallSide: number;
  reducedMotion: boolean;
}

export class FirstPersonCamera {
  private eyeHeight = 1.65;
  private bobPhase = 0;
  private impact = 0;
  private roll = 0;
  private renderYaw = 0;
  private renderPitch = 0;
  private hands = new Group();
  private leftArm = new Group();
  private rightArm = new Group();
  private handVisibility = 0;
  private sleeveMaterial = new MeshStandardMaterial({ color: 0xe5e9e6, roughness: 0.82 });
  private gloveMaterial = new MeshStandardMaterial({ color: 0xe72e25, roughness: 0.65 });
  private cuffMaterial = new MeshStandardMaterial({ color: 0x25333c, roughness: 0.88 });
  private sleeveGeometry = new CylinderGeometry(0.065, 0.082, 0.36, 7);
  private handGeometry = new BoxGeometry(0.12, 0.15, 0.095);
  private cuffGeometry = new CylinderGeometry(0.068, 0.068, 0.055, 7);

  constructor(private camera: PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
    for (const [arm, side] of [[this.leftArm, -1], [this.rightArm, 1]] as const) {
      const sleeve = new Mesh(this.sleeveGeometry, this.sleeveMaterial);
      const glove = new Mesh(this.handGeometry, this.gloveMaterial);
      const cuff = new Mesh(this.cuffGeometry, this.cuffMaterial);
      sleeve.position.y = -0.18;
      cuff.position.y = 0.01;
      glove.position.y = 0.1;
      glove.rotation.x = -0.12;
      arm.add(sleeve, cuff, glove);
      arm.position.set(side * 0.34, -0.42, -0.55);
      arm.rotation.set(-0.6, side * -0.14, side * -0.28);
      this.hands.add(arm);
    }
    this.hands.visible = false;
    camera.add(this.hands);
  }

  reset(position: Vector3, yaw: number, pitch: number): void {
    this.eyeHeight = 1.65;
    this.impact = 0;
    this.roll = 0;
    this.renderYaw = yaw;
    this.renderPitch = pitch;
    this.bobPhase = 0;
    this.camera.position.copy(position).add(new Vector3(0, this.eyeHeight, 0));
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  land(speed: number): void { this.impact = Math.min(0.16, speed * 0.009); }

  render(dt: number, time: number, state: CameraState): void {
    const ease = 1 - Math.exp(-dt * 16);
    const lookEase = 1 - Math.exp(-dt * 48);
    this.renderYaw += Math.atan2(Math.sin(state.yaw - this.renderYaw), Math.cos(state.yaw - this.renderYaw)) * lookEase;
    this.renderPitch = MathUtils.lerp(this.renderPitch, state.pitch, lookEase);
    this.eyeHeight = MathUtils.lerp(this.eyeHeight, state.crouched ? 0.65 : 1.65, ease);
    this.bobPhase += dt * state.speed * 1.55;
    this.impact *= Math.exp(-dt * 9);
    const motion = state.reducedMotion ? 0 : 1;
    const bobAmplitude = state.grounded && !state.crouched ? Math.min(state.speed / 12, 1) * 0.035 * motion : 0;
    const targetRoll = (state.wallSide * 0.095 - state.strafe * Math.min(state.speed / 12, 1) * 0.018) * motion;
    this.roll = MathUtils.lerp(this.roll, targetRoll, 1 - Math.exp(-dt * 8));
    const sideways = Math.cos(this.bobPhase * 0.5) * bobAmplitude * 0.35;
    this.camera.position.copy(state.position);
    this.camera.position.x += Math.cos(state.yaw) * sideways;
    this.camera.position.z -= Math.sin(state.yaw) * sideways;
    this.camera.position.y += this.eyeHeight + Math.abs(Math.sin(this.bobPhase)) * bobAmplitude - this.impact * motion;
    this.camera.rotation.set(this.renderPitch, this.renderYaw, this.roll, 'YXZ');
    const targetFov = 75 + Math.max(0, Math.min(state.speed - 5, 8)) * (state.reducedMotion ? 0.35 : 1.15);
    const nextFov = MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-dt * 5));
    if (Math.abs(nextFov - this.camera.fov) > 0.003) { this.camera.fov = nextFov; this.camera.updateProjectionMatrix(); }

    const active = ['sprint', 'slide', 'wallrun', 'vault', 'mantle'].includes(state.action);
    this.handVisibility = MathUtils.lerp(this.handVisibility, active ? 1 : 0, ease);
    this.hands.visible = this.handVisibility > 0.01;
    this.hands.position.y = (1 - this.handVisibility) * -0.4;
    for (const [arm, side] of [[this.leftArm, -1], [this.rightArm, 1]] as const) {
      const vault = state.action === 'vault' || state.action === 'mantle';
      const sway = Math.sin(this.bobPhase * 0.5 + (side < 0 ? Math.PI : 0));
      arm.position.set(side * (vault ? 0.31 : 0.36), vault ? -0.24 : -0.43 + sway * 0.055 * motion, vault ? -0.48 : -0.56);
      arm.rotation.x = vault ? -1.22 : -0.58 + sway * 0.16 * motion;
      arm.rotation.y = side * -0.14;
      arm.rotation.z = side * (vault ? -0.32 : -0.2);
      if (state.action === 'wallrun' && side === state.wallSide) {
        arm.position.set(side * 0.48, -0.2, -0.45);
        arm.rotation.set(-0.75, 0, side * -1.05);
      }
      if (state.action === 'slide') {
        arm.position.y = -0.35;
        arm.rotation.x = -0.9 + Math.sin(time * 13) * 0.01 * motion;
      }
    }
  }

  dispose(): void {
    this.camera.remove(this.hands);
    this.sleeveGeometry.dispose(); this.handGeometry.dispose(); this.cuffGeometry.dispose();
    this.sleeveMaterial.dispose(); this.gloveMaterial.dispose(); this.cuffMaterial.dispose();
  }
}
