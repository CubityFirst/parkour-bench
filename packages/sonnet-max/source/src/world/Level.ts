import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld.ts';
import { MeshBucket, makeBar, makeCylinder } from './GeometryBatcher.ts';
import type { FlagSpec, LevelLayout, MatKey, SignSpec } from './LevelBuilder.ts';
import { createLevelLayout } from './LevelLayout.ts';
import { createMaterials } from './Materials.ts';
import type { MaterialLib } from './Materials.ts';

/** Builds the collision world and all render meshes for the course from the pure-data layout. */
export class Level {
  readonly layout: LevelLayout;
  readonly world = new CollisionWorld();
  readonly group = new THREE.Group();
  readonly materials: MaterialLib;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(layout: LevelLayout = createLevelLayout()) {
    this.layout = layout;
    this.materials = createMaterials();
    this.group.name = 'level';
    this.buildCollision();
    this.buildMeshes();
    this.buildAmbientOcclusion();
    this.buildFlags();
    this.buildSigns();
  }

  update(time: number): void {
    this.materials.time.value = time;
  }

  // ------------------------------------------------------------------------------------------
  // Collision
  // ------------------------------------------------------------------------------------------

  private buildCollision(): void {
    for (const b of this.layout.boxes) {
      if (!b.collide) continue;
      this.world.addBox(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], b.flags, b.label);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Static meshes (batched per section / material / shadow flag)
  // ------------------------------------------------------------------------------------------

  private buildMeshes(): void {
    const buckets = new Map<string, { bucket: MeshBucket; mat: MatKey; shadow: boolean }>();
    const get = (chunk: number, mat: MatKey, shadow: boolean) => {
      const key = `${chunk}|${mat}|${shadow ? 1 : 0}`;
      let e = buckets.get(key);
      if (!e) {
        e = { bucket: new MeshBucket(), mat, shadow };
        buckets.set(key, e);
      }
      return e.bucket;
    };

    for (const b of this.layout.boxes) {
      if (!b.visible) continue;
      get(b.chunk, b.mat, b.shadow).addBox(b.min, b.max, b.mat === 'building' ? b.facade : null);
    }
    for (const c of this.layout.cyls) {
      const geo = makeCylinder(c.axis, c.cx, c.cy, c.cz, c.radius, c.radiusTop, c.length, c.segments);
      get(c.chunk, c.mat, c.shadow).addGeometry(geo, null);
      geo.dispose();
    }
    for (const b of this.layout.bars) {
      const geo = makeBar(b.a, b.b, b.thickness);
      get(b.chunk, b.mat, b.shadow).addGeometry(geo, null);
      geo.dispose();
    }

    for (const [key, e] of buckets) {
      if (e.bucket.vertexCount === 0) continue;
      const isBuilding = e.mat === 'building';
      const geometry = e.bucket.build({ facade: isBuilding });
      const material = this.materials.get(e.mat);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `level:${key}`;
      mesh.castShadow = e.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.disposables.push(geometry);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Soft contact shadows under rooftop objects
  // ------------------------------------------------------------------------------------------

  private buildAmbientOcclusion(): void {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let n = 0;
    const margin = 0.75;
    for (const b of this.layout.boxes) {
      if (!b.ao) continue;
      const x0 = b.min[0] - margin;
      const x1 = b.max[0] + margin;
      const z0 = b.min[2] - margin;
      const z1 = b.max[2] + margin;
      const y = b.min[1] + 0.012;
      positions.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    }
    if (n === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.materials.ao);
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    this.disposables.push(g);
  }

  // ------------------------------------------------------------------------------------------
  // Flags
  // ------------------------------------------------------------------------------------------

  private buildFlags(): void {
    const byColor = new Map<string, FlagSpec[]>();
    for (const f of this.layout.flags) {
      const list = byColor.get(f.color) ?? [];
      list.push(f);
      byColor.set(f.color, list);
    }
    for (const [color, list] of byColor) {
      const bucket = new MeshBucket();
      for (const f of list) {
        const len = Math.min(2.4, f.height * 0.46);
        const hgt = len * 0.55;
        const segs = 10;
        const pos: number[] = [];
        const nor: number[] = [];
        const idx: number[] = [];
        const flagAttr: number[] = [];
        const dx = Math.cos(f.angle);
        const dz = Math.sin(f.angle);
        // Plane normal is perpendicular to the flag direction in the XZ plane.
        const nx = -dz;
        const nz = dx;
        for (let i = 0; i <= segs; i++) {
          const u = i / segs;
          for (let j = 0; j < 2; j++) {
            const y = f.y - j * hgt;
            pos.push(f.x + dx * u * len, y, f.z + dz * u * len);
            nor.push(nx, 0, nz);
            flagAttr.push(u, f.x * 0.37 + f.z * 0.21);
          }
        }
        for (let i = 0; i < segs; i++) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setIndex(idx);
        bucket.addGeometry(g, null, new Float32Array(flagAttr));
        g.dispose();
      }
      const geometry = bucket.build({ facade: false, flag: true });
      const mesh = new THREE.Mesh(geometry, color === 'red' ? this.materials.flagRed : this.materials.flagOrange);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(geometry);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Billboards
  // ------------------------------------------------------------------------------------------

  private buildSigns(): void {
    for (const s of this.layout.signs) this.addSign(s);
  }

  private addSign(s: SignSpec): void {
    const tex = makeSignTexture(s.variant);
    this.disposables.push(tex);
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
    this.disposables.push(face);
    const group = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.height), face);
    panel.position.set(0, 2.4 + s.height / 2, 0.11);
    panel.castShadow = false;
    group.add(panel);
    this.disposables.push(panel.geometry);
    const back = new THREE.Mesh(new THREE.BoxGeometry(s.width + 0.3, s.height + 0.3, 0.2), this.materials.get('metal'));
    back.position.set(0, 2.4 + s.height / 2, 0);
    back.castShadow = true;
    back.receiveShadow = true;
    group.add(back);
    this.disposables.push(back.geometry);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), this.materials.get('metal'));
      post.position.set(sx * (s.width * 0.34), 1.3, -0.05);
      post.castShadow = true;
      group.add(post);
      this.disposables.push(post.geometry);
    }
    // Facing: 0 = looks toward -Z, 1 = +X, 2 = +Z, 3 = -X. The panel's front is +Z in local space.
    group.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][s.facing]!;
    group.position.set(s.x, s.y, s.z);
    this.group.add(group);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.materials.dispose();
  }
}

