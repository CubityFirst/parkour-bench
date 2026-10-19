import * as THREE from "three";

export const PALETTE = {
  white: "#eef2ef",
  concrete: "#ced6d5",
  edge: "#b0c3ca",
  red: "#ef3025",
  redDark: "#ad241f",
  dark: "#263e48",
  metal: "#6d858d",
  glass: "#3c728d",
};

export function seeded(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFacade(light = false): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const c = canvas.getContext("2d")!;
  const random = seeded(light ? 46 : 12);
  c.fillStyle = light ? "#d8e5e7" : "#3a697c";
  c.fillRect(0, 0, 512, 1024);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 8; x++) {
      const value = random();
      c.fillStyle = light
        ? `hsl(200, 22%, ${37 + value * 22}%)`
        : `hsl(201, 31%, ${22 + value * 16}%)`;
      c.fillRect(x * 64 + 3, y * 32 + 4, 57, 24);
      c.fillStyle = "rgba(190,226,239,.14)";
      c.fillRect(x * 64 + 4, y * 32 + 5, 55, 2);
      if (value > 0.8) {
        c.fillStyle = "rgba(229,234,223,.35)";
        c.fillRect(x * 64 + 4, y * 32 + 15, 55, 11);
      }
    }
    c.fillStyle = light ? "#d4dfe0" : "#98b5c0";
    c.fillRect(0, y * 32, 512, 3);
    c.fillStyle = "rgba(13,42,54,.35)";
    c.fillRect(0, y * 32 + 31, 512, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function makeConcrete(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#f0f1ec";
  c.fillRect(0, 0, 256, 256);
  const random = seeded(234);
  for (let i = 0; i < 16000; i++) {
    const n = Math.floor(170 + random() * 70);
    c.fillStyle = `rgba(${n},${n + 2},${n + 1},.15)`;
    c.fillRect(random() * 256, random() * 256, 1, 1);
  }
  c.strokeStyle = "rgba(109,131,136,.16)";
  c.lineWidth = 0.7;
  c.strokeRect(0.5, 0.5, 255, 255);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.anisotropy = 8;
  return texture;
}

export class SceneBuilder {
  private batches = new Map<THREE.Material, THREE.Matrix4[]>();
  readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  readonly materials = {
    white: new THREE.MeshStandardMaterial({
      color: PALETTE.white,
      roughness: 0.82,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: makeConcrete(),
      roughness: 0.93,
    }),
    concrete: new THREE.MeshStandardMaterial({
      color: PALETTE.concrete,
      roughness: 0.9,
    }),
    edge: new THREE.MeshStandardMaterial({
      color: PALETTE.edge,
      roughness: 0.7,
    }),
    red: new THREE.MeshStandardMaterial({
      color: PALETTE.red,
      roughness: 0.52,
    }),
    redDark: new THREE.MeshStandardMaterial({
      color: PALETTE.redDark,
      roughness: 0.6,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: PALETTE.dark,
      roughness: 0.75,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: PALETTE.metal,
      roughness: 0.46,
      metalness: 0.4,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: "#b5d2df",
      map: makeFacade(),
      metalness: 0.25,
      roughness: 0.3,
    }),
    glassLight: new THREE.MeshStandardMaterial({
      color: "#eaf5fa",
      map: makeFacade(true),
      metalness: 0.18,
      roughness: 0.38,
    }),
  };

  constructor(readonly scene: THREE.Scene) {}

  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: keyof SceneBuilder["materials"] | THREE.Material = "white",
    rotation = 0,
  ): void {
    const m =
      typeof material === "string" ? this.materials[material] : material;
    if (!this.batches.has(m)) this.batches.set(m, []);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        rotation,
      ),
      new THREE.Vector3(w, h, d),
    );
    this.batches.get(m)!.push(matrix);
  }

  beam(
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius = 0.1,
    material: keyof SceneBuilder["materials"] = "red",
  ): void {
    const direction = b.clone().sub(a);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, direction.length(), 6),
      this.materials[material],
    );
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    mesh.castShadow = true;
    this.scene.add(mesh);
  }

  label(
    text: string,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    color = "#ecf3f2",
    background = "#263f4b",
    rotation = 0,
  ): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = Math.max(128, Math.round((1024 * height) / width));
    const c = canvas.getContext("2d")!;
    c.fillStyle = background;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = color;
    c.font = `700 ${Math.min(canvas.height * 0.54, 160)}px Arial`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width * 0.88);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    this.scene.add(mesh);
    return mesh;
  }

  arrow(x: number, y: number, z: number, size = 1, color = "red"): void {
    const shape = new THREE.Shape();
    shape.moveTo(-0.54, -0.45);
    shape.lineTo(0, 0.15);
    shape.lineTo(0.54, -0.45);
    shape.lineTo(0.54, -0.1);
    shape.lineTo(0, 0.53);
    shape.lineTo(-0.54, -0.1);
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      this.materials[color as keyof SceneBuilder["materials"]],
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.025, z);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
  }

  flush(): void {
    for (const [material, transforms] of this.batches) {
      const mesh = new THREE.InstancedMesh(
        this.boxGeometry,
        material,
        transforms.length,
      );
      transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
    this.batches.clear();
  }
}
