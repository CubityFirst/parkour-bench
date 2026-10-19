import { Group, Mesh, PlaneGeometry, Scene, Vector3 } from 'three';
import { boxMesh, materials } from './Assets';

/** Small seeded PRNG so the skyline is identical on every load. */
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

/** Background skyline placed beside the playable route; purely visual, no collision. */
export function buildCity(scene: Scene): void {
  const random = mulberry32(1337);
  const city = new Group();

  for (let i = 0; i < 110; i++) {
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (34 + random() * 130);
    const z = 70 - random() * 380;
    const width = 10 + random() * 18;
    const depth = 10 + random() * 18;
    const height = 25 + random() * (random() < 0.2 ? 150 : 70);

    const roll = random();
    const material = roll < 0.5 ? materials.glass : roll < 0.93 ? materials.cityWhite : materials.red;

    const min = new Vector3(x - width / 2, -32, z - depth / 2);
    const max = new Vector3(x + width / 2, height, z + depth / 2);
    city.add(boxMesh(min, max, material, false));
  }

  const ground = new Mesh(new PlaneGeometry(1400, 1400), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -32;
  city.add(ground);

  scene.add(city);
}
