import * as THREE from 'three';
import { CollisionWorld, type Collider } from './CollisionWorld';
import { CityGenerator } from './CityGenerator';

export interface Checkpoint { position: THREE.Vector3; yaw: number; name: string; hint: string; number: number }
interface Roof { start: number; end: number; y: number; width: number }
interface Block { position: THREE.Vector3; scale: THREE.Vector3; rotation: THREE.Quaternion }

/** A hand-authored 650m route. All measurements are shared with the collision world. */
export class Level {
  readonly world = new CollisionWorld();
  readonly spawn = new THREE.Vector3(0, 40, 12);
  readonly finish = new THREE.Vector3(0, 40.15, -625);
  readonly length = 637;
  readonly checkpoints: Checkpoint[] = [
    { position: this.spawn.clone(), yaw: 0, number: 1, name: 'The departure', hint: 'WASD to move · SHIFT to sprint · E to vault the red barrier', },
    { position: new THREE.Vector3(0, 40.35, -90), yaw: 0, number: 2, name: 'Above the streets', hint: 'Hold SHIFT + W, then SPACE at the red takeoff marks', },
    { position: new THREE.Vector3(0, 40.4, -214), yaw: 0, number: 3, name: 'Under pressure', hint: 'Sprint, then hold C or CTRL to slide beneath the ducts', },
    { position: new THREE.Vector3(0, 40.15, -300), yaw: 0, number: 4, name: 'Against the wall', hint: 'Follow the arrows right. Sprint and jump beside the red wall', },
    { position: new THREE.Vector3(0, 40.15, -390), yaw: 0, number: 5, name: 'Find your flow', hint: 'Chain a vault, a jump, a left wall run, and a slide', },
    { position: new THREE.Vector3(0, 40.2, -516), yaw: 0, number: 6, name: 'One last breath', hint: 'Keep your speed. The red finish gate is straight ahead', },
  ];

  private readonly group = new THREE.Group();
  private readonly city: CityGenerator;
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly batches = new Map<THREE.Material, Block[]>();
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly extraGeometry: THREE.BufferGeometry[] = [];
  private readonly flags: { mesh: THREE.Mesh<THREE.PlaneGeometry>; origin: Float32Array }[] = [];
  private readonly white = this.material(0xf1f3ee, .85);
  private readonly edge = this.material(0xd0dbe0, .7);
  private readonly red = this.material(0xef3827, .64);
  private readonly redDark = this.material(0xb62219, .65);
  private readonly charcoal = this.material(0x263b45, .8);
  private readonly blueGlass = this.material(0x3e6b83, .24, .3);
  private readonly seam = this.material(0xc1cdd0, .95);
  private readonly steel = this.material(0x778b93, .52, .35);
  private readonly roofs: Roof[] = [
    { start: 20, end: -26, y: 40, width: 26 },
    { start: -32, end: -76, y: 40.15, width: 22 },
    { start: -82, end: -118, y: 40.35, width: 20 },
    { start: -124, end: -160, y: 40.1, width: 18 },
    { start: -166, end: -198, y: 40.4, width: 18 },
    { start: -204, end: -286, y: 40.4, width: 22 },
    { start: -292, end: -330, y: 40.15, width: 20 },
    { start: -346, end: -422, y: 40.15, width: 22 },
    { start: -428, end: -449, y: 40, width: 16 },
    { start: -465, end: -504, y: 40, width: 22 },
    { start: -510, end: -550, y: 40.2, width: 20 },
    { start: -556, end: -588, y: 40.4, width: 18 },
    { start: -594, end: -636, y: 40.15, width: 24 },
  ];

