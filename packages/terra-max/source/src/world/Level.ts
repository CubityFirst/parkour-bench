import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld';
import { CityGenerator } from './CityGenerator';

export type Checkpoint = {
  id: string;
  name: string;
  position: THREE.Vector3;
  trigger: THREE.Box3;
};

type Materials = {
  roof: THREE.MeshStandardMaterial;
  roofEdge: THREE.MeshStandardMaterial;
  side: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  redHot: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
};

/** Builds a complete, original rooftop route and its collision representation. */
export class Level {
  readonly group = new THREE.Group();
  readonly collision = new CollisionWorld();
  readonly spawn = new THREE.Vector3(0, 0, -91.5);
  readonly checkpoints: Checkpoint[] = [];
  readonly finishTrigger = new THREE.Box3(new THREE.Vector3(-7.5, -2, 153.1), new THREE.Vector3(7.5, 5, 157.3));
  private readonly materials: Materials;

  constructor() {
    this.group.name = 'Skyline Flow course';
    this.materials = {
      roof: new THREE.MeshStandardMaterial({ color: 0xf2f5f3, roughness: 0.79, metalness: 0.03 }),
      roofEdge: new THREE.MeshStandardMaterial({ color: 0xcfd7d9, roughness: 0.64, metalness: 0.14 }),
      side: new THREE.MeshStandardMaterial({ color: 0xaebac0, roughness: 0.76, metalness: 0.06 }),
      red: new THREE.MeshStandardMaterial({ color: 0xd94842, roughness: 0.52, metalness: 0.08 }),
      redHot: new THREE.MeshStandardMaterial({ color: 0xf05245, roughness: 0.36, metalness: 0.1, emissive: 0x3c0805, emissiveIntensity: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2d3d46, roughness: 0.61, metalness: 0.25 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x66767d, roughness: 0.45, metalness: 0.61 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x60aecb, roughness: 0.2, metalness: 0.38, transparent: true, opacity: 0.72 }),
    };
    this.build();
  }

  getHint(position: THREE.Vector3): string {
    const z = position.z;
    if (z < -72) return 'WASD to move · hold SHIFT to build speed';
    if (z < -54) return 'SPACE — clear the first rooftop gap';
    if (z < -17) return 'Keep the red route in sight · speed is distance';
    if (z < 13) return 'CTRL or C — slide under the red ventilation gate';
    if (z < 39) return 'SPRINT JUMP to the red wall · ride it to the next roof';
    if (z < 70) return 'E — vault the low red barrier without losing flow';
    if (z < 99) return 'Chain sprint, jump, vault, and slide';
    if (z < 143) return 'FINAL SPRINT · stay light on the rooftops';
    return 'THE FINISH LINE IS AHEAD';
  }

  getProgress(position: THREE.Vector3): number {
    return THREE.MathUtils.clamp((position.z + 92) / 248, 0, 1);
  }

  findCheckpoint(position: THREE.Vector3, activated: Set<string>): Checkpoint | null {
    return this.checkpoints.find((checkpoint) => !activated.has(checkpoint.id) && checkpoint.trigger.containsPoint(position)) ?? null;
  }

  isFinished(position: THREE.Vector3): boolean {
    return this.finishTrigger.containsPoint(position);
  }

