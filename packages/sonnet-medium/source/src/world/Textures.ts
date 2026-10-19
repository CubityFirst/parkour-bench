import * as THREE from 'three';

/** Procedural canvas textures - no external assets. */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, renderer: THREE.WebGLRenderer, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, size: number, amount: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * amount})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** White office facade: horizontal window bands with mullions (one tile = 8 m x 8 m, two floors). */
export function facadeWhiteTexture(r: THREE.WebGLRenderer): THREE.Texture {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#f3f5f7';
  g.fillRect(0, 0, S, S);
  for (let f = 0; f < 2; f++) {
    const y0 = f * 128;
    // spandrel panel shading
    g.fillStyle = '#e4e8ec';
    g.fillRect(0, y0 + 96, S, 32);
    // window band
    const grad = g.createLinearGradient(0, y0 + 20, 0, y0 + 90);
    grad.addColorStop(0, '#6f8aa6');
    grad.addColorStop(1, '#3d5570');
    g.fillStyle = grad;
    g.fillRect(0, y0 + 22, S, 68);
    // glass highlight diagonal
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.moveTo(0, y0 + 90); g.lineTo(60, y0 + 22); g.lineTo(90, y0 + 22); g.lineTo(30, y0 + 90); g.fill();
    // mullions
    g.fillStyle = '#f3f5f7';
    for (let x = 0; x < S; x += 32) g.fillRect(x, y0 + 22, 3, 68);
    // sill line
    g.fillStyle = '#cfd5db';
    g.fillRect(0, y0 + 90, S, 4);
    g.fillRect(0, y0 + 20, S, 3);
  }
  noise(g, S, 0.05, 700);
  return finish(c, r);
}

/** Blue reflective glass curtain wall. */
export function glassTexture(r: THREE.WebGLRenderer): THREE.Texture {
  const S = 256;
  const [c, g] = canvas(S);
  const grad = g.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, '#9cc4e6');
  grad.addColorStop(0.5, '#7aa6cf');
  grad.addColorStop(1, '#b4d4ee');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  for (let row = 0; row < 8; row++) {
    const y = row * 32;
    g.fillStyle = row % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,20,50,0.10)';
    g.fillRect(0, y, S, 32);
  }
  g.fillStyle = 'rgba(230,240,250,0.85)';
  for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 2, S);
  for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 2);
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.beginPath();
  g.moveTo(0, 256); g.lineTo(110, 0); g.lineTo(150, 0); g.lineTo(40, 256); g.fill();
  return finish(c, r);
}

/** Concrete rooftop: off-white with panel seams and fine speckle (one tile = 6 m). */
export function roofTexture(r: THREE.WebGLRenderer): THREE.Texture {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#eceff1';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(150,160,170,${0.03 + Math.random() * 0.05})`;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 10 + Math.random() * 40, 0, Math.PI * 2);
    g.fill();
  }
  noise(g, S, 0.18, 2500);
  g.strokeStyle = 'rgba(120,130,140,0.35)';
  g.lineWidth = 1.5;
  g.strokeRect(0.5, 0.5, S - 1, S - 1);
  g.beginPath();
  g.moveTo(S / 2, 0); g.lineTo(S / 2, S);
  g.moveTo(0, S / 2); g.lineTo(S, S / 2);
  g.strokeStyle = 'rgba(120,130,140,0.18)';
  g.stroke();
  return finish(c, r);
}

/** Street level for the ground far below. */
export function groundTexture(r: THREE.WebGLRenderer): THREE.Texture {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#8f98a1';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#b5bcc3';
  g.fillRect(0, 0, S, 28);
  g.fillRect(0, 0, 28, S);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (let x = 40; x < S; x += 40) g.fillRect(x, 13, 18, 3);
  noise(g, S, 0.15, 1500);
  return finish(c, r);
}

/** Soft cloud puff for sprites. */
export function cloudTexture(): THREE.Texture {
  const [c, g] = canvas(128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function bannerTexture(text: string): THREE.Texture {
  const [c, g] = (() => {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 192;
    return [cv, cv.getContext('2d')!] as const;
  })();
  g.fillStyle = '#d9201b';
  g.fillRect(0, 0, 1024, 192);
  g.fillStyle = '#fff';
  g.font = '700 128px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.split('').join(' '), 512, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