  constructor(scene: THREE.Scene) {
    this.city = new CityGenerator(scene);
    this.blueGlass.envMap = this.city.reflections;
    this.blueGlass.envMapIntensity = 1.5;
    const roofMaterial = this.material(0xffffff, .97);
    roofMaterial.map = this.concreteTexture();
    this.roofs.forEach((roof, index) => this.roof(roof, index, roofMaterial));

    // First roof: a readable athletic lane framed by a service house and a red lattice mast.
    this.vault(0, 40, -8, 7.5);
    this.box(this.white, 8.3, 42.6, -9.7, 5.5, 5.2, 8.4, 'solid', 'Access house');
    this.box(this.edge, 8.3, 45.3, -9.7, 5.9, .2, 8.8, 'solid');
    this.box(this.red, 8.4, 41.5, -5.47, 1.5, 3, .12);
    this.box(this.charcoal, 8.95, 41.4, -5.38, .08, .24, .12);
    this.sign('ACCESS  /  08', 'SERVICE LEVEL', 8.3, 44.2, -5.44, 4.7, .78, false, '#263b45');
    this.grille(5.535, 42.5, -10.5, 3.4, 1.5, Math.PI / 2);
    this.crane(-8.5, 40, -15);
    this.hvac(-8.9, 40, 7, 4.3, 2.9);
    this.grate(0, 40, 4, 3.4, 3.3);
    this.floorText('01', 'THE DEPARTURE', -6, 40, 12, 6.5, 2.4);
    this.floorText('RUN  /  SHIFT', 'TAKE A BREATH. KEEP MOVING.', 0, 40, -15, 6.6, 1.25);
    this.billboard(-10, 40, 1, 'THE CITY', 'IS YOURS.', 0.18);
    for (const x of [-2.3, 2.3]) {
      for (let z = 10; z > -20; z -= 3) this.box(this.white, x, 40.017, z, .085, .025, 1.5);
    }

    this.slide(0, 40.15, -55, 8, 'SLIDE / C');
    this.floorText('LOW CLEARANCE', 'SPRINT + HOLD C / CTRL', 0, 40.15, -46, 6, 1.25);
    this.vault(0, 40.35, -104, 6.4);
    this.hvac(-6.1, 40.1, -142, 3.6, 4.8);
    this.box(this.red, 6.4, 41.1, -183, .6, 1.4, 11, 'solid', 'Red ventilation pipe');

    // A sustained slide lane: generous ceiling clearance for the crouched capsule.
    this.slide(0, 40.4, -237, 16, '01 / STAY LOW');
    this.slide(0, 40.4, -259, 16, '02 / KEEP FLOW');
    this.slide(0, 40.4, -278, 16, '03 / BREATHE');
    this.floorText('03 / UNDER PRESSURE', 'SPRINT. SLIDE. REPEAT.', 0, 40.4, -225, 8, 1.8);
    this.wallRun(1, 40.15, -330, -346);
    this.wallRun(-1, 40, -449, -465);

    // Combination section. Every new obstacle has more than ten metres of recovery space.
    this.vault(0, 40.15, -405, 8);
    this.floorText('05 / FIND YOUR FLOW', 'EVERY MOVE BECOMES THE NEXT.', 0, 40.15, -397, 8, 1.55);
    this.slide(0, 40, -487, 16, 'KEEP MOVING');

    this.floorText('06 / ONE LAST BREATH', 'THREE JUMPS. ONE FINISH.', 0, 40.2, -528, 8, 1.8);
    this.finishGate();

    // Checkpoint monuments stand beside the route; luminous red strips mark safe arrival zones.
    this.checkpoints.forEach(checkpoint => {
      const { position, number, name } = checkpoint;
      if (number === 1) return;
      this.box(this.red, -5.7, position.y + 1.9, position.z, .21, 3.8, .21, 'solid', 'Checkpoint post');
      this.box(this.red, -5.7, position.y + 3.77, position.z, 2.6, .11, .2);
      this.sign(String(number).padStart(2, '0'), name.toUpperCase(), -5.7, position.y + 2.6, position.z + .15, 2.9, 1.38, false, '#ef3827');
      for (const x of [-2.7, 2.7]) this.box(this.red, x, position.y + .025, position.z + 1.8, 1.1, .035, .13);
      this.flag(7.2, position.y, position.z - 4, 4.4);
    });

    this.flushBatches();
    scene.add(this.group);
  }

