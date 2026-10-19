import * as THREE from 'three';

export interface Materials {
  roof: THREE.MeshStandardMaterial[];
  concrete: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  flag: THREE.MeshStandardMaterial;
  grate: THREE.MeshStandardMaterial;
  unit: THREE.BoxGeometry;
}

function std(color: number, roughness: number, metalness = 0.04): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function createMaterials(): Materials {
  const top = std(0xf4f6f8, 0.9, 0.02);
  const side = std(0xd7dee6, 0.86, 0.03);
  const bottom = std(0xb4bec8, 0.95, 0);
  const red = std(0xe10600, 0.42, 0.08);
  red.emissive = new THREE.Color(0x8a140c);
  red.emissiveIntensity = 0.38;
  const carpet = red.clone();
  carpet.polygonOffset = true;
  carpet.polygonOffsetFactor = -2;
  carpet.polygonOffsetUnits = -2;
  const flag = red.clone();
  flag.side = THREE.DoubleSide;
  flag.emissiveIntensity = 0.55;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1b1f25';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2c333c';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillRect(x * 16 + 2, y * 16 + 2, 12, 12);
      }
    }
  }
  const grateMap = new THREE.CanvasTexture(canvas);
  grateMap.colorSpace = THREE.SRGBColorSpace;
  grateMap.wrapS = THREE.RepeatWrapping;
  grateMap.wrapT = THREE.RepeatWrapping;
  const grate = new THREE.MeshStandardMaterial({
    map: grateMap,
    roughness: 0.8,
    metalness: 0.25,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  return {
    roof: [side, side, top, bottom, side, side],
    concrete: std(0xc5ccd4, 0.84, 0.05),
    red,
    metal: std(0xb4bcc4, 0.58, 0.16),
    dark: std(0x2a313a, 0.7, 0.18),
    wall: std(0xe6ebf0, 0.8, 0.04),
    glass: new THREE.MeshStandardMaterial({
      color: 0xb7d4e6,
      roughness: 0.14,
      metalness: 0.62,
      transparent: true,
      opacity: 0.62,
    }),
    carpet,
    flag,
    grate,
    unit: new THREE.BoxGeometry(1, 1, 1),
  };
}
