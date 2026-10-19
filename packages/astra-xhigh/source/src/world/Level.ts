import * as THREE from "three";
import { Architecture, createMaterials, labelTexture } from "./Materials";
import { CollisionWorld } from "./CollisionWorld";
import { createCity } from "./CityGenerator";

export interface Checkpoint {
  position: THREE.Vector3;
  title: string;
  subtitle: string;
  hint: string;
}
export class Level {
  collision = new CollisionWorld();
  checkpoints: Checkpoint[] = [
    {
      position: new THREE.Vector3(0, 42, 18),
      title: "FIRST LIGHT",
      subtitle: "Find your feet",
      hint: "WASD to move  ·  SHIFT to sprint  ·  SPACE to jump",
    },
    {
      position: new THREE.Vector3(0, 42, -61),
      title: "OPEN AIR",
      subtitle: "Commit to the jump",
      hint: "Hold SHIFT + W. Jump at the red edge and hold SPACE for distance.",
    },
    {
      position: new THREE.Vector3(0, 42.5, -183),
      title: "LOW PROFILE",
      subtitle: "Keep your momentum",
      hint: "Sprint, then hold C or CTRL to slide underneath the red ducts.",
    },
    {
      position: new THREE.Vector3(0, 42.5, -291),
      title: "SIDE EFFECT",
      subtitle: "Trust the wall",
      hint: "Sprint and jump beside the red wall. Wall run engages in the air.",
    },
    {
      position: new THREE.Vector3(0, 42.5, -352),
      title: "IN THE FLOW",
      subtitle: "Put it all together",
      hint: "E to vault  ·  Jump beside red walls  ·  C to slide",
    },
    {
      position: new THREE.Vector3(0, 42.5, -503),
      title: "HOME STRETCH",
      subtitle: "Leave nothing behind",
      hint: "Keep sprinting. Follow the red takeoff markers to the finish gate.",
    },
  ];
  flags: THREE.Mesh[] = [];
  beacons: THREE.Mesh[] = [];
  constructor(public scene: THREE.Scene) {
    const m = createMaterials(),
      b = new Architecture(scene),
      c = this.collision;
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      solid = false,
      kind: "roof" | "obstacle" | "ceiling" | "wall" = "obstacle",
    ) => {
      b.box(x, y, z, w, h, d, mat);
      if (solid) return c.add(x, y, z, w, h, d, kind);
    };
    const roof = (start: number, end: number, y: number, width = 22) => {
      const z = (start + end) / 2,
        length = start - end;
      box(0, y / 2 - 5, z, width, y + 10, length, m.glass, true, "roof");
      box(0, y - 0.095, z, width + 0.2, 0.24, length + 0.2, m.concrete);
      for (let yy = 3; yy < y; yy += 4)
        box(0, yy, z, width + 0.08, 0.28, length + 0.08, m.white);
      for (const side of [-1, 1]) {
        box(
          side * (width / 2 - 0.12),
          y + 0.22,
          z,
          0.25,
          0.44,
          length,
          m.white,
          true,
        );
        box(side * (width / 2 + 0.05), y - 1.5, z, 0.22, 2.8, length, m.white);
        for (let zz = end + 3; zz < start - 3; zz += 7) {
          box(side * (width / 2 - 0.2), y + 0.8, zz, 0.09, 1.1, 0.09, m.metal);
        }
        box(
          side * (width / 2 - 0.2),
          y + 1.25,
          z,
          0.07,
          0.07,
          length - 3,
          m.metal,
        );
      }
      // Sparse rooftop equipment leaves a readable central runway.
      for (let zz = end + 10; zz < start - 7; zz += 20) {
        const x = width / 2 - 3.2;
        box(x, y + 0.65, zz, 2.7, 1.3, 2.6, m.white, true);
        box(x, y + 1.32, zz, 2.45, 0.06, 2.3, m.dark);
        for (let k = -0.9; k < 1; k += 0.22)
          box(x, y + 1.37, zz + k, 2.2, 0.06, 0.055, m.metal);
        box(-x, y + 0.18, zz - 5, 1.4, 0.36, 4, m.metal, true);
      }
      // Red takeoff strips sit just inside each open edge.
      box(0, y + 0.015, end + 1.1, 4.5, 0.03, 2.1, m.red);
      for (const x of [-2, 2])
        box(x, y + 0.025, end + 3.3, 0.09, 0.04, 2, m.red);
      this.arrow(0, y + 0.04, end + 6, scene);
    };
    roof(21, -48, 42, 25);
    roof(-54, -86, 42, 21);
    roof(-93, -124, 43, 20);
    roof(-131, -170, 42.5, 22);
    roof(-177, -257, 42.5, 21);
    // A narrow service bridge connects the ventilation roof to the wall-run approach.
    box(0, 42.24, -269.5, 3.8, 0.52, 25, m.white, true, "roof");
    for (const x of [-1.85, 1.85]) {
      box(x, 43.1, -269.5, 0.08, 0.08, 25, m.red);
      for (let z = -258; z > -282; z -= 4)
        box(x, 42.9, z, 0.08, 1.3, 0.08, m.red);
    }
    roof(-282, -312, 42.5, 16);
    roof(-334, -370, 42.5, 18);
    roof(-377, -425, 43, 19);
    roof(-445, -490, 42.5, 19);
    roof(-497, -535, 42.5, 22);
    roof(-542, -580, 43, 21);
    roof(-587, -635, 42.5, 25);
    roof(-642, -690, 43, 22);
    roof(-697, -745, 42.5, 21);
    roof(-752, -810, 42.5, 25);

