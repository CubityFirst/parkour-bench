import * as THREE from 'three';
import { CollisionWorld, type Collider } from './CollisionWorld';

export interface Roof { start: number; end: number; y: number; width: number; x?: number }
export interface Checkpoint { progress: number; y: number; name: string; hint: string; action: string }
export const CHECKPOINTS: Checkpoint[] = [
  { progress: 5, y: 32, name: 'First steps', hint: 'Find your pace. Follow the red.', action: 'W A S D  Move     SHIFT  Sprint' },
  { progress: 70, y: 33, name: 'Open air', hint: 'Commit to the gap. Keep your momentum.', action: 'SHIFT + SPACE  Running jump' },
  { progress: 192, y: 34, name: 'Stay low', hint: 'Slide beneath the red ventilation ducts.', action: 'SHIFT → C  Slide     SPACE  Jump out' },
  { progress: 286, y: 34, name: 'Against the wall', hint: 'Sprint, jump, and stay close to the red wall.', action: 'W + SHIFT + SPACE  Enter wall run' },
  { progress: 374, y: 34, name: 'Find your flow', hint: 'Vault. Slide. Run the wall. Make it one motion.', action: 'E  Vault     C  Slide     SPACE  Jump' },
  { progress: 502, y: 34, name: 'The home stretch', hint: 'The city is yours. Take it to the finish.', action: 'SHIFT  Sprint     SPACE  Jump the gaps' },
];
export const ROOFS: Roof[] = [
  { start: -16, end: 60, y: 32, width: 24 },
  { start: 65, end: 99, y: 33, width: 20 },
  { start: 105, end: 139, y: 34, width: 18 },
  { start: 146, end: 181, y: 33, width: 22 },
  { start: 187, end: 273, y: 34, width: 20 },
  { start: 279, end: 308, y: 34, width: 16 },
  { start: 329, end: 361, y: 34, width: 18 },
  { start: 368, end: 409, y: 34, width: 19 },
  { start: 414, end: 442, y: 34, width: 16 },
  { start: 463, end: 491, y: 34, width: 18 },
  { start: 497, end: 535, y: 34, width: 18 },
  { start: 542, end: 569, y: 35, width: 16 },
  { start: 576, end: 608, y: 34, width: 20 },
  { start: 615, end: 665, y: 34, width: 24 },
];

const BOX = new THREE.BoxGeometry(1, 1, 1);
const MAT = {
  white: new THREE.MeshStandardMaterial({ color: '#f0f3ef', roughness: 0.78 }),
  edge: new THREE.MeshStandardMaterial({ color: '#d2e0e4', roughness: 0.65 }),
  red: new THREE.MeshStandardMaterial({ color: '#ef392d', roughness: 0.48 }),
  redDark: new THREE.MeshStandardMaterial({ color: '#a82320', roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: '#49788d', metalness: 0.34, roughness: 0.28 }),
  dark: new THREE.MeshStandardMaterial({ color: '#263f49', roughness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: '#9eb4bf', metalness: 0.5, roughness: 0.55 }),
  black: new THREE.MeshStandardMaterial({ color: '#172b33', roughness: 0.85 }),
  paleGlass: new THREE.MeshStandardMaterial({ color: '#78a5b6', metalness: 0.3, roughness: 0.3 }),
  orange: new THREE.MeshStandardMaterial({ color: '#f0a149', roughness: 0.6 }),
};
type MaterialKey = keyof typeof MAT;

