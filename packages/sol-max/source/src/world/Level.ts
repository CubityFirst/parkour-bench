import * as THREE from "three";
import { CollisionWorld } from "./CollisionWorld";
import { SceneBuilder } from "./SceneBuilder";

export interface Rooftop {
  x: number;
  start: number;
  end: number;
  y: number;
  width: number;
}
export interface Checkpoint {
  position: THREE.Vector3;
  section: number;
  label: string;
}
export const SECTIONS = [
  {
    name: "FIRST LIGHT",
    action: "Find your feet. Follow the red.",
    hint: "W A S D  Move     SHIFT  Sprint     SPACE  Jump",
    z: 16,
  },
  {
    name: "OPEN AIR",
    action: "Commit to the jump.",
    hint: "Hold SHIFT to sprint. Jump at the red edge.",
    z: -114,
  },
  {
    name: "LOW PROFILE",
    action: "Stay low. Keep your momentum.",
    hint: "C / CTRL  Slide under the ventilation ducts",
    z: -250,
  },
  {
    name: "WALK THE WALL",
    action: "Trust the wall. Keep moving.",
    hint: "Sprint + jump beside the red wall. SPACE to kick away.",
    z: -330,
  },
  {
    name: "IN THE FLOW",
    action: "Put it all together.",
    hint: "E  Vault red barriers     SPACE  Jump / wall kick",
    z: -424,
  },
  {
    name: "THE HOME STRETCH",
    action: "One last push. Make it yours.",
    hint: "Follow the red. The finish is straight ahead.",
    z: -565,
  },
];

export const ROOFTOPS: Rooftop[] = [
  { x: 0, start: 26, end: -34, y: 42, width: 30 },
  { x: 0, start: -43, end: -95, y: 42.5, width: 24 },
  { x: -3, start: -104, end: -144, y: 43.5, width: 22 },
  { x: 1, start: -154, end: -188, y: 44.5, width: 22 },
  { x: -2, start: -198, end: -234, y: 44.5, width: 24 },
  { x: -2, start: -242, end: -315, y: 44.5, width: 24 },
  { x: 0, start: -323, end: -350, y: 46, width: 24 },
  { x: 0, start: -370, end: -407, y: 46, width: 22 },
  { x: 3, start: -416, end: -453, y: 47, width: 24 },
  { x: 2, start: -462, end: -492, y: 48, width: 24 },
  { x: 2, start: -512, end: -548, y: 48, width: 24 },
  { x: 2, start: -557, end: -589, y: 49, width: 24 },
  { x: -1, start: -599, end: -634, y: 48.5, width: 24 },
  { x: 0, start: -644, end: -680, y: 48.5, width: 24 },
  { x: 1, start: -690, end: -726, y: 49, width: 24 },
  { x: -1, start: -736, end: -776, y: 48.5, width: 24 },
  { x: 0, start: -786, end: -831, y: 48.5, width: 30 },
];

export class Level {
  readonly world = new CollisionWorld();
  readonly checkpoints: Checkpoint[] = [
    {
      position: new THREE.Vector3(0, 42, 16),
      section: 0,
      label: "First light",
    },
    {
      position: new THREE.Vector3(-1, 43.5, -113),
      section: 1,
      label: "Open air",
    },
    {
      position: new THREE.Vector3(-1, 44.5, -249),
      section: 2,
      label: "Low profile",
    },
    {
      position: new THREE.Vector3(0, 46, -329),
      section: 3,
      label: "Walk the wall",
    },
    {
      position: new THREE.Vector3(3, 47, -423),
      section: 4,
      label: "In the flow",
    },
    {
      position: new THREE.Vector3(2, 49, -564),
      section: 5,
      label: "The home stretch",
    },
  ];
  readonly beacons: THREE.Group[] = [];
  readonly flags: THREE.Mesh[] = [];
  readonly finish = new THREE.Vector3(0, 48.5, -814);

  constructor(readonly builder: SceneBuilder) {}

