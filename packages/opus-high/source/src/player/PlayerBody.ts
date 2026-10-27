import * as THREE from 'three';
import type { CameraMotion } from './FirstPersonCamera';
import type { PlayerController } from './PlayerController';

interface ArmPose {
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

const HIDDEN_Y = -0.95;
/** Narrow, fixed viewmodel FOV keeps the arms a sensible size at any gameplay FOV. */
const VIEWMODEL_FOV = 58;
/** Extra distance in front of the camera applied to every arm pose. */
const ARM_DEPTH = -0.2;

function pose(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): ArmPose {
  return { pos: new THREE.Vector3(x, y, z + ARM_DEPTH), rot: new THREE.Euler(rx, ry, rz) };
}

/**
 * Simple low-poly first-person body.
 *  - Arms live in a separate overlay scene rendered on top of the world (so they
 *    never clip into walls) and only appear while sprinting, vaulting, climbing,
 *    wall running or sliding.
 *  - Legs live in the world and are visible when looking down or sliding.
 */
export class PlayerBody {
  readonly overlayScene = new THREE.Scene();
  readonly overlayCamera: THREE.PerspectiveCamera;
  readonly legs = new THREE.Group();

  private arms: THREE.Group[] = [];
  private armState: ArmPose[] = [];
  private legPivots: THREE.Group[] = [];
  private time = 0;
  motion: CameraMotion = 'full';