  private build(): void {
    CityGenerator.addTo(this.group);

    // Section 01 — a broad, clean launch roof with a forgiving first jump.
    this.addRooftop('launch deck', 0, -79, 22, 39, 0, 27);
    this.addRouteLine(0, -88, 11);
    this.addRouteMarker(0, -81.5);
    this.addVentUnit(-6.6, -73.5, 0.8, 1.8, 2.8);
    this.addVaultBarrier(0, -68.5, 4.8, 0.86, 0.42);
    this.addRedDoor(-8.6, -61.5, Math.PI * 0.5);
    this.addRouteMarker(0, -61.6);

    // Section 02 — rooftops split by visible, sprintable jumps.
    this.addRooftop('north jumper', 0, -40, 18, 23, 0, 23);
    this.addRooftop('step roof', -1, -20, 16, 13, 0, 20);
    this.addRouteLine(0, -43, 8);
    this.addRouteMarker(0, -49.1);
    this.addRouteMarker(-1, -31.2);
    this.addVentUnit(5.2, -39, 0.72, 1.4, 3.3);
    this.addDuct(-5.6, -26.6, 3.4, 0);
    this.addRouteLine(-1, -20, 5);
    this.addCheckpoint('first-jump', 'ROOFTOP JUMPS', new THREE.Vector3(0, 0, -47), new THREE.Vector3(-8.5, -2, -50.5), new THREE.Vector3(8.5, 4, -45.5));

    // Section 03 — a slide gate placed on a long technical roof.
    this.addRooftop('ventilation terrace', 0, 5, 16, 31, 0, 22);
    this.addRouteLine(0, -4.5, 8);
    this.addRouteMarker(0, -8.5);
    this.addSlideGate(0, 5.2, 15.25);
    this.addRouteLine(0, 13.5, 7);
    this.addDuct(-5.25, 15, 4, Math.PI * 0.5);
    this.addCheckpoint('slide-gate', 'SLIDE RUN', new THREE.Vector3(0, 0, -5), new THREE.Vector3(-7.5, -2, -7.5), new THREE.Vector3(7.5, 4, -1));

    // Section 04 — too wide for a normal jump; the red wall creates the bridge.
    this.addWallRunWall(5.45, 29, 24);
    this.addRooftop('wall-run landing', 0, 55, 16, 31, 0, 28);
    this.addRouteMarker(3.5, 18.4, -0.46);
    this.addRouteMarker(4.25, 29, -0.46);
    this.addRouteLine(0, 47, 8);
    this.addVentUnit(-5.5, 60.5, 0.72, 1.5, 2.7);
    this.addCheckpoint('wall-run', 'WALL RUN', new THREE.Vector3(0, 0, 47), new THREE.Vector3(-7.5, -2, 43.5), new THREE.Vector3(7.5, 4, 50.5));

    // Section 05 — combo roof: gap, vault, then a low slide clearance.
    this.addRooftop('flow deck', 0, 85, 15, 20, 0, 24);
    this.addRouteMarker(0, 76.5);
    this.addVaultBarrier(0, 83.2, 10.8, 1.06, 0.48);
    this.addSlideGate(0, 90.7, 14.1, 2.6);
    this.addRouteLine(0, 93.2, 3);
    this.addCheckpoint('combo-deck', 'COMBINATION', new THREE.Vector3(0, 0, 78), new THREE.Vector3(-7, -2, 75.2), new THREE.Vector3(7, 4, 80.5));

    // Section 06 — final sequence, a few tight gaps and an unmistakable red finish gate.
    this.addRooftop('last transfer', 0, 113, 15, 25, 0, 21);
    this.addRooftop('finish roof', 0, 145, 16, 32, 0, 31);
    this.addRouteLine(0, 109, 8);
    this.addRouteMarker(0, 100.6);
    this.addRouteLine(0, 132.5, 7);
    this.addRouteMarker(0, 127.9);
    this.addRouteLine(0, 148.5, 8);
    this.addFinishGate();
    this.addCheckpoint('final-sprint', 'FINAL SPRINT', new THREE.Vector3(0, 0, 104), new THREE.Vector3(-7, -2, 101.4), new THREE.Vector3(7, 4, 106.5));

    this.addCrane(-15.5, -3.5);
    this.addDistantGlassTower(19, 30, 56);
    this.addDistantGlassTower(-25, 78, 78);
  }

