import * as THREE from 'three';

export class FirstPersonCamera {
  camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;

  // effects
  fovBase = 75;
  bobTime = 0;
  landingAnim = 0;
  vaultAnim = 0;
  wallRunTilt = 0;
  targetHeight = 1.7;
  currentHeight = 1.7;
  strafeRoll = 0;

  private motionMultiplier = 1;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fovBase, aspect, 0.05, 800);
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setMotion(mode: 'normal' | 'low') {
    this.motionMultiplier = mode === 'low' ? 0.3 : 1;
  }

  handleMouse(dx: number, dy: number, sensitivity: number) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  getForward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
  }

  getRight(): THREE.Vector3 {
    return new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
  }

  update(dt: number, speed: number, grounded: boolean, sliding: boolean, vaulting: boolean, wallRunSide: number) {
    // Base orientation
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.z = 0;

    // FOV based on speed
    const targetFov = this.fovBase + Math.min(20, speed * 0.7) * this.motionMultiplier;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, dt * 4);
    this.camera.updateProjectionMatrix();

    // Head bob
    if (grounded && speed > 0.5 && !sliding && !vaulting) {
      this.bobTime += dt * speed * 2.5;
    } else {
      this.bobTime += dt * 2;
    }
    const bobAmount = Math.min(0.04, speed * 0.003) * this.motionMultiplier;
    const bobY = Math.sin(this.bobTime * 2) * bobAmount;
    const bobX = Math.cos(this.bobTime) * bobAmount * 0.3;

    // Landing impact
    if (this.landingAnim > 0) {
      this.landingAnim = Math.max(0, this.landingAnim - dt * 5);
    }
    const landY = -Math.sin(this.landingAnim * Math.PI) * 0.12 * this.motionMultiplier;

    // Vault animation
    if (this.vaultAnim > 0) {
      this.vaultAnim = Math.max(0, this.vaultAnim - dt * 3);
    }
    const vaultY = Math.sin(this.vaultAnim * Math.PI) * 0.25 * this.motionMultiplier;

    // Height transition (sliding)
    this.currentHeight = THREE.MathUtils.lerp(this.currentHeight, this.targetHeight, dt * 8);

    // Strafe roll
    this.strafeRoll = THREE.MathUtils.lerp(this.strafeRoll, wallRunSide * 0.12 + this.strafeRoll * 0, dt * 5);

    // Wall run tilt
    const targetTilt = wallRunSide * 0.1 * this.motionMultiplier;
    this.wallRunTilt = THREE.MathUtils.lerp(this.wallRunTilt, targetTilt, dt * 4);

    this.camera.position.y += bobY + landY + vaultY;
    this.camera.position.x += bobX;
    this.camera.rotateZ(this.wallRunTilt + this.strafeRoll * this.motionMultiplier);
  }

  setHeight(height: number) {
    this.targetHeight = height;
  }

  triggerLanding() {
    this.landingAnim = 1;
  }

  triggerVault() {
    this.vaultAnim = 1;
  }
}
