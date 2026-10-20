import * as THREE from 'three';
import { Rng } from '../utils/Rng.ts';
import { MeshBucket } from './GeometryBatcher.ts';
import type { LevelLayout, Rect, V3 } from './LevelBuilder.ts';
import type { MaterialLib } from './Materials.ts';

const PITCH = 62; // lot pitch (building + street)
const STREET = 16;
const TILE = 640; // instanced meshes are split into tiles so frustum culling works

interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y0: number;
  style: number;
  tint: V3;
  accent: number;
  seed: number;
}

function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/**
 * Procedural background city: instanced skyline boxes carrying the same facade shader as the route
 * buildings, rooftop clutter, a few red cranes and a street-grid ground plane. Everything lives outside the
 * playable footprints and is never collidable.
 */
export class CityGenerator {
  readonly group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(layout: LevelLayout, materials: MaterialLib, seed = 7) {
    this.group.name = 'city';
    const rng = new Rng(seed);
    const buildings = this.layoutBuildings(layout, rng);
    this.buildInstances(buildings, layout, materials);
    this.buildClutter(buildings, layout, materials, rng);
    this.buildCranes(buildings, layout, materials, rng);
    this.buildGround();
  }

  // ------------------------------------------------------------------------------------------

  private layoutBuildings(layout: LevelLayout, rng: Rng): Building[] {
    const feet = layout.footprints;
    // Course bounding box / centre for the skyline height ramp.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const f of feet) {
      minX = Math.min(minX, f.x0);
      maxX = Math.max(maxX, f.x1);
      minZ = Math.min(minZ, f.z0);
      maxZ = Math.max(maxZ, f.z1);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    const out: Building[] = [];
    const X0 = -1900;
    const X1 = 2300;
    const Z0 = -1900;
    const Z1 = 1500;

    /** Distance to the nearest route structure and that structure's roof height. */
    const nearestRoute = (x: number, z: number): { d: number; top: number } => {
      let nearest = Infinity;
      let refTop = 55;
      for (const f of feet) {
        const dist = rectDistance(f, x, z);
        if (dist < nearest) {
          nearest = dist;
          refTop = f.top ?? 55;
        }
      }
      return { d: nearest, top: refTop };
    };
    /** True if a w x d building centred on (x, z) stays at least `gap` metres clear of every route structure. */
    const clearOfRoute = (x: number, z: number, w: number, d: number, gap: number): boolean => {
      for (const f of feet) {
        if (x - w / 2 < f.x1 + gap && x + w / 2 > f.x0 - gap && z - d / 2 < f.z1 + gap && z + d / 2 > f.z0 - gap) return false;
      }
      return true;
    };

    const addBuilding = (x: number, z: number, w: number, d: number, nearest: number, refTop: number): void => {
      const distCentre = Math.hypot(x - cx, z - cz);
      // Distant lots thin out into the haze to keep the instance count sane.
      if (distCentre > 1500 && rng.chance(0.45)) return;
      if (distCentre > 2300) return;
      let h: number;
      if (nearest < 40) {
        h = refTop - rng.range(9, 44);
      } else if (nearest < 140) {
        h = refTop + rng.range(-50, 14);
      } else {
        const ramp = Math.min(1, Math.max(0, (distCentre - 250) / 700));
        const base = 26 + Math.pow(rng.next(), 1.6) * (62 + ramp * 190);
        h = Math.min(base, refTop + 14 + ramp * 210);
      }
      h = Math.max(12, h);
      // Occasional landmark towers on the skyline.
      if (distCentre > 500 && rng.chance(0.06)) h = rng.range(160, 330);

      const glassy = h > 90 ? rng.chance(0.42) : rng.chance(0.16);
      const concrete = !glassy && rng.chance(0.14);
      const style = glassy ? 1 : concrete ? 3 : rng.pick([0, 0, 2, 2]);
      const tint: V3 = glassy
        ? rng.pick<V3>([[0.76, 0.88, 1], [0.82, 0.92, 1], [0.7, 0.84, 0.98]])
        : concrete
          ? rng.pick<V3>([[0.7, 0.73, 0.77], [0.78, 0.8, 0.82], [0.66, 0.7, 0.75]])
          : rng.pick<V3>([[1, 1, 1], [0.98, 0.99, 1], [0.94, 0.96, 0.99], [1, 0.985, 0.955], [0.9, 0.93, 0.97]]);
      out.push({
        x,
        z,
        w,
        d,
        h,
        y0: 0,
        style,
        tint,
        accent: !glassy && rng.chance(0.2) ? rng.pick([1, 2, 2, 3]) : 0,
        seed: rng.next(),
      });
      // Setback crown on tall towers for silhouette variety.
      if (h > 110 && rng.chance(0.5)) {
        out.push({
          x: x + (rng.next() - 0.5) * w * 0.15,
          z: z + (rng.next() - 0.5) * d * 0.15,
          w: w * rng.range(0.5, 0.72),
          d: d * rng.range(0.5, 0.72),
          h: h * rng.range(0.18, 0.34),
          y0: h,
          style: glassy ? 1 : 0,
          tint,
          accent: 0,
          seed: rng.next(),
        });
      }
    };

    // Lot grid. Lots that touch the course are subdivided so the infill hugs the route buildings.
    for (let gx = X0; gx < X1; gx += PITCH) {
      for (let gz = Z0; gz < Z1; gz += PITCH) {
        const lotW = PITCH - STREET;
        const lx = gx + STREET / 2;
        const lz = gz + STREET / 2;
        const w = lotW * rng.range(0.6, 1.0);
        const d = lotW * rng.range(0.6, 1.0);
        const x = lx + lotW / 2 + (lotW - w) * (rng.next() - 0.5);
        const z = lz + lotW / 2 + (lotW - d) * (rng.next() - 0.5);
        if (clearOfRoute(x, z, w, d, 7)) {
          const r = nearestRoute(x, z);
          addBuilding(x, z, w, d, r.d, r.top);
          continue;
        }
        // Too close to the course: try quarter lots, then smaller blocks, always staying >= 5 m clear.
        for (let qx = 0; qx < 2; qx++) {
          for (let qz = 0; qz < 2; qz++) {
            const qw = lotW / 2 - 2;
            const qd = lotW / 2 - 2;
            const qcx = lx + lotW * (0.25 + 0.5 * qx);
            const qcz = lz + lotW * (0.25 + 0.5 * qz);
            if (clearOfRoute(qcx, qcz, qw, qd, 5)) {
              const r = nearestRoute(qcx, qcz);
              addBuilding(qcx, qcz, qw, qd, r.d, r.top);
            } else {
              for (let sx = 0; sx < 2; sx++) {
                for (let sz = 0; sz < 2; sz++) {
                  const sw = qw / 2 - 1.5;
                  const scx = qcx + (sx - 0.5) * (qw / 2);
                  const scz = qcz + (sz - 0.5) * (qd / 2);
                  if (clearOfRoute(scx, scz, sw, sw, 4.5) && rng.chance(0.85)) {
                    const r = nearestRoute(scx, scz);
                    addBuilding(scx, scz, sw, sw, r.d, r.top);
                  }
                }
              }
            }
          }
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------

  private buildInstances(buildings: Building[], layout: LevelLayout, materials: MaterialLib): void {
    // Bounding region of the course for deciding which tiles cast / receive shadows.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const f of layout.footprints) {
      minX = Math.min(minX, f.x0);
      maxX = Math.max(maxX, f.x1);
      minZ = Math.min(minZ, f.z0);
      maxZ = Math.max(maxZ, f.z1);
    }
    const tiles = new Map<string, Building[]>();
    for (const b of buildings) {
      const key = `${Math.floor(b.x / TILE)}|${Math.floor(b.z / TILE)}`;
      const list = tiles.get(key);
      if (list) list.push(b);
      else tiles.set(key, [b]);
    }

    const unit = new THREE.BoxGeometry(1, 1, 1);
    unit.translate(0, 0.5, 0);
    this.disposables.push(unit);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    for (const [key, list] of tiles) {
      const geometry = unit.clone();
      const facade = new Float32Array(list.length * 4);
      const mesh = new THREE.InstancedMesh(geometry, materials.buildingInstanced, list.length);
      list.forEach((b, i) => {
        m.compose(new THREE.Vector3(b.x, b.y0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
        mesh.setMatrixAt(i, m);
        color.setRGB(b.tint[0], b.tint[1], b.tint[2], THREE.LinearSRGBColorSpace);
        mesh.setColorAt(i, color);
        facade[i * 4] = b.style;
        facade[i * 4 + 1] = b.y0 + b.h;
        facade[i * 4 + 2] = b.seed;
        facade[i * 4 + 3] = b.accent;
      });
      geometry.setAttribute('aFacade', new THREE.InstancedBufferAttribute(facade, 4));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      // Only tiles near the course need real shadows.
      const [tx, tz] = key.split('|').map(Number) as [number, number];
      const tcx = (tx + 0.5) * TILE;
      const tcz = (tz + 0.5) * TILE;
      const near =
        tcx > minX - TILE * 0.9 && tcx < maxX + TILE * 0.9 && tcz > minZ - TILE * 0.9 && tcz < maxZ + TILE * 0.9;
      mesh.castShadow = near;
      mesh.receiveShadow = near;
      mesh.name = `city:${key}`;
      this.group.add(mesh);
      this.disposables.push(geometry);
      this.disposables.push(mesh);
    }
  }

  // ------------------------------------------------------------------------------------------

  private buildClutter(buildings: Building[], layout: LevelLayout, materials: MaterialLib, rng: Rng): void {
    // Merge rooftop boxes (AC units, penthouses) near the course into one static mesh.
    const bucket = new MeshBucket();
    const centre = { x: 0, z: 0, n: 0 };
    for (const f of layout.footprints) {
      centre.x += (f.x0 + f.x1) / 2;
      centre.z += (f.z0 + f.z1) / 2;
      centre.n++;
    }
    centre.x /= centre.n;
    centre.z /= centre.n;
    for (const b of buildings) {
      if (b.y0 > 0) continue;
      let nearest = Infinity;
      for (const f of layout.footprints) nearest = Math.min(nearest, rectDistance(f, b.x, b.z));
      if (nearest > 420 || b.w < 14 || b.d < 14) continue;
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) {
        const w = rng.range(1.6, 4.2);
        const d = rng.range(1.4, 3.4);
        const h = rng.range(1.0, 2.8);
        const x = b.x + (rng.next() - 0.5) * (b.w - w - 3);
        const z = b.z + (rng.next() - 0.5) * (b.d - d - 3);
        bucket.addBox([x - w / 2, b.h, z - d / 2], [x + w / 2, b.h + h, z + d / 2], null);
      }
    }
    if (bucket.vertexCount === 0) return;
    const geometry = bucket.build({ facade: false });
    const mesh = new THREE.Mesh(geometry, materials.get('white'));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'city-clutter';
    this.group.add(mesh);
    this.disposables.push(geometry);
  }

  // ------------------------------------------------------------------------------------------

  private buildCranes(buildings: Building[], layout: LevelLayout, materials: MaterialLib, rng: Rng): void {
    // A handful of red tower cranes on mid-distance roofs: lifts the red accent into the skyline.
    const candidates = buildings
      .filter((b) => b.y0 === 0 && b.h > 60 && b.h < 150 && b.w > 24)
      .map((b) => {
        let nearest = Infinity;
        for (const f of layout.footprints) nearest = Math.min(nearest, rectDistance(f, b.x, b.z));
        return { b, nearest };
      })
      .filter((c) => c.nearest > 160 && c.nearest < 650);
    const bucket = new MeshBucket();
    const count = Math.min(7, candidates.length);
    for (let i = 0; i < count; i++) {
      const c = candidates[Math.floor(rng.next() * candidates.length)]!;
      const { b } = c;
      const x = b.x;
      const z = b.z;
      const top = b.h;
      const mast = rng.range(34, 52);
      const jib = rng.range(26, 38);
      const rot = rng.next() * Math.PI * 2;
      const dx = Math.cos(rot);
      const dz = Math.sin(rot);
      // Lattice mast: four thin legs.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          bucket.addBox([x + sx * 0.9 - 0.12, top, z + sz * 0.9 - 0.12], [x + sx * 0.9 + 0.12, top + mast, z + sz * 0.9 + 0.12], null);
        }
      }
      for (let k = 1; k < 8; k++) {
        const y = top + (mast * k) / 8;
        bucket.addBox([x - 0.95, y - 0.06, z - 0.95], [x + 0.95, y + 0.06, z + 0.95], null);
      }
      // Jib and counter-jib: a long thin box along the crane's dominant axis, offset so the jib reaches
      // further out than the counter-jib behind the mast.
      const alongX = Math.abs(dx) > Math.abs(dz);
      const sgn = (alongX ? Math.sign(dx) : Math.sign(dz)) || 1;
      const reach = sgn > 0 ? [-8, jib] : [-jib, 8];
      if (alongX) {
        bucket.addBox([x + reach[0]!, top + mast, z - 0.5], [x + reach[1]!, top + mast + 1.1, z + 0.5], null);
      } else {
        bucket.addBox([x - 0.5, top + mast, z + reach[0]!], [x + 0.5, top + mast + 1.1, z + reach[1]!], null);
      }
      bucket.addBox([x - 1.4, top + mast - 1.5, z - 1.4], [x + 1.4, top + mast + 2.2, z + 1.4], null);
      bucket.addBox([x - 0.15, top + mast + 1.1, z - 0.15], [x + 0.15, top + mast + 7, z + 0.15], null);
    }
    if (bucket.vertexCount === 0) return;
    const geometry = bucket.build({ facade: false });
    const mesh = new THREE.Mesh(geometry, materials.get('redDark'));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'cranes';
    this.group.add(mesh);
    this.disposables.push(geometry);
  }

  // ------------------------------------------------------------------------------------------

  private buildGround(): void {
    const geometry = new THREE.PlaneGeometry(7000, 7000);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGWPos;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 g = vGWPos.xz / ${PITCH.toFixed(1)};
  vec2 f = fract(g);
  float streetW = ${(STREET / PITCH).toFixed(4)};
  float inX = step(f.x, streetW * 0.5) + step(1.0 - streetW * 0.5, f.x);
  float inZ = step(f.y, streetW * 0.5) + step(1.0 - streetW * 0.5, f.y);
  float street = clamp(inX + inZ, 0.0, 1.0);
  vec3 lot = vec3(0.64, 0.66, 0.68);
  vec3 asphalt = vec3(0.19, 0.2, 0.22);
  vec3 c = mix(lot, asphalt, street);
  // dashed centre lines
  float lineX = (1.0 - step(0.012, abs(f.x - 0.0))) * step(0.5, fract(vGWPos.z / 6.0));
  c = mix(c, vec3(0.7, 0.7, 0.66), lineX * 0.0);
  diffuseColor.rgb = c;
}`,
        );
    };
    material.customProgramCacheKey = () => 'ground';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0;
    mesh.receiveShadow = false;
    mesh.name = 'ground';
    this.group.add(mesh);
    this.disposables.push(geometry, material);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
