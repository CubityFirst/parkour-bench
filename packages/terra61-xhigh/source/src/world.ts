import * as THREE from 'three';

export interface Solid { min: THREE.Vector3; max: THREE.Vector3; runnable?: boolean; }
export interface Checkpoint { z: number; x: number; y: number; name: string; hint: string; }

export class World {
  readonly scene = new THREE.Scene();
  readonly solids: Solid[] = [];
  readonly checkpoints: Checkpoint[] = [
    { z: 7, x: 0, y: 0, name: 'THE DEPARTURE', hint: 'SHIFT TO SPRINT  /  SPACE TO JUMP' },
    { z: -32, x: 0, y: 0.6, name: 'THE CROSSING', hint: 'KEEP YOUR SPEED THROUGH THE GAPS' },
    { z: -72, x: 0, y: 0.3, name: 'THE FILTER', hint: 'HOLD CTRL OR C TO SLIDE UNDER THE DUCTS' },
    { z: -115, x: -3.7, y: 0.5, name: 'THE EDGE', hint: 'JUMP BESIDE A RED WALL TO WALL-RUN' },
    { z: -154, x: 0, y: 1, name: 'THE SWITCH', hint: 'PRESS E TO VAULT LOW OBSTACLES' },
    { z: -192, x: 0, y: 0.5, name: 'THE HOME STRETCH', hint: 'SPRINT FOR THE FINISH' },
  ];
  private readonly unit = new THREE.BoxGeometry(1, 1, 1);
  private readonly white = new THREE.MeshStandardMaterial({ color: 0xe8efef, roughness: 0.9 });
  private readonly roof = new THREE.MeshStandardMaterial({ color: 0xf7faf8, roughness: 0.92 });
  private readonly grey = new THREE.MeshStandardMaterial({ color: 0x9aaeb3, roughness: 0.85 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x263f4c, roughness: 0.75 });
  private readonly red = new THREE.MeshStandardMaterial({ color: 0xef2e2c, roughness: 0.62 });
  private readonly glass = new THREE.MeshStandardMaterial({ color: 0x54889c, metalness: 0.35, roughness: 0.35 });

  constructor() {
    this.scene.background = new THREE.Color(0x9bd9ef);
    this.scene.fog = new THREE.Fog(0xb8dce7, 95, 310);
    this.scene.add(new THREE.HemisphereLight(0xe8f9ff, 0x80919b, 2.1));
    const sun = new THREE.DirectionalLight(0xfff6e8, 2.3);
    sun.position.set(-40, 75, 30); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55; sun.shadow.camera.near = 1; sun.shadow.camera.far = 180;
    sun.shadow.bias = -0.0003; sun.target.position.set(0, 0, -70);
    this.scene.add(sun, sun.target);

    this.rooftop(0, -8, 22, 30, 0);
    this.rooftop(0, -35, 18, 18, 0.6);
    this.rooftop(0, -57, 19, 20, 0.3);
    this.rooftop(0, -83, 20, 28, 0.3);
    this.rooftop(0, -122, 20, 20, 0.5);
    this.rooftop(0, -145, 18, 18, 1);
    this.rooftop(0, -169, 18, 22, 1);
    this.rooftop(0, -195, 18, 20, 0.5);
    this.rooftop(0, -219, 20, 20, 0.5);
    this.rooftop(0, -245, 24, 24, 0.5);

    // The low crossbars have enough clearance for the sliding capsule only.
    this.duct(-79); this.duct(-87); this.duct(-94);
    this.box(0, 0.75, -14, 3.6, 1.5, 0.8, this.red, true);
    this.box(0, 1.75, -151, 4, 1.5, 0.9, this.red, true);
    this.box(3.5, 1.75, -174, 3, 1.5, 1, this.red, true);
    this.duct(-177, 1);
    // Red runnable wall bridges the long gap, with no floor beneath it.
    this.box(-5.7, 1.3, -104.5, 0.7, 5.2, 20, this.red, true, true);
    this.box(-5.7, 4.05, -104.5, 0.9, 0.25, 20, this.white);
    this.box(-5.05, 2.4, -104.5, 0.08, 0.12, 19, this.white);

    for (const [z, x, y] of [[-21, 0, 0], [-42, 0, 0.6], [-65, 0, 0.3], [-96, -3.9, 0.3], [-130, 0, 0.5], [-153, 0, 1], [-178, 0, 1], [-203, 0, 0.5], [-228, 0, 0.5]] as number[][]) this.arrow(x, y + 0.03, z);
    this.finish();
    this.details();
    this.skyline();
  }

