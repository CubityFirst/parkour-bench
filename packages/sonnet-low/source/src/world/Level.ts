import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld';
import { Checkpoints } from './Checkpoints';
import { makeConcreteTexture, makeFacadeTexture, scaleBoxUV } from './CityGenerator';

/**
 * The rooftop route. The level runs along -Z; "d" below is the distance
 * travelled from the start (world z = -d). Jump gaps are kept <= 5.5 m
 * (a sprint jump covers ~7 m) and ledge differences <= 1.5 m.
 */
interface Spec { gap: number; len: number; top: number; w: number; x?: number; }
export interface Platform { i: number; d0: number; d1: number; top: number; w: number; x: number; }
export interface Hint { d0: number; d1: number; text: string; }

const SPECS: Spec[] = [
  /* 0  S1 tutorial roof      */ { gap: 0, len: 34, top: 20, w: 14 },
  /* 1                        */ { gap: 3.5, len: 14, top: 20, w: 10 },
  /* 2  S2 rooftop jumps      */ { gap: 4.5, len: 10, top: 21, w: 8 },
  /* 3                        */ { gap: 5, len: 10, top: 19.5, w: 8, x: 2 },
  /* 4                        */ { gap: 5, len: 9, top: 20.5, w: 8, x: -2 },
  /* 5                        */ { gap: 5, len: 10, top: 21.5, w: 8 },
  /* 6  S3 slide roof         */ { gap: 5, len: 36, top: 21, w: 12 },
  /* 7  S4 wall run           */ { gap: 5, len: 12, top: 21, w: 8 },
  /* 8                        */ { gap: 12, len: 14, top: 21, w: 8 },
  /* 9  S5 combination        */ { gap: 5, len: 12, top: 21, w: 8 },
  /* 10                       */ { gap: 5, len: 12, top: 21, w: 8 },
  /* 11                       */ { gap: 11, len: 14, top: 21, w: 8 },
  /* 12 S6 final sprint       */ { gap: 5, len: 10, top: 20, w: 8 },
  /* 13                       */ { gap: 5.5, len: 9, top: 18.5, w: 7, x: 2 },
  /* 14                       */ { gap: 5.5, len: 9, top: 19.5, w: 7, x: -2 },
  /* 15                       */ { gap: 5.5, len: 9, top: 20.5, w: 7 },
  /* 16 finish roof           */ { gap: 5.5, len: 26, top: 20, w: 14 },
];

