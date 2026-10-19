import * as THREE from 'three';
import { createCityMaterials } from './Materials.ts';
import { BASE_Y } from './LevelLayout.ts';
import type { Footprint } from './LevelLayout.ts';

/**
 * Background skyline: a few thousand triangles of instanced boxes with procedural glass /
 * office facades. Buildings are placed on a jittered street grid, kept clear of the playable
 * route, and get taller (and hazier) with distance so the player sees a deep city skyline.
 * Nothing here is collidable or casts shadows; it only has to look right.
 */

interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  top: number;
  style: 'glass' | 'office';
}

/** Hand-placed skyline anchors: tall glass towers on the shadow-safe (west / north) side, lower ones east. */
const HERO_TOWERS: Tower[] = [
  { x: -62, z: 5, w: 30, d: 34, top: 72, style: 'glass' },
  { x: -60, z: -182, w: 30, d: 42, top: 58, style: 'glass' },
  { x: -74, z: -300, w: 34, d: 36, top: 84, style: 'glass' },
  { x: 10, z: -404, w: 44, d: 34, top: 70, style: 'glass' },
  { x: 88, z: -408, w: 50, d: 30, top: 56, style: 'office' },
  { x: 122, z: -296, w: 40, d: 34, top: 32, style: 'glass' },
  { x: 52, z: -112, w: 36, d: 30, top: 27, style: 'office' },
  { x: 38, z: -222, w: 26, d: 30, top: 25, style: 'glass' },
  { x: 72, z: 22, w: 40, d: 40, top: 46, style: 'glass' },
  { x: -120, z: -80, w: 40, d: 40, top: 110, style: 'glass' },
  { x: 140, z: -140, w: 36, d: 40, top: 64, style: 'office' },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rectDistance(a: { x: number; z: number; w: number; d: number }, f: Footprint): number {
  const dx = Math.max(f.minX - (a.x + a.w / 2), a.x - a.w / 2 - f.maxX, 0);
  const dz = Math.max(f.minZ - (a.z + a.d / 2), a.z - a.d / 2 - f.maxZ, 0);
  return Math.hypot(dx, dz);
}

function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Baked vertical shade: darker towards the street.
    const s = 0.5 + 0.5 * pos.getY(i);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export class CityGenerator {
  readonly group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(route: Footprint[]) {
    const rng = mulberry32(20240607);
    const materials = createCityMaterials();
    this.disposables.push(materials.office, materials.glass, materials.concrete);

    const towers: Tower[] = [...HERO_TOWERS];
    const cell = 46;
    for (let gx = -720; gx < 800; gx += cell) {
      for (let gz = -860; gz < 600; gz += cell) {
        if (rng() < 0.1) continue;
        const w = 22 + rng() * 14;
        const d = 22 + rng() * 14;
        const x = gx + (rng() - 0.5) * 6;
        const z = gz + (rng() - 0.5) * 6;
        const rect = { x, z, w, d, top: 0, style: 'glass' as const };

        let nearest = Infinity;
        for (const f of route) nearest = Math.min(nearest, rectDistance(rect, f));
        if (nearest < 14) continue;
        let blocked = false;
        for (const t of HERO_TOWERS) {
          if (Math.abs(t.x - x) < (t.w + w) / 2 + 4 && Math.abs(t.z - z) < (t.d + d) / 2 + 4) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        const r = rng();
        let top: number;
        if (nearest < 28) top = 6 + r * 11;
        else if (nearest < 90) top = 8 + r * 34;
        else if (nearest < 300) top = 14 + r * r * 110;
        else top = 30 + r * r * 240;
        towers.push({ x, z, w, d, top, style: rng() < 0.55 ? 'glass' : 'office' });
      }
    }

    // ---- buildings ----------------------------------------------------------------------
    const box = unitBox();
    this.disposables.push(box);
    const glassTowers = towers.filter((t) => t.style === 'glass');
    const officeTowers = towers.filter((t) => t.style === 'office');
    const m = new THREE.Matrix4();
    const color = new THREE.Color();

    const build = (list: Tower[], material: THREE.Material, tintBase: [number, number, number], tintVar: number): void => {
      const mesh = new THREE.InstancedMesh(box, material, list.length);
      list.forEach((t, i) => {
        m.makeScale(t.w, t.top - BASE_Y, t.d);
        m.setPosition(t.x, BASE_Y, t.z);
        mesh.setMatrixAt(i, m);
        const v = 1 - rng() * tintVar;
        color.setRGB(tintBase[0] * v, tintBase[1] * v, tintBase[2] * (0.94 + 0.06 * v));
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(mesh);
    };
    build(glassTowers, materials.glass, [0.92, 0.97, 1.0], 0.22);
    build(officeTowers, materials.office, [1.0, 0.99, 0.97], 0.12);

    // ---- rooftop clutter (AC units, stairwells, a few red accents) -----------------------
    const clutter: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; red: boolean }> = [];
    for (const t of towers) {
      if (t.top > 130) continue;
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const w = 1.5 + rng() * 3.5;
        const d = 1.5 + rng() * 3.5;
        const h = 0.8 + rng() * 2.2;
        const x = t.x + (rng() - 0.5) * (t.w - w - 3);
        const z = t.z + (rng() - 0.5) * (t.d - d - 3);
        clutter.push({ x, y: t.top, z, w, h, d, red: rng() < 0.06 });
      }
    }
    const clutterMesh = new THREE.InstancedMesh(box, materials.concrete, clutter.length);
    clutter.forEach((c, i) => {
      m.makeScale(c.w, c.h, c.d);
      m.setPosition(c.x, c.y, c.z);
      clutterMesh.setMatrixAt(i, m);
      if (c.red) color.setRGB(0.95, 0.12, 0.14);
      else color.setRGB(0.86, 0.88, 0.9);
      clutterMesh.setColorAt(i, color);
    });
    clutterMesh.instanceMatrix.needsUpdate = true;
    if (clutterMesh.instanceColor) clutterMesh.instanceColor.needsUpdate = true;
    clutterMesh.frustumCulled = false;
    this.group.add(clutterMesh);
    this.disposables.push(clutterMesh);

    // ---- street level -------------------------------------------------------------------
    const groundGeo = new THREE.PlaneGeometry(6000, 6000);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x8f99a3, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = BASE_Y - 0.2;
    this.group.add(ground);
    this.disposables.push(groundGeo, groundMat);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