/** Abstract billboard artwork painted on a canvas - no external images. */
function makeSignTexture(variant: number): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const ORANGE = '#ff6a1a';
  const RED = '#e0150f';
  const NAVY = '#16263f';
  if (variant === 0) {
    g.fillStyle = ORANGE;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 9; i++) g.fillRect(60 + i * 38, 70, 20, 372);
    g.fillRect(430, 70, 520, 120);
    g.fillRect(430, 230, 330, 40);
    g.fillRect(430, 300, 430, 40);
    g.fillStyle = NAVY;
    g.fillRect(430, 380, 160, 62);
  } else if (variant === 1) {
    g.fillStyle = NAVY;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(250, 256, 150, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = RED;
    g.fillRect(470, 130, 480, 70);
    g.fillStyle = '#c9d6ea';
    g.fillRect(470, 240, 400, 28);
    g.fillRect(470, 300, 300, 28);
    g.fillRect(470, 360, 440, 28);
  } else if (variant === 2) {
    g.fillStyle = '#f4f6f8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = RED;
    g.beginPath();
    g.moveTo(60, 440);
    g.lineTo(150, 70);
    g.lineTo(230, 70);
    g.lineTo(140, 440);
    g.closePath();
    g.fill();
    g.fillStyle = '#10151c';
    g.font = '900 150px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('ROOFTOP', 290, 190);
    g.fillStyle = RED;
    g.fillText('FLOW', 290, 350);
  } else {
    g.fillStyle = RED;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      const x = 90 + i * 230;
      g.beginPath();
      g.moveTo(x, 96);
      g.lineTo(x + 130, 256);
      g.lineTo(x, 416);
      g.lineTo(x + 60, 416);
      g.lineTo(x + 190, 256);
      g.lineTo(x + 60, 96);
      g.closePath();
      g.fill();
    }
  }
  // thin frame
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 8;
  g.strokeRect(4, 4, w - 8, h - 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
