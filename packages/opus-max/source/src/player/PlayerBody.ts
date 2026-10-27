import * as THREE from 'three';
import { PlayerConfig as C } from './PlayerConfig.ts';
import { MoveMode, type PlayerController } from './PlayerController.ts';
import { SUN_DIRECTION } from '../world/Sky.ts';

/**
 * A hand target in camera space: wrist position, forearm orientation (local +Z runs from the
 * wrist back along the forearm, local -Z is where the fingers point) and a wrist bend.
 */
interface Pose {
  p: THREE.Vector3;
  r: THREE.Quaternion;
  wrist: number;
}

const pose = (x: number, y: number, z: number, rx: number, ry: number, rz: number, wrist = 0): Pose => ({
  p: new THREE.Vector3(x, y, z),
  r: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
  wrist,
});

// Right-arm poses; the left arm mirrors them. Forearms point down/back out of the frame so
// only a sleeve and hand ever enter the bottom edge of the view.
const POSES = {
  hidden: pose(0.36, -0.62, -0.32, 1.0, 0.25, 0),
  runFwd: pose(0.27, -0.2, -0.56, 0.76, 0.73, -0.3, -0.1),
  runBack: pose(0.44, -0.6, -0.32, 0.9, 0.75, -0.3),
  vaultPlant: pose(0.19, -0.25, -0.6, 0.35, 0.2, 0, -0.9),
  vaultPush: pose(0.24, -0.45, -0.42, 0.8, 0.22, 0, -1.1),
  mantleGrab: pose(0.24, -0.07, -0.6, 0.7, 0.18, 0, -1.3),
  mantlePush: pose(0.26, -0.31, -0.5, 1.2, 0.2, 0, -1.4),
  wallTouch: pose(0.43, -0.14, -0.5, 0.85, -0.65, -1.25, 0.35),
  slideFront: pose(0.22, -0.26, -0.6, 0.6, 0.35, -0.2, -0.5),
  slideBack: pose(0.38, -0.6, -0.25, 1.2, 0.2, 0),
  zip: pose(0.1, 0.285, -0.55, -0.6, 0.05, 0.08, 1.0),
  airUp: pose(0.29, -0.16, -0.56, 0.76, 0.7, -0.3, -0.2),
  fall: pose(0.42, -0.17, -0.52, 0.65, -0.45, -0.85, 0.1),
} as const;

/** Fixed view-model lens: keeps the arms in proportion whatever the gameplay FOV is. */
const VIEWMODEL_FOV = 52;

const tmpPose: Pose = { p: new THREE.Vector3(), r: new THREE.Quaternion(), wrist: 0 };

function mirror(src: Pose, out: Pose): Pose {
  out.p.set(-src.p.x, src.p.y, src.p.z);
  // Mirroring across the YZ plane: negate the y and z components of the quaternion.
  out.r.set(src.r.x, -src.r.y, -src.r.z, src.r.w);
  out.wrist = src.wrist;
  return out;
}

function copyPose(src: Pose, out: Pose): Pose {
  out.p.copy(src.p);
  out.r.copy(src.r);
  out.wrist = src.wrist;
  return out;
}

const newPose = (): Pose => ({ p: new THREE.Vector3(), r: new THREE.Quaternion(), wrist: 0 });

function blendPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.p.copy(a.p).lerp(b.p, t);
  out.r.copy(a.r).slerp(b.r, t);
  out.wrist = a.wrist + (b.wrist - a.wrist) * t;
  return out;
}

class Arm {
  readonly group = new THREE.Group();
  private readonly hand = new THREE.Group();
  private readonly side: number;

