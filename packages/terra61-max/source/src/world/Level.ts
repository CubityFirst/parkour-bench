import * as THREE from 'three';
import { CollisionWorld, type SolidKind } from './CollisionWorld';

export interface Checkpoint {
  z: number;
  position: THREE.Vector3;
  label: string;
}

const roofs = [
  { z: -10, length: 48, width: 24, top: 0 },
  { z: -49, length: 22, width: 22, top: 0.4 },
  { z: -83, length: 38, width: 24, top: 0.4 },
  { z: -129, length: 28, width: 22, top: 0.4 },
  { z: -163, length: 32, width: 22, top: 1 },
  { z: -190, length: 14, width: 16, top: 1 },
  { z: -221, length: 40, width: 24, top: 1 },
];

const stretchedSections = [
  { start: -20, end: -32 },
  { start: -43, end: -58 },
  { start: -70, end: -100 },
  { start: -120, end: -141 },
  { start: -151, end: -177 },
  { start: -185, end: -195 },
  { start: -207, end: -229 },
];

export function routeZ(z: number): number {
  let offset = 0;
  for (const section of stretchedSections) offset += THREE.MathUtils.clamp((section.start - z) / (section.start - section.end), 0, 1) * 50;
  return z - offset;
}

function stretchedInterval(z: number, depth: number): { center: number; depth: number } {
  const front = routeZ(z + depth / 2);
  const back = routeZ(z - depth / 2);
  return { center: (front + back) / 2, depth: front - back };
}

export const checkpoints: Checkpoint[] = [
  { z: 7, position: new THREE.Vector3(0, 0, 7), label: 'START LINE' },
  { z: routeZ(-43), position: new THREE.Vector3(0, 0.4, routeZ(-43)), label: 'THE LEAP' },
  { z: routeZ(-68), position: new THREE.Vector3(0, 0.4, routeZ(-68)), label: 'LOW PROFILE' },
  { z: routeZ(-120), position: new THREE.Vector3(0, 0.4, routeZ(-120)), label: 'THE CROSSING' },
  { z: routeZ(-151), position: new THREE.Vector3(0, 1, routeZ(-151)), label: 'IN THE FLOW' },
  { z: routeZ(-206), position: new THREE.Vector3(0, 1, routeZ(-206)), label: 'HOME STRETCH' },
];

export function sectionFor(z: number): { number: string; name: string; hint: string } {
  if (z > routeZ(-35)) return { number: '01', name: 'THE WARM UP', hint: 'HOLD SHIFT TO SPRINT  /  SPACE TO JUMP' };
  if (z > routeZ(-64)) return { number: '02', name: 'THE LEAP', hint: 'SPRINT + JUMP TO CLEAR THE GAP' };
  if (z > routeZ(-100)) return { number: '03', name: 'LOW PROFILE', hint: 'HOLD CTRL OR C TO SLIDE UNDER THE DUCTS' };
  if (z > routeZ(-145)) return { number: '04', name: 'THE CROSSING', hint: 'JUMP BESIDE THE RED WALL AND KEEP MOVING' };
  if (z > routeZ(-180)) return { number: '05', name: 'IN THE FLOW', hint: 'PRESS E TO VAULT  /  CTRL TO SLIDE' };
  return { number: '06', name: 'HOME STRETCH', hint: 'KEEP MOVING. THE FINISH IS IN SIGHT.' };
}

export class Level {
  readonly collision = new CollisionWorld();
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly sunTarget = new THREE.Object3D();
  readonly finishZ = routeZ(-231);
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly white = new THREE.MeshStandardMaterial({ color: 0xf4f6f4, roughness: 0.82 });
  private readonly roofWhite = new THREE.MeshStandardMaterial({ color: 0xf7f8f6, roughness: 0.93 });
  private readonly grey = new THREE.MeshStandardMaterial({ color: 0xa4b0b4, roughness: 0.8 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x283d46, roughness: 0.7 });
  private readonly red = new THREE.MeshStandardMaterial({ color: 0xef242d, roughness: 0.55 });
  private readonly redDark = new THREE.MeshStandardMaterial({ color: 0xa9141c, roughness: 0.62 });
  private readonly facade: THREE.MeshStandardMaterial;
  private readonly glassFacade: THREE.MeshStandardMaterial;
  private sky: THREE.Mesh | null = null;

