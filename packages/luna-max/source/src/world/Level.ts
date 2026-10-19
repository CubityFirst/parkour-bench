import * as THREE from "three";

export interface Platform {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  top: number;
  section: string;
}
export interface SolidObstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
  bottom: number;
  top: number;
  vaultable: boolean;
  label: string;
}
export interface WallRunSurface {
  x: number;
  width: number;
  minZ: number;
  maxZ: number;
  bottom: number;
  top: number;
  label: string;
}
export interface Checkpoint {
  name: string;
  position: THREE.Vector3;
  platformId: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class Level {
  readonly platforms: Platform[] = [];
  readonly obstacles: SolidObstacle[] = [];
  readonly wallRunSurfaces: WallRunSurface[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly startPosition = new THREE.Vector3(0, 0, 8);
  readonly finishZ = -351;
  readonly routeLength = 360;
  private readonly cityBodyGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly cityGlassGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly whiteRoof = new THREE.MeshStandardMaterial({ color: 0xf5f7f5, roughness: 0.86 });
  private readonly roofEdge = new THREE.MeshStandardMaterial({ color: 0xc5d2d5, roughness: 0.76 });
  private readonly glassWall = new THREE.MeshStandardMaterial({ color: 0x91b9c8, roughness: 0.35, metalness: 0.2 });
  private readonly redMaterial = new THREE.MeshStandardMaterial({ color: 0xec392e, roughness: 0.42, metalness: 0.08, emissive: 0x3a0907 });
  private readonly darkMaterial = new THREE.MeshStandardMaterial({ color: 0x344653, roughness: 0.62 });
  private readonly ventMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa9ac, roughness: 0.78 });
  private readonly trimMaterial = new THREE.MeshStandardMaterial({ color: 0xe1e8e8, roughness: 0.65 });

  constructor(private readonly scene: THREE.Scene) {
    this.buildRoute();
    this.buildCity();
    this.buildRooftopDetails();
    this.buildCheckpoints();
    this.buildFinishGate();
  }

  private box(
    width: number, height: number, depth: number, x: number, y: number, z: number,
    material: THREE.Material, castShadow = true, receiveShadow = true
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    this.scene.add(mesh);
    return mesh;
  }