export class Level {
  group = new THREE.Group();
  world = new CollisionWorld();
  checkpoints = new Checkpoints();
  platforms: Platform[] = [];
  hints: Hint[] = [];
  spawn = new THREE.Vector3();
  killY = 8;
  finish = { minX: -8, maxX: 8, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  private geos: THREE.BufferGeometry[] = [];
  private textures: THREE.Texture[] = [];
  private concrete: THREE.MeshStandardMaterial;
  private glass: THREE.MeshStandardMaterial[];
  private red: THREE.MeshStandardMaterial;
  private white: THREE.MeshStandardMaterial;
  private grey: THREE.MeshStandardMaterial;
  private dark: THREE.MeshStandardMaterial;
  private cpOn: THREE.MeshStandardMaterial;
  readonly facade: THREE.CanvasTexture;

  constructor() {
    const conc = makeConcreteTexture();
    this.facade = makeFacadeTexture();
    this.textures.push(conc, this.facade);
    this.concrete = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.92, color: 0xffffff });
    const glassSide = new THREE.MeshStandardMaterial({ map: this.facade, roughness: 0.22, metalness: 0.15, envMapIntensity: 1.1, color: 0xe6f0fb });
    this.glass = [glassSide];
    this.red = new THREE.MeshStandardMaterial({ color: 0xe0201a, roughness: 0.5, emissive: 0x3a0300 });
    this.white = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.85 });
    this.grey = new THREE.MeshStandardMaterial({ color: 0xa9b0b8, roughness: 0.7 });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6 });
    this.cpOn = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x555555 });
    this.build();
  }

  dispose(): void {
    this.geos.forEach((g) => g.dispose());
    this.textures.forEach((t) => t.dispose());
    [this.concrete, this.red, this.white, this.grey, this.dark, this.cpOn, ...this.glass].forEach((m) => m.dispose());
  }

  // ---------- helpers ----------
  private mesh(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, cell = 0): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (cell) scaleBoxUV(geo, w, h, d, cell);
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  /** Visible box that is also solid. */
  private solid(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, runnable = false): void {
    this.mesh(w, h, d, mat, x, y, z);
    this.world.addCentered(x, y, z, w, h, d, runnable);
  }

  private cyl(r: number, h: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(r, r, h, 10);
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    this.group.add(m);
    return m;
  }

  // ---------- build ----------
  private build(): void {
    let d = 0;
    SPECS.forEach((s, i) => {
      const d0 = d + s.gap;
      const d1 = d0 + s.len;
      this.platforms.push({ i, d0, d1, top: s.top, w: s.w, x: s.x ?? 0 });
      d = d1;
    });
    const P = this.platforms;
    const last = P.length - 1;

    for (const p of P) this.buildPlatform(p, p.i < last);

    // spawn
    this.spawn.set(0, P[0].top + 0.02, -5);
    this.checkpoints.add(this.spawn, 7);

    this.buildStart(P[0]);
    this.buildSection2(P);
    this.buildSlideRoof(P[6]);
    this.buildWallRun(P[7], P[8], +1);
    this.buildCombo(P);
    this.buildFinal(P);

    // checkpoints: end of S1, S2, S3, S4, S5
    this.addCheckpoint(P[1], 6);
    this.addCheckpoint(P[5], 7);
    this.addCheckpoint(P[6], 31);
    this.addCheckpoint(P[8], 7);
    this.addCheckpoint(P[11], 7);

    this.killY = Math.min(...P.map((p) => p.top)) - 11;

    this.hints = [
      { d0: 0, d1: 10, text: 'WASD to move  ·  hold SHIFT to sprint  ·  SPACE to jump' },
      { d0: 10, d1: 17, text: 'Press E to vault the red obstacle (or jump over it)' },
      { d0: 17, d1: 34, text: 'Sprint, then press CTRL or C to slide under the bar' },
      { d0: 34, d1: P[1].d1, text: 'Sprint and jump the gap  —  hold SPACE for a higher jump' },
      { d0: P[1].d1, d1: P[5].d1 + 1, text: 'Jump at the red markers. Keep your speed up between roofs' },
      { d0: P[6].d0, d1: P[6].d0 + 6, text: 'Slide under the red ducts to keep your momentum' },
      { d0: P[6].d0 + 6, d1: P[6].d1, text: 'Sprint  →  slide  →  sprint' },
      { d0: P[7].d0, d1: P[8].d1, text: 'Hug the red wall, jump, then hold W + SHIFT to wall-run. SPACE jumps off' },
      { d0: P[9].d0, d1: P[9].d1, text: 'Press E to vault' },
      { d0: P[10].d0, d1: P[10].d1, text: 'Slide, then jump the gap' },
      { d0: P[11].d0 - 2, d1: P[11].d1, text: 'Wall-run on the left wall' },
      { d0: P[12].d0, d1: P[15].d1, text: 'Final sprint — don\'t stop!' },
      { d0: P[16].d0, d1: P[16].d1, text: 'Cross the red gate' },
    ];
  }

  private buildPlatform(p: Platform, hasNext: boolean): void {
    const cz = -(p.d0 + p.d1) / 2;
    const len = p.d1 - p.d0;
    // roof slab (visual + collision) and the glass tower below it
    this.mesh(p.w, 0.5, len, this.concrete, p.x, p.top - 0.25, cz, 6);
    this.world.addBox(p.x - p.w / 2, p.top - 60, cz - len / 2, p.x + p.w / 2, p.top, cz + len / 2);
    const gm = [this.glass[0], this.glass[0], this.white, this.glass[0], this.glass[0], this.glass[0]];
    const geo = new THREE.BoxGeometry(p.w - 0.8, 60, len - 0.8);
    scaleBoxUV(geo, p.w - 0.8, 60, len - 0.8, 8);
    this.geos.push(geo);
    const tower = new THREE.Mesh(geo, gm);
    tower.position.set(p.x, p.top - 0.5 - 30, cz);
    tower.castShadow = true; tower.receiveShadow = true;
    this.group.add(tower);

    // red drainpipe down one facade
    const sx = p.x + (p.i % 2 ? 1 : -1) * (p.w / 2 - 0.32);
    this.cyl(0.1, 40, this.red, sx, p.top - 20.5, cz + len * 0.25);

    // red take-off marker on the last metre before a gap
    const markIdx = [0, 1, 2, 3, 4, 5, 6, 9, 10, 12, 13, 14, 15];
    if (hasNext && markIdx.includes(p.i)) {
      const mw = Math.min(4, p.w * 0.6);
      this.mesh(mw, 0.03, 0.55, this.red, p.x, p.top + 0.016, -(p.d1 - 0.5));
      this.mesh(mw, 0.03, 0.2, this.red, p.x, p.top + 0.016, -(p.d1 - 1.4));
    }
  }

  private ac(x: number, top: number, z: number): void {
    this.solid(1.6, 1.0, 1.2, this.grey, x, top + 0.5, z);
    this.cyl(0.4, 0.06, this.dark, x, top + 1.03, z);
    this.mesh(1.62, 0.08, 1.22, this.white, x, top + 0.96, z);
  }

  private duct(p: Platform, rel: number, len = 2): void {
    const z = -(p.d0 + rel + len / 2);
    const top = p.top;
    // lintel the player must slide under (underside 1.0 m above the roof, collider is 0.9 m when sliding)
    this.solid(p.w, 1.6, len, this.red, p.x, top + 1.8, z);
    // pillars at both edges
    for (const s of [-1, 1]) this.solid(0.5, 1.0, len, this.white, p.x + s * (p.w / 2 - 0.25), top + 0.5, z);
    // white bands for definition
    this.mesh(p.w + 0.02, 0.12, len + 0.02, this.white, p.x, top + 2.2, z);
  }

  private vaultBox(p: Platform, rel: number): void {
    const z = -(p.d0 + rel);
    this.solid(4, 1.1, 0.9, this.red, p.x, p.top + 0.55, z);
    this.mesh(4.02, 0.06, 0.92, this.white, p.x, p.top + 1.12, z);
  }

  private housing(p: Platform, x: number, rel: number, w: number, d: number, doorOnPositiveX: boolean): void {
    const z = -(p.d0 + rel);
    this.solid(w, 2.8, d, this.white, x, p.top + 1.4, z);
    this.mesh(w + 0.2, 0.2, d + 0.2, this.concrete, x, p.top + 2.85, z, 4);
    const dx = x + (doorOnPositiveX ? 1 : -1) * (w / 2 + 0.02);
    this.mesh(0.06, 2.0, 1.1, this.red, dx, p.top + 1.0, z);
  }

  private buildStart(p: Platform): void {
    // low parapet behind the spawn so the player can't wander off the back
    this.solid(p.w, 1.2, 0.3, this.white, p.x, p.top + 0.6, -(p.d0 + 0.15));
    this.housing(p, -4.8, 4, 3.4, 3, true);
    this.ac(5.2, p.top, -(p.d0 + 6));
    this.ac(-5.6, p.top, -(p.d0 + 19));
    this.vaultBox(p, 12);
    this.duct(p, 22);
    // red crane mast (decorative, base cabinet is solid) echoing the Runner-Vision look
    const cx = -5.2, cz = -(p.d0 + 29);
    this.solid(1.2, 1.5, 0.9, this.red, cx, p.top + 0.75, cz);
    for (const [ox, oz] of [[-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) this.cyl(0.05, 9, this.red, cx + ox, p.top + 4.5, cz + oz);
    for (let y = 1.5; y < 9; y += 1.5) {
      this.mesh(0.8, 0.05, 0.05, this.red, cx, p.top + y, cz - 0.3);
      this.mesh(0.8, 0.05, 0.05, this.red, cx, p.top + y, cz + 0.3);
    }
  }

  private buildSection2(P: Platform[]): void {
    this.ac(-2.8, P[1].top, -(P[1].d0 + 5));
    this.ac(2.8, P[2].top, -(P[2].d0 + 3));
    this.ac(P[3].x + 2.8, P[3].top, -(P[3].d0 + 6));
    this.ac(P[4].x - 2.8, P[4].top, -(P[4].d0 + 3));
    this.housing(P[5], -2.6, 6, 2.0, 2.2, true);
    // small red crates that mark the line
    this.solid(0.8, 0.5, 0.8, this.red, P[2].x, P[2].top + 0.25, -(P[2].d0 + 6.5));
  }

  private buildSlideRoof(p: Platform): void {
    [8, 16, 24].forEach((r) => this.duct(p, r));
    this.ac(-4.8, p.top, -(p.d0 + 12));
    this.ac(4.8, p.top, -(p.d0 + 20));
    this.ac(-4.8, p.top, -(p.d0 + 28));
  }

  /** Long runnable wall beside a gap; side +1 = wall on +x, -1 = on -x. */
  private buildWallRun(a: Platform, b: Platform, side: number): void {
    const d0 = a.d0 + 1, d1 = b.d0 + 3;
    const z = -(d0 + d1) / 2, len = d1 - d0;
    const x0 = a.x + side * a.w / 2;
    const wallTop = a.top + 10;
    const wx = x0 + side * 0.5;
    this.mesh(1, wallTop - (a.top - 60), len, this.white, wx, (wallTop + a.top - 60) / 2, z, 0);
    this.world.addBox(Math.min(x0, x0 + side), a.top - 60, z - len / 2, Math.max(x0, x0 + side), wallTop, z + len / 2, true);
    // red wall-run stripes
    const inner = x0 - side * 0.02;
    this.mesh(0.06, 0.45, len, this.red, inner, a.top + 1.5, z);
    this.mesh(0.06, 0.45, len, this.red, inner, a.top + 3.4, z);
    for (let k = 0; k < len; k += 4) this.mesh(0.06, 2.6, 0.18, this.red, inner, a.top + 2.5, -(d0 + k + 0.5));
    // cap
    this.mesh(1.3, 0.3, len + 0.3, this.concrete, wx, wallTop + 0.15, z, 4);
  }

  private buildCombo(P: Platform[]): void {
    this.vaultBox(P[9], 6);
    this.duct(P[10], 4);
    this.ac(P[9].x - 2.8, P[9].top, -(P[9].d0 + 3));
    this.ac(P[10].x + 2.8, P[10].top, -(P[10].d0 + 9));
    this.buildWallRun(P[10], P[11], -1);
    this.ac(P[11].x + 2.8, P[11].top, -(P[11].d0 + 8));
  }

  private buildFinal(P: Platform[]): void {
    this.ac(P[12].x + 2.8, P[12].top, -(P[12].d0 + 4));
    this.ac(P[13].x - 2.2, P[13].top, -(P[13].d0 + 4));
    this.ac(P[14].x + 2.2, P[14].top, -(P[14].d0 + 4));
    const f = P[16];
    this.solid(f.w, 1.2, 0.3, this.white, f.x, f.top + 0.6, -(f.d1 - 0.15));
    // finish gate
    const gd = f.d0 + 12, gz = -gd;
    for (const s of [-1, 1]) this.solid(0.5, 5, 0.5, this.red, f.x + s * 5, f.top + 2.5, gz);
    this.mesh(10.5, 0.6, 0.5, this.red, f.x, f.top + 5.1, gz);
    this.mesh(10, 0.5, 0.15, this.white, f.x, f.top + 4.6, gz);
    this.mesh(10, 0.04, 1.6, this.red, f.x, f.top + 0.02, gz);
    for (let k = 0; k < 5; k++) this.mesh(10, 0.04, 0.32, k % 2 ? this.white : this.red, f.x, f.top + 0.025, gz - 1.4 - k * 0.4);
    this.finish = { minX: f.x - 7, maxX: f.x + 7, minY: f.top - 1, maxY: f.top + 6, minZ: gz - 1.5, maxZ: gz + 0.5 };
  }

  private addCheckpoint(p: Platform, rel: number): void {
    const pos = new THREE.Vector3(p.x, p.top + 0.02, -(p.d0 + rel));
    const disc = this.cyl(1.3, 0.05, this.red, pos.x, p.top + 0.03, pos.z);
    disc.receiveShadow = true;
    this.checkpoints.add(pos, p.w / 2, disc);
    // flag pole
    this.cyl(0.04, 3, this.red, pos.x + p.w / 2 - 0.5, p.top + 1.5, pos.z);
  }

  /** Turns an activated checkpoint white. */
  activateCheckpointVisual(disc?: THREE.Mesh): void {
    if (disc) disc.material = this.cpOn;
  }

  resetCheckpointVisuals(): void {
    for (const c of this.checkpoints.list) if (c.disc) c.disc.material = this.red;
  }
}
