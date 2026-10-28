import * as THREE from 'three';

/**
 * Builds the background city that surrounds the playable route.
 *
 * Everything is instanced so the whole skyline costs only a handful of draw
 * calls. The buildings are placed outside the playable corridor and are not
 * part of the collision world.
 */
export class CityGenerator {
  readonly group = new THREE.Group();

  private readonly rand: () => number;

  constructor(seed = 987654321) {
    this.rand = this.makeRandom(seed);
    this.build();
  }

  private makeRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private build(): void {
    const rand = this.rand;

    // Playable corridor: keep the background away from the route.
    const routeMinX = -70;
    const routeMaxX = 620;
    const corridor = 52;

    const blocks: { x: number; z: number; w: number; d: number; h: number; glass: boolean }[] = [];

    for (let x = -420; x < 1100; x += 46) {
      for (let z = -520; z < 520; z += 46) {
        const jitterX = (rand() - 0.5) * 22;
        const jitterZ = (rand() - 0.5) * 22;
        const bx = x + jitterX;
        const bz = z + jitterZ;

        // Skip the playable corridor.
        if (bx > routeMinX && bx < routeMaxX && Math.abs(bz) < corridor) continue;
        // Thin out very dense areas.
        if (rand() < 0.12) continue;

        const w = 16 + rand() * 26;
        const d = 16 + rand() * 26;
        const near = Math.abs(bz) < 150 ? 1 : 1.9;
        const h = (26 + rand() * 78) * near;
        const glass = rand() < 0.42;

        blocks.push({ x: bx, z: bz, w, d, h, glass });
      }
    }

    const solid = blocks.filter((b) => !b.glass);
    const glass = blocks.filter((b) => b.glass);

    this.addInstances(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.82, metalness: 0.04 }),
      solid,
      0
    );
    this.addInstances(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x86b6d6,
        roughness: 0.12,
        metalness: 0.6,
        transparent: true,
        opacity: 0.82,
      }),
      glass,
      0
    );
    // Thin white roof caps to break up the skyline.
    this.addInstances(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xfbfcfd, roughness: 0.7 }),
      blocks,
      1
    );

    // Window bands: horizontal stripes that give the towers a sense of scale.
    const bandBlocks: { x: number; z: number; w: number; d: number; h: number }[] = [];
    for (const b of blocks) {
      const bands = b.h > 70 ? 5 : b.h > 40 ? 4 : 3;
      for (let i = 1; i <= bands; i++) {
        const y = -48 + (b.h * i) / (bands + 1);
        bandBlocks.push({ x: b.x, z: b.z, w: b.w * 1.01, d: b.d * 1.01, h: y });
      }
    }
    this.addInstances(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x7ea6c4,
        roughness: 0.25,
        metalness: 0.35,
      }),
      bandBlocks,
      2
    );

    // Antennae on the tallest towers.
    const mastCount = 120;
    const masts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.35, 0.5, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0xb9c0c9, roughness: 0.5, metalness: 0.5 }),
      mastCount
    );
    masts.castShadow = false;
    masts.receiveShadow = false;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (let i = 0; i < mastCount; i++) {
      const b = blocks[Math.floor(rand() * blocks.length)];
      const h = 8 + rand() * 22;
      position.set(b.x + (rand() - 0.5) * b.w * 0.4, b.h - 48 + h / 2, b.z + (rand() - 0.5) * b.d * 0.4);
      scale.set(1, h, 1);
      matrix.compose(position, quaternion, scale);
      masts.setMatrixAt(i, matrix);
    }
    masts.instanceMatrix.needsUpdate = true;
    this.group.add(masts);

    // Distant ground so the gaps read as a city, not a void.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({ color: 0xa9b6c2, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(280, -62, 0);
    ground.receiveShadow = false;
    this.group.add(ground);
  }

  private addInstances(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    blocks: { x: number; z: number; w: number; d: number; h: number }[],
    capMode: number
  ): void {
    if (blocks.length === 0) return;
    const count = blocks.length;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = capMode === 0;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const b = blocks[i];
      if (capMode === 0) {
        position.set(b.x, -48 + b.h / 2, b.z);
        scale.set(b.w, b.h, b.d);
      } else if (capMode === 1) {
        position.set(b.x, -48 + b.h + 0.6, b.z);
        scale.set(b.w * 0.92, 1.2, b.d * 0.92);
      } else {
        // Window band
        position.set(b.x, b.h, b.z);
        scale.set(b.w, 1.1, b.d);
      }
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });
  }
}
