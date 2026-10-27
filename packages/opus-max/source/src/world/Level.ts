import * as THREE from 'three';
import type { CityData } from './CityGenerator.ts';
import { Batch, addBox, segmentMatrix } from './GeometryBuilder.ts';
import type { DecorDef, LevelDef, Style, Vec3 } from './LevelData.ts';
import { bannerTexture, type MaterialKey, type Materials } from './Materials.ts';

const FACADES: ReadonlySet<Style> = new Set<Style>(['facadeWhite', 'facadeGlass', 'facadeConcrete']);

/**
 * Builds every visual of the level (route + background city) from data.
 * Static geometry is merged per material, which keeps the whole city at a few dozen draw calls.
 */
export class Level {
  readonly root = new THREE.Group();
  /** Shared time uniform for waving flags. */
  private readonly flagTime = { value: 0 };
  private readonly disposables: { dispose(): void }[] = [];
  private readonly batches = new Map<MaterialKey, Batch>();
  private readonly materials: Materials;

  constructor(def: LevelDef, city: CityData, materials: Materials) {
    this.materials = materials;
    this.root.name = 'level';

    this.buildRoute(def);
    this.buildDecor(def.decor);
    this.buildCity(city);
    this.buildZiplines(def);
    this.flushBatches();
    this.buildGround();
  }