  private buildRoute(): void {
    const route: Array<[number, number, number, number, number, string]> = [
      [0, 0, 22, 28, 0, "THE START"],
      [2, -32, 17, 18, 0.8, "ROOFTOP JUMPS"],
      [-4, -62, 16, 20, 1.5, "ROOFTOP JUMPS"],
      [-4, -91, 18, 20, 1.5, "SLIDE LOW"],
      [4, -128, 18, 20, 2.2, "WALL RUN"],
      [2, -159, 18, 22, 1.2, "PARKOUR COMBINATION"],
      [-3, -190, 17, 20, 2.0, "PARKOUR COMBINATION"],
      [2, -220, 18, 20, 1.7, "CITY FLOW"],
      [2, -251, 18, 22, 2.4, "CITY FLOW"],
      [-4, -282, 19, 22, 2.1, "CITY FLOW"],
      [1, -313, 20, 22, 2.3, "FINAL SPRINT"],
      [3, -347, 22, 24, 2.8, "FINAL SPRINT"]
    ];
    route.forEach(([x, z, width, depth, top, section], id) => {
      const platform: Platform = { id, x, z, width, depth, top, section };
      this.platforms.push(platform);
      this.buildRoof(platform);
    });
    // A low canopy over a clear center lane makes the wall run the reliable route across this gap.
    const wall: WallRunSurface = { x: 6.35, width: 0.34, minZ: -120, maxZ: -101, bottom: 1.5, top: 7.1, label: "RED WALL RUN" };
    this.wallRunSurfaces.push(wall);
    this.box(wall.width, wall.top - wall.bottom, wall.maxZ - wall.minZ, wall.x, (wall.top + wall.bottom) / 2, (wall.maxZ + wall.minZ) / 2, this.redMaterial);
    this.box(wall.width + 0.45, 0.22, wall.maxZ - wall.minZ + 0.45, wall.x, wall.top, (wall.maxZ + wall.minZ) / 2, this.darkMaterial);
    this.box(0.1, 0.08, wall.maxZ - wall.minZ - 0.5, wall.x - 0.24, wall.bottom + 0.18, (wall.maxZ + wall.minZ) / 2, this.redMaterial, false);

    // Tutorial vault block.
    this.addObstacle({ x: 0, z: -5.3, width: 1.65, depth: 0.7, bottom: 0, top: 0.88, vaultable: true, label: "LOW BARRIER" }, true);
    // Raised ventilation housings leave a crouch-height channel underneath.
    const slideRoof = this.platforms[3].top;
    [-84.6, -89.2, -93.8].forEach((z, index) => {
      const laneX = -4;
      const beamBottom = slideRoof + 0.82;
      const beamTop = slideRoof + 1.95;
      const beamDepth = 0.72;
      this.addObstacle({ x: laneX, z, width: 5.25, depth: beamDepth, bottom: beamBottom, top: beamTop, vaultable: false, label: "VENTILATION CANOPY" }, false);
      this.box(5.25, beamTop - beamBottom, beamDepth, laneX, (beamTop + beamBottom) / 2, z, index === 1 ? this.redMaterial : this.ventMaterial);
      [-2.7, 2.7].forEach((side) => {
        this.box(0.25, beamBottom - slideRoof, 0.34, laneX + side, slideRoof + (beamBottom - slideRoof) / 2, z, this.ventMaterial);
      });
      this.box(5.4, 0.08, 0.12, laneX, beamTop - 0.12, z - beamDepth / 2 - 0.03, this.trimMaterial, false);
    });

    // A second marked hurdle rewards a clean vault in the combination section.
    const comboRoof = this.platforms[5].top;
    this.addObstacle({ x: 2, z: -161.2, width: 1.8, depth: 0.75, bottom: comboRoof, top: comboRoof + 0.92, vaultable: true, label: "RED HURDLE" }, true);
    this.addObstacle({ x: 7.8, z: -44, width: 2.0, depth: 2.0, bottom: 0.8, top: 2.2, vaultable: false, label: "ROOF HVAC" }, false);
    this.box(2, 1.4, 2, 7.8, 1.5, -44, this.ventMaterial);
    this.addObstacle({ x: -9, z: -64, width: 2.1, depth: 2.4, bottom: 1.5, top: 3.1, vaultable: false, label: "ROOF HVAC" }, false);
    this.box(2.1, 1.6, 2.4, -9, 2.3, -64, this.ventMaterial);
  }

  private buildRoof(platform: Platform): void {
    const top = platform.top;
    const depthBelow = platform.id === 0 ? 28 : 22 + (platform.id % 3) * 3;
    const bodyHeight = depthBelow - 0.8;
    this.box(platform.width + 0.6, bodyHeight, platform.depth + 0.6, platform.x, top - 0.8 - bodyHeight / 2, platform.z, this.glassWall, false);
    this.box(platform.width + 0.85, 0.8, platform.depth + 0.85, platform.x, top - 0.4, platform.z, this.roofEdge);
    this.box(platform.width, 0.12, platform.depth, platform.x, top - 0.06, platform.z, this.whiteRoof);

    // Fine roof seams and a restrained parapet make the running surface readable.
    for (let dx = -Math.floor(platform.width / 2) + 2; dx < platform.width / 2; dx += 4) {
      this.box(0.018, 0.018, platform.depth - 1.2, platform.x + dx, top + 0.008, platform.z, this.trimMaterial, false, false);
    }
    const sideRail = new THREE.MeshStandardMaterial({ color: 0xe7eeee, roughness: 0.68 });
    [-1, 1].forEach((side) => {
      this.box(0.2, 0.62, platform.depth - 1.1, platform.x + side * (platform.width / 2 - 0.18), top + 0.31, platform.z, sideRail, false);
    });

    // Red chevron at the outgoing edge. The path itself stays mostly white.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.05, 3), this.redMaterial);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(platform.x, top + 0.09, platform.z - platform.depth / 2 + 2.4);
    arrow.castShadow = true;
    this.scene.add(arrow);

    if (platform.id === 0) {
      this.box(0.18, 1.75, 0.18, -8.5, top + 0.88, -8, this.redMaterial);
      this.box(0.18, 1.75, 0.18, 8.5, top + 0.88, -8, this.redMaterial);
      this.box(17.2, 0.12, 0.18, 0, top + 1.72, -8, this.redMaterial);
      this.box(0.06, 1.4, 0.08, -8.35, top + 0.95, -8.06, this.trimMaterial, false);
    }
  }

