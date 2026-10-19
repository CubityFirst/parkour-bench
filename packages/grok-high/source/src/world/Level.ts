import * as THREE from 'three';
import type { Layout, Solid } from '../player/types';
import { createMaterials, type Materials } from './materials';

/** Playable rooftops, runner-vision markers, rails, and checkpoint lamps. */
export class Level {
  readonly group = new THREE.Group();
  readonly flags: THREE.Object3D[] = [];
  private readonly lamps: THREE.Mesh[] = [];
  private readonly mats: Materials;

  constructor(scene: THREE.Scene, layout: Layout) {
    this.mats = createMaterials();
    scene.add(this.group);
    for (const solid of layout.solids) this.addSolid(solid);
    this.addCarpets(layout);
    this.addRails(layout);
    this.addFlags(layout);
    this.addBeacons(layout);
    this.addGratings(layout);
    this.addFinishMark(layout);
    this.addPipes(layout);
  }

  update(time: number): void {
    for (const flag of this.flags) {
      flag.rotation.y = Math.sin(time * 2.2 + flag.position.x * 0.15) * 0.35;
    }
  }

  setReached(index: number): void {
    this.lamps.forEach((lamp, i) => {
      const mat = lamp.material as THREE.MeshStandardMaterial;
      const on = i <= index;
      mat.emissive.setHex(on ? 0xff2b2b : 0x3a0c0c);
      mat.emissiveIntensity = on ? 1.35 : 0.25;
    });
  }

