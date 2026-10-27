import * as THREE from 'three';

/**
 * Builds merged box geometry with world-space UVs so a single tiling texture
 * (windows, concrete) looks consistent on buildings of any size. Everything
 * sharing a material ends up in a single draw call.
 */
export class GeometryBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];

  constructor(private uScale = 1, private vScale = 1) {}

  addBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
         faces: { sides?: boolean; top?: boolean; bottom?: boolean } = { sides: true, top: true }) {
    const s = faces.sides !== false, t = faces.top !== false, b = !!faces.bottom;
    // Each face listed counter-clockwise as seen from outside.
    if (s) {
      this.face([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], [1, 0, 0], 'x');
      this.face([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], [-1, 0, 0], 'x');
      this.face([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 0, 1], 'z');
      this.face([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], [0, 0, -1], 'z');
    }
    if (t) this.face([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], [0, 1, 0], 'y');
    if (b) this.face([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], [0, -1, 0], 'y');
  }

  private face(p: number[], n: number[], axis: 'x' | 'y' | 'z') {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      this.positions.push(x, y, z);
      this.normals.push(n[0], n[1], n[2]);
      if (axis === 'x') this.uvs.push(z / this.uScale, y / this.vScale);
      else if (axis === 'z') this.uvs.push(x / this.uScale, y / this.vScale);
      else this.uvs.push(x / this.uScale, z / this.uScale);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(material: THREE.Material, shadows = true): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export interface Materials {
  facade: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  gray: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  redGlow: THREE.MeshStandardMaterial;
}

export function createMaterials(): Materials {
  // White office facade: one window per 4m x 3.5m cell.
  const facadeTex = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#eef1f4'; ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, s * 0.3, 0, s * 0.85);
    g.addColorStop(0, '#5d7fa3'); g.addColorStop(1, '#2f4a68');
    ctx.fillStyle = g; ctx.fillRect(s * 0.06, s * 0.3, s * 0.88, s * 0.55);
    ctx.fillStyle = '#dfe4ea'; ctx.fillRect(s * 0.49, s * 0.3, s * 0.02, s * 0.55);
    ctx.fillStyle = '#d5dae0'; ctx.fillRect(0, s * 0.86, s, s * 0.04);
  });
  // Blue glass curtain wall.
  const glassTex = canvasTexture(128, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#7fb2e0'); g.addColorStop(1, '#4b82bd');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, s * 0.5, s);
    ctx.fillStyle = '#cfe0ef'; ctx.fillRect(0, 0, s, s * 0.04); ctx.fillRect(0, 0, s * 0.03, s);
  });
  // Light concrete roof with subtle speckle and panel seams.
  const roofTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#f1f2f3'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) {
      const v = 215 + Math.random() * 35;
      ctx.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    ctx.strokeStyle = 'rgba(160,165,172,0.45)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });

  return {
    facade: new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ map: glassTex, roughness: 0.08, metalness: 0.55, envMapIntensity: 1.3 }),
    roof: new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.85, envMapIntensity: 0.4 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf5f6f7, roughness: 0.7, envMapIntensity: 0.5 }),
    gray: new THREE.MeshStandardMaterial({ color: 0xb4bac2, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc80f0a, roughness: 0.45, envMapIntensity: 0.6 }),
    redGlow: new THREE.MeshStandardMaterial({ color: 0xd81810, emissive: 0xc01008, emissiveIntensity: 0.5, roughness: 0.4 }),
  };
}