  private material(color: number, roughness: number, metalness = 0) {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.push(material);
    return material;
  }

  private box(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, kind?: Collider['kind'], name?: string, rotation = 0) {
    const blocks = this.batches.get(material) ?? [];
    blocks.push({ position: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(w, h, d), rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation) });
    this.batches.set(material, blocks);
    if (kind) this.world.add(new THREE.Vector3(x, y, z), new THREE.Vector3(w, h, d), kind, name);
  }

  private flushBatches() {
    const matrix = new THREE.Matrix4();
    for (const [material, blocks] of this.batches) {
      const mesh = new THREE.InstancedMesh(this.boxGeometry, material, blocks.length);
      blocks.forEach((block, index) => { matrix.compose(block.position, block.rotation, block.scale); mesh.setMatrixAt(index, matrix); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = material !== this.blueGlass && material !== this.seam;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.batches.clear();
  }

  private roof(roof: Roof, index: number, roofMaterial: THREE.Material, bridgeSegment = 0) {
    if (index === 7 && bridgeSegment === 0) {
      this.roof({ ...roof, end: -370 }, index, roofMaterial, 1);
      this.roof({ ...roof, start: -380 }, index, roofMaterial, 2);
      this.bridge(roof.y, roofMaterial);
      return;
    }
    const { start, end, y, width } = roof;
    const depth = start - end;
    const z = (start + end) / 2;
    this.box(this.white, 0, (y - .28) / 2, z, width, y - .28, depth, 'solid', `Rooftop ${index + 1}`);
    this.box(roofMaterial, 0, y - .14, z, width + .15, .28, depth, 'solid', `Roof slab ${index + 1}`);
    this.box(this.edge, 0, y - .55, z, width + .6, .2, depth + .35);
    for (let floorY = 3; floorY < y - 1; floorY += 3.2) {
      this.box(this.blueGlass, -width / 2 - .015, floorY, z, .08, 2.45, depth - .8);
      this.box(this.blueGlass, width / 2 + .015, floorY, z, .08, 2.45, depth - .8);
      this.box(this.blueGlass, 0, floorY, start + .015, width - .6, 2.45, .08);
      this.box(this.blueGlass, 0, floorY, end - .015, width - .6, 2.45, .08);
    }
    for (let panelZ = end + 2.8; panelZ < start; panelZ += 3.6) {
      this.box(this.white, -width / 2 - .07, y / 2, panelZ, .16, y - .8, .13);
      this.box(this.white, width / 2 + .07, y / 2, panelZ, .16, y - .8, .13);
    }
    // Fine expansion joints sell scale without adding noise to the white running surface.
    for (let lineZ = end + 3; lineZ < start; lineZ += 4) this.box(this.seam, 0, y + .004, lineZ, width, .008, .022);
    for (let lineX = -width / 2 + 4; lineX < width / 2; lineX += 4) this.box(this.seam, lineX, y + .005, z, .022, .009, depth);

    for (const side of [-1, 1]) {
      const x = side * (width / 2 - .22);
      this.box(this.edge, x, y + .18, z, .28, .36, depth - .4, 'solid', 'Roof parapet');
      // Railings are deliberately kept on the sides, leaving the takeoff and landing edges clear.
      if (index % 3 !== 1) {
        this.box(this.steel, x, y + .95, z, .075, .085, depth - 2, 'solid', 'Safety rail');
        this.box(this.steel, x, y + .59, z, .045, .05, depth - 2);
        for (let postZ = end + 1; postZ < start; postZ += 3.5) this.box(this.steel, x, y + .64, postZ, .065, 1.1, .065, 'solid');
      }
    }

    if (index > 0 && index !== 8) {
      const side = index % 2 ? 1 : -1;
      this.hvac(side * (width / 2 - 2.9), y, z + depth * .22, 3.1, 4.2);
      if (depth > 40) this.hvac(-side * (width / 2 - 2.7), y, z - 8, 3.1, 3.2);
    }
    if (index !== 6 && index !== 8 && index !== 12 && bridgeSegment !== 1) {
      this.takeoff(0, y, end + 1.7);
      this.arrows(0, y, end + 8, 3);
    }
    if (index > 0) this.box(this.red, 0, y + .025, start - .5, 4.2, .035, .17);
  }

  private bridge(y: number, surface: THREE.Material) {
    const z = -375;
    this.box(surface, 0, y - .15, z, 3.2, .3, 12, 'solid', 'Narrow pedestrian bridge');
    this.box(this.steel, 0, y - .6, z, 2.7, .6, 12, 'solid', 'Bridge structure');
    for (const side of [-1, 1]) {
      const x = side * 1.53;
      this.box(this.red, x, y + .07, z, .12, .14, 12, 'solid', 'Bridge edge');
      this.box(this.steel, x, y + 1.04, z, .08, .08, 12, 'solid', 'Bridge handrail');
      this.box(this.steel, x, y + .58, z, .055, .06, 12, 'solid', 'Bridge safety rail');
      for (let postZ = -369; postZ >= -381; postZ -= 2) this.box(this.steel, x, y + .57, postZ, .075, 1.08, .075, 'solid', 'Bridge post');
    }
    for (let seamZ = -369.5; seamZ > -381; seamZ -= .8) this.box(this.seam, 0, y + .008, seamZ, 3, .01, .022);
    this.arrows(0, y, -367, 2);
    this.floorText('SKYBRIDGE', 'KEEP YOUR LINE', 0, y, -362, 5.5, 1.2);
  }

  private vault(x: number, y: number, z: number, width: number) {
    this.box(this.red, x, y + .51, z, width, 1.02, .84, 'vault', 'Vault barrier');
    this.box(this.redDark, x, y + .08, z, width + .12, .16, 1.1);
    this.box(this.white, x, y + 1.031, z, width - .16, .025, .12);
    this.sign('VAULT  /  E', 'KEEP YOUR MOMENTUM', x, y + .57, z + .425, 3.4, .6, false, '#ffffff', true);
    this.arrows(x, y, z + 5, 2);
  }

  private slide(x: number, y: number, z: number, width: number, label: string) {
    // Collision bottom is y+1.08; crouched height is 0.8m, standing height is 1.8m.
    this.box(this.red, x, y + 2.08, z, width, 2, 2.7, 'solid', 'Low ventilation duct');
    for (const side of [-1, 1]) {
      this.box(this.charcoal, x + side * (width / 2 - .25), y + .54, z, .35, 1.08, 2.45, 'solid', 'Duct support');
      this.box(this.edge, x + side * (width / 2 + .02), y + 2.08, z, .18, 2.15, 2.86);
    }
    this.box(this.redDark, x, y + 1.13, z + 1.36, width, .1, .08);
    this.sign(label, '↓  1.08 M  /  SLIDE', x, y + 2.18, z + 1.361, 5.8, 1.1, false, '#ffffff', true);
    this.arrows(x, y, z + 7, 2);
    for (let band = -width / 2 + .5; band < width / 2; band += 1) {
      this.box(this.white, x + band, y + 1.44, z + 1.365, .42, .09, .02);
    }
  }

  private wallRun(side: number, y: number, takeoffZ: number, landingZ: number) {
    const wallX = side * 3.22;
    const start = takeoffZ + 10;
    const end = landingZ - 8;
    const center = (start + end) / 2;
    this.box(this.red, wallX, y + 2.1, center, .6, 6.2, start - end, 'wallrun', side > 0 ? 'Right wall run' : 'Left wall run');
    this.box(this.redDark, wallX, y + 5.23, center, .78, .15, start - end + .3);
    // The white broken line makes the ideal shoulder distance visible before the leap.
    const lane = side * 2.3;
    for (let z = start + 4; z > takeoffZ + 1; z -= 2) this.box(this.white, lane - side * .7, y + .02, z, .07, .025, 1.0);
    this.takeoff(lane, y, takeoffZ + 1.2, 1.25);
    this.arrows(lane, y, takeoffZ + 6, 3);
    this.arrows(side * 1.3, y, takeoffZ + 13, 2);
    this.floorText(side > 0 ? 'WALL RUN  /  RIGHT' : 'WALL RUN  /  LEFT', 'SPRINT + JUMP CLOSE TO THE WALL', 0, y, takeoffZ + 20, 7.5, 1.25);
    this.box(this.white, wallX - side * .312, y + 1.8, center, .025, .12, start - end - .8);
    for (let z = start - 1.8; z > end; z -= 3.8) {
      this.box(this.redDark, wallX - side * .313, y + 2.3, z, .026, 5.6, .025);
      this.box(this.white, wallX - side * .33, y + 3.6, z, .028, .12, 1.4);
    }
    this.sign('COMMIT TO THE LINE', '16 M / WALL TRANSIT', wallX - side * .321, y + 3.6, center, 14, 1.5, false, '#ffffff', true, -side * Math.PI / 2);
  }

  private takeoff(x: number, y: number, z: number, width = 4.8) {
    this.box(this.red, x, y + .025, z, width, .035, .38);
    this.box(this.red, x, y + .025, z + .72, width, .035, .1);
    for (const side of [-1, 1]) this.box(this.red, x + side * (width / 2 - .15), y + .025, z + 1.1, .3, .035, 2);
  }

  private arrows(x: number, y: number, z: number, count: number) {
    for (let i = 0; i < count; i++) {
      const centerZ = z - i * 1.55;
      this.box(this.red, x - .3, y + .022, centerZ, .12, .025, .88, undefined, undefined, -.76);
      this.box(this.red, x + .3, y + .022, centerZ, .12, .025, .88, undefined, undefined, .76);
    }
  }

  private hvac(x: number, y: number, z: number, width: number, depth: number) {
    this.box(this.edge, x, y + .12, z, width + .25, .24, depth + .25, 'solid', 'HVAC mounting');
    this.box(this.white, x, y + .85, z, width, 1.5, depth, 'vault', 'Air conditioning unit');
    this.box(this.charcoal, x, y + 1.62, z, width - .22, .09, depth - .22, 'solid');
    this.box(this.edge, x, y + 1.69, z, width + .12, .08, depth + .12, 'solid');
    for (let offset = -width / 2 + .24; offset < width / 2; offset += .24) {
      this.box(this.charcoal, x + offset, y + .8, z + depth / 2 + .015, .08, .85, .04);
    }
    const fanGeometry = new THREE.CylinderGeometry(Math.min(width, depth) * .28, Math.min(width, depth) * .28, .07, 24);
    const fan = new THREE.Mesh(fanGeometry, this.charcoal);
    fan.position.set(x, y + 1.75, z);
    fan.receiveShadow = true;
    this.group.add(fan);
    this.extraGeometry.push(fanGeometry);
    for (let offset = -.6; offset <= .6; offset += .2) this.box(this.steel, x + offset, y + 1.792, z, .035, .025, 1.42);
    this.box(this.red, x + width * .27, y + 1.3, z + depth / 2 + .04, .25, .2, .05);
  }

  private grate(x: number, y: number, z: number, width: number, depth: number) {
    this.box(this.charcoal, x, y + .035, z, width, .055, depth);
    for (let v = -width / 2 + .1; v < width / 2; v += .27) this.box(this.steel, x + v, y + .071, z, .055, .025, depth);
    for (let v = -depth / 2 + .1; v < depth / 2; v += .32) this.box(this.steel, x, y + .073, z + v, width, .025, .045);
  }

  private grille(x: number, y: number, z: number, width: number, height: number, rotation = 0) {
    this.box(this.charcoal, x, y, z, .06, height, width);
    for (let i = 0; i < 9; i++) this.box(this.edge, x - .04, y - height / 2 + .08 + i * height / 9, z, .07, .07, width, undefined, undefined, rotation ? 0 : rotation);
  }

  private crane(x: number, y: number, z: number) {
    this.box(this.redDark, x, y + .15, z, 3.2, .3, 3.2, 'solid', 'Crane base');
    const height = 23;
    for (const sx of [-.7, .7]) for (const sz of [-.7, .7]) this.box(this.red, x + sx, y + height / 2, z + sz, .2, height, .2, 'solid', 'Crane mast');
    for (let h = 1.5; h < height; h += 2.8) {
      this.box(this.red, x, y + h, z - .7, 1.6, .16, .16, 'solid');
      this.box(this.red, x, y + h, z + .7, 1.6, .16, .16, 'solid');
      this.box(this.red, x - .7, y + h, z, .16, .16, 1.6, 'solid');
      this.box(this.red, x + .7, y + h, z, .16, .16, 1.6, 'solid');
      this.beam(new THREE.Vector3(x - .7, y + h, z + .7), new THREE.Vector3(x + .7, y + h + 2.8, z + .7), .105, this.red);
      this.beam(new THREE.Vector3(x - .7, y + h, z - .7), new THREE.Vector3(x + .7, y + h + 2.8, z - .7), .105, this.red);
    }
    this.box(this.red, x, y + 3.5, z + .88, 1.65, 2.1, .32, 'solid', 'Crane switch box');
    for (let i = 0; i < 7; i++) this.box(this.redDark, x + .3, y + 2.8 + i * .19, z + 1.05, .65, .07, .025);
    this.box(this.red, x + 4, y + height - .5, z, 13, .3, 1.4);
    this.box(this.red, x + 4, y + height + 1, z, 13, .16, .16);
    for (let offset = -2; offset < 11; offset += 1.5) this.beam(new THREE.Vector3(x + offset, y + height - .5, z), new THREE.Vector3(x + offset + 1.5, y + height + 1, z), .09, this.red);
    this.beam(new THREE.Vector3(x, y + height + 4, z), new THREE.Vector3(x + 10, y + height + 1, z), .05, this.charcoal);
    this.box(this.red, x, y + height + 2, z, .15, 4, .15);
    this.box(this.charcoal, x + 9, y + height - 4, z, .045, 7, .045);
    this.box(this.red, x + 9, y + height - 7.5, z, .4, .6, .4);
  }

  private beam(from: THREE.Vector3, to: THREE.Vector3, thickness: number, material: THREE.Material) {
    const blocks = this.batches.get(material) ?? [];
    const delta = to.clone().sub(from);
    blocks.push({ position: from.clone().add(to).multiplyScalar(.5), scale: new THREE.Vector3(thickness, delta.length(), thickness), rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()) });
    this.batches.set(material, blocks);
  }

  private flag(x: number, y: number, z: number, height: number) {
    this.box(this.steel, x, y + height / 2, z, .06, height, .06, 'solid', 'Flagpole');
    const geometry = new THREE.PlaneGeometry(1.7, .9, 10, 4);
    geometry.translate(.85, -.45, 0);
    const flagMaterial = new THREE.MeshStandardMaterial({ color: 0xf03c25, roughness: .8, side: THREE.DoubleSide });
    this.materials.push(flagMaterial);
    const mesh = new THREE.Mesh(geometry, flagMaterial);
    mesh.position.set(x, y + height - .2, z);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.flags.push({ mesh, origin: new Float32Array(geometry.attributes.position.array) });
    this.extraGeometry.push(geometry);
  }

  private finishGate() {
    const y = this.finish.y;
    const z = this.finish.z;
    for (const x of [-5, 5]) {
      this.box(this.red, x, y + 3, z, .9, 6, 1.1, 'solid', 'Finish gate');
      this.box(this.redDark, x, y + .15, z, 1.6, .3, 1.7, 'solid');
      this.flag(x * 1.8, y, z - 2, 6.8);
    }
    this.box(this.red, 0, y + 5.6, z, 10.8, 1.4, 1.1, 'solid', 'Finish header');
    this.sign('FINISH', 'THE CITY IS YOURS.', 0, y + 5.67, z + .56, 7.5, 1.1, false, '#ffffff', true);
    this.box(this.red, 0, y + .025, z, 10, .035, 1.8);
    for (let i = -5; i < 5; i++) {
      this.box(i % 2 ? this.white : this.charcoal, i + .5, y + .047, z + .48, 1, .015, .6);
      this.box(i % 2 ? this.charcoal : this.white, i + .5, y + .047, z - .48, 1, .015, .6);
    }
    this.arrows(0, y, z + 13, 5);
    this.floorText('YOU WERE MADE TO MOVE.', 'REDLINE / END OF TRANSMISSION', 0, y, z - 5.3, 8, 1.7);
  }

  private billboard(x: number, y: number, z: number, first: string, second: string, yaw: number) {
    this.box(this.charcoal, x, y + 2.1, z, .1, 4.2, .1, 'solid');
    this.box(this.charcoal, x + 2, y + 2.1, z, .1, 4.2, .1, 'solid');
    this.box(this.white, x + 1, y + 3.8, z, 5.5, 3.3, .16, 'solid', 'Rooftop sign');
    this.sign(first, second, x + 1, y + 3.8, z + .1, 5.2, 3.05, false, '#ef3827', false);
  }

  private floorText(title: string, subtitle: string, x: number, y: number, z: number, width: number, height: number) {
    this.sign(title, subtitle, x, y + .035, z, width, height, true, '#536972');
  }

  private sign(title: string, subtitle: string, x: number, y: number, z: number, width: number, height: number, floor: boolean, color: string, small = false, yaw = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.round(1024 * height / width);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = Math.min(canvas.height * .46, small ? 92 : 155);
    ctx.font = `800 ${size}px Arial, Helvetica, sans-serif`;
    const measured = ctx.measureText(title).width;
    if (measured > canvas.width * .95) size *= canvas.width * .95 / measured;
    ctx.font = `800 ${size}px Arial, Helvetica, sans-serif`;
    ctx.fillText(title, 512, canvas.height * .38);
    ctx.font = `600 ${Math.min(canvas.height * .18, 33)}px Arial, Helvetica, sans-serif`;
    ctx.fillText(subtitle, 512, canvas.height * .77);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.push(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (floor) mesh.rotation.x = -Math.PI / 2;
    else mesh.rotation.y = yaw;
    this.group.add(mesh);
    this.materials.push(material);
    this.extraGeometry.push(geometry);
  }

  private concreteTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.createImageData(256, 256);
    let seed = 103;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const noise = seed % 12;
      pixels.data[i] = 232 + noise;
      pixels.data[i + 1] = 236 + noise;
      pixels.data[i + 2] = 234 + noise;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 12);
    texture.anisotropy = 8;
    this.textures.push(texture);
    return texture;
  }

  update(time: number) {
    this.flags.forEach(({ mesh, origin }) => {
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = origin[i * 3];
        positions.setZ(i, Math.sin(x * 4 - time * 4.3 + mesh.position.z) * .14 * x + Math.sin(x * 7 + time * 2) * .035 * x);
      }
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    });
  }

  dispose() {
    this.city.dispose();
    this.group.removeFromParent();
    this.group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.boxGeometry.dispose();
    this.extraGeometry.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
  }
}
