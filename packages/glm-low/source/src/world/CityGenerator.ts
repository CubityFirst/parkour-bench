import * as THREE from 'three';
import { COLORS } from '../game/GameState';

/** Instanced distant skyscrapers that suggest a full city. */
export class CityGenerator {
  group = new THREE.Group();

  constructor() {
    this.buildSkyline();
  }

  private buildSkyline(): void {
    const rng = mulberry32(1337);
    const countRows = 5;
    const geometries = new THREE.BoxGeometry(1, 1, 1);
    const matWhite = new THREE.MeshLambertMaterial({ color: 0xdfe3e6 });
    const matGlass = new THREE.MeshLambertMaterial({ color: 0x8fb6c4 });
    const matDark = new THREE.MeshLambertMaterial({ color: 0x5c7078 });
    const matOrange = new THREE.MeshLambertMaterial({ color: COLORS.yellow });

    // A row of buildings encircling the play route, far away in -Z and over a
    // belt on both sides of the route.
    const white: THREE.Matrix4[] = [];
    const glass: THREE.Matrix4[] = [];
    const dark: THREE.Matrix4[] = [];
    const orange: THREE.Matrix4[] = [];

    const addRows = (zBase: number, rows: number, xSpan: number, scaleMin: number, scaleMax: number) => {
      for (let r = 0; r < rows; r++) {
        let x = -xSpan;
        while (x < xSpan) {
          const w = 8 + rng() * 16;
          const d = 8 + rng() * 14;
          const hgt = scaleMin + Math.pow(rng(), 1.7) * scaleMax * (1 - r / (rows + 2));
          const z = zBase + r * (14 + rng() * 12);
          const pick = rng();
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(x + rng() * 4, hgt / 2 - 40, z),
            new THREE.Quaternion(),
            new THREE.Vector3(w, hgt, d)
          );
          if (pick < 0.14) glass.push(m);
          else if (pick < 0.3) dark.push(m);
          else white.push(m);
          // occasional orange accent strip
          if (rng() < 0.18) {
            orange.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(x + rng() * 4, (hgt - 40) * 0.55, z + d / 2 + 0.4),
                new THREE.Quaternion(),
                new THREE.Vector3(w * 0.7, 2.2, 0.6)
              )
            );
          }
          x += w + 2 + rng() * 6;
        }
      }
    };

    addRows(-90, countRows, 340, 24, 110);
    addRows(-260, countRows, 360, 30, 130);

    const makeInstanced = (mats: THREE.Matrix4[], mat: THREE.Material) => {
      if (mats.length === 0) return;
      const im = new THREE.InstancedMesh(geometries, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    };

    makeInstanced(white, matWhite);
    makeInstanced(glass, matGlass);
    makeInstanced(dark, matDark);
    makeInstanced(orange, matOrange);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