  create(): void {
    ROOFTOPS.forEach((roof, index) => this.rooftop(roof, index));
    this.startDetails();
    this.vault(0, 42, -5, 6.5, 0.95, 1.4);
    this.vault(0, 42.5, -67, 10, 1.05, 1.05);
    this.tunnel(0, 42.5, -84, 20, 3.2);
    this.vault(-2, 44.5, -218, 11, 0.95, 1.2);
    for (const z of [-263, -282, -303]) this.tunnel(-2, 44.5, z, 22, 4.4);
    this.wallRun(-1.5, 46, -361, 38);
    this.vault(3, 47, -435, 17, 1.15, 1.15);
    this.vault(3, 47, -447, 14, 1.35, 2.2);
    this.tunnel(2, 48, -477, 22, 4.3);
    this.wallRun(0.5, 48, -501, 38);
    this.vault(2, 48, -534, 13, 1.05, 1.2);
    this.serviceBridge();
    this.builder.box(2, 49.1, -575, 4.2, 0.2, 11, "red");
    this.world.add(2, 49.1, -575, 4.2, 0.2, 11, "vault", "Service platform");
    this.checkpoints.slice(1).forEach((cp, i) => this.checkpoint(cp, i + 1));
    this.finishGate();
  }

  private rooftop(r: Rooftop, index: number): void {
    const b = this.builder,
      length = r.start - r.end,
      z = (r.start + r.end) / 2;
    b.box(
      r.x,
      r.y / 2 - 3,
      z,
      r.width,
      r.y + 6,
      length,
      index % 3 === 0 ? "glass" : "glassLight",
    );
    b.box(r.x, r.y - 0.24, z, r.width + 0.2, 0.48, length + 0.1, "roof");
    this.world.add(
      r.x,
      r.y / 2 - 3,
      z,
      r.width,
      r.y + 6,
      length,
      "roof",
      `Rooftop ${index + 1}`,
    );
    b.box(r.x, r.y - 1.1, z, r.width + 0.4, 0.35, length + 0.25, "white");
    // Side parapets protect long run-ups, but the jump edges are always open.
    for (const side of [-1, 1]) {
      const x = r.x + side * (r.width / 2 - 0.15);
      b.box(x, r.y + 0.28, z, 0.32, 0.56, length, "concrete");
      b.box(x, r.y + 0.59, z, 0.48, 0.11, length, "white");
      this.world.add(x, r.y + 0.3, z, 0.36, 0.6, length, "solid", "Parapet");
      // Clean slab joints and corner edging.
      for (let zz = r.start - 8; zz > r.end + 2; zz -= 8) {
        b.box(r.x, r.y + 0.008, zz, r.width - 0.8, 0.008, 0.025, "edge");
      }
    }
    const laneX = index === 0 ? 0 : Math.max(-1, Math.min(2, r.x));
    b.box(laneX, r.y + 0.016, r.end + 0.65, 5.2, 0.032, 1.3, "red");
    b.box(laneX, r.y + 0.012, r.end + 4, 0.12, 0.024, 3.5, "red");
    b.arrow(laneX, r.y, r.end + 6, 1.4);
    b.arrow(laneX, r.y, r.end + 8, 1.4);
    if (index > 0)
      b.box(laneX, r.y + 0.012, r.start - 0.5, 5.2, 0.024, 0.23, "red");
    if (index !== 5 && index !== 6 && index !== 9) {
      this.aircon(r.x + r.width / 2 - 3.3, r.y, z + 3);
      if (index % 2 === 0) this.aircon(r.x - r.width / 2 + 3, r.y, z - 5);
    }
    // Rooftop identity panels can also be read while playing.
    const panel = b.label(
      `${String(Math.min(6, Math.floor(index / 2) + 1)).padStart(2, "0")}   /   MERIDIAN`,
      r.x - r.width / 2 + 4,
      r.y + 0.03,
      r.start - 5,
      4,
      0.65,
      "#718c94",
      "#e7eeeb",
    );
    panel.rotation.x = -Math.PI / 2;
  }

