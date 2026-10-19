import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld.ts';
import { BoxBatcher } from './BoxBatcher.ts';
import { buildLevel, BASE_Y } from './LevelLayout.ts';
import type { LevelDesc, MatKind } from './LevelLayout.ts';
import { createSurfaceMaterials } from './Materials.ts';
import type { SurfaceMaterials } from './Materials.ts';

/**
 * Turns the pure LevelDesc into renderable meshes (one merged mesh per material) and fills the
 * CollisionWorld used by the player physics.
 */
export class Level {
  readonly root = new THREE.Group();
  readonly world = new CollisionWorld();
  readonly desc: LevelDesc;

  private readonly materials: SurfaceMaterials;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly extraMaterials: THREE.Material[] = [];
  private readonly curtain: THREE.Mesh;
  private readonly curtainMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.desc = buildLevel();
    this.materials = createSurfaceMaterials();

    const batchers: Record<MatKind, BoxBatcher> = {
      building: new BoxBatcher(),
      glass: new BoxBatcher(),
      concrete: new BoxBatcher(),
      red: new BoxBatcher(),
      dark: new BoxBatcher(),
      grate: new BoxBatcher(),
      trim: new BoxBatcher(),
    };

    for (const s of this.desc.solids) {
      batchers[s.mat].addBox(
        s.minX,
        s.maxX,
        s.minY,
        s.maxY,
        s.minZ,
        s.maxZ,
        s.tint,
        s.aoTop,
        s.aoBottom,
        s.minY <= BASE_Y + 1,
      );
      if (s.collide) this.world.add(s, s.runnable);
    }

    (Object.keys(batchers) as MatKind[]).forEach((kind) => {
      const batcher = batchers[kind];
      if (batcher.isEmpty) return;
      const geometry = batcher.build();
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, this.materials[kind]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `level-${kind}`;
      this.root.add(mesh);
    });

    // Finish gate: translucent red curtain between the pillars.
    const f = this.desc.finish;
    this.curtainMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2a30,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const curtainGeo = new THREE.PlaneGeometry(f.halfWidth * 2 - 1.2, 5.4);
    this.geometries.push(curtainGeo);
    this.curtain = new THREE.Mesh(curtainGeo, this.curtainMaterial);
    this.curtain.rotation.y = Math.PI / 2;
    this.curtain.position.set(f.x, f.y + 2.7, f.z);
    this.curtain.renderOrder = 5;
    this.root.add(this.curtain);
  }

  update(time: number): void {
    this.curtainMaterial.opacity = 0.17 + 0.06 * Math.sin(time * 2.2);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    for (const m of this.extraMaterials) m.dispose();
    this.curtainMaterial.dispose();
  }
}
