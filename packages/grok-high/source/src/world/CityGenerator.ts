import * as THREE from 'three';

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function facadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#d5e4ee';
    g.fillRect(0, 0, 128, 256);
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 6; col++) {
        const lit = (row * 5 + col * 3) % 17 === 0;
        const shade = (row + col) % 5 === 0;
        g.fillStyle = lit ? '#f3d7b0' : shade ? '#c3d5e2' : '#eef5f8';
        g.fillRect(8 + col * 20, 8 + row * 16, 12, 10);
      }
    }
    g.strokeStyle = '#b7c9d4';
    g.lineWidth = 2;
    for (let row = 0; row <= 16; row++) {
      g.beginPath();
      g.moveTo(0, row * 16);
      g.lineTo(128, row * 16);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function labelTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 160);
    g.fillStyle = fg;
    g.font = '700 64px Segoe UI, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 84);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Background skyline. Nothing here is collidable or reachable from the route. */
export class CityGenerator {
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const rand = mulberry32(19);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: facadeTexture(),
      roughness: 0.38,
      metalness: 0.45,
    });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe7eef3, roughness: 0.86, metalness: 0.04 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xc5ced6, roughness: 0.8 });
    const glass: THREE.Matrix4[] = [];
    const white: THREE.Matrix4[] = [];
    const caps: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const push = (list: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      dummy.position.set(x, y, z);
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      list.push(dummy.matrix.clone());
    };

    const zs = [-78, -54, -36, 36, 54, 78];
    for (let x = -140; x <= 680; x += 24) {
      for (const z of zs) {
        if (rand() < 0.18) continue;
        const w = 9 + rand() * 8;
        const d = 9 + rand() * 8;
        const h = 16 + rand() * (rand() > 0.82 ? 78 : 42);
        const glassBuilding = rand() > 0.42;
        push(glassBuilding ? glass : white, x, h * 0.5, z, w, h, d);
        push(caps, x, h + 0.4, z, w * 0.72, 0.8, d * 0.72);
      }
    }

    const unit = new THREE.BoxGeometry(1, 1, 1);
    const addInst = (list: THREE.Matrix4[], mat: THREE.Material) => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(unit, mat, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
    };
    addInst(glass, glassMat);
    addInst(white, whiteMat);
    addInst(caps, capMat);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ color: 0xc9d3db, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    this.group.add(ground);

    this.addCrane(-30, -40);
    this.addCrane(120, 42);
    this.addBillboard(-55, 28, 34, 'NORTHLINE', 0);
    this.addBillboard(210, 24, -36, 'HELIO', Math.PI);
    this.addBillboard(400, 22, 36, 'APEX', 0);
    this.addBillboard(560, 26, -34, 'VANTAGE', Math.PI);
  }

  private addCrane(x: number, z: number): void {
    const red = new THREE.MeshStandardMaterial({ color: 0xd01218, roughness: 0.45, metalness: 0.15 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.1, 68, 1.1), red);
    mast.position.set(x, 34, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(28, 0.5, 0.5), red);
    arm.position.set(x + 8, 66, z);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 2.2), red);
    cab.position.set(x, 63, z);
    this.group.add(mast, arm, cab);
    const orange = new THREE.MeshStandardMaterial({
      color: 0xe36a1e,
      roughness: 0.72,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.5), orange);
      cloth.position.set(x + 3.5 + i * 5.2, 64.3, z);
      this.group.add(cloth);
    }
  }

  private addBillboard(x: number, y: number, z: number, text: string, rotY: number): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 4.4),
      new THREE.MeshStandardMaterial({
        map: labelTexture(text, '#f4f1ea', '#e10600'),
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.group.add(mesh);
  }
}

export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(420, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: new THREE.Vector3(0.42, 0.82, 0.28).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 sunDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, -0.05, 1.0);
        vec3 zenith = vec3(0.36, 0.68, 0.95);
        vec3 mid = vec3(0.62, 0.82, 0.96);
        vec3 horizon = vec3(0.78, 0.88, 0.94);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.35, h));
        col = mix(col, zenith, smoothstep(0.2, 0.85, h));
        float cloud = sin(dir.x * 5.0 + dir.z * 3.5) * sin(dir.z * 6.0 - dir.x * 2.2);
        cloud = smoothstep(0.2, 0.95, cloud) * smoothstep(0.02, 0.4, dir.y);
        col = mix(col, vec3(0.97, 0.98, 1.0), cloud * 0.5);
        float sun = pow(max(dot(dir, sunDir), 0.0), 700.0);
        col += vec3(1.0, 0.95, 0.86) * sun * 1.15;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
