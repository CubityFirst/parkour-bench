import {
  Box3, BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide,
  Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry,
  RepeatWrapping, Scene, SRGBColorSpace, Vector3,
} from 'three';
import { CollisionWorld } from './CollisionWorld';
import { CityGenerator } from './CityGenerator';

type Checkpoint = { position: Vector3; section: number; title: string; hint: string };
type BoxItem = { position: Vector3; scale: Vector3 };

/** An authored course, measured against a 12 m/s sprint and a 9.6 m jump. */
export class Level {
  world = new CollisionWorld();
  start = new Vector3(0, 0.05, 12);
  startYaw = 0;
  length = 706;
  finish = new Box3(new Vector3(-7, -0.5, -700), new Vector3(7, 5, -691));
  checkpoints: Checkpoint[] = [];

  private scene: Scene;
  private boxGeometry = new BoxGeometry(1, 1, 1);
  private white = new MeshStandardMaterial({ color: '#edf1eb', roughness: 0.86 });
  private pale = new MeshStandardMaterial({ color: '#d1dce0', roughness: 0.81 });
  private red = new MeshStandardMaterial({ color: '#f32c29', roughness: 0.67, metalness: 0.04 });
  private dark = new MeshStandardMaterial({ color: '#365260', roughness: 0.78 });
  private metal = new MeshStandardMaterial({ color: '#9aafb5', roughness: 0.56, metalness: 0.42 });
  private roof: MeshStandardMaterial;
  private facade: MeshStandardMaterial;
  private detailBatches = new Map<MeshStandardMaterial, BoxItem[]>();
  private flags: { mesh: Mesh; phase: number }[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
    this.roof = this.makeRoofMaterial();
    this.facade = this.makeFacadeMaterial();
    new CityGenerator(scene);
    this.createCourse();
    this.flushDetails();
  }

  update(time: number) {
    for (const flag of this.flags) {
      flag.mesh.rotation.y = Math.sin(time * 1.9 + flag.phase) * 0.1;
      flag.mesh.rotation.z = Math.sin(time * 2.5 + flag.phase) * 0.06;
    }
  }

