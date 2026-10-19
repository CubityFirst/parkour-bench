import * as THREE from 'three';

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Creates the low-detail, blue-glass city that frames the playable rooftops. */
export class CityGenerator {
  static addTo(parent: THREE.Object3D): void {
    const random = seededRandom(7019);
    const glass = new THREE.MeshStandardMaterial({ color: 0x5e9fc0, roughness: 0.32, metalness: 0.18, transparent: true, opacity: 0.9 });
    const paleGlass = new THREE.MeshStandardMaterial({ color: 0xa9d7e7, roughness: 0.22, metalness: 0.16, transparent: true, opacity: 0.86 });
    const white = new THREE.MeshStandardMaterial({ color: 0xdce7e9, roughness: 0.78, metalness: 0.03 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x38505d, roughness: 0.64, metalness: 0.12 });
    const geometry = new THREE.BoxGeometry(1, 1, 1);

    const groups = [glass, paleGlass, white, dark].map((material) => new THREE.InstancedMesh(geometry, material, 68));
    groups.forEach((mesh) => {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      parent.add(mesh);
    });

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let index = 0; index < 272; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 42 + random() * 140;
      let x = Math.cos(angle) * radius;
      let z = Math.sin(angle) * radius + 28;
      if (Math.abs(x) < 19 && z > -115 && z < 180) x += x < 0 ? -28 : 28;
      if (Math.abs(z + 84) < 18 && Math.abs(x) < 35) z += z < -84 ? -26 : 26;

      const width = 8 + random() * 19;
      const depth = 8 + random() * 21;
      const height = 18 + random() * 92;
      const top = -4 - random() * 16;
      const groupIndex = index % groups.length;
      matrix.compose(new THREE.Vector3(x, top - height * 0.5, z), new THREE.Quaternion(), new THREE.Vector3(width, height, depth));
      groups[groupIndex].setMatrixAt(Math.floor(index / groups.length), matrix);
      color.setHex(groupIndex === 0 ? 0x4f94b8 : groupIndex === 1 ? 0xa3d3e1 : groupIndex === 2 ? 0xdce5e6 : 0x304956);
      color.offsetHSL((random() - 0.5) * 0.025, 0, (random() - 0.5) * 0.08);
      groups[groupIndex].setColorAt(Math.floor(index / groups.length), color);
    }
    groups.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });

    const horizonMaterial = new THREE.MeshBasicMaterial({ color: 0xb4dce8, transparent: true, opacity: 0.42, depthWrite: false });
    for (let i = 0; i < 24; i += 1) {
      const x = -210 + i * 18 + random() * 8;
      const h = 38 + random() * 100;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(11 + random() * 14, h, 10 + random() * 13), horizonMaterial);
      tower.position.set(x, -14 - h * 0.5, 210 + random() * 52);
      parent.add(tower);
    }

    const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false });
    for (let i = 0; i < 17; i += 1) {
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(7 + random() * 10, 12, 8), cloudMaterial);
      cloud.scale.set(1.9, 0.42, 0.9);
      cloud.position.set(-135 + random() * 270, 50 + random() * 36, -100 + random() * 330);
      parent.add(cloud);
    }
  }
}