  constructor(side: number, mats: { sleeve: THREE.Material; skin: THREE.Material; cuff: THREE.Material }) {
    this.side = side;
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      parent.add(m);
    };
    const alongZ = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
    // Forearm (sleeve) and upper arm run along local +Z from the wrist.
    add(this.group, alongZ(new THREE.CylinderGeometry(0.037, 0.037, 0.05, 14)), mats.cuff, 0, 0, 0.032);
    add(this.group, alongZ(new THREE.CylinderGeometry(0.035, 0.046, 0.44, 14)), mats.sleeve, 0, 0, 0.275);
    // Hand on a wrist joint: palm, curled fingers, thumb.
    this.group.add(this.hand);
    add(this.hand, new THREE.BoxGeometry(0.072, 0.03, 0.084), mats.skin, 0, 0, -0.042);
    add(this.hand, new THREE.BoxGeometry(0.068, 0.026, 0.066), mats.skin, 0, -0.009, -0.11, -0.55);
    add(this.hand, new THREE.BoxGeometry(0.024, 0.024, 0.056), mats.skin, -side * 0.042, -0.005, -0.046, 0.1, side * 0.55);
  }

  apply(target: Pose, rate: number, dt: number): void {
    const k = 1 - Math.exp(-rate * dt);
    this.group.position.lerp(target.p, k);
    this.group.quaternion.slerp(target.r, k);
    this.hand.rotation.x += (target.wrist - this.hand.rotation.x) * k;
  }

  snap(target: Pose): void {
    this.group.position.copy(target.p);
    this.group.quaternion.copy(target.r);
    this.hand.rotation.x = target.wrist;
  }

  get isLeft(): boolean {
    return this.side < 0;
  }
}

class Leg {
  readonly hip = new THREE.Group();
  readonly knee = new THREE.Group();

  constructor(x: number, mats: { pants: THREE.Material; shoe: THREE.Material; sole: THREE.Material }) {
    this.hip.position.x = x;
    // Only the lower part of the thigh is modelled (open-ended): from above, looking down,
    // you see knees and shoes rather than the inside of a cylinder.
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.062, 0.3, 10, 1, true), mats.pants);
    thigh.position.y = -0.31;
    this.hip.add(thigh);
    this.knee.position.y = -0.46;
    this.hip.add(this.knee);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.048, 0.44, 10), mats.pants);
    shin.position.y = -0.22;
    this.knee.add(shin);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.27), mats.shoe);
    shoe.position.set(0, -0.47, -0.06);
    this.knee.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.03, 0.28), mats.sole);
    sole.position.set(0, -0.525, -0.06);
    this.knee.add(sole);
  }

  set(hipAngle: number, kneeAngle: number, rate: number, dt: number): void {
    const k = 1 - Math.exp(-rate * dt);
    this.hip.rotation.x += (hipAngle - this.hip.rotation.x) * k;
    this.knee.rotation.x += (kneeAngle - this.knee.rotation.x) * k;
  }
}

/**
 * Stylised first-person body: arms that appear during moves and legs visible when looking
 * down. Rendered as an overlay pass (separate scene, cleared depth) so limbs never clip
 * into walls; an invisible capsule in the main scene gives the runner a real shadow.
 */