  private addObstacle(obstacle: SolidObstacle, addRedMark: boolean): void {
    this.obstacles.push(obstacle);
    if (addRedMark) {
      this.box(obstacle.width, 0.12, obstacle.depth + 0.08, obstacle.x, obstacle.top - 0.06, obstacle.z, this.redMaterial);
      const faceZ = obstacle.z - obstacle.depth / 2 - 0.015;
      this.box(obstacle.width * 0.78, 0.12, 0.035, obstacle.x, obstacle.bottom + 0.25, faceZ, this.trimMaterial, false);
    }
  }

  private buildRooftopDetails(): void {
    // Compact air vents sit outside the route line and add scale without clutter.
    const rooftopUnits: Array<[number, number, number, number, number]> = [
      [-6.9, -12, 2.2, 0.8, 1.3], [7.5, -18, 2.4, 0.9, 1.6],
      [-8.8, -35, 2.2, 0.7, 1.6], [7.3, -57, 2.0, 0.8, 1.5],
      [-9.2, -96, 2.0, 0.8, 1.6], [10.6, -154, 2.2, 0.7, 1.5],
      [-10.5, -185, 2.4, 0.8, 1.8], [10.3, -213, 2.0, 0.7, 1.5],
      [-9.2, -247, 2.2, 0.75, 1.6], [8.8, -275, 2.4, 0.8, 1.5],
      [-9.6, -308, 2.2, 0.85, 1.7]
    ];
    rooftopUnits.forEach(([x, z, width, height, depth]) => {
      const platform = this.platformForPoint(x, z);
      if (!platform) return;
      this.box(width, height, depth, x, platform.top + height / 2, z, this.ventMaterial);
      this.box(width * 0.72, 0.06, depth + 0.04, x, platform.top + height + 0.03, z, this.trimMaterial, false);
      this.box(width * 0.7, 0.08, 0.04, x, platform.top + height * 0.72, z - depth / 2 - 0.02, this.darkMaterial, false);
    });
    // Small red route studs repeat at the launch edges.
    this.platforms.forEach((platform, index) => {
      const z = platform.z - platform.depth / 2 + 0.75;
      this.box(0.12, 0.035, 1.25, platform.x - 0.72, platform.top + 0.025, z, this.redMaterial, false, false);
      this.box(0.12, 0.035, 1.25, platform.x + 0.72, platform.top + 0.025, z, this.redMaterial, false, false);
      if (index === 4 || index === 8) {
        this.box(0.12, 2.1, 0.12, platform.x - platform.width / 2 + 0.9, platform.top + 1.05, platform.z, this.redMaterial);
      }
    });
  }