  private addRooftop(name: string, x: number, z: number, width: number, depth: number, top: number, buildingHeight: number): void {
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, buildingHeight, depth), this.materials.side);
    body.name = name;
    body.position.set(x, top - buildingHeight * 0.5, z);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const surface = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.16, depth + 0.08), this.materials.roof);
    surface.position.set(x, top - 0.08, z);
    surface.castShadow = false;
    surface.receiveShadow = true;
    this.group.add(surface);

    const edge = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 0.1, depth + 0.2), this.materials.roofEdge);
    edge.position.set(x, top - 0.18, z);
    edge.castShadow = false;
    edge.receiveShadow = true;
    this.group.add(edge);

    this.collision.addBox(new THREE.Vector3(x, top - buildingHeight * 0.5, z), new THREE.Vector3(width, buildingHeight, depth), { id: name, landing: true });
    this.addParapet(x, z, width, depth, top);
  }

  private addParapet(x: number, z: number, width: number, depth: number, top: number): void {
    const rail = (w: number, d: number, px: number, pz: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.43, d), this.materials.roofEdge);
      mesh.position.set(px, top + 0.19, pz);
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    // Leave a broad central opening on each roof edge. It makes the intended
    // forward route feel physically readable instead of asking the player to
    // ghost through decorative rails at every jump.
    const opening = Math.min(5.2, width * 0.55);
    const endPiece = Math.max(1.3, (width - opening) * 0.5);
    const endOffset = opening * 0.5 + endPiece * 0.5;
    for (const direction of [-1, 1]) {
      rail(endPiece, 0.16, x + direction * endOffset, z - depth * 0.5 + 0.08);
      rail(endPiece, 0.16, x + direction * endOffset, z + depth * 0.5 - 0.08);
    }
    rail(0.16, depth, x - width * 0.5 + 0.08, z);
    rail(0.16, depth, x + width * 0.5 - 0.08, z);
  }

  private addRouteLine(x: number, z: number, length: number): void {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.026, length), this.materials.red);
    stripe.position.set(x, 0.025, z);
    stripe.receiveShadow = false;
    this.group.add(stripe);
  }

  private addRouteMarker(x: number, z: number, rotation = 0): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.9, 0.52, 0, -0.52, -0.52, 0, -0.52], 3));
    geometry.setIndex([0, 2, 1]);
    geometry.computeVertexNormals();
    const marker = new THREE.Mesh(geometry, this.materials.redHot);
    marker.position.set(x, 0.042, z);
    marker.rotation.y = rotation;
    this.group.add(marker);
  }

  private addVentUnit(x: number, z: number, height: number, width: number, depth: number): void {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.materials.metal);
    housing.position.set(x, height * 0.5, z);
    housing.castShadow = true;
    housing.receiveShadow = true;
    this.group.add(housing);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.08, depth + 0.08), this.materials.dark);
    cap.position.set(x, height + 0.04, z);
    cap.castShadow = true;
    this.group.add(cap);
  }

  private addDuct(x: number, z: number, length: number, rotation: number): void {
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, length, 12), this.materials.red);
    duct.position.set(x, 0.35, z);
    duct.rotation.z = Math.PI * 0.5;
    duct.rotation.y = rotation;
    duct.castShadow = true;
    this.group.add(duct);
    for (const direction of [-1, 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), this.materials.dark);
      brace.position.set(x + direction * (length * 0.5 - 0.24), 0.27, z);
      brace.castShadow = true;
      this.group.add(brace);
    }
  }

  private addVaultBarrier(x: number, z: number, width: number, height: number, depth: number): void {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.materials.red);
    barrier.position.set(x, height * 0.5, z);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    this.group.add(barrier);
    const blackStripe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.13, depth + 0.05), this.materials.dark);
    blackStripe.position.set(x, height * 0.57, z - depth * 0.52);
    blackStripe.castShadow = true;
    this.group.add(blackStripe);
    this.collision.addBox(new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), { solid: true, vaultable: true });
  }

  private addSlideGate(x: number, z: number, width: number, depth = 4.8): void {
    const gate = new THREE.Mesh(new THREE.BoxGeometry(width, 0.46, depth), this.materials.red);
    gate.position.set(x, 1.47, z);
    gate.castShadow = true;
    gate.receiveShadow = true;
    this.group.add(gate);
    this.collision.addBox(new THREE.Vector3(x, 1.47, z), new THREE.Vector3(width, 0.46, depth), { solid: true });
    for (const sign of [-1, 1]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.42, 0.34), this.materials.dark);
      support.position.set(x + sign * (width * 0.5 - 0.48), 0.71, z - depth * 0.5 + 0.38);
      support.castShadow = true;
      this.group.add(support);
    }
    const lowerGlow = new THREE.Mesh(new THREE.BoxGeometry(width - 0.7, 0.05, 0.09), this.materials.redHot);
    lowerGlow.position.set(x, 1.22, z - depth * 0.5 - 0.01);
    this.group.add(lowerGlow);
  }

  private addWallRunWall(x: number, z: number, depth: number): void {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.4, depth), this.materials.red);
    wall.position.set(x, 2.7, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    const accent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, depth + 0.08), this.materials.redHot);
    accent.position.set(x - 0.02, 4.65, z);
    accent.castShadow = true;
    this.group.add(accent);
    this.collision.addBox(new THREE.Vector3(x, 2.7, z), new THREE.Vector3(0.65, 5.4, depth), { solid: true, runnable: true });
    for (let i = -2; i <= 2; i += 1) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.1, 0.1), this.materials.dark);
      panel.position.set(x - 0.01, 1.15, z + i * 4.1);
      this.group.add(panel);
    }
  }

  private addRedDoor(x: number, z: number, rotation: number): void {
    const frame = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.85, 2.5, 0.18), this.materials.red);
    panel.position.y = 1.25;
    frame.add(panel);
    const inset = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.74, 0.205), this.materials.dark);
    inset.position.set(0, 1.22, 0.02);
    frame.add(inset);
    frame.position.set(x, 0, z);
    frame.rotation.y = rotation;
    this.group.add(frame);
  }

  private addCheckpoint(id: string, name: string, position: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): void {
    this.checkpoints.push({ id, name, position, trigger: new THREE.Box3(min, max) });
    const pad = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.025, 0.28), this.materials.redHot);
    pad.position.set(position.x, 0.03, position.z);
    this.group.add(pad);
  }

  private addFinishGate(): void {
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.2, 0.65), this.materials.red);
      pillar.position.set(side * 5.2, 2.6, 155.1);
      pillar.castShadow = true;
      this.group.add(pillar);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.22, 0.94), this.materials.redHot);
      cap.position.set(side * 5.2, 5.27, 155.1);
      this.group.add(cap);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 0.5), this.materials.red);
    header.position.set(0, 4.75, 155.1);
    header.castShadow = true;
    this.group.add(header);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.06, 0.8), this.materials.redHot);
    strip.position.set(0, 0.04, 155.1);
    this.group.add(strip);
  }

  private addCrane(x: number, z: number): void {
    const crane = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, 27, 0.8), this.materials.red);
    tower.position.y = 13.5;
    crane.add(tower);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(19, 0.48, 0.52), this.materials.red);
    arm.position.set(8.8, 25.8, 0);
    crane.add(arm);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4, 1.3, 2.4), this.materials.dark);
    counter.position.set(-2.7, 25.2, 0);
    crane.add(counter);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 10, 6), this.materials.dark);
    cable.position.set(15.4, 20.5, 0);
    crane.add(cable);
    crane.position.set(x, 0, z);
    crane.rotation.y = -0.2;
    this.group.add(crane);
  }

  private addDistantGlassTower(x: number, z: number, height: number): void {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(13, height, 13), this.materials.glass);
    tower.position.set(x, -height * 0.5 + 1, z);
    tower.castShadow = false;
    this.group.add(tower);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(8.5, 1.8, 8.5), this.materials.roofEdge);
    crown.position.set(x, 1.1, z);
    this.group.add(crown);
  }
}