export class Level {
  readonly world = new CollisionWorld();
  private batches = new Map<MaterialKey, THREE.Matrix4[]>();
  readonly flags: THREE.Mesh[] = [];
  readonly checkpointRings: THREE.Group[] = [];
  private dummy = new THREE.Object3D();
  readonly finish = 650;
  constructor(readonly scene: THREE.Scene) {
    this.createMaterials();
    this.createRoute();
    this.createCity();
    this.flush();
  }
  private createMaterials() {
    // Tiny procedural concrete grain; no downloaded textures or models.
    const concrete = document.createElement('canvas'); concrete.width = 128; concrete.height = 128;
    const ctx = concrete.getContext('2d')!;
    const pixels = ctx.createImageData(128, 128);
    let seed = 41;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const value = 237 + (seed % 19);
      pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(concrete);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(24, 24);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    MAT.white.map = texture;
    // Reflection bands and varied panes give the office facades depth at little cost.
    const glass = document.createElement('canvas'); glass.width = 256; glass.height = 512;
    const gc = glass.getContext('2d')!;
    const gradient = gc.createLinearGradient(0, 0, 160, 512);
    gradient.addColorStop(0, '#eefaff'); gradient.addColorStop(0.38, '#9ab8c4');
    gradient.addColorStop(0.52, '#d0e2e9'); gradient.addColorStop(1, '#7496a6');
    gc.fillStyle = gradient; gc.fillRect(0, 0, 256, 512);
    for (let y = 0; y < 512; y += 32) for (let x = 0; x < 256; x += 32) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      gc.fillStyle = `rgba(20,50,65,${(seed % 15) / 100})`;
      gc.fillRect(x + 1, y + 1, 30, 30);
      gc.fillStyle = '#ffffff17'; gc.fillRect(x + 1, y + 1, 1, 30);
    }
    const glassTexture = new THREE.CanvasTexture(glass); glassTexture.colorSpace = THREE.SRGBColorSpace;
    glassTexture.anisotropy = 4; MAT.glass.map = glassTexture; MAT.paleGlass.map = glassTexture;
  }
  private box(key: MaterialKey, x: number, y: number, z: number, w: number, h: number, d: number, solid: boolean | Collider['kind'] = false, rotation = 0) {
    this.dummy.position.set(x, y, z); this.dummy.scale.set(w, h, d); this.dummy.rotation.set(0, rotation, 0); this.dummy.updateMatrix();
    if (!this.batches.has(key)) this.batches.set(key, []);
    this.batches.get(key)!.push(this.dummy.matrix.clone());
    if (solid) this.world.add(x, y, z, w, h, d, solid === true ? 'solid' : solid);
  }
  private flush() {
    for (const [name, matrices] of this.batches) {
      const mesh = new THREE.InstancedMesh(BOX, MAT[name], matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = name !== 'glass' && name !== 'paleGlass'; mesh.receiveShadow = true;
      mesh.computeBoundingSphere(); this.scene.add(mesh);
    }
  }
  private building(x: number, z: number, w: number, d: number, h: number, variant = 0, decorate = true) {
    this.box(variant % 3 === 0 ? 'paleGlass' : 'glass', x, h / 2 - 12, z, w, h, d);
    this.box('white', x, h - 11.7, z, w + 0.4, 0.65, d + 0.4);
    const spacing = variant % 4 === 0 ? 5 : 3.6;
    for (let y = 0; y < h; y += spacing) {
      this.box(variant % 4 === 0 ? 'edge' : 'white', x, y - 12, z, w + 0.13, variant % 4 === 0 ? 0.22 : 0.65, d + 0.13);
    }
    for (let i = -w / 2; i <= w / 2; i += variant % 2 ? 3 : 5) {
      this.box('edge', x + i, h / 2 - 12, z - d / 2 - 0.04, 0.14, h, 0.12);
      this.box('edge', x + i, h / 2 - 12, z + d / 2 + 0.04, 0.14, h, 0.12);
    }
    for (let i = -d / 2; i <= d / 2; i += 4) {
      this.box('edge', x - w / 2 - 0.04, h / 2 - 12, z + i, 0.12, h, 0.14);
      this.box('edge', x + w / 2 + 0.04, h / 2 - 12, z + i, 0.12, h, 0.14);
    }
    if (decorate && variant % 3 === 0) this.box('white', x, h - 10, z, w * 0.4, 3, d * 0.3);
  }
  private text(text: string, x: number, y: number, z: number, w: number, h: number, background = '#ec382e', color = '#ffffff', rotationY = 0, floor = false) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = color; ctx.font = 'bold 112px Arial, sans-serif'; ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    lines.forEach((line, i) => ctx.fillText(line, 65, 256 + (i - (lines.length - 1) / 2) * 132));
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z); mesh.rotation.y = rotationY;
    if (floor) mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh); return mesh;
  }
  private roof(r: Roof, index: number) {
    const x = r.x || 0, z = -(r.start + r.end) / 2, d = r.end - r.start;
    this.building(x, z, r.width, d, r.y + 11.35, index, false);
    this.box('white', x, r.y - 0.35, z, r.width, 0.7, d, true);
    // Side parapets leave every takeoff and landing unobstructed.
    for (const side of [-1, 1]) {
      this.box('edge', x + side * (r.width / 2 - 0.15), r.y + 0.24, z, 0.3, 0.48, d, true);
      this.box('white', x + side * (r.width / 2 - 0.15), r.y + 0.51, z, 0.46, 0.12, d);
    }
    // Expansion joints and maintenance stripes add scale to the roof.
    for (let s = r.start + 4; s < r.end; s += 8) this.box('edge', x, r.y + 0.006, -s, r.width - 0.8, 0.008, 0.025);
    for (const side of [-1, 1]) this.box('edge', x + side * 4.2, r.y + 0.007, z, 0.025, 0.009, d - 1);
    this.box('red', x, r.y + 0.018, -(r.end - 1.25), 4.6, 0.035, 2.2);
    this.arrow(x, r.y + 0.045, -(r.end - 2.7));
    if (index > 0) this.box('red', x, r.y + 0.015, -(r.start + 1.2), 4.6, 0.025, 0.4);
    this.text(String(index + 1).padStart(2, '0'), x - r.width / 2 + 2.5, r.y + 0.015, -(r.start + 5), 3.6, 1.8, '#e8eeed', '#9dafb6', 0, true);
    this.vent(x + r.width / 2 - 3.4, r.y, -(r.start + d * 0.45), index % 2 === 0);
    if (d > 45) this.vent(x - r.width / 2 + 3.3, r.y, -(r.start + d * 0.7), true);
    this.flag(x - r.width / 2 + 1, r.y, -(r.end - 4));
  }
  private arrow(x: number, y: number, z: number) {
    this.box('red', x - 0.32, y, z, 0.16, 0.018, 1.05, false, -Math.PI / 4);
    this.box('red', x + 0.32, y, z, 0.16, 0.018, 1.05, false, Math.PI / 4);
  }
  private vent(x: number, y: number, z: number, double: boolean) {
    const width = double ? 3.1 : 1.7;
    this.box('edge', x, y + 0.12, z, width + 0.24, 0.24, 2.6, true);
    this.box('white', x, y + 0.8, z, width, 1.35, 2.3, true);
    this.box('metal', x, y + 1.5, z, width + 0.12, 0.12, 2.42);
    for (let i = 0; i < 7; i++) this.box('dark', x, y + 0.35 + i * 0.15, z + 1.16, width - 0.2, 0.055, 0.018);
    for (const offset of double ? [-0.8, 0.8] : [0]) {
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.06, 16), MAT.dark);
      fan.position.set(x + offset, y + 1.59, z); this.scene.add(fan);
      this.box('metal', x + offset, y + 1.63, z, 0.12, 0.025, 0.94);
      this.box('metal', x + offset, y + 1.63, z, 0.94, 0.025, 0.12);
    }
  }
  private flag(x: number, y: number, z: number) {
    this.box('metal', x, y + 2.6, z, 0.065, 5.2, 0.065);
    const geometry = new THREE.PlaneGeometry(1.5, 0.8, 8, 2);
    geometry.translate(0.75, 0, 0);
    const flag = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#f14a34', side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(x, y + 4.7, z); this.scene.add(flag); this.flags.push(flag);
  }
  private vault(s: number, y: number, width = 7) {
    this.box('red', 0, y + 0.55, -s, width, 1.1, 0.85, 'vault');
    this.box('redDark', 0, y + 0.12, -s, width + 0.16, 0.24, 1.0);
    this.text('↑  VAULT', 0, y + 0.58, -s + 0.435, Math.min(width - 0.3, 3), 0.7);
    for (const x of [-width / 2 + 0.2, width / 2 - 0.2]) this.box('white', x, y + 0.56, -s + 0.44, 0.1, 0.85, 0.025);
  }
  private slide(s: number, y: number, width = 9) {
    this.box('red', 0, y + 1.7, -s, width, 1.22, 2.7, true);
    this.box('redDark', 0, y + 2.34, -s, width + 0.1, 0.1, 2.82);
    for (const x of [-width / 2 + 0.18, width / 2 - 0.18]) this.box('metal', x, y + 0.55, -s, 0.32, 1.1, 2.8, true);
    this.text('↓  STAY LOW', 0, y + 1.74, -s + 1.36, 4.3, 0.85);
    this.box('dark', 0, y + 0.016, -s, width - 0.8, 0.025, 5.5);
    for (let a = -width / 2 + 0.6; a < width / 2 - 0.4; a += 0.35) this.box('metal', a, y + 0.035, -s, 0.035, 0.015, 5.4);
  }
  private wall(start: number, end: number, y: number, side: number) {
    const z = -(start + end) / 2;
    this.box('red', side * 2.05, y + 2.0, z, 0.7, 5.6, end - start, 'wallrun');
    this.box('redDark', side * 2.05, y + 4.85, z, 0.82, 0.12, end - start + 0.1);
    // Long white bands explicitly communicate the direction of traversal.
    this.box('white', side * 1.69, y + 2.2, z, 0.03, 0.16, end - start - 1.2);
    this.box('white', side * 1.69, y + 2.6, z, 0.03, 0.06, end - start - 1.2);
    this.text('RUN THE WALL  →', side * 1.685, y + 3.6, z, 12, 1.1, '#ec382e', '#ffffff', side > 0 ? -Math.PI / 2 : Math.PI / 2);
    for (let s = start + 1; s < end; s += 4) this.box('redDark', side * 2.05, y - 1.7, -s, 0.45, 3, 0.45);
  }
  private createRoute() {
    ROOFS.forEach((r, i) => this.roof(r, i));
    this.text('UPSHIFT / 07\nROOFTOP ACCESS', -8.8, 35, 5, 5.5, 2.75, '#e6edea', '#233a42');
    this.box('edge', -8.8, 35, 4.85, 5.8, 3.1, 0.22, true);
    this.box('metal', -8.8, 33, 4.85, 0.14, 2, 0.14);
    this.text('START HERE  ↑', 0, 32.026, -9, 4.2, 2.1, '#e7edeb', '#3e555d', 0, true);
    this.vault(25, 32); this.slide(44, 32);
    this.text('01 / FIRST STEPS', -5.7, 32.024, -17, 4, 2, '#e7edeb', '#83999e', 0, true);
    // A narrow maintenance bridge connects the middle two jump rooftops.
    this.box('red', 0, 33.82, -142.5, 1.8, 0.36, 8, true);
    for (const x of [-0.88, 0.88]) this.box('redDark', x, 33.6, -142.5, 0.12, 0.55, 8);
    for (let s = 139; s < 146; s += 0.4) this.box('metal', 0, 34.014, -s, 1.65, 0.025, 0.035);
    this.slide(209, 34, 18); this.slide(233, 34, 18); this.slide(257, 34, 18);
    this.wall(305, 333, 34, 1);
    this.vault(391, 34, 12); this.slide(426, 34, 14);
    this.wall(439, 467, 34, -1);
    this.vault(480, 34, 13);
    // A final slim bridge offers a breath between jumps.
    this.box('red', 0, 34.025, -521, 2.3, 0.045, 16);
    for (let s = 510; s < 530; s += 4) this.arrow(0, 34.06, -s);
    // Red radio mast: a recognizable starting-roof landmark.
    for (const x of [7.5, 8.7]) {
      for (const z of [-48.8, -50]) this.box('redDark', x, 38, z, 0.16, 12, 0.16);
      for (let y = 33; y < 44; y += 1.8) this.box('red', x, y, -49.4, 0.18, 0.13, 1.5);
    }
    for (let y = 33; y < 44; y += 1.8) this.box('red', 8.1, y, -49.4, 1.5, 0.13, 1.5);
    this.box('red', 8.1, 34.5, -48.6, 1.5, 2, 0.35);
    this.box('redDark', 8.1, 32.2, -49.4, 2.4, 0.4, 2.4, true);
    CHECKPOINTS.forEach((cp, i) => {
      const s = cp.progress + 2;
      this.box('red', -5, cp.y + 1, -s, 0.12, 2, 0.12);
      this.text(`${String(i + 1).padStart(2, '0')} / ${cp.name.toUpperCase()}`, -5, cp.y + 2.1, -s, 4.8, 1.05, '#f0f3ed', '#2c4650');
      if (i > 0) {
        this.box('red', 0, cp.y + 0.025, -cp.progress, 6.5, 0.04, 0.16);
        const g = new THREE.Group();
        const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.24), new THREE.MeshBasicMaterial({ color: '#f14332' }));
        g.add(diamond); g.position.set(0, cp.y + 3.3, -cp.progress); this.scene.add(g); this.checkpointRings.push(g);
      }
    });
    // Finish gantry and white-striped landing apron.
    for (const x of [-4.2, 4.2]) this.box('red', x, 37.2, -650, 0.55, 6.4, 0.65, true);
    this.box('red', 0, 40.15, -650, 9, 0.65, 0.65);
    this.text('FINISH / UPSHIFT', 0, 40.15, -649.65, 8.4, 0.55);
    this.box('red', 0, 34.026, -650, 8.2, 0.045, 5);
    for (let x = -4; x < 4; x += 0.5) for (let z = -651; z <= -649; z += 0.5) {
      if ((Math.round(x * 2) + Math.round(z * 2)) % 2 === 0) this.box('white', x + 0.25, 34.055, z + 0.25, 0.5, 0.016, 0.5);
    }
  }
  private createCity() {
    let seed = 7149;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    // Ordered city blocks keep the skyline architectural, with an open course corridor.
    for (let z = 95; z > -800; z -= 49) {
      for (let x = -360; x <= 360; x += 48) {
        if (Math.abs(x) < 28) continue;
        const bx = x + (random() - 0.5) * 7;
        const bz = z + (random() - 0.5) * 7;
        const w = 22 + random() * 14, d = 23 + random() * 16;
        const far = Math.abs(x) > 110;
        let height = far ? 47 + random() * 105 : 28 + random() * 22;
        if (random() < 0.09 && far) height += 50;
        const variant = Math.floor(random() * 10);
        this.building(bx, bz, w, d, height, variant);
        if (variant % 4 === 0) {
          this.box('metal', bx + w * 0.2, height - 6, bz, 0.2, 12, 0.2);
          this.box('white', bx + w * 0.2, height - 1, bz, 1.8, 0.5, 0.4);
        }
        if (variant === 3) this.box('orange', bx, height - 16, bz + d / 2 + 0.1, w, 2.8, 0.15);
      }
    }
    // A few carefully placed hero buildings and rooftop billboards.
    this.building(48, -70, 28, 35, 60, 4);
    this.text('TAKE THE\nHIGH ROAD.', 48, 54, -51.9, 22, 11, '#e95035', '#f7f1e4');
    this.box('dark', 48, 53.8, -52.2, 22.4, 11.4, 0.4);
    this.building(-58, -120, 28, 34, 84, 2);
    this.text('ASTER\nDISTRICT 07', -58, 69, -102.9, 22, 8, '#eef2e9', '#294d5c');
    this.building(118, -155, 23, 30, 172, 0);
    this.box('white', 118, 170, -155, 2, 24, 2);
    this.box('paleGlass', 121, 144, -155, 16, 35, 23);
    // Streets are far below the route, glimpsed through rooftop gaps.
    this.box('dark', 0, -12.7, -320, 900, 0.5, 1100);
    for (let z = 80; z > -800; z -= 49) {
      this.box('metal', 0, -12.4, z + 24, 850, 0.02, 0.28);
      for (let x = -340; x < 340; x += 15) this.box('white', x, -12.35, z + 21, 4, 0.02, 0.16);
    }
  }
  animate(time: number) {
    for (const flag of this.flags) {
      const pos = flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(x * 4 - time * 4 + flag.position.z) * 0.13 * x);
      }
      pos.needsUpdate = true;
    }
    this.checkpointRings.forEach((ring, i) => {
      ring.rotation.y = time; ring.position.y = CHECKPOINTS[i + 1].y + 3.3 + Math.sin(time * 2 + i) * 0.15;
    });
  }
}