  private box(x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material, collision = false, runnable = false) {
    const mesh = new THREE.Mesh(this.unit, material); mesh.position.set(x, y, z); mesh.scale.set(width, height, depth);
    mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    if (collision) this.solids.push({ min: new THREE.Vector3(x - width / 2, y - height / 2, z - depth / 2), max: new THREE.Vector3(x + width / 2, y + height / 2, z + depth / 2), runnable });
    return mesh;
  }

  private rooftop(x: number, z: number, width: number, depth: number, y: number) {
    this.box(x, y - 7, z, width, 14, depth, this.white, true);
    this.box(x, y - 0.04, z, width + 0.12, 0.08, depth + 0.12, this.roof);
    this.box(x - width / 2 + 0.15, y + 0.12, z, 0.3, 0.24, depth, this.grey);
    this.box(x + width / 2 - 0.15, y + 0.12, z, 0.3, 0.24, depth, this.grey);
    for (let offset = -depth / 2 + 3; offset < depth / 2; offset += 6) {
      this.box(x, y + 0.007, z + offset, width - 0.5, 0.015, 0.025, this.grey);
    }
  }

  private duct(z: number, floor = 0.3) {
    this.box(0, floor + 1.63, z, 8, 0.55, 1.25, this.grey, true);
    this.box(0, floor + 1.93, z, 8.15, 0.08, 1.3, this.red);
    this.box(-4.15, floor + 0.95, z, 0.3, 1.9, 1.4, this.grey, true);
    this.box(4.15, floor + 0.95, z, 0.3, 1.9, 1.4, this.grey, true);
  }

  private arrow(x: number, y: number, z: number) {
    const shape = new THREE.Shape(); shape.moveTo(-0.85, 0.65); shape.lineTo(0, -0.65); shape.lineTo(0.85, 0.65); shape.lineTo(0.48, 0.65); shape.lineTo(0, -0.05); shape.lineTo(-0.48, 0.65); shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.red); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); this.scene.add(mesh);
  }

  private finish() {
    this.box(-4, 3.5, -247, 0.35, 6, 0.35, this.red);
    this.box(4, 3.5, -247, 0.35, 6, 0.35, this.red);
    this.box(0, 6.4, -247, 8.35, 0.35, 0.35, this.red);
    this.box(0, 0.53, -247, 8, 0.06, 1.1, this.red);
    this.box(0, 5.25, -247, 4, 0.75, 0.2, this.red);
  }

  private details() {
    for (const [x, z, y] of [[-7,-3,0],[7,-9,0],[6,-34,0.6],[-6,-55,0.3],[7,-120,0.5],[-6,-145,1],[6,-194,0.5],[-8,-238,0.5]] as number[][]) {
      this.box(x, y + 0.7, z, 2.2, 1.4, 2.1, this.white, true);
      this.box(x, y + 1.43, z, 2.25, 0.08, 2.15, this.grey);
      for (let index = -2; index <= 2; index++) this.box(x + index * 0.32, y + 1.49, z, 0.08, 0.03, 1.6, this.dark);
    }
    // A communications mast frames the opening view.
    this.box(-8, 4, -18, 0.22, 8, 0.22, this.red);
    this.box(-6.6, 4, -18, 0.22, 8, 0.22, this.red);
    for (let y = 1; y < 8; y += 1.7) this.box(-7.3, y, -18, 1.6, 0.16, 0.16, this.red);
    for (const z of [-35, -57, -122, -169, -219]) {
      this.box(8.4, 0.9, z, 0.09, 1.8, 0.09, this.grey);
      this.box(8.4, 1.65, z - 0.6, 0.08, 0.6, 1.2, this.red);
    }
  }

  private skyline() {
    let seed = 1429; const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let side = -1; side <= 1; side += 2) for (let row = 0; row < 3; row++) for (let index = 0; index < 18; index++) {
      const x = side * (26 + row * 20 + random() * 9), z = 30 - index * 18 - random() * 12;
      const height = 18 + random() * 55, width = 9 + random() * 11, depth = 9 + random() * 10;
      this.box(x, -18 + height / 2, z, width, height, depth, random() > 0.42 ? this.glass : this.white);
      if (row === 0) for (let floor = 3; floor < height; floor += 4) this.box(x, -18 + floor, z + depth / 2 + 0.02, width, 0.12, 0.08, this.grey);
    }
  }
}
