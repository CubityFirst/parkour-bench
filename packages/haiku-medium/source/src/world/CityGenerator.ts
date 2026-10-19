import * as THREE from 'three';

/** Simple seeded RNG so the skyline looks the same on every load. */
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

/**
 * Procedural background: a gradient sky dome, a hazy ground plane far below,
 * and instanced towers and blocks around the route. Nothing here collides.
 */
export class CityGenerator {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(seed = 1337) {
    const rand = mulberry32(seed);
    this.buildSky();
    this.buildGround();
    this.buildTowers(rand);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  private buildSky(): void {
    // Gradient dome: deep blue at the zenith, pale haze at the horizon.
    const geo = new THREE.SphereGeometry(950, 32, 16);
    const colors: number[] = [];
    const top = new THREE.Color('#3f9be0');
    const horizon = new THREE.Color('#d8efff');
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp(y / 950, 0, 1);
      const c = horizon.clone().lerp(top, Math.pow(t, 0.6));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    this.geometries.push(geo);
    this.materials.push(mat);
    this.group.add(new THREE.Mesh(geo, mat));
  }

  private buildGround(): void {
    // A large haze-coloured street far below the rooftops. Fog blends it into the sky.
    const geo = new THREE.PlaneGeometry(2000, 2000);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#b9c3cc', roughness: 1 });
    this.geometries.push(geo);
    this.materials.push(mat);
    const plane = new THREE.Mesh(geo, mat);
    plane.position.y = -60;
    plane.receiveShadow = false;
    this.group.add(plane);
  }

  private buildTowers(rand: () => number): void {
    // Two instanced sets: reflective glass towers and white blocks. Both are placed
    // in a ring that stays clear of the route (|x| < 40 is left open near the route).
    const glassGeo = new THREE.BoxGeometry(1, 1, 1);
    const whiteGeo = new THREE.BoxGeometry(1, 1, 1);
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#8fc3e0',
      roughness: 0.15,
      metalness: 0.45,
      emissive: '#0c1a26',
      emissiveIntensity: 0.25,
    });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#e9edf1', roughness: 0.9 });
    this.geometries.push(glassGeo, whiteGeo);
    this.materials.push(glassMat, whiteMat);

    const glassCount = 260;
    const whiteCount = 180;
    const glass = new THREE.InstancedMesh(glassGeo, glassMat, glassCount);
    const white = new THREE.InstancedMesh(whiteGeo, whiteMat, whiteCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    const place = (mesh: THREE.InstancedMesh, index: number, minH: number, maxH: number, minW: number, maxW: number) => {
      // Ring placement: x in ±[40, 260], z in [-260, 60], skipping the route corridor.
      let x = 0;
      let z = 0;
      do {
        x = (rand() * 2 - 1) * 260;
        z = -260 + rand() * 320;
      } while (Math.abs(x) < 40 && z < 20 && z > -240);
      const w = minW + rand() * (maxW - minW);
      const h = minH + rand() * (maxH - minH);
      s.set(w, h, w * (0.7 + rand() * 0.6));
      p.set(x, h / 2 - 60, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(index, m);
    };

    for (let i = 0; i < glassCount; i++) place(glass, i, 30, 150, 14, 34);
    for (let i = 0; i < whiteCount; i++) place(white, i, 10, 60, 12, 28);

    glass.instanceMatrix.needsUpdate = true;
    white.instanceMatrix.needsUpdate = true;
    this.group.add(glass, white);

    // Distant skyline band along the far end of the route, for depth.
    const farGeo = new THREE.BoxGeometry(1, 1, 1);
    const farMat = new THREE.MeshStandardMaterial({ color: '#c5d9e8', roughness: 0.9, transparent: true, opacity: 0.85 });
    this.geometries.push(farGeo);
    this.materials.push(farMat);
    const far = new THREE.InstancedMesh(farGeo, farMat, 90);
    for (let i = 0; i < 90; i++) {
      const x = -420 + i * 9.5 + rand() * 4;
      const h = 60 + rand() * 180;
      s.set(10 + rand() * 12, h, 10 + rand() * 12);
      p.set(x, h / 2 - 60, -380 - rand() * 60);
      m.compose(p, q, s);
      far.setMatrixAt(i, m);
    }
    far.instanceMatrix.needsUpdate = true;
    this.group.add(far);
  }
}