    const vault = (z: number, y: number, tutorialAssist = false) => {
      const barrier = box(0, y + 0.62, z, 6, 1.24, 0.9, m.red, true)!;
      barrier.tutorialAssist = tutorialAssist;
      box(0, y + 1.25, z, 6.1, 0.06, 1, m.white);
      for (const x of [-2.4, 2.4]) box(x, y + 0.12, z, 0.28, 0.24, 1.6, m.dark);
    };
    vault(-12, 42, true);
    vault(-397, 43);
    const duct = (
      z: number,
      y: number,
      width: number,
      tutorialAssist = false,
    ) => {
      const ceiling = box(
        0,
        y + 1.72,
        z,
        width,
        1.3,
        2.4,
        m.red,
        true,
        "ceiling",
      )!;
      ceiling.tutorialAssist = tutorialAssist;
      for (const x of [-width / 2 + 0.2, width / 2 - 0.2])
        box(x, y + 0.55, z, 0.4, 1.1, 2.4, m.red, true);
      for (let x = -width / 2 + 1; x < width / 2; x += 1.2)
        box(x, y + 1.73, z + 1.22, 0.55, 0.65, 0.025, m.dark);
      box(0, y + 0.02, z + 2, 4, 0.04, 1.5, m.red);
    };
    duct(-29, 42, 8, true);
    duct(-198, 42.5, 20.5);
    duct(-221, 42.5, 20.5);
    duct(-244, 42.5, 20.5);
    duct(-468, 42.5, 18.5);
    const wall = (x: number, start: number, end: number, y: number) => {
      const z = (start + end) / 2;
      box(x, y + 3, z, 0.65, 6, start - end, m.red);
      c.add(x, y + 3, z, 0.65, 6, start - end, "wall", true);
      for (let zz = end + 2; zz < start; zz += 3.6)
        box(x + (x < 0 ? 0.34 : -0.34), y + 2.1, zz, 0.03, 0.12, 2.2, m.white);
      box(x, y + 6.1, z, 0.85, 0.2, start - end + 0.4, m.white);
      // A building fascia under the wall anchors the structure in the city.
      box(x + (x < 0 ? -3 : 3), y / 2 - 5, z, 6, y + 10, start - end, m.glass);
    };
    wall(-1.65, -304, -343, 42.5);
    wall(1.65, -417, -453, 43);