  private makeRoofMaterial() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ecf0ed'; c.fillRect(0, 0, 512, 512);
    let seed = 921;
    for (let i = 0; i < 14000; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = seed % 512;
      seed = (seed * 16807) % 2147483647;
      const y = seed % 512;
      c.fillStyle = i % 3 ? 'rgba(74,103,112,.025)' : 'rgba(255,255,255,.24)';
      c.fillRect(x, y, 1.4, 1.4);
    }
    c.strokeStyle = 'rgba(120,145,150,.2)'; c.lineWidth = 1.2;
    c.strokeRect(1, 1, 510, 510);
    c.beginPath(); c.moveTo(256, 0); c.lineTo(256, 512); c.stroke();
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping; map.repeat.set(3, 8); map.anisotropy = 8;
    return new MeshStandardMaterial({ map, color: '#ffffff', roughness: 0.95 });
  }

  private makeFacadeMaterial() {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1024;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#5d8eaa'; c.fillRect(0, 0, 256, 1024);
    const gradient = c.createLinearGradient(0, 0, 256, 1024);
    gradient.addColorStop(0, 'rgba(236,248,250,.5)'); gradient.addColorStop(1, 'rgba(6,49,78,.42)');
    c.fillStyle = gradient; c.fillRect(0, 0, 256, 1024);
    for (let y = 0; y < 1024; y += 32) {
      c.fillStyle = '#c5d6d9'; c.fillRect(0, y, 256, 5);
      c.fillStyle = 'rgba(16,42,61,.28)'; c.fillRect(0, y + 5, 256, 3);
    }
    c.fillStyle = '#b2c7ce';
    for (let x = 0; x < 256; x += 25.6) c.fillRect(x, 0, 1.8, 1024);
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; map.anisotropy = 8;
    return new MeshStandardMaterial({ map, color: '#c8e2eb', roughness: 0.5, metalness: 0.12 });
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, material: MeshStandardMaterial, collision?: 'solid' | 'vault' | 'wallrun') {
    const mesh = new Mesh(this.boxGeometry, material);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (collision) this.world.addBox(new Vector3(x, y, z), new Vector3(w, h, d), collision);
    return mesh;
  }

  private detail(x: number, y: number, z: number, w: number, h: number, d: number, material = this.pale) {
    if (!this.detailBatches.has(material)) this.detailBatches.set(material, []);
    this.detailBatches.get(material)!.push({ position: new Vector3(x, y, z), scale: new Vector3(w, h, d) });
  }

  private flushDetails() {
    const transform = new Object3D();
    for (const [material, items] of this.detailBatches) {
      const mesh = new InstancedMesh(this.boxGeometry, material, items.length);
      items.forEach((item, i) => {
        transform.position.copy(item.position); transform.scale.copy(item.scale); transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
      });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
  }

  private rooftop(front: number, back: number, width: number, index: number) {
    const elevation = index === 2 ? 0.45 : index === 3 ? -0.3 : 0;
    const childStart = this.scene.children.length;
    const colliderStart = this.world.colliders.length;
    const batchStarts = new Map([...this.detailBatches].map(([material, items]) => [material, items.length]));
    const length = front - back;
    const center = (front + back) / 2;
    const body = new Mesh(this.boxGeometry, this.facade);
    body.position.set(0, -46, center); body.scale.set(width, 90, length); body.receiveShadow = true;
    this.scene.add(body);
    this.box(0, -0.6, center, width + 0.35, 1.2, length, this.roof, 'solid');
    this.detail(0, -1.2, center, width + 0.7, 0.28, length + 0.2, this.white);
    // Low side parapets leave the jumping edges completely open.
    this.box(-width / 2, 0.19, center, 0.3, 0.38, length, this.white, 'solid');
    this.box(width / 2, 0.19, center, 0.3, 0.38, length, this.white, 'solid');
    this.detail(-width / 2, 0.4, center, 0.48, 0.06, length, this.metal);
    this.detail(width / 2, 0.4, center, 0.48, 0.06, length, this.metal);
    for (let z = front - 9; z > back + 7; z -= 13) {
      this.detail(-width / 2 + 0.6, 0.02, z, 0.12, 0.025, 4, this.pale);
      this.detail(width / 2 - 0.6, 0.02, z, 0.12, 0.025, 4, this.pale);
    }
    if (width > 15) {
      this.vent(-width / 2 + 2.4, center + 3, 2.2, 1.2, 3.2);
      if (index % 2 === 0) this.vent(width / 2 - 2.5, center - 8, 2.5, 1.0, 2.8);
    }
    if (index > 0) this.arrow(0, front - 9, 2.7);
    if (back > -690) {
      this.takeoff(back + 1.7);
      this.arrow(0, back + 9, 2.5);
    }
    if (elevation !== 0) {
      for (let i = childStart; i < this.scene.children.length; i++) this.scene.children[i].position.y += elevation;
      const offset = new Vector3(0, elevation, 0);
      for (let i = colliderStart; i < this.world.colliders.length; i++) this.world.colliders[i].box.translate(offset);
      for (const [material, items] of this.detailBatches) {
        for (let i = batchStarts.get(material) ?? 0; i < items.length; i++) items[i].position.y += elevation;
      }
    }
  }

  private createCourse() {
    const roofs: [number, number, number][] = [
      [24, -66, 28], [-72, -111, 18], [-117, -150, 16], [-156, -198, 18],
      [-204, -293, 22], [-299, -347, 17], [-365, -402, 17], [-408, -471, 20],
      [-477, -508, 17], [-525, -565, 18], [-571, -610, 19], [-617, -653, 16], [-659, -706, 24],
    ];
    roofs.forEach(([front, back, width], i) => this.rooftop(front, back, width, i));

    this.checkpoint(0, 12, 0, 'FIRST LIGHT', 'WASD to move · Hold SHIFT to sprint');
    this.checkpoint(0, -79, 1, 'OPEN AIR', 'Hold SHIFT + SPACE to clear the gaps');
    this.checkpoint(0, -211, 2, 'LOW PROFILE', 'Sprint, then hold C / CTRL beneath the red ducts');
    this.checkpoint(0, -306, 3, 'SIDE EFFECT', 'Jump beside the red wall and keep sprinting');
    this.checkpoint(0, -415, 4, 'FIND YOUR FLOW', 'Chain vaults, slides and a left wall run');
    this.checkpoint(0, -578, 5, 'HOME STRETCH', 'Keep your speed · The red gate is the finish');

    // First roof: every mechanic has generous run-up and recovery space.
    this.groundLabel(-4.2, 4, 6.5, 4.4, '01', 'FIRST LIGHT');
    this.arrow(0, -4, 3.2);
    this.vault(0, -15, 5.7);
    this.instructionSign(5.6, -14, '01 / OVER', 'E  /  VAULT');
    this.slideGate(-39, 6.5);
    this.instructionSign(5.4, -36, '02 / UNDER', 'C  /  SLIDE');
    this.instructionSign(5.3, -59, '03 / ACROSS', 'SHIFT + SPACE');
    this.utilityRoom(-9.3, -16);
    this.scaffold(8.6, -9);
    this.vent(8.7, -35, 3.4, 1.3, 8, true);
    this.vent(-9.4, 7, 2.7, 1.1, 3.8);
    this.floorStrip(0, 1.8, 8, 0.12, this.red);
    this.labelPlane(0, 0.025, 8, 5.5, 1.1, 'START / CITY RUN', '#566b75', true);
    this.arrow(0, -25, 2.6);
    this.flag(11, -55, 5.7);
    this.flag(-11, -61, 4.5);

    this.groundLabel(-4.5, -88, 4.7, 3.8, '02', 'OPEN AIR');
    this.instructionSign(5.3, -101, 'KEEP YOUR SPEED', 'SHIFT + SPACE');
    this.flag(6.5, -145, 4.2, 0.45);

    this.groundLabel(-5.4, -219, 5.1, 4, '03', 'LOW PROFILE');
    this.slideGate(-229, 6.5);
    this.slideGate(-253, 6.5);
    this.slideGate(-276, 6.5);
    this.vent(-6.8, -248, 2.1, 1.4, 31);
    this.vent(6.8, -256, 2.1, 1.4, 36);
    this.arrow(0, -241, 2.4);
    this.arrow(0, -266, 2.4);

    this.groundLabel(-4.4, -314, 4.5, 3.7, '04', 'SIDE EFFECT');
    this.wallRun(-338, -374, 1);
    this.instructionSign(-4.3, -334, 'TRUST THE WALL', 'SPRINT + JUMP');
    this.floorStrip(0, -339, 1.25, 6.5, this.red);
    this.arrow(0, -331, 2.5);
    this.arrow(0, -344, 1.5);

    this.groundLabel(-5, -424, 4.6, 3.5, '05', 'FIND YOUR FLOW');
    this.vault(0, -438, 5.4);
    this.slideGate(-455, 6.5);
    this.vault(0, -490, 5.4);
    this.wallRun(-500, -534, -1);
    this.instructionSign(4.5, -500, 'GO LEFT', 'JUMP BESIDE RED');
    this.arrow(0, -505, 1.5);
    this.slideGate(-548, 6.5);
    this.arrow(0, -529, 2.5);

    this.groundLabel(-5, -589, 4.6, 3.5, '06', 'HOME STRETCH');
    this.flag(7, -604, 5.5);
    this.flag(-6.2, -648, 5.5);
    // An optional service bridge offers a precise alternative to the final jump.
    this.box(5, -0.15, -656, 1.6, 0.3, 6.4, this.white, 'solid');
    this.detail(4.24, 0.025, -656, 0.08, 0.05, 6.4, this.red);
    this.detail(5.76, 0.025, -656, 0.08, 0.05, 6.4, this.red);
    this.detail(5, -0.36, -656, 0.8, 0.22, 6.4, this.red);
    for (let z = -653.2; z >= -658.8; z -= 0.8) this.detail(5, 0.015, z, 1.45, 0.025, 0.05, this.metal);
    this.finishGate();
  }

  private checkpoint(x: number, z: number, section: number, title: string, hint: string) {
    this.checkpoints.push({ position: new Vector3(x, 0.06, z), section, title, hint });
    if (section === 0) return;
    this.floorStrip(0, z + 1.4, 7, 0.12, this.red);
    this.labelPlane(4.7, 1.8, z, 2.4, 1.2, `0${section + 1}  /  ${title}`, '#f02e29');
    this.detail(4.7, 0.85, z, 0.06, 1.7, 0.06, this.metal);
  }

  private floorStrip(x: number, z: number, w: number, d: number, material: MeshStandardMaterial) {
    this.detail(x, 0.016, z, w, 0.025, d, material);
  }

  private takeoff(z: number) {
    this.floorStrip(0, z, 5.5, 0.24, this.red);
    this.floorStrip(-2.65, z + 0.8, 0.14, 1.8, this.red);
    this.floorStrip(2.65, z + 0.8, 0.14, 1.8, this.red);
    this.labelPlane(0, 0.027, z + 1, 2.6, 0.6, 'JUMP  ↑', '#e62e2b', true);
  }

  private arrow(x: number, z: number, size: number) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ed302d';
    c.beginPath(); c.moveTo(64, 12); c.lineTo(108, 61); c.lineTo(85, 61); c.lineTo(85, 111); c.lineTo(43, 111); c.lineTo(43, 61); c.lineTo(20, 61); c.closePath(); c.fill();
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const plane = new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
    plane.rotation.x = -Math.PI / 2; plane.position.set(x, 0.03, z); this.scene.add(plane);
  }

  private groundLabel(x: number, z: number, w: number, h: number, number: string, title: string) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#c0cbcd'; c.font = 'bold 290px Arial'; c.fillText(number, 4, 277);
    c.fillStyle = '#75888f'; c.font = 'bold 22px Arial'; c.fillText(title, 15, 330);
    c.fillStyle = '#e43a31'; c.fillRect(15, 354, 84, 5);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 0.03, z); this.scene.add(mesh);
  }

  private labelPlane(x: number, y: number, z: number, w: number, h: number, text: string, color: string, floor = false) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const c = canvas.getContext('2d')!;
    c.fillStyle = floor ? 'rgba(255,255,255,0)' : color; c.fillRect(0, 0, 1024, 256);
    c.fillStyle = floor ? color : '#fff'; c.font = 'bold 55px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 512, 132, 950);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const material = new MeshStandardMaterial({ map: texture, transparent: floor, roughness: 0.85, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    const mesh = new Mesh(new PlaneGeometry(w, h), material); mesh.position.set(x, y, z);
    if (floor) mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh); return mesh;
  }

  private vault(x: number, z: number, width: number) {
    this.box(x, 0.51, z, width, 1.02, 0.9, this.red, 'vault');
    this.detail(x, 1.03, z, width + 0.05, 0.065, 1.03, this.red);
    this.detail(x - width / 2 + 0.18, 0.51, z + 0.46, 0.05, 0.7, 0.015, this.white);
    this.detail(x + width / 2 - 0.18, 0.51, z + 0.46, 0.05, 0.7, 0.015, this.white);
    this.labelPlane(x, 0.55, z + 0.46, 2.4, 0.4, '↑   VAULT   ↑', '#ed3029');
  }

  private slideGate(z: number, width: number) {
    // The bottom is 1.08 m: standing players stop, a 0.8 m slide clears it.
    this.box(0, 1.73, z, width, 1.3, 2.4, this.red, 'solid');
    this.box(-width / 2 - 0.15, 1.12, z, 0.3, 2.24, 2.4, this.metal, 'solid');
    this.box(width / 2 + 0.15, 1.12, z, 0.3, 2.24, 2.4, this.metal, 'solid');
    this.labelPlane(0, 1.74, z + 1.21, 3.4, 0.65, '↓   STAY LOW   ↓', '#e92926');
    for (let x = -width / 2 + 0.3; x < width / 2; x += 0.35) this.detail(x, 1.7, z + 1.215, 0.035, 0.75, 0.025, this.dark);
    this.floorStrip(-2.25, z + 2.5, 0.1, 5, this.red);
    this.floorStrip(2.25, z + 2.5, 0.1, 5, this.red);
  }

  private wallRun(front: number, back: number, side: number) {
    const center = (front + back) / 2;
    this.box(side * 1.1, 2.2, center, 0.56, 4.4, front - back, this.red, 'wallrun');
    this.detail(side * 1.1, 4.45, center, 0.68, 0.1, front - back, this.metal);
    this.detail(side * 0.808, 0.9, center, 0.025, 0.12, front - back - 1, this.white);
    this.detail(side * 0.808, 3.5, center, 0.025, 0.05, front - back - 1, this.white);
    for (let z = front - 1; z > back; z -= 4) this.detail(side * 0.808, 2.2, z, 0.025, 3.7, 0.04, this.dark);
    this.flag(side * 1.1, back + 2, 6.5);
  }

  private instructionSign(x: number, z: number, heading: string, detail: string) {
    this.box(x, 0.85, z, 0.065, 1.7, 0.065, this.metal);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#f1f3ed'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#ef322c'; c.fillRect(0, 0, 12, 256); c.fillRect(35, 42, 60, 6);
    c.fillStyle = '#253f4d'; c.font = 'bold 33px Arial'; c.fillText(heading, 36, 113);
    c.fillStyle = '#e12f29'; c.font = 'bold 31px Arial'; c.fillText(detail, 36, 181);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const sign = new Mesh(new PlaneGeometry(2.35, 1.18), new MeshStandardMaterial({ map: texture, roughness: 1, side: DoubleSide }));
    sign.position.set(x, 1.75, z); this.scene.add(sign);
  }

  private vent(x: number, z: number, w: number, h: number, d: number, red = false) {
    this.box(x, h / 2 + 0.18, z, w, h, d, red ? this.red : this.pale, 'solid');
    this.detail(x, 0.12, z, w + 0.25, 0.24, d + 0.25, this.dark);
    this.detail(x, h + 0.21, z, w + 0.16, 0.08, d + 0.12, this.white);
    for (let i = -w / 2 + 0.15; i < w / 2; i += 0.17) this.detail(x + i, h * 0.55 + 0.18, z + d / 2 + 0.012, 0.055, h * 0.65, 0.025, this.dark);
    for (let pz = z - d / 2 + 0.4; pz < z + d / 2 - 0.1; pz += 0.65) this.detail(x, h + 0.265, pz, w * 0.72, 0.035, 0.055, this.metal);
  }

  private utilityRoom(x: number, z: number) {
    this.box(x, 2.2, z, 5.6, 4.4, 8.5, this.white, 'solid');
    this.detail(x, 4.45, z, 6.05, 0.23, 9, this.pale);
    this.box(x + 1, 1.35, z + 4.28, 1.45, 2.7, 0.07, this.red);
    this.detail(x + 1.49, 1.3, z + 4.34, 0.13, 0.06, 0.06, this.metal);
    this.labelPlane(x - 1.4, 2.2, z + 4.31, 1.7, 0.55, 'ROOF ACCESS', '#31586c');
    for (let i = 0; i < 6; i++) this.detail(x - 1.4, 1.6 - i * 0.1, z + 4.32, 1.5, 0.04, 0.025, this.metal);
    this.detail(x + 2.3, 2.3, z + 4.38, 0.06, 4.1, 0.06, this.metal);
    this.vent(x - 0.5, z - 0.5, 3.2, 0.8, 4);
  }

  private scaffold(x: number, z: number) {
    this.box(x, 0.12, z, 3.2, 0.24, 3.2, this.red, 'solid');
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      this.box(x + dx, 6.9, z + dz, 0.17, 13.8, 0.17, this.red, 'solid');
      this.detail(x + dx, 0.24, z + dz, 0.42, 0.2, 0.42, this.dark);
    }
    for (let y = 2; y <= 14; y += 2.5) {
      this.detail(x, y, z - 1, 2.15, 0.12, 0.15, this.red);
      this.detail(x, y, z + 1, 2.15, 0.12, 0.15, this.red);
      this.detail(x - 1, y, z, 0.15, 0.12, 2.15, this.red);
      this.detail(x + 1, y, z, 0.15, 0.12, 2.15, this.red);
    }
    this.box(x, 3, z + 1.12, 1.75, 2.6, 0.28, this.red);
    for (let i = 0; i < 11; i++) this.detail(x, 3.85 - i * 0.17, z + 1.27, 1.1, 0.045, 0.025, this.dark);
    this.labelPlane(x, 5, z + 1.12, 1.6, 0.45, 'STRIDE', '#ed3029');
    this.flag(x, z, 15.5);
    // A thin cable links the roof silhouette to the city below without blocking play.
    const from = new Vector3(x + 1, 13.7, z - 1);
    const to = new Vector3(10, 5, -195);
    const direction = new Vector3().subVectors(to, from);
    const cable = new Mesh(new CylinderGeometry(0.025, 0.025, direction.length(), 5), this.red);
    cable.position.copy(from).add(to).multiplyScalar(0.5);
    cable.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()); this.scene.add(cable);
  }

  private flag(x: number, z: number, height: number, baseY = 0) {
    const pole = new Mesh(new CylinderGeometry(0.035, 0.045, height, 6), this.metal);
    pole.position.set(x, baseY + height / 2, z); this.scene.add(pole);
    const group = new Group(); group.position.set(x, baseY + height - 1.1, z);
    const mesh = new Mesh(new PlaneGeometry(1.9, 0.8, 4, 1), new MeshStandardMaterial({ color: '#f03727', side: DoubleSide, roughness: 0.9 }));
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setZ(i, Math.sin(positions.getX(i) * 5) * 0.13);
    positions.needsUpdate = true; mesh.geometry.computeVertexNormals();
    mesh.position.x = 0.95; group.add(mesh); this.scene.add(group);
    this.flags.push({ mesh, phase: Math.abs(z) * 0.03 });
  }

  private finishGate() {
    const z = -694;
    this.box(-5.3, 3.3, z, 0.55, 6.6, 0.65, this.red, 'solid');
    this.box(5.3, 3.3, z, 0.55, 6.6, 0.65, this.red, 'solid');
    this.box(0, 6.45, z, 11.2, 0.8, 0.65, this.red, 'solid');
    this.labelPlane(0, 6.45, z + 0.34, 7, 0.65, 'STRIDE  /  FINISH', '#ec302b');
    this.floorStrip(0, z + 1.6, 10, 1.1, this.red);
    this.labelPlane(0, 0.035, z + 4, 7, 2, 'FINISH', '#e52c27', true);
    for (let x = -4.8; x <= 4.8; x += 0.6) this.detail(x, 0.035, z + 1.6, 0.28, 0.035, 0.9, this.white);
    this.flag(-8, z, 8); this.flag(8, z, 8);
    this.labelPlane(0, 2.5, -705.5, 8, 3.6, 'THE CITY IS YOURS.', '#ed3029');
  }
}