  private aircon(x: number, y: number, z: number): void {
    const b = this.builder;
    b.box(x, y + 0.15, z, 3.9, 0.3, 3.1, "dark");
    b.box(x, y + 0.85, z, 3.6, 1.4, 2.8, "concrete");
    b.box(x, y + 1.57, z, 3.7, 0.12, 2.9, "white");
    for (let i = 0; i < 8; i++)
      b.box(x, y + 0.4 + i * 0.14, z + 1.415, 3.15, 0.06, 0.04, "metal");
    for (const dx of [-0.85, 0.85]) {
      const fan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.58, 0.58, 0.045, 20),
        b.materials.dark,
      );
      fan.position.set(x + dx, y + 1.66, z);
      b.scene.add(fan);
      for (let n = -2; n <= 2; n++)
        b.box(x + dx + n * 0.18, y + 1.69, z, 0.035, 0.035, 1.05, "metal");
    }
    this.world.add(x, y + 0.8, z, 3.75, 1.6, 2.9, "vault", "Air conditioning");
  }

  private vault(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ): void {
    const b = this.builder;
    b.box(x, y + h / 2, z, w, h, d, "red");
    b.box(x, y + h + 0.035, z, w + 0.08, 0.07, d + 0.08, "redDark");
    b.label(
      "↑  VAULT",
      x,
      y + h * 0.55,
      z + d / 2 + 0.015,
      Math.min(3, w - 0.5),
      h * 0.5,
      "#fff5e9",
      "#e93428",
    );
    this.world.add(x, y + h / 2, z, w, h, d, "vault", "Red barrier");
  }

  private tunnel(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
  ): void {
    const b = this.builder;
    const clearance = 1.17;
    b.box(x, y + clearance + 1.4, z, width, 2.8, depth, "white");
    b.box(
      x,
      y + clearance + 0.18,
      z + depth / 2 + 0.025,
      width + 0.06,
      0.36,
      0.12,
      "red",
    );
    b.box(
      x,
      y + clearance + 0.18,
      z - depth / 2 - 0.025,
      width + 0.06,
      0.36,
      0.12,
      "red",
    );
    for (const side of [-1, 1]) {
      b.box(x + side * (width / 2 - 0.22), y + 1, z, 0.45, 2, depth, "metal");
      this.world.add(x + side * (width / 2 - 0.22), y + 1, z, 0.45, 2, depth);
    }
    for (let i = 0; i < 10; i++)
      b.box(
        x,
        y + clearance + 0.6 + i * 0.2,
        z + depth / 2 + 0.04,
        width - 0.8,
        0.08,
        0.08,
        "edge",
      );
    b.label(
      "↓   STAY LOW",
      x,
      y + 2.5,
      z + depth / 2 + 0.09,
      6,
      0.7,
      "#ef382c",
      "#edf2ef",
    );
    this.world.add(
      x,
      y + clearance + 1.4,
      z,
      width,
      2.8,
      depth,
      "solid",
      "Slide duct",
    );
    b.arrow(x, y, z + depth / 2 + 3, 1.2);
  }

  private wallRun(x: number, y: number, z: number, length: number): void {
    const b = this.builder;
    b.box(x, y + 3.2, z, 0.7, 6.4, length, "red");
    b.box(x, y + 6.5, z, 0.92, 0.2, length + 0.2, "white");
    for (let zz = z - length / 2 + 2; zz < z + length / 2; zz += 4) {
      b.box(x + 0.36, y + 3.3, zz, 0.025, 5.6, 0.045, "redDark");
    }
    const text = b.label(
      "KEEP  /  MOVING   →",
      x + 0.361,
      y + 3.8,
      z,
      length * 0.65,
      1.2,
      "#fff2e7",
      "#e93428",
      Math.PI / 2,
    );
    (text.material as THREE.Material).side = THREE.DoubleSide;
    this.world.add(x, y + 3.2, z, 0.7, 6.4, length, "wallrun", "Runner wall");
    b.box(x + 2, y + 0.02, z + length / 2 - 4, 3, 0.04, 1.2, "red");
  }

  private checkpoint(cp: Checkpoint, index: number): void {
    const b = this.builder,
      p = cp.position;
    // Slim red pylons frame a generous checkpoint zone.
    for (const side of [-1, 1]) {
      b.box(p.x + side * 5, p.y + 1.8, p.z, 0.18, 3.6, 0.28, "red");
      b.box(p.x + side * 5, p.y + 3.65, p.z, 0.4, 0.12, 0.4, "white");
    }
    b.box(p.x, p.y + 0.02, p.z, 10, 0.04, 0.14, "red");
    b.label(
      `0${index + 1}  /  ${SECTIONS[index].name}`,
      p.x,
      p.y + 3.2,
      p.z,
      7.4,
      0.65,
      "#f9f6ec",
      "#293e46",
    );
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 6, 20),
      new THREE.MeshBasicMaterial({ color: "#ef3c2d" }),
    );
    ring.position.set(p.x + 5, p.y + 3.95, p.z);
    group.add(ring);
    b.scene.add(group);
    this.beacons.push(group);
  }

  private startDetails(): void {
    const b = this.builder,
      y = 42;
    b.box(0, y + 0.025, 12, 4.8, 0.05, 6.6, "dark");
    for (let i = 0; i < 13; i++)
      b.box(0, y + 0.065, 9 + i * 0.5, 4.8, 0.04, 0.055, "metal");
    for (let i = 0; i < 10; i++)
      b.box(-2.2 + i * 0.5, y + 0.065, 12, 0.045, 0.04, 6.6, "metal");
    // Low red launch ramp, with small physical steps beneath the continuous surface.
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.12, 5.5),
      b.materials.red,
    );
    ramp.position.set(0, y + 0.3, -27.5);
    ramp.rotation.x = 0.1;
    ramp.receiveShadow = true;
    ramp.castShadow = true;
    b.scene.add(ramp);
    for (let i = 0; i < 5; i++)
      this.world.add(
        0,
        y + (i + 1) * 0.055,
        -25.1 - i * 1.05,
        4.6,
        (i + 1) * 0.11,
        1.1,
        "vault",
        "Launch ramp",
      );
    b.box(-9.3, y + 0.12, -13, 4.4, 0.24, 4.4, "redDark");
    const mastHeight = 21;
    for (const dx of [-1.35, 1.35])
      for (const dz of [-1.35, 1.35]) {
        b.box(
          -9.3 + dx,
          y + mastHeight / 2,
          -13 + dz,
          0.26,
          mastHeight,
          0.26,
          "red",
        );
      }
    for (let h = 1; h < mastHeight; h += 3.2) {
      b.box(-9.3, y + h, -11.65, 2.9, 0.2, 0.23, "red");
      b.box(-9.3, y + h, -14.35, 2.9, 0.2, 0.23, "red");
      b.beam(
        new THREE.Vector3(-10.65, y + h, -11.65),
        new THREE.Vector3(-7.95, y + h + 3, -11.65),
        0.065,
      );
    }
    b.box(-9.3, y + mastHeight, -13, 3.2, 0.65, 3.2, "red");
    b.box(1, y + mastHeight + 0.6, -13, 25, 0.48, 1.1, "red");
    b.beam(
      new THREE.Vector3(-9.3, y + mastHeight + 6, -13),
      new THREE.Vector3(13, y + mastHeight + 0.5, -13),
      0.04,
      "dark",
    );
    b.box(-9.3, y + mastHeight + 3, -13, 0.25, 6, 0.25, "red");
    b.box(-9.3, y + 2, -11.25, 2.5, 3, 0.6, "red");
    for (let i = 0; i < 10; i++)
      b.box(-9.3, y + 1 + i * 0.19, -10.93, 1.7, 0.055, 0.025, "redDark");
    this.world.add(-9.3, y + 2, -13, 3.2, 4, 3.4);
    b.label("07", -9.3, y + 4.4, -11.21, 1.6, 1.1, "#fff2e8", "#e93428");
    // A zipline silhouette is part of the city infrastructure, outside the route.
    b.beam(
      new THREE.Vector3(-9.3, y + 17, -13),
      new THREE.Vector3(-25, 36, -125),
      0.035,
      "dark",
    );
    this.aircon(9, y, -5);
    this.aircon(9, y, -9);
    b.box(-12, y + 1.8, -26, 4.3, 3.6, 6, "white");
    b.box(-11.8, y + 1.35, -22.96, 1.6, 2.7, 0.1, "red");
    b.label(
      "ACCESS  /  ROOF",
      -12,
      y + 3.05,
      -22.89,
      3.5,
      0.45,
      "#3b5661",
      "#e9efec",
    );
    this.world.add(-12, y + 1.8, -26, 4.3, 3.6, 6);
    for (const z of [-26, -90, -144, -234, -315, -407, -548, -634, -776])
      this.flag(9, 46, z);
  }

  private flag(x: number, y: number, z: number): void {
    const b = this.builder;
    const roof = ROOFTOPS.find((r) => z < r.start && z > r.end);
    if (roof) y = roof.y;
    b.box(x, y + 2.7, z, 0.055, 5.4, 0.055, "metal");
    const geometry = new THREE.PlaneGeometry(2.3, 1.25, 10, 4);
    geometry.translate(1.15, 0, 0);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: "#ee392a",
        side: THREE.DoubleSide,
        roughness: 0.8,
      }),
    );
    mesh.position.set(x, y + 4.55, z);
    mesh.rotation.y = -0.4;
    b.scene.add(mesh);
    this.flags.push(mesh);
  }

  private finishGate(): void {
    const b = this.builder,
      p = this.finish;
    for (const side of [-1, 1]) {
      b.box(side * 5, p.y + 3.5, p.z, 0.7, 7, 0.7, "red");
      this.world.add(side * 5, p.y + 3.5, p.z, 0.7, 7, 0.7);
    }
    b.box(0, p.y + 7, p.z, 10.7, 1.5, 0.7, "red");
    b.label(
      "F I N I S H",
      0,
      p.y + 7,
      p.z + 0.36,
      8.6,
      1.1,
      "#fff7ef",
      "#e93428",
    );
    for (let i = -5; i < 5; i++)
      for (let j = 0; j < 2; j++) {
        b.box(
          i + 0.5,
          p.y + 0.026,
          p.z + j,
          1,
          0.052,
          1,
          (i + j) % 2 === 0 ? "red" : "white",
        );
      }
    b.label(
      "ABOVE THE ORDINARY.",
      0,
      p.y + 2.2,
      p.z - 13,
      12,
      1.7,
      "#f7f4ee",
      "#273f48",
    );
    b.box(0, p.y + 1.7, p.z - 13.1, 15, 3.4, 0.3, "dark");
    this.world.add(0, p.y + 1.7, p.z - 13.1, 15, 3.4, 0.3);
  }

  private serviceBridge(): void {
    const b = this.builder;
    b.box(0, 44.31, -238, 3.4, 0.38, 12, "red");
    this.world.add(0, 44.31, -238, 3.4, 0.38, 12, "roof", "Service bridge");
    b.box(0, 44.51, -238, 3.1, 0.02, 12, "dark");
    for (let z = -232.5; z > -244; z -= 0.35)
      b.box(0, 44.54, z, 3.1, 0.04, 0.035, "metal");
    for (const side of [-1, 1]) {
      b.box(side * 1.65, 45.45, -238, 0.075, 0.075, 12, "red");
      this.world.add(side * 1.65, 44.98, -238, 0.075, 1, 12);
      for (const z of [-233, -238, -243])
        b.box(side * 1.65, 44.98, z, 0.075, 1, 0.075, "metal");
    }
  }

  animate(time: number): void {
    this.flags.forEach((flag, index) => {
      const position = flag.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        position.setZ(
          i,
          Math.sin(x * 3.2 - time * 5 + index) * 0.18 * x +
            Math.sin(time * 2.4 + x * 5) * 0.04 * x,
        );
      }
      position.needsUpdate = true;
    });
    this.beacons.forEach((group, index) => {
      group.rotation.y = Math.sin(time + index) * 0.12;
    });
  }
}