export class PlayerBody {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Add to the main scene: casts the player's shadow. */
  readonly shadowCaster: THREE.Mesh;
  private readonly rig = new THREE.Group();
  /** Legs live in the main scene (real perspective, lighting and depth); add this group to it. */
  readonly legsRoot = new THREE.Group();
  private readonly legRoot = new THREE.Group();
  private readonly right: Arm;
  private readonly left: Arm;
  private readonly legs: [Leg, Leg];
  private readonly zipHandle: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly poseR = newPose();
  private readonly poseL = newPose();
  private readonly poseA = newPose();
  private readonly poseB = newPose();
  private cycle = 0;
  private lastPhase = 0;
  private parity = 0;
  private time = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.camera.rotation.order = 'YXZ';

    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe2b49a, roughness: 0.72 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0xe2231a, roughness: 0.5 });
    const pants = new THREE.MeshStandardMaterial({ color: 0xe4e7ea, roughness: 0.85 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xd8211a, roughness: 0.55 });
    const sole = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.8 });
    this.disposables.push(sleeve, skin, cuff, pants, shoe, sole);

    this.right = new Arm(1, { sleeve, skin, cuff });
    this.left = new Arm(-1, { sleeve, skin, cuff });
    this.rig.add(this.right.group, this.left.group);

    const handleMat = new THREE.MeshStandardMaterial({ color: 0xe2231a, roughness: 0.4, metalness: 0.3 });
    this.zipHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.4, 10).rotateZ(Math.PI / 2), handleMat);
    this.zipHandle.position.set(0, 0.296, -0.6);
    this.zipHandle.visible = false;
    this.rig.add(this.zipHandle);
    this.disposables.push(handleMat);

    this.legs = [new Leg(-0.11, { pants, shoe, sole }), new Leg(0.11, { pants, shoe, sole })];
    this.legRoot.add(this.legs[0].hip, this.legs[1].hip);
    this.legsRoot.add(this.legRoot);
    this.legRoot.position.y = 0.92;

    this.scene.add(this.rig);
    // Lighting that matches the world: sun from the same direction plus sky fill.
    this.scene.add(new THREE.HemisphereLight(0xcfe4ff, 0xb8b2a8, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.copy(SUN_DIRECTION);
    this.scene.add(sun);

    this.right.snap(POSES.hidden);
    this.left.snap(mirror(POSES.hidden, tmpPose));

    const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.shadowCaster = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 1.15, 4, 10), casterMat);
    this.shadowCaster.castShadow = true;
    this.shadowCaster.receiveShadow = false;
    this.disposables.push(casterMat, this.shadowCaster.geometry);

    this.legsRoot.traverse((o) => {
      if (o instanceof THREE.Mesh) o.receiveShadow = true;
    });
    for (const root of [this.scene, this.legsRoot]) {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) this.disposables.push(o.geometry);
      });
    }
  }

  reset(): void {
    this.right.snap(POSES.hidden);
    this.left.snap(mirror(POSES.hidden, tmpPose));
  }

  update(dt: number, player: PlayerController, mainCamera: THREE.PerspectiveCamera, renderPos: THREE.Vector3, yaw: number): void {
    this.time += dt;
    // Overlay camera shares the main camera's lens and orientation, at the origin.
    this.camera.fov = VIEWMODEL_FOV;
    this.camera.aspect = mainCamera.aspect;
    this.camera.updateProjectionMatrix();
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.rig.quaternion.copy(mainCamera.quaternion);
    this.legsRoot.position.copy(renderPos);
    this.legsRoot.rotation.set(0, yaw, 0);

    const mode = player.mode;
    const speed = player.horizontalSpeed;
    const phase = player.stridePhase;
    if (phase < this.lastPhase) this.parity ^= 1;
    this.lastPhase = phase;
    // Full gait cycle spans two footsteps.
    this.cycle = (phase + this.parity) / 2;
    const swing = Math.sin(this.cycle * Math.PI * 2);

    // ---------------------------------------------------------------- arms
    const r = this.poseR;
    const l = this.poseL;
    let rate = 14;
    switch (mode) {
      case MoveMode.Vault: {
        blendPose(POSES.vaultPlant, POSES.vaultPush, THREE.MathUtils.smoothstep(player.actionProgress, 0.3, 0.9), r);
        mirror(r, l);
        rate = 22;
        break;
      }
      case MoveMode.Mantle: {
        blendPose(POSES.mantleGrab, POSES.mantlePush, THREE.MathUtils.smoothstep(player.actionProgress, 0.15, 0.75), r);
        mirror(r, l);
        rate = 24;
        break;
      }
      case MoveMode.WallRun: {
        // The arm on the wall side reaches out to the wall; the other one keeps pumping.
        const touch = copyPose(POSES.wallTouch, this.poseA);
        touch.p.y += Math.sin(this.time * 9) * 0.02;
        const pump = blendPose(POSES.runBack, POSES.runFwd, 0.5 + 0.5 * swing, this.poseB);
        if (player.wallSide > 0) {
          copyPose(touch, r);
          mirror(pump, l);
        } else {
          mirror(touch, l);
          copyPose(pump, r);
        }
        rate = 12;
        break;
      }
      case MoveMode.Slide:
        copyPose(POSES.slideBack, r);
        mirror(POSES.slideFront, l);
        rate = 12;
        break;
      case MoveMode.Zipline:
        copyPose(POSES.zip, r);
        mirror(r, l);
        rate = 16;
        break;
      case MoveMode.Air: {
        const target = player.velocity.y > 0 ? POSES.airUp : player.velocity.y < -6 ? POSES.fall : POSES.runFwd;
        copyPose(target, r);
        mirror(r, l);
        rate = 7;
        break;
      }
      default: {
        // Pump the arms when running fast; tuck them away at low speed.
        const sprint = THREE.MathUtils.smoothstep(speed, C.RUN_SPEED * 0.85, C.SPRINT_SPEED);
        if (sprint > 0.01 && player.sinceLanding > 0.12) {
          blendPose(POSES.runBack, POSES.runFwd, 0.5 + 0.5 * swing, this.poseA);
          blendPose(POSES.hidden, this.poseA, sprint, r);
          blendPose(POSES.runBack, POSES.runFwd, 0.5 - 0.5 * swing, this.poseA);
          blendPose(POSES.hidden, this.poseA, sprint, this.poseB);
          mirror(this.poseB, l);
        } else {
          copyPose(POSES.hidden, r);
          mirror(r, l);
        }
        rate = 12;
      }
    }
    this.right.apply(r, rate, dt);
    this.left.apply(l, rate, dt);
    this.zipHandle.visible = mode === MoveMode.Zipline;

    // ---------------------------------------------------------------- legs
    const sliding = mode === MoveMode.Slide;
    const crouched = player.crouched && !sliding;
    // Hip height above the feet, and how far behind the eye the hips sit.
    const hipY = sliding ? 0.4 : crouched ? 0.55 : 0.92;
    const hipZ = sliding ? 0.3 : 0.12;
    this.legRoot.position.y += (hipY - this.legRoot.position.y) * (1 - Math.exp(-14 * dt));
    this.legRoot.position.z += (hipZ - this.legRoot.position.z) * (1 - Math.exp(-14 * dt));
    // Positive hip angle swings a leg forward (-Z); negative knee angle bends the shin back.
    const [legL, legR] = this.legs;
    if (sliding) {
      legR.set(1.35, -0.1, 14, dt);
      legL.set(0.95, -1.5, 14, dt);
    } else if (mode === MoveMode.Air || mode === MoveMode.Vault || mode === MoveMode.Mantle) {
      legR.set(0.55, -0.9, 10, dt);
      legL.set(0.25, -0.7, 10, dt);
    } else if (mode === MoveMode.Zipline) {
      legR.set(0.35 + Math.sin(this.time * 2) * 0.08, -0.35, 6, dt);
      legL.set(0.2 + Math.sin(this.time * 2 + 1) * 0.08, -0.45, 6, dt);
    } else if (crouched) {
      legR.set(1.1, -1.9, 12, dt);
      legL.set(1.0, -1.8, 12, dt);
    } else {
      const amt = Math.min(1, speed / C.SPRINT_SPEED);
      const a = 0.75 * amt;
      const c = Math.cos(this.cycle * Math.PI * 2);
      legR.set(swing * a, -(0.25 + 0.75 * Math.max(0, -c)) * amt * 1.4, 18, dt);
      legL.set(-swing * a, -(0.25 + 0.75 * Math.max(0, c)) * amt * 1.4, 18, dt);
    }

    // ---------------------------------------------------------------- shadow
    const h = player.body.height;
    this.shadowCaster.position.set(renderPos.x, renderPos.y + h / 2, renderPos.z);
    this.shadowCaster.scale.set(1, h / C.STAND_HEIGHT, 1);
  }

  dispose(): void {
    for (const d of new Set(this.disposables)) d.dispose();
  }
}
