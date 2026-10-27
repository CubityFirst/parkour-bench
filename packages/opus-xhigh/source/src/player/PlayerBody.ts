import * as THREE from 'three';
import { damp, type FirstPersonCamera } from './FirstPersonCamera';
import { MOVE } from './MovementConfig';
import type { PlayerController } from './PlayerController';

interface ArmPose {
  pos: THREE.Vector3;
  rot: THREE.Vector3;
}

interface Arm {
  group: THREE.Group;
  sign: -1 | 1;
  pose: ArmPose;
}

const _target: ArmPose = { pos: new THREE.Vector3(), rot: new THREE.Vector3() };
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

const SLEEVE = 0xf4f4f2;
const SKIN = 0xd9a383;
const PANTS = 0x4d535c;
const SHOE = 0xd8231c;

/**
 * Low-poly first-person body:
 *  - arms rendered in a separate view-model pass (never clip into walls,
 *    never cover the crosshair), posed procedurally per movement state;
 *  - legs in the world, visible when looking down and stretched forward
 *    during slides;
 *  - an invisible proxy that only casts the player's shadow (useful for
 *    judging landings).
 */
export class PlayerBody {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 10);
  readonly worldGroup = new THREE.Group();

  private readonly arms: Arm[];
  private readonly sunLight: THREE.DirectionalLight;
  private readonly sunDirection: THREE.Vector3;

  private readonly legsRoot = new THREE.Group();
  private readonly hips: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly shadowProxy = new THREE.Group();
  private bodyYaw = 0;
  private hipHeight = 0.92;
  private legPose = [
    { thigh: 0, knee: 0 },
    { thigh: 0, knee: 0 },
  ];
  private time = 0;

  constructor(sunDirection: THREE.Vector3, environment: THREE.Texture | null) {
    this.sunDirection = sunDirection.clone();
    this.viewScene.environment = environment;
    this.viewScene.environmentIntensity = 0.6;
    this.viewScene.add(new THREE.HemisphereLight(0xdbeeff, 0xc9c2b8, 1.2));
    this.sunLight = new THREE.DirectionalLight(0xfff3e0, 2.4);
    this.viewScene.add(this.sunLight);
    this.viewScene.add(this.sunLight.target);

    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe0211b, roughness: 0.5, emissive: 0x300000 });

    this.arms = ([-1, 1] as const).map((sign) => {
      const group = this.buildArm(sign, sleeve, skin, red);
      this.viewScene.add(group);
      const pose: ArmPose = { pos: new THREE.Vector3(sign * 0.22, -0.7, 0.1), rot: new THREE.Vector3(-1.2, 0, 0) };
      return { group, sign, pose };
    });

    this.buildLegs();
    this.buildShadowProxy();
    this.worldGroup.add(this.legsRoot, this.shadowProxy);
  }

  private buildArm(sign: -1 | 1, sleeve: THREE.Material, skin: THREE.Material, red: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const part = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      g.add(m);
      return m;
    };
    part(0.1, 0.1, 0.32, sleeve, 0, 0, -0.15);
    part(0.088, 0.086, 0.3, sleeve, 0, -0.004, -0.45);
    part(0.096, 0.092, 0.045, red, 0, -0.004, -0.615);
    part(0.094, 0.048, 0.13, skin, 0, -0.006, -0.7);
    part(0.088, 0.036, 0.09, skin, 0, -0.024, -0.795, -0.45);
    part(0.034, 0.032, 0.08, skin, -sign * 0.056, -0.004, -0.68, -0.25);
    return g;
  }

  private buildLegs(): void {
    const pants = new THREE.MeshStandardMaterial({ color: PANTS, roughness: 0.85 });
    const shoe = new THREE.MeshStandardMaterial({ color: SHOE, roughness: 0.55, emissive: 0x200000 });
    const sole = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
    for (const sign of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sign * 0.11, 0.92, 0.12);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.46, 0.17), pants);
      thigh.position.y = -0.23;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.14), pants);
      shin.position.y = -0.21;
      knee.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.27), shoe);
      foot.position.set(0, -0.43, -0.06);
      knee.add(foot);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.025, 0.28), sole);
      s.position.set(0, -0.475, -0.06);
      knee.add(s);
      hip.add(knee);
      hip.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.legsRoot.add(hip);
      this.hips.push(hip);
      this.knees.push(knee);
    }
  }

  private buildShadowProxy(): void {
    // Invisible in colour and depth, but still rendered into the shadow map.
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.shadowProxy.add(m);
    };
    add(0.42, 0.62, 0.24, 0, 1.22, 0.04); // torso
    add(0.22, 0.26, 0.24, 0, 1.66, 0.02); // head
    add(0.1, 0.6, 0.1, -0.28, 1.2, 0.04); // arms
    add(0.1, 0.6, 0.1, 0.28, 1.2, 0.04);
  }

  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  update(dt: number, player: PlayerController, cam: FirstPersonCamera, feet: THREE.Vector3, showArms: boolean): void {
    this.time += dt;
    const state = player.state;
    const speed = player.horizontalSpeed;
    const phase = player.stepPhase;
    const sprintK = THREE.MathUtils.clamp((speed - MOVE.RUN_SPEED + 0.5) / (MOVE.SPRINT_SPEED - MOVE.RUN_SPEED), 0, 1);

    // ---- Arms ---------------------------------------------------------------
    for (const arm of this.arms) {
      const s = arm.sign;
      const target = this.armTarget(arm.sign, state, player, phase, sprintK);
      if (!showArms) {
        target.pos.set(s * 0.22, -0.8, 0.1);
        target.rot.set(-1.3, 0, 0);
      }
      const rate = state === 'vault' || state === 'mantle' ? 22 : 12;
      arm.pose.pos.x = damp(arm.pose.pos.x, target.pos.x, rate, dt);
      arm.pose.pos.y = damp(arm.pose.pos.y, target.pos.y, rate, dt);
      arm.pose.pos.z = damp(arm.pose.pos.z, target.pos.z, rate, dt);
      arm.pose.rot.x = damp(arm.pose.rot.x, target.rot.x, rate, dt);
      arm.pose.rot.y = damp(arm.pose.rot.y, target.rot.y, rate, dt);
      arm.pose.rot.z = damp(arm.pose.rot.z, target.rot.z, rate, dt);
      // Arms share a little of the camera bob so they feel attached to the body.
      arm.group.position.set(arm.pose.pos.x - cam.bobX * 0.5, arm.pose.pos.y + cam.bobY * 0.6, arm.pose.pos.z);
      arm.group.rotation.set(arm.pose.rot.x, arm.pose.rot.y, arm.pose.rot.z, 'YXZ');
      arm.group.visible = arm.pose.pos.y > -0.75;
    }

    // Keep the view-model sun consistent with the world sun.
    _q.copy(cam.camera.quaternion).invert();
    _v.copy(this.sunDirection).applyQuaternion(_q);
    this.sunLight.position.copy(_v).multiplyScalar(5);
    this.sunLight.target.position.set(0, 0, 0);

    // ---- Legs ---------------------------------------------------------------
    const moving = speed > 1.5 && (state === 'slide' || state === 'wallrun' || state === 'air');
    const moveYaw = Math.atan2(-player.vel.x, -player.vel.z);
    const targetYaw = moving ? moveYaw : cam.yaw;
    let dy = targetYaw - this.bodyYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.bodyYaw += dy * (1 - Math.exp(-10 * dt));

    let hip = 0.92;
    const legs = [
      { thigh: 0, knee: 0.05 },
      { thigh: 0, knee: 0.05 },
    ];
    if (state === 'slide') {
      // Lead leg stretched out in front (visible at the bottom of the view), the other tucked.
      hip = 0.42;
      legs[1] = { thigh: 1.52, knee: 0.12 };
      legs[0] = { thigh: 0.95, knee: 1.95 };
    } else if (state === 'crouch') {
      hip = 0.52;
      const sw = Math.sin(phase * Math.PI) * 0.3 * Math.min(1, speed / 2);
      legs[0] = { thigh: 1.0 + sw, knee: 1.9 };
      legs[1] = { thigh: 1.0 - sw, knee: 1.9 };
    } else if (state === 'air' || state === 'vault' || state === 'mantle') {
      const tuck = state === 'air' ? Math.min(1, player.airTime * 4) : 1;
      legs[0] = { thigh: 0.35 + 0.5 * tuck, knee: 0.6 + 0.6 * tuck };
      legs[1] = { thigh: 0.1 + 0.3 * tuck, knee: 0.4 + 0.5 * tuck };
    } else if (speed > 0.5) {
      const amp = 0.25 + 0.45 * Math.min(1, speed / MOVE.SPRINT_SPEED);
      const sw = Math.sin(phase * Math.PI);
      legs[0] = { thigh: sw * amp, knee: 0.15 + Math.max(0, -sw) * 1.1 * amp + 0.3 * amp };
      legs[1] = { thigh: -sw * amp, knee: 0.15 + Math.max(0, sw) * 1.1 * amp + 0.3 * amp };
    }
    this.hipHeight = damp(this.hipHeight, hip, 14, dt);
    for (let i = 0; i < 2; i++) {
      this.legPose[i].thigh = damp(this.legPose[i].thigh, legs[i].thigh, 16, dt);
      this.legPose[i].knee = damp(this.legPose[i].knee, legs[i].knee, 16, dt);
      this.hips[i].position.y = this.hipHeight;
      this.hips[i].rotation.x = this.legPose[i].thigh;
      this.knees[i].rotation.x = -this.legPose[i].knee;
    }
    this.legsRoot.position.copy(feet);
    this.legsRoot.rotation.y = this.bodyYaw;
    // Legs show while sliding, or when looking down mid-air, so they never block the view.
    this.legsRoot.visible = state === 'slide' || ((state === 'air' || state === 'vault') && cam.pitch < -0.45);

    this.shadowProxy.position.copy(feet);
    this.shadowProxy.rotation.y = this.bodyYaw;
    this.shadowProxy.scale.y = player.isCrouched ? 0.5 : 1;
  }

  /** Target arm pose for the current movement state (camera space). Returns a shared object. */
  private armTarget(s: -1 | 1, state: string, player: PlayerController, phase: number, sprintK: number): ArmPose {
    const pos = _target.pos;
    const rot = _target.rot;
    const hidden = () => {
      pos.set(s * 0.22, -0.8, 0.1);
      rot.set(-1.3, 0, 0);
    };

    switch (state) {
      case 'vault': {
        const p = player.traversal?.progress ?? 0;
        if (s === -1) {
          // Left hand plants on the obstacle and pushes.
          pos.set(-0.12, -0.2 - p * 0.08, 0.04 + p * 0.08);
          rot.set(-0.32 - p * 0.3, 0.08, -0.05);
        } else {
          pos.set(0.26, -0.22, 0.08);
          rot.set(0.12, -0.42, 0.45);
        }
        break;
      }
      case 'mantle': {
        const p = player.traversal?.progress ?? 0;
        // Reach for the ledge, then push down past it.
        pos.set(s * 0.18, -0.18 - p * 0.16, 0.06 + p * 0.06);
        rot.set(0.35 - p * 1.15, s * -0.08, s * 0.1);
        break;
      }
      case 'wallrun': {
        const side = player.wall?.side ?? 1;
        if (s === side) {
          // Hand reaching out to brush along the wall.
          pos.set(s * 0.24, -0.16, 0.06);
          rot.set(0.32, -s * 0.5, s * 0.65);
        } else {
          const sw = Math.sin(phase * Math.PI) * s;
          pos.set(s * 0.2, -0.25 + 0.03 * sw, 0.08);
          rot.set(0.08 + 0.12 * sw, -s * 0.14, s * 0.25);
        }
        break;
      }
      case 'slide':
        if (s === -1) {
          pos.set(-0.28, -0.34, 0.1);
          rot.set(-0.95, 0.5, -0.3);
        } else {
          pos.set(0.2, -0.26, 0.06);
          rot.set(0.02, -0.1, 0.25);
        }
        break;
      case 'air': {
        const rise = THREE.MathUtils.clamp(player.vel.y / 8, -1, 1);
        pos.set(s * 0.21, -0.27 + rise * 0.03, 0.1);
        rot.set(0.1 + rise * 0.12, -s * 0.12, s * 0.28);
        break;
      }
      default:
        if (sprintK > 0.05 && state === 'ground' && player.grounded) {
          // Sprint pumping: hands swing up into the bottom corners of the view.
          const sw = Math.sin(phase * Math.PI) * s;
          const k = sprintK;
          pos.set(s * 0.22, -0.42 + (0.1 + 0.05 * sw) * k, 0.08 - 0.05 * sw * k);
          rot.set(-0.75 + (0.62 + 0.38 * sw) * k, -s * 0.12, s * 0.25);
        } else hidden();
    }
    return _target;
  }
}
