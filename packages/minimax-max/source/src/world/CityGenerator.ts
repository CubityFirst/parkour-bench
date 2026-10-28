import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { MaterialKey, MaterialSet } from './Materials';

/** Deterministic pseudo random generator so the city is identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the background city.
 *
 * None of these buildings are part of the collision world - they only exist
 * to give the impression of a huge metropolis below and around the route.
 */
export class CityGenerator {
  readonly group = new Group();

  constructor(materials: MaterialSet) {
    this.group.name = 'background-city';
    this.buildCity(materials);
  }

  private buildCity(materials: MaterialSet): void {
    const random = mulberry32(20240613);
    const geometry = new BoxGeometry(1, 1, 1);

    const buckets = new Map<MaterialKey, Matrix4[]>();
    const push = (key: MaterialKey, matrix: Matrix4): void => {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(matrix);
    };

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();

    const setBox = (
      key: MaterialKey,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
    ): void => {
      position.set(x, y, z);
      quaternion.identity();
      scale.set(w, h, d);
      matrix.compose(position, quaternion, scale);
      push(key, matrix.clone());
    };

    // --- dense city below the rooftops -------------------------------------
    const cell = 20;
    for (let x = -240; x < 500; x += cell) {
      for (let z = -260; z < 270; z += cell) {
        const jx = x + (random() - 0.5) * cell * 0.6;
        const jz = z + (random() - 0.5) * cell * 0.6;

        // Keep the corridor around the playable route free.
        if (jx > -40 && jx < 280 && jz > -19 && jz < 17) continue;

        const w = 8 + random() * 14;
        const d = 8 + random() * 14;
        const top = -1.5 - random() * 30;
        const bottom = -88;

        const roll = random();
        let key: MaterialKey = 'white';
        if (roll > 0.58) key = 'concrete';
        else if (roll > 0.82) key = 'gray';
        else if (roll > 0.93) key = 'glass';
        else if (roll > 0.965) key = 'orange';

        setBox(key, jx, (top + bottom) / 2, jz, w, top - bottom, d);

        // Glass crown on some towers.
        if (random() > 0.8) {
          setBox(
            'glassDark',
            jx,
            top + 3 + random() * 7,
            jz,
            w * 0.74,
            8 + random() * 14,
            d * 0.74,
          );
        }
        // Rooftop block.
        if (random() > 0.62) {
          setBox('gray', jx + (random() - 0.5) * w * 0.4, top + 1.8, jz + (random() - 0.5) * d * 0.4, w * 0.42, 3.6, d * 0.42);
        }
        // Red service structure.
        if (random() > 0.9) {
          setBox('red', jx + (random() - 0.5) * w * 0.5, top + 1.2, jz + (random() - 0.5) * d * 0.5, 1.6, 2.4, 1.6);
        }
      }
    }

    // --- mid distance towers beside the route ------------------------------
    for (let i = 0; i < 120; i++) {
      const side = random() > 0.5 ? 1 : -1;
      const x = -60 + random() * 380;
      const z = side * (46 + random() * 130);
      const w = 14 + random() * 20;
      const d = 14 + random() * 20;
      const top = 2 + random() * 48;
      const bottom = -88;
      const key: MaterialKey = random() > 0.55 ? 'glass' : random() > 0.3 ? 'white' : 'concrete';
      setBox(key, x, (top + bottom) / 2, z, w, top - bottom, d);
      if (random() > 0.5) {
        setBox('glassDark', x, top + 4, z, w * 0.66, 8, d * 0.66);
      }
    }

    // --- distant skyline ---------------------------------------------------
    for (let i = 0; i < 150; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 160 + random() * 430;
      const x = 120 + Math.cos(angle) * radius;
      const z = -2 + Math.sin(angle) * radius;
      const w = 20 + random() * 36;
      const d = 20 + random() * 36;
      const top = 10 + random() * 110;
      const bottom = -90;
      const key: MaterialKey = random() > 0.62 ? 'glass' : random() > 0.25 ? 'white' : 'concrete';
      setBox(key, x, (top + bottom) / 2, z, w, top - bottom, d);
      if (random() > 0.62) {
        setBox('glassDark', x, top + 8, z, w * 0.6, 16, d * 0.6);
      }
    }

    // --- orange accent blocks (echoes the reference skyline) ---------------
    for (let i = 0; i < 20; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 210 + random() * 300;
      const x = 120 + Math.cos(angle) * radius;
      const z = -2 + Math.sin(angle) * radius;
      const w = 16 + random() * 26;
      const d = 16 + random() * 26;
      const top = 6 + random() * 40;
      setBox('orange', x, (top - 80) / 2, z, w, top + 80, d);
    }

    for (const [key, matrices] of buckets) {
      if (matrices.length === 0) continue;
      const mesh = new InstancedMesh(geometry, materials[key], matrices.length);
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    // --- ground haze plane -------------------------------------------------
    const groundMaterial = new MeshStandardMaterial({
      color: new Color(0x9aa6ae),
      roughness: 1,
      metalness: 0,
    });
    const ground = new Mesh(new BoxGeometry(2600, 4, 2600), groundMaterial);
    ground.position.set(120, -76, 0);
    ground.receiveShadow = false;
    this.group.add(ground);
  }
}
