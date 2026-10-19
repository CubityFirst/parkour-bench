/**
 * Level - turns the pure-data LevelSpec into Three.js meshes (batched into a handful of
 * draw calls) and exposes the matching CollisionWorld.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCollisionWorld } from './buildWorld';
import { type CollisionWorld } from './CollisionWorld';
import { CheckpointMarker } from './Checkpoints';
import { type LevelSpec, type Mat, type PartSpec } from './LevelSpec';
import { type MaterialSet } from './Materials';

interface Bucket {
  mat: Mat;
  cast: boolean;
  geoms: THREE.BufferGeometry[];
}

const tmpColor = new THREE.Color();

export class Level {
  readonly group = new THREE.Group();
  readonly world: CollisionWorld;
  readonly markers: CheckpointMarker[] = [];

  private readonly disposables: { dispose(): void }[] = [];
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);

  constructor(readonly spec: LevelSpec, private readonly materials: MaterialSet) {
    this.world = createCollisionWorld(spec);
    this.group.name = 'level';
    this.buildStatic();
    this.buildFlags();
    this.buildFinishSign();
    for (const cp of spec.checkpoints) {
      const marker = new CheckpointMarker(cp);
      this.markers.push(marker);
      this.group.add(marker.group);
      this.disposables.push(marker);
    }
  }

  // ------------------------------------------------------------------ static geometry

  private buildStatic(): void {
    const buckets = new Map<string, Bucket>();
    const bucketFor = (mat: Mat, cast: boolean): Bucket => {
      const key = `${mat}:${cast ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) {
        b = { mat, cast, geoms: [] };
        buckets.set(key, b);
      }
      return b;
    };

    for (const part of this.spec.parts) {
      if (!part.visible) continue;
      bucketFor(part.mat, part.castShadow).geoms.push(this.boxGeometry(part));
    }
    for (const c of this.spec.cylinders) {
      const g = new THREE.CylinderGeometry(c.radius, c.radius, c.length, 16, 1);
      if (c.axis === 'x') g.rotateZ(Math.PI / 2);
      else if (c.axis === 'z') g.rotateX(Math.PI / 2);
      g.translate(c.pos[0], c.pos[1], c.pos[2]);
      this.paint(g, c.color, 1);
      bucketFor(c.mat, true).geoms.push(g);
    }
    // Flag poles
    for (const f of this.spec.flags) {
      const g = new THREE.CylinderGeometry(0.035, 0.045, 3.4, 8, 1);
      g.translate(f[0], f[1] + 1.7, f[2]);
      this.paint(g, 0xd5d9de, 1);
      bucketFor('prop', true).geoms.push(g);
    }

    for (const bucket of buckets.values()) {
      const merged = mergeGeometries(bucket.geoms, false);
      for (const g of bucket.geoms) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.materialFor(bucket.mat));
      mesh.castShadow = bucket.cast;
      mesh.receiveShadow = true;
      mesh.name = `level-${bucket.mat}${bucket.cast ? '' : '-nocast'}`;
      this.group.add(mesh);
      this.disposables.push(merged);
    }
  }

  private materialFor(mat: Mat): THREE.Material {
    switch (mat) {
      case 'arch': return this.materials.arch;
      case 'glass': return this.materials.glassV;
      case 'red': return this.materials.red;
      default: return this.materials.prop;
    }
  }

  /** Box geometry in world space with baked vertex colours (tint + cheap contact AO). */
  private boxGeometry(part: PartSpec): THREE.BufferGeometry {
    const g = this.unitBox.clone();
    const sx = part.max[0] - part.min[0];
    const sy = part.max[1] - part.min[1];
    const sz = part.max[2] - part.min[2];
    g.scale(sx, sy, sz);
    g.translate(
      (part.min[0] + part.max[0]) / 2,
      (part.min[1] + part.max[1]) / 2,
      (part.min[2] + part.max[2]) / 2,
    );
    // Contact darkening towards the bottom of props (not for big buildings or decals).
    let ao = 1;
    if (part.mat !== 'arch' && part.mat !== 'glass' && sy > 0.2) {
      ao = sy > 3 ? 0.93 : 0.8;
    }
    this.paint(g, part.color, ao, (part.min[1] + part.max[1]) / 2);
    return g;
  }

  /** Writes a colour attribute. Vertices below `splitY` are multiplied by `bottom`. */
  private paint(g: THREE.BufferGeometry, hex: number, bottom: number, splitY = Infinity): void {
    tmpColor.set(hex);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // Only vertical faces get the gradient.
      const isSide = Math.abs(nrm.getY(i)) < 0.5;
      const k = isSide && pos.getY(i) < splitY ? bottom : 1;
      arr[i * 3] = tmpColor.r * k;
      arr[i * 3 + 1] = tmpColor.g * k;
      arr[i * 3 + 2] = tmpColor.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  // ------------------------------------------------------------------ flags

  private buildFlags(): void {
    const flags = this.spec.flags;
    if (flags.length === 0) return;
    const geo = new THREE.PlaneGeometry(1.15, 0.7, 10, 1);
    geo.translate(0.575, 0, 0);
    const mesh = new THREE.InstancedMesh(geo, this.materials.flag, flags.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    flags.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i % 2 === 0 ? 0.2 : Math.PI + 0.2) + i * 0.7);
      p.set(f[0], f[1] + 3.0, f[2]);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.disposables.push(geo, { dispose: () => mesh.dispose() });
  }

  // ------------------------------------------------------------------ finish sign

  private buildFinishSign(): void {
    const f = this.spec.finish;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#e0231c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 108px "Segoe UI", system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F I N I S H', canvas.width / 2, canvas.height / 2 + 6);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.5, emissive: new THREE.Color(0xff2418), emissiveIntensity: 0.22, emissiveMap: tex,
    });
    const width = 9;
    const geo = new THREE.PlaneGeometry(width, width * (160 / 1024));
    const mesh = new THREE.Mesh(geo, mat);
    const hx = f.heading[0];
    const hz = f.heading[1];
    // A banner hanging just below the lintel on the side the player approaches from.
    mesh.position.set(f.pos[0] - hx * 0.47, f.pos[1] + 4.45, f.pos[2] - hz * 0.47);
    mesh.rotation.y = Math.atan2(-hx, -hz);
    this.group.add(mesh);
    this.disposables.push(geo, mat, tex);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.unitBox.dispose();
    this.group.clear();
  }
}