  constructor() {
    this.overlayCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, 0.01, 10);
    this.overlayScene.add(new THREE.HemisphereLight(0xe6f2ff, 0x9a9184, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.5, 1, 0.3);
    this.overlayScene.add(key);
    this.overlayScene.add(this.overlayCamera);

    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.8 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6 });
    const band = new THREE.MeshStandardMaterial({ color: 0xe1251b, roughness: 0.5, emissive: 0x500500, emissiveIntensity: 0.4 });

    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.36), sleeve);
      forearm.position.z = 0.14;
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.078, 0.05), band);
      cuff.position.z = -0.06;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.12), glove);
      hand.position.z = -0.15;
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), glove);
      thumb.position.set(-side * 0.05, 0.005, -0.12);
      arm.add(forearm, cuff, hand, thumb);
      arm.position.set(side * 0.3, HIDDEN_Y, -0.4);
      this.overlayCamera.add(arm);
      this.arms.push(arm);
      this.armState.push(pose(side * 0.3, HIDDEN_Y, -0.4));
    }

    // Legs: hip pivots so they can swing; red shoes like the reference.
    const pants = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.85 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xd8231a, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.13, 0.92, 0.05);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.86, 0.17), pants);
      leg.position.y = -0.43;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.3), shoe);
      foot.position.set(0, -0.87, -0.07);
      leg.castShadow = true;
      foot.castShadow = true;
      pivot.add(leg, foot);
      this.legs.add(pivot);
      this.legPivots.push(pivot);
    }
  }

  /** Target arm poses for the current movement state (camera space). */
  private targetPoses(player: PlayerController): [ArmPose, ArmPose] {
    const speed = player.horizontalSpeed;
    const ph = player.bobPhase;
    const s = this.motion === 'full' ? 1 : this.motion === 'reduced' ? 0.6 : 0.3;
    switch (player.state) {
      case 'vault': {
        // Both hands planted forward and down onto the obstacle.
        const t = player.animProgress;
        const push = Math.sin(Math.min(1, t * 1.4) * Math.PI) * 0.08;
        return [
          pose(-0.2, -0.3 - push, -0.4, -0.45, 0.12, 0.1),
          pose(0.2, -0.3 - push, -0.4, -0.45, -0.12, -0.1),
        ];
      }
      case 'mantle': {
        const t = player.animProgress;
        // Reach up onto the ledge, then press down.
        const y = t < 0.5 ? -0.06 - t * 0.3 : -0.21 - (t - 0.5) * 0.25;
        return [pose(-0.24, y, -0.42, -0.55, 0.1, 0.1), pose(0.24, y, -0.42, -0.55, -0.1, -0.1)];
      }
      case 'wallrun': {
        const side = player.wallRun?.side ?? 1;
        // Wall-side hand brushes the wall; the other pumps.
        const pump = Math.sin(ph) * 0.05 * s;
        const wallHand = pose(side * 0.5, -0.08, -0.4, 0.3, -side * 0.9, -side * 1.2);
        const freeHand = pose(-side * 0.24, -0.33 + pump, -0.42, 0.3, 0, side * 0.2);
        return side > 0 ? [freeHand, wallHand] : [wallHand, freeHand];
      }
      case 'slide':
        // One arm out for balance.
        return [pose(-0.4, -0.25, -0.4, 0.1, 0.4, 0.6), pose(0.3, HIDDEN_Y, -0.4)];
      case 'air':
        if (player.velocity.y > 2 && speed > 6) {
          return [pose(-0.26, -0.31, -0.42, 0.2, 0.1, 0.2), pose(0.26, -0.31, -0.42, 0.2, -0.1, -0.2)];
        }
        break;
      case 'ground':
        if (speed > 9.5 && !player.crouched) {
          // Sprint arm pump: hands rise into view alternately.
          const a = Math.sin(ph);
          return [
            pose(-0.25, -0.47 + Math.max(0, a) * 0.17 * s, -0.42 - a * 0.05 * s, 0.35 + a * 0.2 * s, 0.15, 0.2),
            pose(0.25, -0.47 + Math.max(0, -a) * 0.17 * s, -0.42 + a * 0.05 * s, 0.35 - a * 0.2 * s, -0.15, -0.2),
          ];
        }
        break;
    }
    return [pose(-0.3, HIDDEN_Y, -0.4), pose(0.3, HIDDEN_Y, -0.4)];
  }

  update(dt: number, player: PlayerController, mainCamera: THREE.PerspectiveCamera, alpha: number): void {
    this.time += dt;
    // Overlay camera shares the aspect ratio and roll of the main camera.
    if (this.overlayCamera.aspect !== mainCamera.aspect) {
      this.overlayCamera.aspect = mainCamera.aspect;
      this.overlayCamera.updateProjectionMatrix();
    }
    this.overlayCamera.rotation.z = mainCamera.rotation.z;

    const targets = this.targetPoses(player);
    const rate = player.state === 'vault' || player.state === 'mantle' ? 22 : 12;
    for (let i = 0; i < 2; i++) {
      const st = this.armState[i];
      const tg = targets[i];
      st.pos.x = THREE.MathUtils.damp(st.pos.x, tg.pos.x, rate, dt);
      st.pos.y = THREE.MathUtils.damp(st.pos.y, tg.pos.y, rate, dt);
      st.pos.z = THREE.MathUtils.damp(st.pos.z, tg.pos.z, rate, dt);
      st.rot.x = THREE.MathUtils.damp(st.rot.x, tg.rot.x, rate, dt);
      st.rot.y = THREE.MathUtils.damp(st.rot.y, tg.rot.y, rate, dt);
      st.rot.z = THREE.MathUtils.damp(st.rot.z, tg.rot.z, rate, dt);
      const arm = this.arms[i];
      arm.position.copy(st.pos);
      arm.rotation.copy(st.rot);
      arm.visible = st.pos.y > HIDDEN_Y + 0.08;
    }

    // Legs follow the interpolated body position and yaw.
    this.legs.position.lerpVectors(player.prevPosition, player.position, alpha);
    this.legs.rotation.y = player.yaw;
    const speed = player.horizontalSpeed;
    const ph = player.bobPhase;
    const [l, r] = this.legPivots;
    if (player.state === 'slide') {
      l.rotation.x = THREE.MathUtils.damp(l.rotation.x, 1.35, 14, dt);
      r.rotation.x = THREE.MathUtils.damp(r.rotation.x, 0.75, 14, dt);
      l.position.y = r.position.y = THREE.MathUtils.damp(l.position.y, 0.32, 14, dt);
    } else {
      let la = 0;
      let ra = 0;
      if (player.crouched && player.state === 'ground') {
        la = 1.0 + Math.sin(ph) * 0.2;
        ra = 0.85 - Math.sin(ph) * 0.2;
      } else if (player.state === 'ground' && speed > 0.5) {
        const amp = Math.min(1, speed / 11) * 0.75;
        la = Math.sin(ph) * amp;
        ra = -Math.sin(ph) * amp;
      } else if (player.state === 'air' || player.state === 'vault' || player.state === 'mantle') {
        la = 0.6;
        ra = 0.2;
      } else if (player.state === 'wallrun') {
        la = Math.sin(ph) * 0.6;
        ra = -la;
      }
      l.rotation.x = THREE.MathUtils.damp(l.rotation.x, la, 12, dt);
      r.rotation.x = THREE.MathUtils.damp(r.rotation.x, ra, 12, dt);
      const hip = player.crouched ? 0.55 : 0.92;
      l.position.y = r.position.y = THREE.MathUtils.damp(l.position.y, hip, 14, dt);
    }
  }
}
