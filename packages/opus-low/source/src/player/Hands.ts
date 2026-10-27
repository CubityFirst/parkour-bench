import * as THREE from 'three';
import type { PlayerController } from './PlayerController';

interface Pose { pos: THREE.Vector3; rot: THREE.Euler; }

/**
 * Simple low-poly arms parented to the camera. They stay hidden while walking
 * and appear when sprinting, vaulting, climbing, sliding or wall running.
 * Drawn on top of the world so they never clip into geometry.
 */
export class Hands {
  private arms: THREE.Group[] = [];
  private current: Pose[] = [];

  constructor(camera: THREE.Camera) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.8, depthTest: false, fog: false });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a688, roughness: 0.7, depthTest: false, fog: false });
    const band = new THREE.MeshStandardMaterial({ color: 0xe3241b, roughness: 0.6, depthTest: false, fog: false });
    const sleeveGeo = new THREE.BoxGeometry(0.085, 0.085, 0.46);
    const bandGeo = new THREE.BoxGeometry(0.09, 0.09, 0.05);
    const handGeo = new THREE.BoxGeometry(0.075, 0.04, 0.11);

    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Group();
      const s = new THREE.Mesh(sleeveGeo, sleeve); s.position.z = -0.23;
      const b = new THREE.Mesh(bandGeo, band); b.position.z = -0.47;
      const h = new THREE.Mesh(handGeo, skin); h.position.z = -0.54;
      for (const mesh of [s, b, h]) { mesh.renderOrder = 1000; mesh.frustumCulled = false; arm.add(mesh); }
      camera.add(arm);
      this.arms.push(arm);
      this.current.push({ pos: new THREE.Vector3(0, -0.8, 0), rot: new THREE.Euler(-1.2, 0, 0) });
    }
  }

  update(dt: number, player: PlayerController, bobPhase: number, bobAmount: number) {
    const k = 1 - Math.exp(-14 * dt);
    const hs = player.horizontalSpeed;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const target = this.poseFor(player, side, hs, bobPhase, bobAmount);
      const c = this.current[i];
      c.pos.lerp(target.pos, k);
      c.rot.set(
        c.rot.x + (target.rot.x - c.rot.x) * k,
        c.rot.y + (target.rot.y - c.rot.y) * k,
        c.rot.z + (target.rot.z - c.rot.z) * k,
      );
      this.arms[i].position.copy(c.pos);
      this.arms[i].rotation.copy(c.rot);
      this.arms[i].visible = c.pos.y > -0.7;
    }
  }

  private poseFor(player: PlayerController, side: number, hs: number, phase: number, bob: number): Pose {
    const pos = new THREE.Vector3(side * 0.24, -0.85, 0);
    const rot = new THREE.Euler(-1.3, 0, 0);
    const pk = player.parkour;
    switch (player.state) {
      case 'traverse': {
        const t = pk.traverseProgress;
        if (pk.travKind === 'vault') {
          // Hands plant on the obstacle and push down.
          pos.set(side * 0.17, -0.22 - t * 0.12, -0.05);
          rot.set(-0.95 - t * 0.3, side * -0.15, 0);
        } else {
          // Reach up for the ledge, then press down to climb over.
          pos.set(side * 0.2, -0.12 - t * 0.2, -0.02);
          rot.set(-0.35 - t * 0.6, side * -0.1, 0);
        }
        break;
      }
      case 'wallrun':
        if (side === pk.wallSide) { pos.set(side * 0.32, -0.15, -0.05); rot.set(-0.2, side * -0.9, side * -0.4); }
        else { pos.set(side * 0.22, -0.3, -0.02); rot.set(-0.45, side * -0.2, 0); }
        break;
      case 'slide':
        if (side === 1) { pos.set(0.3, -0.28, 0); rot.set(-0.6, -0.6, 0); }
        break;
      default:
        if (hs > 8.5 && player.body.grounded) {
          // Sprint: arms pump into the bottom corners of the view.
          const swing = Math.sin(phase + (side > 0 ? Math.PI : 0)) * 0.35 * bob;
          pos.set(side * 0.24, -0.36 + swing * 0.12, -0.02 - swing * 0.1);
          rot.set(-0.45 + swing, side * -0.15, 0);
        } else if (!player.body.grounded && player.body.vel.y > 1) {
          pos.set(side * 0.25, -0.33, 0);
          rot.set(-0.5, side * -0.2, 0);
        }
    }
    return { pos, rot };
  }
}
