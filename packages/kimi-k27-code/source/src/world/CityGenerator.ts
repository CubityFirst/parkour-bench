import * as THREE from 'three';

export function CityGenerator(root: THREE.Object3D) {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.6 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x88ccff,
    metalness: 0.1,
    roughness: 0.15,
    transmission: 0.1,
    transparent: true,
    opacity: 0.85
  });

  const count = 220;
  const instances: { pos: THREE.Vector3; scale: THREE.Vector3; glass: boolean }[] = [];

  // Keep a generous corridor around the playable rooftop route free of background towers
  // so the opening view and the whole run stay readable.
  const corridorMinX = -100;
  const corridorMaxX = 100;
  const corridorMinZ = -80;
  const corridorMaxZ = 480;

  let attempts = 0;
  while (instances.length < count && attempts < count * 40) {
    attempts++;
    const angle = Math.random() * Math.PI * 2;
    const radius = 280 + Math.random() * 380;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const width = 12 + Math.random() * 28;
    const depth = 12 + Math.random() * 28;

    // Reject buildings that overlap the playable corridor
    if (x - width / 2 < corridorMaxX && x + width / 2 > corridorMinX &&
        z - depth / 2 < corridorMaxZ && z + depth / 2 > corridorMinZ) {
      continue;
    }

    const height = 30 + Math.random() * 160;
    const y = -60 + height / 2 - Math.random() * 40;
    const glass = Math.random() > 0.55;
    instances.push({ pos: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(width, height, depth), glass });
  }

  const whiteMesh = new THREE.InstancedMesh(boxGeo, whiteMat, count);
  const glassMesh = new THREE.InstancedMesh(boxGeo, glassMat, count);
  whiteMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  glassMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const dummy = new THREE.Object3D();
  let wIdx = 0, gIdx = 0;
  for (const inst of instances) {
    dummy.position.copy(inst.pos);
    dummy.scale.copy(inst.scale);
    dummy.updateMatrix();
    if (inst.glass) {
      glassMesh.setMatrixAt(gIdx++, dummy.matrix);
    } else {
      whiteMesh.setMatrixAt(wIdx++, dummy.matrix);
    }
  }
  glassMesh.count = gIdx;
  whiteMesh.count = wIdx;

  whiteMesh.castShadow = true;
  whiteMesh.receiveShadow = true;
  glassMesh.receiveShadow = true;

  root.add(whiteMesh);
  root.add(glassMesh);
}
