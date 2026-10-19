import * as THREE from 'three';

type Block = { position: THREE.Vector3; scale: THREE.Vector3; rotation: number };

/** Deterministic architectural backdrop. Thousands of façade elements share a few draw calls. */
export class CityGenerator {
  readonly group = new THREE.Group();
  readonly reflections = this.reflectionTexture();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly buckets = new Map<THREE.Material, Block[]>();
  private readonly materials: THREE.Material[] = [];
  private seed = 1847;

  constructor(scene: THREE.Scene) {
    const concrete = this.material(0xe0e9e9, .86);
    const white = this.material(0xf6f5ed, .74);
    const glass = this.glazing(0x759fac);
    const darkGlass = this.glazing(0x477589);
    const lightGlass = this.glazing(0xa1c5cc);
    const deep = this.material(0x3d5865, .76);
    const red = this.material(0xe94730, .52);
    const street = this.material(0x6b8793, 1);

    this.box(street, 0, -1.5, -340, 1500, 2, 1900);
    // The city follows the route's long avenue. Near buildings stay below the skyline.
    for (const side of [-1, 1]) {
      for (let row = 0; row < 4; row++) {
        for (let index = 0; index < 13; index++) {
          const x = side * (36 + row * 48 + this.random() * 12);
          const z = 50 - index * 65 - this.random() * 22;
          const w = 19 + this.random() * (row ? 17 : 8);
          const d = 23 + this.random() * 21;
          const height = row === 0 ? 20 + this.random() * 30 : 38 + this.random() * (52 + row * 19);
          const skin = this.random() > .62 ? darkGlass : glass;
          this.building(x, z, w, d, height, this.random() > .5 ? white : concrete, skin, deep);
          if (row === 0 && index % 3 === 0) {
            this.box(red, x, height - 4.3, z + d / 2 + .11, w * .7, 1.3, .16);
            this.box(concrete, x + w * .19, height + 1, z, w * .3, 2, d * .28);
          }
          if (row > 1 && index % 4 === 0) {
            const crown = height * .13;
            this.box(lightGlass, x, height + crown / 2, z, w * .61, crown, d * .65);
            this.box(white, x + w * .24, height + crown / 2, z, .6, crown + .3, d * .65);
            this.box(white, x, height + crown + .25, z, w * .63, .5, d * .67);
            this.box(deep, x, height + crown + 6, z, .2, 12, .2);
          }
        }
      }
    }

    // Signature towers frame the introductory view without obscuring the playable route.
    this.building(61, -104, 25, 30, 106, white, darkGlass, deep, true);
    this.building(-87, -159, 30, 35, 142, concrete, lightGlass, deep, true);
    this.box(white, -94, 86, -159, 1.4, 151, 36);
    this.box(white, 70, 62, -104, 1.2, 122, 31);
    this.building(121, -251, 36, 39, 170, white, glass, deep, true);
    for (let i = 0; i < 13; i++) {
      const x = (i - 6) * 37;
      const height = 80 + this.random() * 135;
      this.building(x, -835 - this.random() * 80, 21 + this.random() * 13, 28, height, concrete, lightGlass, deep, true);
    }

    // White service bridges and distant gantries give the massing a coherent civic scale.
    for (const z of [-112, -390, -612]) {
      this.box(white, 0, 17, z, 88, 2.4, 5);
      this.box(glass, 0, 19, z, 88, 2.1, 4.3);
      this.box(white, 0, 20.2, z, 88, .4, 5.2);
    }

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    for (const [material, blocks] of this.buckets) {
      const mesh = new THREE.InstancedMesh(this.geometry, material, blocks.length);
      blocks.forEach((block, index) => {
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), block.rotation);
        matrix.compose(block.position, quaternion, block.scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    scene.add(this.group);
    this.buckets.clear();
  }

  private material(color: number, roughness: number, metalness = 0) {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.push(material);
    return material;
  }

  private glazing(color: number) {
    const material = this.material(color, .2, .5);
    material.envMap = this.reflections;
    material.envMapIntensity = 1.35;
    return material;
  }

  /** A tiny procedural reflection environment adds the sky and opposite skyline to the glazing. */
  private reflectionTexture() {
    const images: HTMLCanvasElement[] = [];
    for (let face = 0; face < 6; face++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, face === 3 ? '#617d88' : '#66b4d4');
      gradient.addColorStop(.57, face === 3 ? '#617d88' : '#c4e2eb');
      gradient.addColorStop(1, face === 2 ? '#b5dce9' : '#527b8b');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 256, 256);
      if (face !== 2 && face !== 3) {
        for (let index = 0; index < 17; index++) {
          const x = index * 18 - 12;
          const height = 24 + ((index * 37 + face * 19) % 74);
          context.fillStyle = index % 3 === 0 ? '#7ca0ae' : '#547c8d';
          context.fillRect(x, 256 - height, 14, height);
          context.fillStyle = '#aec8d0';
          for (let y = 260 - height; y < 256; y += 6) context.fillRect(x, y, 14, 1);
        }
      }
      if (face !== 3) {
        for (let cloud = 0; cloud < 4; cloud++) {
          const x = 25 + cloud * 73;
          const y = 45 + (cloud % 2) * 37;
          const cloudGradient = context.createRadialGradient(x, y, 0, x, y, 45);
          cloudGradient.addColorStop(0, 'rgba(255,255,255,.7)');
          cloudGradient.addColorStop(1, 'rgba(255,255,255,0)');
          context.fillStyle = cloudGradient;
          context.fillRect(x - 45, y - 45, 90, 90);
        }
      }
      images.push(canvas);
    }
    const texture = new THREE.CubeTexture(images);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private box(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rotation = 0) {
    const blocks = this.buckets.get(material) ?? [];
    blocks.push({ position: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(w, h, d), rotation });
    this.buckets.set(material, blocks);
  }

  private building(x: number, z: number, w: number, d: number, h: number, shell: THREE.Material, glass: THREE.Material, dark: THREE.Material, tower = false) {
    this.box(shell, x, h / 2, z, w, h, d);
    const floorHeight = tower ? 3.7 : 3.15;
    const stories = Math.floor((h - 3) / floorHeight);
    for (let floor = 1; floor <= stories; floor++) {
      const y = floor * floorHeight;
      const bandHeight = floorHeight * (tower ? .88 : .73);
      this.box(glass, x, y, z + d / 2 + .025, w - .7, bandHeight, .08);
      this.box(glass, x, y, z - d / 2 - .025, w - .7, bandHeight, .08);
      this.box(glass, x + w / 2 + .025, y, z, .08, bandHeight, d - .7);
      this.box(glass, x - w / 2 - .025, y, z, .08, bandHeight, d - .7);
    }
    const spacing = tower ? 2.7 : 4.2;
    for (let offset = -w / 2 + spacing; offset < w / 2; offset += spacing) {
      this.box(shell, x + offset, h / 2, z + d / 2 + .09, .15, h - .4, .16);
      this.box(shell, x + offset, h / 2, z - d / 2 - .09, .15, h - .4, .16);
    }
    for (let offset = -d / 2 + spacing; offset < d / 2; offset += spacing) {
      this.box(shell, x + w / 2 + .09, h / 2, z + offset, .16, h - .4, .15);
      this.box(shell, x - w / 2 - .09, h / 2, z + offset, .16, h - .4, .15);
    }
    this.box(shell, x, h + .15, z, w + .5, .3, d + .5);
    this.box(dark, x - w * .2, h + .65, z, w * .23, 1, d * .28);
    this.box(shell, x - w * .2, h + 1.2, z, w * .25, .15, d * .3);
    this.box(shell, x + w * .22, h + 1.6, z - d * .2, w * .18, 3, d * .19);
    this.box(dark, x + w * .22, h + 3.2, z - d * .2, w * .2, .2, d * .21);
    if (tower) {
      this.box(shell, x, h * .32, z, w + .4, .7, d + .4);
      this.box(shell, x, h * .67, z, w + .4, .7, d + .4);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.geometry.dispose();
    this.reflections.dispose();
    this.materials.forEach(material => material.dispose());
  }
}