    // The starting rooftop's red communications mast is the visual landmark.
    for (const x of [6.3, 8.2])
      for (const z of [-33, -34.9]) box(x, 49.8, z, 0.18, 15.6, 0.18, m.red);
    for (let y = 42.3; y < 58; y += 2.1) {
      box(7.25, y, -33, 2.1, 0.16, 0.16, m.red);
      box(7.25, y, -34.9, 2.1, 0.16, 0.16, m.red);
      box(6.3, y, -33.95, 0.16, 0.16, 2.1, m.red);
    }
    box(7.25, 42.15, -33.95, 3.4, 0.3, 3.3, m.dark);
    box(7.25, 45.2, -32.8, 1.6, 1.9, 0.32, m.red);
    for (let y = 44.55; y < 45.8; y += 0.18)
      box(7.25, y, -32.62, 1.1, 0.035, 0.04, m.dark);
    const cableGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(7.25, 57.5, -34),
      new THREE.Vector3(8.5, 43, -78),
    ]);
    scene.add(
      new THREE.Line(
        cableGeo,
        new THREE.LineBasicMaterial({ color: 0xe63b2b }),
      ),
    );
    // A broad red launch wedge is a side landmark; the central jump path stays flat.
    const rampGeo = new THREE.BufferGeometry();
    rampGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          4, 42.04, -40, 9, 42.04, -40, 9, 43.2, -46, 4, 42.04, -40, 9, 43.2,
          -46, 4, 43.2, -46, 4, 42.04, -46, 4, 43.2, -46, 9, 43.2, -46, 4,
          42.04, -46, 9, 43.2, -46, 9, 42.04, -46,
        ],
        3,
      ),
    );
    rampGeo.computeVertexNormals();
    const ramp = new THREE.Mesh(rampGeo, m.red.clone());
    ramp.material.side = THREE.DoubleSide;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    scene.add(ramp);

    this.checkpoints.forEach((cp, i) => {
      const y = cp.position.y,
        z = i === 0 ? -6 : cp.position.z - 1;
      box(-4.5, y + 2.2, z, 0.12, 4.4, 0.12, m.metal);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 0.85, 8, 2),
        new THREE.MeshStandardMaterial({
          color: 0xf13925,
          side: THREE.DoubleSide,
          roughness: 0.8,
        }),
      );
      flag.position.set(-3.65, y + 3.8, z);
      scene.add(flag);
      this.flags.push(flag);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.8, 1.4),
        new THREE.MeshBasicMaterial({
          map: labelTexture(String(i + 1).padStart(2, "0"), cp.title),
        }),
      );
      sign.position.set(-5.5, y + 1.4, z);
      scene.add(sign);
      const beacon = new THREE.Mesh(
        new THREE.BoxGeometry(4, 0.025, 0.15),
        new THREE.MeshBasicMaterial({ color: 0xeb4a30 }),
      );
      beacon.position.set(0, y + 0.025, z);
      scene.add(beacon);
      this.beacons.push(beacon);
    });
    for (const x of [-3, 3]) box(x, 46, -796, 0.55, 7, 0.55, m.red, true);
    box(0, 49.3, -796, 6.5, 0.65, 0.65, m.red);
    box(0, 42.52, -796, 6, 0.04, 4, m.red);
    const finish = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.6),
      new THREE.MeshBasicMaterial({
        map: labelTexture("FINISH", "THE CITY IS YOURS.", true),
      }),
    );
    finish.position.set(0, 48.1, -795.65);
    scene.add(finish);

    // A nearby billboard and a striped utility structure add scale to the opening vista.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 6),
      new THREE.MeshStandardMaterial({
        map: labelTexture("FLOW", "TAKE THE HIGH ROAD.", true),
        roughness: 0.8,
      }),
    );
    sign.position.set(28, 53, -67);
    sign.rotation.y = -0.25;
    scene.add(sign);
    box(28, 49, -67, 13, 2, 0.5, m.white);
    box(24, 45, -67, 0.3, 10, 0.3, m.dark);
    box(32, 45, -67, 0.3, 10, 0.3, m.dark);
    createCity(scene, b, m);
    b.finish();
  }
  arrow(x: number, y: number, z: number, scene: THREE.Scene) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.65, 0);
    shape.lineTo(0, -0.8);
    shape.lineTo(0.65, 0);
    shape.lineTo(0.65, 0.35);
    shape.lineTo(0, -0.4);
    shape.lineTo(-0.65, 0.35);
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0xe94230, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }
  animate(time: number) {
    this.flags.forEach((flag, i) => {
      const p = flag.geometry.getAttribute("position");
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v);
        p.setZ(v, Math.sin(x * 4 + time * 3 + i) * 0.1 * (x + 0.85));
      }
      p.needsUpdate = true;
    });
  }
}