  private mesh(solid: Solid, material: THREE.Material | THREE.Material[]): THREE.Mesh {
    const mesh = new THREE.Mesh(this.mats.unit, material);
    mesh.scale.set(solid.maxX - solid.minX, solid.maxY - solid.minY, solid.maxZ - solid.minZ);
    mesh.position.set(
      (solid.minX + solid.maxX) * 0.5,
      (solid.minY + solid.maxY) * 0.5,
      (solid.minZ + solid.maxZ) * 0.5,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private addSolid(solid: Solid): void {
    const material =
      solid.surface === 'roof'
        ? this.mats.roof
        : solid.surface === 'red'
          ? this.mats.red
          : solid.surface === 'metal'
            ? this.mats.metal
            : solid.surface === 'dark'
              ? this.mats.dark
              : solid.surface === 'wall'
                ? this.mats.wall
                : this.mats.concrete;
    this.mesh(solid, material);
    if (solid.accent) this.addBand(solid);
    if (solid.surface === 'metal') this.addChevron(solid);
  }

  private addBand(solid: Solid): void {
    const band = new THREE.Mesh(this.mats.unit, this.mats.red);
    const alongX = solid.accent === 'minZ' || solid.accent === 'maxZ';
    const y = 40;
    const height = 2.4;
    if (alongX) {
      const face = solid.accent === 'maxZ' ? solid.maxZ : solid.minZ;
      const sign = solid.accent === 'maxZ' ? 1 : -1;
      band.scale.set(solid.maxX - solid.minX, height, 0.08);
      band.position.set((solid.minX + solid.maxX) * 0.5, y, face + sign * 0.05);
    } else {
      const face = solid.accent === 'maxX' ? solid.maxX : solid.minX;
      const sign = solid.accent === 'maxX' ? 1 : -1;
      band.scale.set(0.08, height, solid.maxZ - solid.minZ);
      band.position.set(face + sign * 0.05, y, (solid.minZ + solid.maxZ) * 0.5);
    }
    band.castShadow = false;
    band.receiveShadow = true;
    this.group.add(band);
  }

  private addChevron(solid: Solid): void {
    const width = solid.maxZ - solid.minZ;
    const mark = new THREE.Mesh(this.mats.unit, this.mats.red);
    mark.scale.set(0.06, 0.16, Math.min(7.5, width * 0.42));
    mark.position.set(solid.minX - 0.04, (solid.minY + solid.maxY) * 0.5, (solid.minZ + solid.maxZ) * 0.5);
    mark.castShadow = false;
    this.group.add(mark);
  }

  private addCarpets(layout: Layout): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (const carpet of layout.carpets) {
      const mesh = new THREE.Mesh(geo, this.mats.carpet);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(carpet.length, carpet.width, 1);
      mesh.position.set(carpet.x, carpet.y, carpet.z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private addRails(layout: Layout): void {
    const parts: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const push = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      dummy.position.set(x, y, z);
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      parts.push(dummy.matrix.clone());
    };
    for (const roof of layout.roofs) {
      const sides: number[] = [];
      if (roof.rails === 'both' || roof.rails === '-z') sides.push(roof.z0);
      if (roof.rails === 'both' || roof.rails === '+z') sides.push(roof.z1);
      for (const z of sides) {
        push((roof.x0 + roof.x1) * 0.5, roof.y + 0.48, z, roof.x1 - roof.x0, 0.06, 0.05);
        for (let x = roof.x0 + 1.2; x < roof.x1 - 0.4; x += 2.5) {
          push(x, roof.y + 0.28, z, 0.06, 0.56, 0.06);
        }
      }
    }
    if (parts.length === 0) return;
    const mesh = new THREE.InstancedMesh(this.mats.unit, this.mats.concrete, parts.length);
    parts.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addFlags(layout: Layout): void {
    for (const carpet of layout.carpets) {
      const pole = new THREE.Mesh(this.mats.unit, this.mats.dark);
      pole.scale.set(0.05, 1.7, 0.05);
      pole.position.set(carpet.x - 0.4, carpet.y + 0.85, carpet.z + 1.15);
      pole.castShadow = true;
      this.group.add(pole);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.38), this.mats.flag);
      cloth.position.set(0.38, 0.55, 0);
      const hinge = new THREE.Group();
      hinge.position.copy(pole.position);
      hinge.position.y += 0.7;
      hinge.add(cloth);
      this.group.add(hinge);
      this.flags.push(hinge);
    }
  }

  private addBeacons(layout: Layout): void {
    layout.checkpoints.forEach((cp, i) => {
      const pole = new THREE.Mesh(this.mats.unit, this.mats.dark);
      pole.scale.set(0.08, 1.35, 0.08);
      pole.position.set(cp.x, cp.y + 0.68, cp.z + 2.15);
      pole.castShadow = true;
      this.group.add(pole);
      const lampMat = this.mats.red.clone();
      lampMat.emissive = new THREE.Color(i === 0 ? 0xff2b2b : 0x3a0c0c);
      lampMat.emissiveIntensity = i === 0 ? 1.35 : 0.25;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), lampMat);
      lamp.position.set(cp.x, cp.y + 1.45, cp.z + 2.15);
      this.group.add(lamp);
      this.lamps.push(lamp);
    });
  }

  private addGratings(layout: Layout): void {
    const spots = [
      { x: 6, z: -2, y: 40 },
      { x: 52, z: 1.5, y: 40.3 },
      { x: 290, z: 2, y: 37.6 },
    ];
    const geo = new THREE.PlaneGeometry(2.4, 2.4);
    for (const spot of spots) {
      const mesh = new THREE.Mesh(geo, this.mats.grate);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(spot.x, spot.y + 0.025, spot.z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    void layout;
  }

  private addFinishMark(layout: Layout): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = '#e10600';
    ctx.font = '700 92px Segoe UI, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', 256, 84);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(layout.finish.x, layout.finish.y + 4.4, 0);
    sprite.scale.set(4.6, 1.45, 1);
    this.group.add(sprite);
  }

  private addPipes(layout: Layout): void {
    const geo = new THREE.CylinderGeometry(0.07, 0.07, 1, 8);
    const place = (x: number, y: number, z: number, len: number) => {
      const mesh = new THREE.Mesh(geo, this.mats.red);
      mesh.rotation.z = Math.PI / 2;
      mesh.scale.set(1, len, 1);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    const start = layout.roofs[0];
    place((start.x0 + 6), start.y + 0.55, start.z0 + 1.1, 7);
    place(190, 39.3, -6.6, 8);
    place(430, 36.7, 5.2, 6);
  }
}
