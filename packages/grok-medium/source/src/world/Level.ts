import * as THREE from 'three';
import { buildCourse, courseSolids, type Course, type CourseBox, type MatId } from './course';
import { buildingMaterials, type MaterialSet } from './Materials';
import type { Solid } from './CollisionWorld';

export interface FlagMesh {
  cloth: THREE.Mesh;
  phase: number;
}

export class Level {
  readonly course: Course;
  readonly solids: Solid[];
  readonly flags: FlagMesh[] = [];
  private readonly root = new THREE.Group();

  constructor(scene: THREE.Scene, mats: MaterialSet) {
    this.course = buildCourse();
    this.solids = courseSolids(this.course);
    scene.add(this.root);

    const windows: THREE.Matrix4[] = [];
    for (const box of this.course.boxes) {
      this.addBox(box, mats);
      if (box.windows && box.solid) this.collectWindows(box, windows);
    }
    if (windows.length) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.InstancedMesh(geo, mats.window, windows.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      for (let i = 0; i < windows.length; i++) mesh.setMatrixAt(i, windows[i]);
      this.root.add(mesh);
    }

    this.addFlags(mats);
    this.addFinishLabel();
    this.addSky();
  }

  update(time: number): void {
    for (const flag of this.flags) {
      flag.cloth.rotation.y = Math.sin(time * 3.1 + flag.phase) * 0.35;
    }
  }

  private addBox(box: CourseBox, mats: MaterialSet): void {
    const geo = new THREE.BoxGeometry(box.w, box.h, box.d);
    const mat = materialFor(box.mat, mats);
    let mesh: THREE.Mesh;
    if ((box.mat === 'concrete' || box.mat === 'glass') && box.solid && !box.rotY) {
      const kind = box.mat === 'glass' ? 'glass' : 'concrete';
      mesh = new THREE.Mesh(geo, buildingMaterials(mats, kind));
    } else {
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.position.set(box.x, box.y, box.z);
    if (box.rotY) mesh.rotation.y = box.rotY;
    const decor = !box.solid || box.mat === 'redGlow' || box.mat === 'orange' || box.mat === 'banner';
    mesh.castShadow = box.solid && !decor;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private collectWindows(box: CourseBox, out: THREE.Matrix4[]): void {
    const top = box.y + box.h / 2;
    const bottom = Math.max(2, box.y - box.h / 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let y = bottom + 2.2; y < top - 1.4; y += 3.15) {
      const bandH = 0.55;
      const inset = 0.04;
      // Four faces, broken into a few panes so the facade reads as windows.
      // span is local X, thickness is local Z. Rotate Y 90° so X-faces stay thin along X.
      const faces: Array<[number, number, number, number, number]> = [
        [box.w / 2 + inset, 0, Math.PI / 2, box.d * 0.7, 0.05],
        [-(box.w / 2 + inset), 0, Math.PI / 2, box.d * 0.7, 0.05],
        [0, box.d / 2 + inset, 0, box.w * 0.7, 0.05],
        [0, -(box.d / 2 + inset), 0, box.w * 0.7, 0.05],
      ];
      for (const [ox, oz, rot, span, depth] of faces) {
        p.set(box.x + ox, y, box.z + oz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        s.set(span, bandH, depth);
        m.compose(p, q, s);
        out.push(m.clone());
      }
    }
  }

  private addFlags(mats: MaterialSet): void {
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.045, 1.7, 6);
    const clothGeo = new THREE.PlaneGeometry(0.72, 0.38);
    for (const f of this.course.flags) {
      const pole = new THREE.Mesh(poleGeo, mats.dark);
      pole.position.set(f.x, f.y + 0.85, f.z);
      pole.castShadow = true;
      const cloth = new THREE.Mesh(clothGeo, f.orange ? mats.flagOrange : mats.flagCloth);
      cloth.position.set(0.36, 0.55, 0);
      pole.add(cloth);
      this.root.add(pole);
      this.flags.push({ cloth, phase: f.phase });
    }
  }

  private addFinishLabel(): void {
    const finish = this.course.triggers.find((t) => t.kind === 'finish');
    if (!finish) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = '#ff2a2a';
    ctx.font = '700 86px Segoe UI, Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', 256, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(finish.x, finish.spawnY + 4.5, finish.z);
    sprite.scale.set(3.4, 0.85, 1);
    this.root.add(sprite);
  }

  private addSky(): void {
    const geo = new THREE.SphereGeometry(700, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
      uniforms: {
        top: { value: new THREE.Color(0x4ea6ee) },
        horizon: { value: new THREE.Color(0xd9f2ff) },
        below: { value: new THREE.Color(0xc3d5e2) },
      },
      vertexShader: `
        out vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        in vec3 vPos;
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 below;
        out vec4 fragColor;
        void main() {
          float h = normalize(vPos).y;
          vec3 col = mix(horizon, top, smoothstep(0.0, 0.62, h));
          col = mix(below, col, smoothstep(-0.25, 0.08, h));
          fragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.root.add(sky);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(520, 24),
      new THREE.MeshStandardMaterial({ color: 0xd5e0e8, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.4;
    ground.receiveShadow = true;
    this.root.add(ground);
  }
}

function materialFor(id: MatId, mats: MaterialSet): THREE.Material {
  switch (id) {
    case 'concrete':
      return mats.concrete;
    case 'roof':
      return mats.roof;
    case 'red':
      return mats.red;
    case 'redGlow':
      return mats.redGlow;
    case 'gray':
      return mats.gray;
    case 'dark':
      return mats.dark;
    case 'metal':
      return mats.metal;
    case 'orange':
      return mats.orange;
    case 'glass':
      return mats.glass;
    case 'banner':
      return mats.banner;
    default:
      return mats.concrete;
  }
}