  private buildCheckpoints(): void {
    const marks: Array<[number, number, number, string]> = [
      [0, 0, 8, "START"],
      [3, 0, -88, "SLIDE LINE"],
      [5, 2, -157, "HIGH ROUTE"],
      [8, 2, -250, "CITY FLOW"],
      [10, 1, -310, "FINAL SPRINT"]
    ];
    marks.forEach(([platformId, x, z, name], index) => {
      const platform = this.platforms[platformId];
      const position = new THREE.Vector3(x, platform.top, z);
      this.checkpoints.push({ name, position, platformId });
      if (index === 0) return;
      const mastX = x + 2.4;
      this.box(0.11, 2.6, 0.11, mastX, platform.top + 1.3, z, this.redMaterial);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.08, 8, 24), this.redMaterial);
      ring.position.set(mastX, platform.top + 2.3, z);
      ring.rotation.y = Math.PI / 2;
      ring.castShadow = true;
      this.scene.add(ring);
      this.box(1.2, 0.12, 0.12, mastX - 0.42, platform.top + 2.25, z, this.trimMaterial, false);
    });
  }

  private buildFinishGate(): void {
    const platform = this.platforms[this.platforms.length - 1];
    const z = this.finishZ;
    const top = platform.top;
    const halfOpening = 6.2;
    this.box(0.35, 4.4, 0.35, platform.x - halfOpening, top + 2.2, z, this.redMaterial);
    this.box(0.35, 4.4, 0.35, platform.x + halfOpening, top + 2.2, z, this.redMaterial);
    this.box(halfOpening * 2 + 0.35, 0.32, 0.35, platform.x, top + 4.3, z, this.redMaterial);
    this.box(halfOpening * 2 - 0.8, 0.055, 0.08, platform.x, top + 4.02, z - 0.19, this.trimMaterial, false);
    const finishLine = new THREE.Mesh(new THREE.BoxGeometry(halfOpening * 2 - 0.8, 0.025, 0.16), this.redMaterial);
    finishLine.position.set(platform.x, top + 0.025, z);
    this.scene.add(finishLine);
  }

  private buildCity(): void {
    type Building = { x: number; z: number; width: number; depth: number; height: number; tint: number };
    const buildings: Building[] = [];
    let seed = 74129;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const zRows = [70, 25, -25, -75, -125, -175, -225, -275, -325, -375, -425, -475];
    const xCols = [-142, -108, -77, -48, 48, 77, 108, 142];
    zRows.forEach((baseZ) => xCols.forEach((baseX, col) => {
      if (Math.abs(baseX) < 55 && (col === 2 || col === 5)) return;
      const x = baseX + (random() - 0.5) * 15;
      const z = baseZ + (random() - 0.5) * 25;
      const width = 11 + random() * 14;
      const depth = 11 + random() * 15;
      const nearStreet = Math.abs(baseX) < 55;
      const height = nearStreet ? 15 + random() * 24 : 28 + Math.pow(random(), 0.7) * 125;
      const tint = random();
      buildings.push({ x, z, width, depth, height, tint });
    }));
    // Far skyline silhouettes frame the run from either end.
    for (let i = 0; i < 28; i++) {
      const x = (random() - 0.5) * 460;
      const z = i < 14 ? 160 + random() * 150 : -490 - random() * 180;
      const width = 14 + random() * 25;
      const depth = 14 + random() * 26;
      const height = 85 + random() * 190;
      buildings.push({ x, z, width, depth, height, tint: random() });
    }

    const bodies = new THREE.InstancedMesh(
      this.cityBodyGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.15 }),
      buildings.length
    );
    bodies.castShadow = false;
    bodies.receiveShadow = true;
    const glassCount = buildings.reduce((sum, building) => sum + Math.min(12, Math.max(4, Math.floor(building.height / 9))) * 4, 0);
    const glass = new THREE.InstancedMesh(
      this.cityGlassGeometry,
      new THREE.MeshStandardMaterial({ color: 0x345366, roughness: 0.26, metalness: 0.35 }),
      glassCount
    );
    glass.castShadow = false;
    glass.receiveShadow = false;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    let glassIndex = 0;

    buildings.forEach((building, i) => {
      position.set(building.x, building.height / 2 - 4, building.z);
      scale.set(building.width, building.height, building.depth);
      matrix.compose(position, quaternion, scale);
      bodies.setMatrixAt(i, matrix);
      const base = new THREE.Color().setHSL(0.53 + building.tint * 0.035, 0.18 + building.tint * 0.12, 0.67 + building.tint * 0.12);
      bodies.setColorAt(i, base);

      const floors = Math.min(12, Math.max(4, Math.floor(building.height / 9)));
      for (let floor = 1; floor < floors; floor++) {
        const y = -4 + (building.height / floors) * floor;
        const bandHeight = Math.min(0.82, building.height / floors * 0.3);
        const faceColor = new THREE.Color().setHSL(0.55 + building.tint * 0.035, 0.34, 0.28 + building.tint * 0.18);
        const faces: Array<[number, number, number, number, number, number]> = [
          [building.width * 0.88, bandHeight, 0.08, building.x, y, building.z + building.depth / 2 + 0.02],
          [building.width * 0.88, bandHeight, 0.08, building.x, y, building.z - building.depth / 2 - 0.02],
          [0.08, bandHeight, building.depth * 0.86, building.x + building.width / 2 + 0.02, y, building.z],
          [0.08, bandHeight, building.depth * 0.86, building.x - building.width / 2 - 0.02, y, building.z]
        ];
        faces.forEach(([w, h, d, x, fy, z]) => {
          position.set(x, fy, z);
          scale.set(w, h, d);
          matrix.compose(position, quaternion, scale);
          glass.setMatrixAt(glassIndex, matrix);
          glass.setColorAt(glassIndex, faceColor);
          glassIndex++;
        });
      }
    });
    bodies.instanceMatrix.needsUpdate = true;
    glass.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
    this.scene.add(bodies, glass);
  }

  private platformForPoint(x: number, z: number): Platform | undefined {
    return this.platforms.find((platform) =>
      Math.abs(x - platform.x) < platform.width / 2 - 0.5 &&
      Math.abs(z - platform.z) < platform.depth / 2 - 0.5
    );
  }

  getSupport(x: number, z: number, feetY: number, radius: number): Platform | undefined {
    let best: Platform | undefined;
    for (const platform of this.platforms) {
      if (Math.abs(x - platform.x) > platform.width / 2 + radius * 0.15) continue;
      if (Math.abs(z - platform.z) > platform.depth / 2 + radius * 0.15) continue;
      if (Math.abs(feetY - platform.top) < 0.2 && (!best || platform.top > best.top)) best = platform;
    }
    return best;
  }

  findLanding(x: number, z: number, fromY: number, toY: number, radius: number): Platform | undefined {
    let best: Platform | undefined;
    for (const platform of this.platforms) {
      if (Math.abs(x - platform.x) > platform.width / 2 + radius * 0.2) continue;
      if (Math.abs(z - platform.z) > platform.depth / 2 + radius * 0.2) continue;
      if (platform.top <= fromY + 0.08 && platform.top >= toY - 0.06 && (!best || platform.top > best.top)) best = platform;
    }
    return best;
  }

  resolveHorizontal(
    currentX: number, currentZ: number, nextX: number, nextZ: number,
    feetY: number, height: number, radius: number
  ): THREE.Vector2 {
    let x = nextX;
    let z = currentZ;
    for (const obstacle of this.obstacles) {
      if (feetY >= obstacle.top || feetY + height <= obstacle.bottom) continue;
      const overlapsZ = Math.abs(z - obstacle.z) < obstacle.depth / 2 + radius;
      const overlapsX = Math.abs(x - obstacle.x) < obstacle.width / 2 + radius;
      if (overlapsZ && overlapsX) {
        x = currentX <= obstacle.x ? obstacle.x - obstacle.width / 2 - radius - 0.015 : obstacle.x + obstacle.width / 2 + radius + 0.015;
      }
    }
    z = nextZ;
    for (const obstacle of this.obstacles) {
      if (feetY >= obstacle.top || feetY + height <= obstacle.bottom) continue;
      const overlapsX = Math.abs(x - obstacle.x) < obstacle.width / 2 + radius;
      const overlapsZ = Math.abs(z - obstacle.z) < obstacle.depth / 2 + radius;
      if (overlapsX && overlapsZ) {
        z = currentZ <= obstacle.z ? obstacle.z - obstacle.depth / 2 - radius - 0.015 : obstacle.z + obstacle.depth / 2 + radius + 0.015;
      }
    }
    return new THREE.Vector2(x, z);
  }

  canOccupy(x: number, z: number, feetY: number, height: number, radius: number): boolean {
    return !this.obstacles.some((obstacle) =>
      feetY < obstacle.top && feetY + height > obstacle.bottom &&
      Math.abs(x - obstacle.x) < obstacle.width / 2 + radius &&
      Math.abs(z - obstacle.z) < obstacle.depth / 2 + radius
    );
  }

  findVaultTarget(x: number, z: number, forwardX: number, forwardZ: number, radius: number): THREE.Vector3 | undefined {
    for (const obstacle of this.obstacles) {
      if (!obstacle.vaultable) continue;
      const dx = obstacle.x - x;
      const dz = obstacle.z - z;
      const along = dx * forwardX + dz * forwardZ;
      const lateral = Math.abs(dx * forwardZ - dz * forwardX);
      if (along < 0.25 || along > 2.3 || lateral > obstacle.width / 2 + radius) continue;
      const halfDepthAlong = Math.abs(forwardX) * obstacle.width / 2 + Math.abs(forwardZ) * obstacle.depth / 2;
      const distance = along + halfDepthAlong + radius + 0.9;
      return new THREE.Vector3(x + forwardX * distance, obstacle.bottom, z + forwardZ * distance);
    }
    return undefined;
  }

  findMantleTarget(x: number, y: number, z: number, forwardX: number, forwardZ: number, radius: number): THREE.Vector3 | undefined {
    for (const platform of this.platforms) {
      const rise = platform.top - y;
      if (rise < 0.25 || rise > 1.55) continue;
      const minX = platform.x - platform.width / 2 + radius + 0.2;
      const maxX = platform.x + platform.width / 2 - radius - 0.2;
      const minZ = platform.z - platform.depth / 2 + radius + 0.2;
      const maxZ = platform.z + platform.depth / 2 - radius - 0.2;
      const targetX = clamp(x, minX, maxX);
      const targetZ = clamp(z, minZ, maxZ);
      const dx = targetX - x;
      const dz = targetZ - z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.2 || distance > 1.4) continue;
      if (dx * forwardX + dz * forwardZ < -0.15) continue;
      return new THREE.Vector3(targetX, platform.top, targetZ);
    }
    return undefined;
  }

  getWallRunSurface(x: number, feetY: number, z: number, radius: number): { surface: WallRunSurface; side: number; targetX: number } | undefined {
    for (const surface of this.wallRunSurfaces) {
      if (z < surface.minZ - 0.3 || z > surface.maxZ + 0.3) continue;
      if (feetY > surface.top || feetY + 1.7 < surface.bottom) continue;
      const signed = surface.x - x;
      const distance = Math.abs(signed);
      const minimum = surface.width / 2 + radius + 0.02;
      if (distance < minimum - 0.1 || distance > 1.35) continue;
      const side = signed >= 0 ? 1 : -1;
      return { surface, side, targetX: surface.x - side * minimum };
    }
    return undefined;
  }

  checkpointAt(position: THREE.Vector3, nextIndex: number): Checkpoint | undefined {
    const checkpoint = this.checkpoints[nextIndex];
    if (!checkpoint || nextIndex === 0) return undefined;
    const platform = this.platforms[checkpoint.platformId];
    if (Math.abs(position.y - platform.top) > 1.1) return undefined;
    if (Math.hypot(position.x - checkpoint.position.x, position.z - checkpoint.position.z) < 5.3) return checkpoint;
    return undefined;
  }

  getSection(z: number): string {
    if (z > -23) return "THE START";
    if (z > -81) return "ROOFTOP JUMPS";
    if (z > -102) return "SLIDE LOW";
    if (z > -145) return "WALL RUN";
    if (z > -178) return "PARKOUR COMBINATION";
    if (z > -299) return "CITY FLOW";
    return "FINAL SPRINT";
  }

  getProgress(z: number): number {
    return clamp((8 - z) / this.routeLength, 0, 1);
  }
}