  constructor() {
    this.scene.background = new THREE.Color(0x93d5f4);
    this.scene.fog = new THREE.Fog(0xc7e8f6, 100, 330);
    this.facade = new THREE.MeshStandardMaterial({ color: 0xe1ebed, map: this.makeFacade(false), roughness: 0.85 });
    this.glassFacade = new THREE.MeshStandardMaterial({ color: 0xc1e1eb, map: this.makeFacade(true), roughness: 0.4, metalness: 0.2 });

    const hemisphere = new THREE.HemisphereLight(0xe4f7ff, 0xa1b7bd, 2.0);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight(0xfffbf1, 2.9);
    this.sun.position.set(-45, 80, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 180;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.bias = -0.00015;
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    this.createSky();
    this.createCity();
    roofs.forEach((roof, index) => this.createRoof(roof, index));
    this.createCourse();
  }

  follow(position: THREE.Vector3): void {
    this.sun.position.set(position.x - 45, position.y + 80, position.z + 40);
    this.sunTarget.position.set(position.x, position.y, position.z - 10);
    this.sunTarget.updateMatrixWorld();
    this.sky?.position.set(position.x, 0, position.z);
  }

  private makeFacade(glass: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d')!;
    context.fillStyle = glass ? '#72a6bd' : '#edf3f2';
    context.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 24; row++) {
      context.fillStyle = glass ? '#416f86' : '#7896a2';
      context.fillRect(0, row * 21 + 4, 512, glass ? 14 : 11);
      context.fillStyle = glass ? '#b8d9e3' : '#f7f8f5';
      for (let column = 0; column < 12; column++) context.fillRect(column * 44, row * 21, glass ? 2 : 5, 21);
      context.fillStyle = glass ? 'rgba(222,247,255,.15)' : 'rgba(39,74,91,.13)';
      context.fillRect(0, row * 21 + 4, 512, 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  private createSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { topColor: { value: new THREE.Color(0x58b9ec) }, bottomColor: { value: new THREE.Color(0xe8f7fa) } },
        vertexShader: 'varying vec3 worldPosition; void main(){ vec4 world = modelMatrix * vec4(position, 1.0); worldPosition = position; gl_Position = projectionMatrix * viewMatrix * world; }',
        fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 worldPosition; void main(){ float h = normalize(worldPosition + vec3(0.0, 65.0, 0.0)).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), 0.7), 0.0)), 1.0); }',
      }),
    );
    this.sky = sky;
    this.scene.add(sky);
  }

  private createCity(): void {
    let seed = 8721;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const count = 130;
    const groups = [new THREE.InstancedMesh(this.boxGeometry, this.facade, count), new THREE.InstancedMesh(this.boxGeometry, this.glassFacade, count)];
    const used = [0, 0];
    const transform = new THREE.Object3D();
    for (let index = 0; index < count; index++) {
      const side = index % 2 === 0 ? -1 : 1;
      const x = side * (24 + random() * 160);
      const z = 45 - random() * 360;
      const width = 10 + random() * 19;
      const depth = 10 + random() * 19;
      const height = 38 + random() * 92;
      const top = -5 + random() * 46;
      transform.position.set(x, top - height / 2, routeZ(z));
      transform.scale.set(width, height, depth);
      transform.updateMatrix();
      const group = random() > 0.52 ? 1 : 0;
      groups[group].setMatrixAt(used[group]++, transform.matrix);
    }
    groups.forEach((group, index) => {
      group.count = used[index];
      group.instanceMatrix.needsUpdate = true;
      this.scene.add(group);
    });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshStandardMaterial({ color: 0xb6d2da, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -64, routeZ(-130));
    this.scene.add(ground);
  }

  private mesh(x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    const interval = stretchedInterval(z, depth);
    mesh.position.set(x, y, interval.center);
    mesh.scale.set(width, height, interval.depth);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private solid(x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material, kind: SolidKind, options: { vaultable?: boolean; runnable?: boolean } = {}): void {
    this.mesh(x, y, z, width, height, depth, material);
    const interval = stretchedInterval(z, depth);
    this.collision.add(new THREE.Vector3(x, y, interval.center), new THREE.Vector3(width, height, interval.depth), kind, options);
  }

  private createRoof(roof: typeof roofs[number], index: number): void {
    const height = 42 + (index % 3) * 4;
    this.mesh(0, roof.top - height / 2, roof.z, roof.width, height, roof.length,
      [this.facade, this.facade, this.roofWhite, this.dark, this.facade, this.facade], false);
    const interval = stretchedInterval(roof.z, roof.length);
    this.collision.add(new THREE.Vector3(0, roof.top - height / 2, interval.center), new THREE.Vector3(roof.width, height, interval.depth), 'roof');
    this.mesh(0, roof.top + 0.025, roof.z, roof.width, 0.05, roof.length, this.roofWhite, false);
    for (const side of [-1, 1]) {
      this.mesh(side * (roof.width / 2 - 0.12), roof.top + 0.1, roof.z, 0.24, 0.2, roof.length, this.grey, false);
      this.mesh(side * (roof.width / 2 - 0.17), roof.top + 0.21, roof.z, 0.1, 0.04, roof.length, this.dark, false);
    }
    for (let z = roof.z - roof.length / 2 + 4; z < roof.z + roof.length / 2; z += 6) {
      this.mesh(0, roof.top + 0.055, z, roof.width - 0.5, 0.012, 0.025, this.grey, false);
    }
    for (let x = -8; x <= 8; x += 4) this.mesh(x, roof.top + 0.055, roof.z, 0.022, 0.012, roof.length - 0.5, this.grey, false);
    this.arrow(0, roof.top + 0.065, roof.z - roof.length / 2 + 3.6, 1.2);
    this.arrow(0, roof.top + 0.065, roof.z + roof.length / 2 - 4.5, 0.8);
  }

  private arrow(x: number, y: number, z: number, scale = 1): void {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.25);
    shape.lineTo(-0.9, 0.25);
    shape.lineTo(-0.42, 0.25);
    shape.lineTo(-0.42, -0.9);
    shape.lineTo(0.42, -0.9);
    shape.lineTo(0.42, 0.25);
    shape.lineTo(0.9, 0.25);
    shape.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.red);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(x, y, routeZ(z));
    arrow.scale.setScalar(scale);
    arrow.receiveShadow = true;
    this.scene.add(arrow);
  }

  private vent(x: number, z: number, y: number, width = 3, depth = 2.3): void {
    this.solid(x, y + 0.65, z, width, 1.3, depth, this.white, 'obstacle', { vaultable: true });
    this.mesh(x, y + 1.31, z, width * 0.92, 0.08, depth * 0.92, this.grey);
    for (let offset = -width / 2 + 0.3; offset < width / 2; offset += 0.38) this.mesh(x + offset, y + 1.37, z, 0.12, 0.04, depth * 0.75, this.dark, false);
  }

  private arch(x: number, y: number, z: number, width: number, height: number): void {
    for (const side of [-1, 1]) {
      this.mesh(x + side * width / 2, y + height / 2, z, 0.2, height, 0.25, this.red);
      this.mesh(x + side * width / 2, y + 0.08, z, 0.6, 0.16, 0.7, this.redDark);
    }
    this.mesh(x, y + height, z, width + 0.2, 0.22, 0.25, this.red);
  }

  private createCourse(): void {
    // A framed rooftop service tower gives the opening view a recognizable landmark.
    this.arch(6.5, 0, -6, 3, 8.5);
    this.mesh(6.5, 3.3, -6, 2.8, 1.8, 0.35, this.redDark);
    this.mesh(6.5, 3.4, -5.8, 2.1, 1.1, 0.05, this.red);
    this.mesh(6.5, 0.08, -6, 4, 0.16, 2.1, this.red);
    this.vent(-7.5, -5, 0, 3.2, 2.5);
    this.vent(8, -23, 0, 3, 3);
    this.solid(0, 0.55, -16, 3.4, 1.1, 1.15, this.red, 'obstacle', { vaultable: true });
    this.mesh(0, 1.12, -16, 3.4, 0.08, 1.2, this.redDark);
    this.arrow(0, 0.07, -25, 1.2);
    this.makeRail(-10.8, 0, -20, 19);
    this.makeRail(10.8, 0, -20, 19);

    this.vent(-7, -49, 0.4, 3, 2.5);
    this.vent(7.5, -53, 0.4, 2.6, 2.3);

    for (const z of [-78, -88]) {
      this.solid(0, 2.15, z, 8.2, 1.3, 1.5, this.red, 'ceiling');
      this.mesh(0, 2.84, z, 8.4, 0.08, 1.55, this.redDark);
      this.solid(-4.25, 1.5, z, 0.35, 2.2, 1.5, this.grey, 'wall');
      this.solid(4.25, 1.5, z, 0.35, 2.2, 1.5, this.grey, 'wall');
      for (const side of [-1, 1]) {
        this.solid(side * 8.2, 1.8, z, 7.2, 2.8, 1.5, this.white, 'wall');
        this.mesh(side * 8.2, 3.23, z, 7.2, 0.08, 1.55, this.grey);
      }
    }
    this.vent(-8.2, -79, 0.4, 2.4, 3);
    this.vent(8.5, -91, 0.4, 2.4, 3);
    this.arrow(2.1, 0.47, -96, 0.9);

    // The wall bridges a gap longer than the ordinary sprint-jump range.
    this.solid(3.25, 1.75, -108.5, 0.5, 4.5, 20, this.red, 'wall', { runnable: true });
    this.mesh(3.25, 4.05, -108.5, 0.62, 0.12, 20, this.redDark);
    for (let z = -117; z <= -100; z += 2.5) this.mesh(2.98, 1.5, z, 0.025, 2.8, 0.045, this.redDark, false);
    this.arrow(1.8, 0.47, -99, 0.9);
    this.vent(-7, -127, 0.4, 3, 3);

    this.solid(3.25, 2.5, -145, 0.5, 4.2, 8, this.red, 'wall', { runnable: true });
    this.solid(0, 1.55, -158, 3.6, 1.1, 1.25, this.red, 'obstacle', { vaultable: true });
    this.mesh(0, 2.12, -158, 3.6, 0.08, 1.3, this.redDark);
    this.solid(0, 2.75, -169, 8.2, 1.3, 1.5, this.red, 'ceiling');
    this.solid(-4.25, 2.1, -169, 0.35, 2.2, 1.5, this.grey, 'wall');
    this.solid(4.25, 2.1, -169, 0.35, 2.2, 1.5, this.grey, 'wall');
    this.vent(8, -161, 1, 2.8, 2.8);
    this.vent(-7.5, -172, 1, 3, 2.5);
    this.makeRail(-9.8, 1, -167, 17);

    this.vent(-6.8, -214, 1, 3.3, 2.8);
    this.vent(7.5, -220, 1, 3.2, 3);
    this.arrow(0, 1.07, -220, 1.4);
    this.arch(0, 1, -231, 7.5, 5.5);
    this.mesh(0, 1.08, -231, 7.3, 0.09, 1.4, this.red);
    this.mesh(0, 6.62, -231, 7.8, 0.75, 0.3, this.red);
    this.sign('FINISH', 0, 6.62, -230.83, 5.4, 0.68, '#ffffff', '#e9232d');

    for (let index = 1; index < checkpoints.length; index++) {
      const checkpoint = checkpoints[index];
      const y = checkpoint.position.y;
      const checkpointZ = [7, -43, -68, -120, -151, -206][index];
      this.mesh(-8.7, y + 2.5, checkpointZ, 0.12, 5, 0.12, this.red);
      this.mesh(-8.15, y + 4.3, checkpointZ, 1, 0.7, 0.08, this.red);
    }
    this.sign('THE CITY IS YOURS', -8, 4.4, -28, 5.2, 0.85, '#e9232d', '#f4f7f5');
    this.sign('07', 7.8, 3.4, -5.57, 1.7, 0.85, '#ffffff', '#ed2730');
    this.makeCable(new THREE.Vector3(6.5, 8.6, -6), new THREE.Vector3(14, 15, -51));
    this.makeCable(new THREE.Vector3(5.1, 8.5, -6), new THREE.Vector3(1.5, 0.1, -27));
  }

  private makeRail(x: number, y: number, z: number, length: number): void {
    for (let offset = -length / 2; offset <= length / 2; offset += 2.5) this.mesh(x, y + 0.65, z + offset, 0.1, 1.3, 0.1, this.grey);
    this.mesh(x, y + 1.25, z, 0.1, 0.1, length, this.grey);
    this.mesh(x, y + 0.65, z, 0.07, 0.07, length, this.grey);
    const interval = stretchedInterval(z, length);
    this.collision.add(new THREE.Vector3(x, y + 0.65, interval.center), new THREE.Vector3(0.1, 1.3, interval.depth), 'wall');
  }

  private makeCable(start: THREE.Vector3, end: THREE.Vector3): void {
    start.z = routeZ(start.z);
    end.z = routeZ(end.z);
    const direction = end.clone().sub(start);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, direction.length(), 6), this.redDark);
    cable.position.copy(start).add(end).multiplyScalar(0.5);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    this.scene.add(cable);
  }

  private sign(text: string, x: number, y: number, z: number, width: number, height: number, color: string, background: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 192;
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.font = '900 120px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 512, 102, 950);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    sign.position.set(x, y, routeZ(z));
    this.scene.add(sign);
  }
}