  private batch(key: MaterialKey): Batch {
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch();
      this.batches.set(key, b);
    }
    return b;
  }

  // ------------------------------------------------------------------ route

  private buildRoute(def: LevelDef): void {
    for (const s of def.solids) {
      if (!s.visible) continue;
      const facade = FACADES.has(s.style);
      const topStyle = s.top ?? s.style;
      addBox(s.min, s.max, this.batch(s.style), this.batch(topStyle), {
        sideUv: facade ? 'facade' : 'world',
        bottom: s.bottom,
        ao: s.ao ? 0.22 : 0,
      });
      if (facade) this.addCornice(s.min, s.max);
    }
  }

  /** Crisp white band around the roof edge of a building. */
  private addCornice(min: Vec3, max: Vec3): void {
    const t = 0.16;
    const y0 = max[1] - 0.75;
    const y1 = max[1] + 0.02;
    const [x0, , z0] = min;
    const [x1, , z1] = max;
    const b = this.batch('white');
    addBox([x0 - t, y0, z0 - t], [x1 + t, y1, z0], b, b, { bottom: true });
    addBox([x0 - t, y0, z1], [x1 + t, y1, z1 + t], b, b, { bottom: true });
    addBox([x0 - t, y0, z0], [x0, y1, z1], b, b, { bottom: true });
    addBox([x1, y0, z0], [x1 + t, y1, z1], b, b, { bottom: true });
  }

  // ------------------------------------------------------------------ decor

  private buildDecor(decor: readonly DecorDef[]): void {
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
    const cylLow = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    const square = new THREE.CylinderGeometry(0.7071, 0.7071, 1, 4, 1);
    square.rotateY(Math.PI / 4);
    const flags: { x: number; y: number; z: number; yaw: number; color: THREE.Color }[] = [];
    const m = new THREE.Matrix4();

    for (const d of decor) {
      switch (d.kind) {
        case 'cylinder': {
          m.makeScale(d.radius, d.height, d.radius).setPosition(d.x, d.y + d.height / 2, d.z);
          this.batch(d.style).geometry(cyl, m);
          break;
        }
        case 'pipe': {
          this.batch(d.style).geometry(cyl, segmentMatrix(d.a, d.b, d.radius));
          break;
        }
        case 'railing': {
          this.addRailing(d.a, d.b, d.height, square);
          break;
        }
        case 'flag': {
          m.makeScale(0.045, d.pole, 0.045).setPosition(d.x, d.y + d.pole / 2, d.z);
          this.batch('metal').geometry(cylLow, m);
          flags.push({ x: d.x, y: d.y + d.pole - 0.05, z: d.z, yaw: d.yaw, color: new THREE.Color(d.color === 'red' ? 0xe2231a : 0xf28a1e) });
          break;
        }
        case 'fan': {
          m.makeScale(d.radius, 0.06, d.radius).setPosition(d.x, d.y + 0.03, d.z);
          this.batch('dark').geometry(cyl, m);
          m.makeScale(d.radius * 1.08, 0.1, d.radius * 1.08).setPosition(d.x, d.y + 0.02, d.z);
          this.batch('grey').geometry(cylLow, m);
          break;
        }
        case 'antenna': {
          m.makeScale(0.06, d.height, 0.06).setPosition(d.x, d.y + d.height / 2, d.z);
          this.batch('metal').geometry(cylLow, m);
          m.makeScale(0.03, d.height * 0.5, 0.03).setPosition(d.x + 0.35, d.y + d.height * 0.55, d.z);
          this.batch('metal').geometry(cylLow, m);
          addBox([d.x - 0.12, d.y + d.height - 0.2, d.z - 0.12], [d.x + 0.12, d.y + d.height + 0.05, d.z + 0.12], this.batch('red'), this.batch('red'));
          break;
        }
        case 'tower': {
          this.addLatticeTower(d.x, d.y, d.z, d.w, d.d, d.h, square);
          break;
        }
        case 'grate': {
          addBox(d.min, d.max, this.batch('grate'), this.batch('grate'), { sideUv: 'world' });
          break;
        }
        case 'banner': {
          const tex = bannerTexture(d.text);
          const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), mat);
          mesh.position.set(d.x, d.y, d.z);
          mesh.rotation.y = d.yaw;
          this.root.add(mesh);
          this.disposables.push(tex, mat, mesh.geometry);
          break;
        }
      }
    }
    this.buildFlags(flags);
    this.disposables.push(cyl, cylLow, square);
  }

  private addRailing(a: Vec3, b: Vec3, height: number, post: THREE.BufferGeometry): void {
    const batch = this.batch('metal');
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.round(len / 1.5));
    const m = new THREE.Matrix4();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      m.makeScale(0.055, height, 0.055).setPosition(x, a[1] + height / 2, z);
      batch.geometry(post, m);
    }
    batch.geometry(post, segmentMatrix([a[0], a[1] + height, a[2]], [b[0], b[1] + height, b[2]], 0.05));
    batch.geometry(post, segmentMatrix([a[0], a[1] + height * 0.5, a[2]], [b[0], b[1] + height * 0.5, b[2]], 0.03));
  }

  /** Red steel lattice mast, like the zipline towers in the reference shots. */
  private addLatticeTower(x: number, y: number, z: number, w: number, d: number, h: number, beam: THREE.BufferGeometry): void {
    const batch = this.batch('red');
    const hw = w / 2;
    const hd = d / 2;
    const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (const [cx, cz] of corners) {
      batch.geometry(beam, segmentMatrix([x + cx, y, z + cz], [x + cx, y + h, z + cz], 0.12));
    }
    const levels = Math.max(2, Math.round(h / 1.5));
    for (let i = 0; i <= levels; i++) {
      const ly = y + (h * i) / levels;
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        batch.geometry(beam, segmentMatrix([x + ax, ly, z + az], [x + bx, ly, z + bz], 0.06));
        if (i < levels) {
          const ny = y + (h * (i + 1)) / levels;
          const diag: [Vec3, Vec3] = i % 2 === 0 ? [[x + ax, ly, z + az], [x + bx, ny, z + bz]] : [[x + bx, ly, z + bz], [x + ax, ny, z + az]];
          batch.geometry(beam, segmentMatrix(diag[0], diag[1], 0.045));
        }
      }
    }
    // Cap platform and a red electrical cabinet, as in the reference.
    addBox([x - hw - 0.2, y + h, z - hd - 0.2], [x + hw + 0.2, y + h + 0.18, z + hd + 0.2], batch, batch, { bottom: true });
    addBox([x - 0.5, y, z - 0.5], [x + 0.5, y + 0.12, z + 0.5], batch, batch);
  }

  private buildFlags(flags: { x: number; y: number; z: number; yaw: number; color: THREE.Color }[]): void {
    if (flags.length === 0) return;
    const geo = new THREE.PlaneGeometry(1.25, 0.8, 10, 2);
    geo.translate(0.625, -0.4, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
    const time = this.flagTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        float flagSeed = 0.0;
        #ifdef USE_INSTANCING
          flagSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
        #endif
        float w = uv.x;
        float ph = uTime * 5.5 - uv.x * 6.0 + flagSeed;
        transformed.z += (sin(ph) * 0.13 + sin(ph * 1.7 + 1.3) * 0.05) * w;
        transformed.y += sin(ph * 0.8) * 0.035 * w;
        transformed.x -= (1.0 - cos(sin(ph) * 0.3)) * w;`,
      );
    };
    const mesh = new THREE.InstancedMesh(geo, mat, flags.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    flags.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
      m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, f.color);
    });
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.disposables.push(geo, mat);
  }

  // ------------------------------------------------------------------ zipline

  private buildZiplines(def: LevelDef): void {
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    for (const z of def.ziplines) {
      this.batch('dark').geometry(cyl, segmentMatrix(z.a, z.b, 0.022));
      // Pulley housing at the top.
      addBox([z.a[0] - 0.25, z.a[1] - 0.2, z.a[2] - 0.1], [z.a[0] + 0.25, z.a[1] + 0.3, z.a[2] + 0.35], this.batch('dark'), this.batch('dark'), { bottom: true });
    }
    this.disposables.push(cyl);
  }

  // ------------------------------------------------------------------ city

  private buildCity(city: CityData): void {
    for (const b of city.buildings) {
      addBox([b.x0, 0, b.z0], [b.x1, b.height, b.z1], this.batch(b.style), this.batch('roof'), { sideUv: 'facade' });
    }
    for (const p of city.props) {
      addBox(p.min, p.max, this.batch(p.style), this.batch(p.style), { ao: 0.15 });
    }
    for (const bb of city.billboards) {
      const hw = bb.w / 2;
      const hh = bb.h / 2;
      const along = bb.nx !== 0 ? 'z' : 'x';
      const depth = 0.3;
      const min: Vec3 = along === 'x'
        ? [bb.x - hw, bb.y - hh, bb.z - depth / 2]
        : [bb.x - depth / 2, bb.y - hh, bb.z - hw];
      const max: Vec3 = along === 'x'
        ? [bb.x + hw, bb.y + hh, bb.z + depth / 2]
        : [bb.x + depth / 2, bb.y + hh, bb.z + hw];
      // White frame slightly larger than the coloured panel.
      const fmin: Vec3 = [min[0] - (along === 'x' ? 0.4 : 0), min[1] - 0.4, min[2] - (along === 'z' ? 0.4 : 0)];
      const fmax: Vec3 = [max[0] + (along === 'x' ? 0.4 : 0), max[1] + 0.4, max[2] + (along === 'z' ? 0.4 : 0)];
      const inset = bb.nx !== 0 ? [-bb.nx * 0.08, 0, 0] : [0, 0, -bb.nz * 0.08];
      addBox([fmin[0] + inset[0], fmin[1], fmin[2] + inset[2]], [fmax[0] + inset[0], fmax[1], fmax[2] + inset[2]], this.batch('white'), this.batch('white'), { bottom: true });
      const out = bb.nx !== 0 ? [bb.nx * 0.04, 0, 0] : [0, 0, bb.nz * 0.04];
      addBox([min[0] + out[0], min[1], min[2] + out[2]], [max[0] + out[0], max[1], max[2] + out[2]], this.batch(bb.color), this.batch(bb.color), { bottom: true });
    }
    for (const c of city.cranes) this.addCrane(c.x, c.baseY, c.z, c.height, c.jib, c.yaw);
  }

  private addCrane(x: number, y: number, z: number, height: number, jib: number, yaw: number): void {
    const batch = this.batch('crane');
    const beam = new THREE.CylinderGeometry(0.7071, 0.7071, 1, 4, 1);
    beam.rotateY(Math.PI / 4);
    const s = 1.1; // half mast width
    const corners: [number, number][] = [[-s, -s], [s, -s], [s, s], [-s, s]];
    for (const [cx, cz] of corners) batch.geometry(beam, segmentMatrix([x + cx, y, z + cz], [x + cx, y + height, z + cz], 0.16));
    for (let ly = y + 6; ly < y + height; ly += 6) {
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        batch.geometry(beam, segmentMatrix([x + ax, ly, z + az], [x + bx, ly + 6, z + bz], 0.08));
      }
    }
    const top = y + height;
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    // Jib (long arm), counter-jib and the peak.
    batch.geometry(beam, segmentMatrix([x - dx * 14, top + 1, z - dz * 14], [x + dx * jib, top + 1, z + dz * jib], 0.55));
    batch.geometry(beam, segmentMatrix([x, top + 8, z], [x + dx * jib * 0.6, top + 1.4, z + dz * jib * 0.6], 0.1));
    batch.geometry(beam, segmentMatrix([x, top + 8, z], [x - dx * 14, top + 1.4, z - dz * 14], 0.1));
    batch.geometry(beam, segmentMatrix([x, top, z], [x, top + 8.5, z], 0.5));
    addBox([x - dx * 13 - 1.6, top - 1.5, z - dz * 13 - 1.6], [x - dx * 13 + 1.6, top + 0.5, z - dz * 13 + 1.6], this.batch('grey'), this.batch('grey'), { bottom: true });
    addBox([x - 1.4, top - 3, z - 1.4], [x + 1.4, top - 0.2, z + 1.4], this.batch('white'), this.batch('white'), { bottom: true });
    // Hook cable.
    const hx = x + dx * jib * 0.7;
    const hz = z + dz * jib * 0.7;
    this.batch('dark').geometry(beam, segmentMatrix([hx, top + 0.5, hz], [hx, top - 40, hz], 0.06));
    addBox([hx - 0.6, top - 42, hz - 0.6], [hx + 0.6, top - 40, hz + 0.6], this.batch('crane'), this.batch('crane'), { bottom: true });
    this.disposables.push(beam);
  }

  // ------------------------------------------------------------------ finishing

  private flushBatches(): void {
    for (const [key, batch] of this.batches) {
      const geo = batch.build();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, this.materials.get(key));
      mesh.name = `batch:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Merged meshes span the whole city; culling them would only cost CPU.
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.disposables.push(geo);
    }
    this.batches.clear();
  }

  private buildGround(): void {
    const geo = new THREE.PlaneGeometry(9000, 9000);
    geo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(geo, this.materials.get('ground'));
    ground.position.set(100, 0, -150);
    ground.name = 'ground';
    this.root.add(ground);
    this.disposables.push(geo);
  }

  update(time: number): void {
    this.flagTime.value = time;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
