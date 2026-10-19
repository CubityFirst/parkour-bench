import * as THREE from "three";
import { SceneBuilder, seeded } from "./SceneBuilder";

export class CityGenerator {
  readonly flags: THREE.Mesh[] = [];

  constructor(private builder: SceneBuilder) {}

  create(): void {
    const b = this.builder;
    const random = seeded(7538);
    // Blocks follow a street grid, with a lower corridor around the playable roofs.
    for (let row = 0; row < 29; row++) {
      const z = 150 - row * 45;
      for (let column = -7; column <= 7; column++) {
        if (column === 0 || (Math.abs(column) === 1 && random() < 0.26))
          continue;
        if (random() < 0.15) continue;
        const x = column * 48 + (random() - 0.5) * 8;
        const w = 21 + random() * 17;
        const d = 24 + random() * 13;
        const near = Math.abs(column) <= 1;
        const h = near
          ? 24 + random() * 35
          : 35 + Math.pow(random(), 1.6) * 136;
        this.building(x, z, w, d, h, random() > 0.5, random());
      }
    }
    // A few recognizable silhouettes give the skyline a deliberate composition.
    this.building(-115, -260, 30, 32, 174, false, 0.7);
    this.building(-115, -260, 21, 23, 195, false, 0.2);
    b.box(-115, 202, -260, 0.6, 18, 0.6, "edge");
    this.building(126, -300, 31, 36, 163, false, 0.8);
    this.building(126, -300, 22, 28, 180, false, 0.2);
    this.building(80, -445, 24, 28, 196, true, 0.3);
    this.building(-57, -106, 34, 30, 62, true, 0.8);
    this.building(43, -55, 29, 34, 58, false, 0.9);
    this.building(-40, -14, 28, 38, 39, true, 0.9);
    // A distant elevated road establishes scale without adding collision work.
    b.box(-83, 4, -350, 13, 1.6, 1100, "concrete");
    for (let z = 120; z > -950; z -= 80)
      b.box(-83, -5, z, 3, 18, 5, "concrete");
    b.box(0, -14, -350, 1200, 1, 1500, "concrete");
  }

  private building(
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    light: boolean,
    detail: number,
  ): void {
    const b = this.builder;
    b.box(x, h / 2 - 12, z, w, h, d, light ? "glassLight" : "glass");
    b.box(x, h - 11.7, z, w + 0.5, 0.6, d + 0.5, "white");
    if (detail > 0.4) {
      b.box(x - w * 0.2, h - 10.1, z, w * 0.27, 2.7, d * 0.28, "metal");
      b.box(x + w * 0.22, h - 10.5, z + d * 0.2, 2.3, 2, 3.8, "concrete");
      for (let y = 1; y < h - 14; y += 12)
        b.box(x, y, z, w + 0.18, 0.36, d + 0.18, "white");
      for (let xx = -w / 2; xx <= w / 2; xx += w / 5) {
        b.box(x + xx, h / 2 - 12, z + d / 2 + 0.08, 0.15, h, 0.16, "edge");
        b.box(x + xx, h / 2 - 12, z - d / 2 - 0.08, 0.15, h, 0.16, "edge");
      }
    }
    if (detail > 0.82) {
      b.box(x, h - 9.8, z, w * 0.6, 3.2, d * 0.27, "white");
      const text = x > 0 ? "MERIDIAN  /  07" : "EVERY DAY, HIGHER.";
      b.label(
        text,
        x,
        h - 8,
        z + d / 2 + 0.12,
        w * 0.8,
        3.2,
        "#f8f7ee",
        x > 0 ? "#dc4a28" : "#1c637b",
      );
    }
  }

  sky(scene: THREE.Scene): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader:
          "varying vec3 vPosition; void main(){ vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: `varying vec3 vPosition;
        void main(){ float h=normalize(vPosition).y; vec3 lower=vec3(.72,.88,.93); vec3 upper=vec3(.12,.57,.83);
          vec3 col=mix(lower,upper,smoothstep(-.05,.65,h)); gl_FragColor=vec4(col,1.0); }`,
      }),
    );
    scene.add(sky);
    // Feathered, procedural cloud cards. Each is a cluster rather than a flat sky image.
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const c = canvas.getContext("2d")!;
    const random = seeded(45);
    for (let i = 0; i < 50; i++) {
      const x = 80 + random() * 350,
        y = 85 + random() * 85,
        radius = 20 + random() * 58;
      const gradient = c.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,.34)");
      gradient.addColorStop(0.5, "rgba(255,255,255,.16)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = gradient;
      c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 27; i++) {
      const cloud = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          fog: false,
        }),
      );
      cloud.position.set(
        (random() - 0.5) * 1200,
        140 + random() * 190,
        200 - random() * 1500,
      );
      cloud.scale.set(150 + random() * 250, 75 + random() * 80, 1);
      scene.add(cloud);
    }
  }
}
