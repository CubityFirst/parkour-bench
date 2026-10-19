import * as THREE from "three";

function texture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

export function createMaterials() {
  const concrete = texture(256, 256, (c) => {
    c.fillStyle = "#e4e7e5";
    c.fillRect(0, 0, 256, 256);
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 15000; i++) {
      const v = 150 + Math.floor(rand() * 80);
      c.fillStyle = `rgba(${v},${v},${v},.10)`;
      c.fillRect(rand() * 256, rand() * 256, 1, 1);
    }
    c.strokeStyle = "#c7cfce";
    c.lineWidth = 1;
    c.strokeRect(0, 0, 256, 256);
  });
  concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
  concrete.repeat.set(5, 8);
  const facade = texture(512, 1024, (c) => {
    c.fillStyle = "#568197";
    c.fillRect(0, 0, 512, 1024);
    for (let y = 0; y < 1024; y += 40)
      for (let x = 0; x < 512; x += 48) {
        const v = Math.sin(x * 17 + y * 9) * 0.5 + 0.5;
        c.fillStyle = `rgba(182,217,231,${0.08 + v * 0.19})`;
        c.fillRect(x + 2, y + 3, 43, 32);
        c.fillStyle = "rgba(15,49,64,.18)";
        c.fillRect(x + 2, y + 30, 43, 5);
      }
    const g = c.createLinearGradient(0, 0, 512, 1024);
    g.addColorStop(0, "rgba(235,250,255,.30)");
    g.addColorStop(0.45, "rgba(49,99,127,.08)");
    g.addColorStop(0.5, "rgba(226,246,255,.18)");
    g.addColorStop(1, "rgba(24,71,94,.18)");
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 1024);
    c.fillStyle = "#c5d4da";
    for (let y = 0; y < 1024; y += 40) c.fillRect(0, y, 512, 3);
    c.fillStyle = "rgba(205,227,233,.6)";
    for (let x = 0; x < 512; x += 48) c.fillRect(x, 0, 2, 1024);
  });
  return {
    white: new THREE.MeshStandardMaterial({ color: 0xeef0eb, roughness: 0.82 }),
    concrete: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: concrete,
      roughness: 0.94,
    }),
    red: new THREE.MeshStandardMaterial({
      color: 0xf03221,
      roughness: 0.64,
      metalness: 0.08,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x233d4b,
      roughness: 0.64,
      metalness: 0.25,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x8fa5ac,
      roughness: 0.5,
      metalness: 0.5,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x9bc7d8,
      map: facade,
      roughness: 0.28,
      metalness: 0.22,
    }),
    blue: new THREE.MeshStandardMaterial({
      color: 0x56839b,
      map: facade,
      roughness: 0.42,
      metalness: 0.2,
    }),
    orange: new THREE.MeshStandardMaterial({ color: 0xf0b13f, roughness: 0.8 }),
    light: new THREE.MeshBasicMaterial({ color: 0xffd1bd }),
  };
}
export type Materials = ReturnType<typeof createMaterials>;

export class Architecture {
  private batches = new Map<THREE.Material, THREE.Matrix4[]>();
  private dummy = new THREE.Object3D();
  constructor(private scene: THREE.Scene) {}
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    rotation = 0,
  ) {
    this.dummy.position.set(x, y, z);
    this.dummy.scale.set(w, h, d);
    this.dummy.rotation.set(0, rotation, 0);
    this.dummy.updateMatrix();
    if (!this.batches.has(material)) this.batches.set(material, []);
    this.batches.get(material)!.push(this.dummy.matrix.clone());
  }
  finish() {
    const cube = new THREE.BoxGeometry(1, 1, 1);
    for (const [material, matrices] of this.batches) {
      const mesh = new THREE.InstancedMesh(cube, material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
  }
}

export function labelTexture(text: string, subtitle = "", red = false) {
  return texture(1024, 512, (c) => {
    c.fillStyle = red ? "#e63727" : "#eff2ec";
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = red ? "#fff4eb" : "#263e4b";
    c.font = "900 190px Arial";
    c.fillText(text, 55, 270);
    c.font = "500 34px monospace";
    c.fillText(subtitle, 64, 370);
    c.fillRect(65, 420, 150, 8);
  });
}
