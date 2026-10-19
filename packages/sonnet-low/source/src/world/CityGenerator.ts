import * as THREE from 'three';

/** Sun direction shared by the sky shader and the directional light. */
export const SUN_DIR = new THREE.Vector3(35, 80, 30).normalize();

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Glass office facade tile covering 8 x 8 m (two floors, four window bays). */
export function makeFacadeTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#e4ecf4'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const x = c * 64 + 4, y = r * 128 + 14, w = 56, h = 90;
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, '#6f9fcb'); grad.addColorStop(1, '#2f5f92');
        g.fillStyle = grad; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,.35)';
        g.beginPath(); g.moveTo(x, y + h * 0.6); g.lineTo(x + w * 0.7, y); g.lineTo(x + w, y); g.lineTo(x, y + h); g.fill();
      }
      g.fillStyle = '#ffffff'; g.fillRect(0, r * 128 + 112, s, 6);
    }
  });
}

/** White concrete with faint expansion joints and speckle. Tile covers 6 m. */
export function makeConcreteTexture(): THREE.CanvasTexture {
  const rnd = mulberry32(7);
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#f0f2f4'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2200; i++) {
      const v = 200 + Math.floor(rnd() * 55);
      g.fillStyle = `rgba(${v - 20},${v - 15},${v - 10},${0.12 + rnd() * 0.12})`;
      g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.strokeStyle = '#c9ced4'; g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
  });
}

/** Rescales box UVs so a texture tile covers `cell` metres regardless of the box size. */
export function scaleBoxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, cell: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * dims[f][0] / cell, uv.getY(idx) * dims[f][1] / cell);
    }
  }
  uv.needsUpdate = true;
}

export function makeSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: SUN_DIR.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sun;
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 horizon = vec3(0.60, 0.78, 0.93);
        vec3 zenith = vec3(0.03, 0.22, 0.72);
        vec3 col = mix(horizon, zenith, pow(h, 0.45));
        float s = max(dot(d, normalize(sun)), 0.0);
        col += vec3(1.0, 0.95, 0.8) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.18);
        // soft haze band near the horizon
        col = mix(col, vec3(0.85, 0.92, 0.98), exp(-abs(d.y) * 9.0) * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** Distant skyline built from a handful of InstancedMeshes (3 draw calls for ~200 towers). */
export function buildCity(facade: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const rnd = mulberry32(1234);
  const side = new THREE.MeshStandardMaterial({ map: facade, color: 0xe8f1fa, roughness: 0.25, metalness: 0.15, envMapIntensity: 1.1 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.9 });
  const mats = [side, side, roof, side, side, side];

  const classes = [{ h: 260, items: [] as number[][] }, { h: 310, items: [] as number[][] }, { h: 380, items: [] as number[][] }];
  const BASE = -250;
  for (let gx = -480; gx <= 480; gx += 56) {
    for (let gz = 240; gz >= -820; gz -= 56) {
      const x = gx + (rnd() - 0.5) * 16, z = gz + (rnd() - 0.5) * 16;
      // keep the playable corridor (x within +-34, z from +60 to -400) free
      if (Math.abs(x) < 34 && z < 60 && z > -400) continue;
      const far = Math.max(Math.abs(x) - 60, 0) / 400 + Math.max(-z - 200, 0) / 600;
      const r = rnd();
      const cls = r < 0.45 - far * 0.2 ? 0 : r < 0.8 ? 1 : 2;
      classes[cls].items.push([x, z, 0.7 + rnd() * 0.7, 0.7 + rnd() * 0.7, 0.9 + rnd() * 0.2, rnd()]);
    }
  }
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const c of classes) {
    if (!c.items.length) continue;
    const geo = new THREE.BoxGeometry(24, c.h, 24);
    scaleBoxUV(geo, 24, c.h, 24, 8);
    geo.translate(0, c.h / 2, 0);
    const im = new THREE.InstancedMesh(geo, mats, c.items.length);
    c.items.forEach((it, i) => {
      dummy.position.set(it[0], BASE, it[1]);
      dummy.scale.set(it[2], it[4], it[3]);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      color.setRGB(0.85 + it[5] * 0.15, 0.9 + it[5] * 0.1, 1);
      im.setColorAt(i, color);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    group.add(im);
  }
  // hazy "ground" far below
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xaac4da }),
  );
  ground.position.y = -249;
  group.add(ground);
  return group;
}
