import * as THREE from 'three';

/**
 * CityGenerator — non-interactive background dressing: the city floor far
 * below the rooftops and a skyline of towers around the playable route.
 * Everything is instanced (two draw calls for the hundreds of buildings).
 */
export class CityGenerator {
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.buildGround();
    this.buildSkyline();
  }

  private buildGround(): void {
    // City floor far below the route (visual only — falling is a respawn).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3600, 3600),
      new THREE.MeshLambertMaterial({ color: 0xaeb6bd })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    this.group.add(ground);

    // street grid strips for a faint city layout from above
    const streetMat = new THREE.MeshLambertMaterial({ color: 0x8f979e });
    const across = new THREE.InstancedMesh(new THREE.PlaneGeometry(3400, 22), streetMat, 14);
    const along = new THREE.InstancedMesh(new THREE.PlaneGeometry(22, 3400), streetMat, 14);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 14; i++) {
      const p = (i - 7) * 230 + (i % 2) * 60;
      m.makeRotationX(-Math.PI / 2);
      m.setPosition(0, -0.3, p);
      across.setMatrixAt(i, m);
      m.makeRotationX(-Math.PI / 2);
      m.setPosition(p * 1.4, -0.3, 0);
      along.setMatrixAt(i, m);
    }
    this.group.add(across, along);
  }

  private buildSkyline(): void {
    const candidates: { x: number; z: number; w: number; d: number; h: number; glass: boolean; shade: number; rot: number }[] = [];
    let seed = 1337;
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const count = 240;
    for (let i = 0; i < count; i++) {
      // cluster around the route but never inside the playable corridor
      let x = 0, z = 0, tries = 0;
      do {
        const angle = rand() * Math.PI * 2;
        const radius = 90 + rand() * 430;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius + 200;
        tries++;
      } while (tries < 12 && Math.abs(x) < 52 && z > -60 && z < 480);
      if (Math.abs(x) < 52 && z > -60 && z < 480) continue;
      const glass = rand() < 0.42;
      const h = 26 + rand() * rand() * 120;
      const w = 12 + rand() * 20;
      const d = 12 + rand() * 20;
      const shade = 0.82 + rand() * 0.18;
      candidates.push({ x, z, w, d, h, glass, shade, rot: rand() * 0.4 - 0.2 });
    }

    const build = (
      list: typeof candidates,
      material: THREE.MeshLambertMaterial
    ): void => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const color = new THREE.Color();
      list.forEach((c, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
        m.compose(new THREE.Vector3(c.x, c.h / 2, c.z), q, new THREE.Vector3(c.w, c.h, c.d));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.setScalar(c.shade));
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    };

    const glassList = candidates.filter((c) => c.glass);
    const whiteList = candidates.filter((c) => !c.glass);
    build(whiteList, new THREE.MeshLambertMaterial({ color: 0xe8e5df }));
    build(glassList, new THREE.MeshLambertMaterial({ color: 0x9dc3dc }));
  }
}
