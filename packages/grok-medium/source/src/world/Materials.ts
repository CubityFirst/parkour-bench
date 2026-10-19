import * as THREE from 'three';

export interface MaterialSet {
  concrete: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  side: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  redGlow: THREE.MeshStandardMaterial;
  gray: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  orange: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  banner: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  cityConcrete: THREE.MeshStandardMaterial;
  cityGlass: THREE.MeshStandardMaterial;
  flagCloth: THREE.MeshStandardMaterial;
  flagOrange: THREE.MeshStandardMaterial;
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function createMaterials(renderer: THREE.WebGLRenderer): MaterialSet {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xcfe8fb);
  const skyLight = new THREE.HemisphereLight(0xffffff, 0xb9c6d0, 1);
  envScene.add(skyLight);
  const sun = new THREE.DirectionalLight(0xfff3df, 2);
  sun.position.set(20, 40, 10);
  envScene.add(sun);
  const envMap = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();

  const roofMap = canvasTexture((ctx, s) => {
    ctx.fillStyle = '#f3f6f4';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const v = 220 + Math.random() * 30;
      ctx.fillStyle = `rgba(${v},${v},${v + 2},0.35)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    ctx.strokeStyle = 'rgba(180, 190, 196, 0.85)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(s, i);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(196, 208, 214, 0.55)';
    ctx.fillRect(18, 18, 28, 20);
    ctx.fillRect(150, 90, 36, 22);
  });

  const concreteMap = canvasTexture((ctx, s) => {
    ctx.fillStyle = '#f7f8f7';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const v = 230 + Math.random() * 20;
      ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    ctx.fillStyle = 'rgba(170, 186, 198, 0.28)';
    for (let y = 28; y < s; y += 46) ctx.fillRect(0, y, s, 8);
  });

  const cityMap = canvasTexture((ctx, s) => {
    ctx.fillStyle = '#e7eef3';
    ctx.fillRect(0, 0, s, s);
    for (let y = 10; y < s; y += 28) {
      for (let x = 8; x < s; x += 22) {
        ctx.fillStyle = Math.random() > 0.82 ? '#f6d7a2' : '#9fb4c4';
        ctx.fillRect(x, y, 12, 16);
      }
    }
  });

  const glassMap = canvasTexture((ctx, s) => {
    ctx.fillStyle = '#c5dcea';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    for (let y = 0; y <= s; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    for (let x = 0; x <= s; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s);
      ctx.stroke();
    }
    for (let y = 6; y < s; y += 32) {
      for (let x = 4; x < s; x += 24) {
        ctx.fillStyle = Math.random() > 0.9 ? 'rgba(255, 214, 150, 0.85)' : 'rgba(190, 220, 235, 0.35)';
        ctx.fillRect(x, y, 16, 20);
      }
    }
  });

  const concrete = new THREE.MeshStandardMaterial({
    color: 0xfbfcfc,
    map: concreteMap,
    roughness: 0.78,
    metalness: 0.02,
    envMap,
    envMapIntensity: 0.25,
  });
  const roof = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roofMap,
    roughness: 0.86,
    metalness: 0.02,
  });
  const side = concrete;

  return {
    concrete,
    roof,
    side,
    red: new THREE.MeshStandardMaterial({
      color: 0xd30f18,
      roughness: 0.42,
      metalness: 0.18,
      emissive: 0x5a0004,
      emissiveIntensity: 0.28,
      envMap,
      envMapIntensity: 0.4,
    }),
    redGlow: new THREE.MeshStandardMaterial({
      color: 0xff2a2a,
      roughness: 0.38,
      metalness: 0.08,
      emissive: 0xff1a1a,
      emissiveIntensity: 0.55,
    }),
    gray: new THREE.MeshStandardMaterial({ color: 0xb7bec4, roughness: 0.7, metalness: 0.08 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x5e676e, roughness: 0.55, metalness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({
      color: 0xd5dbe0,
      roughness: 0.32,
      metalness: 0.72,
      envMap,
      envMapIntensity: 0.7,
    }),
    orange: new THREE.MeshStandardMaterial({
      color: 0xff6a1a,
      roughness: 0.45,
      emissive: 0xff4d00,
      emissiveIntensity: 0.25,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xc5d7e4,
      map: glassMap,
      roughness: 0.12,
      metalness: 0.62,
      envMap,
      envMapIntensity: 0.9,
    }),
    banner: new THREE.MeshStandardMaterial({
      color: 0xe10600,
      roughness: 0.5,
      emissive: 0xff2200,
      emissiveIntensity: 0.2,
    }),
    window: new THREE.MeshStandardMaterial({
      color: 0x8ea8b8,
      roughness: 0.25,
      metalness: 0.35,
      emissive: 0x1a242c,
      emissiveIntensity: 0.15,
    }),
    cityConcrete: new THREE.MeshStandardMaterial({
      color: 0xf2f5f6,
      map: cityMap,
      roughness: 0.8,
      metalness: 0.04,
    }),
    cityGlass: new THREE.MeshStandardMaterial({
      color: 0xd5e6f0,
      map: glassMap,
      roughness: 0.16,
      metalness: 0.55,
      envMap,
      envMapIntensity: 0.55,
    }),
    flagCloth: new THREE.MeshStandardMaterial({
      color: 0xff3b1f,
      side: THREE.DoubleSide,
      roughness: 0.6,
      emissive: 0x7a1408,
      emissiveIntensity: 0.15,
    }),
    flagOrange: new THREE.MeshStandardMaterial({
      color: 0xff7a18,
      side: THREE.DoubleSide,
      roughness: 0.55,
      emissive: 0xc2410c,
      emissiveIntensity: 0.18,
    }),
  };
}

export function buildingMaterials(mats: MaterialSet, kind: 'concrete' | 'glass'): THREE.Material[] {
  const wall = kind === 'glass' ? mats.glass : mats.concrete;
  const top = kind === 'glass' ? mats.glass : mats.roof;
  return [wall, wall, top, wall, wall, wall];
}
