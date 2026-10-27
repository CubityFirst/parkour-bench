import * as THREE from 'three';
import { CollisionWorld, TriggerBox } from './CollisionWorld';

/**
 * Level — the rooftop route. Geometry, colliders, decorations, checkpoints
 * and the finish gate. Everything is procedural geometry/materials.
 *
 * The route runs along +Z across a chain of rooftops:
 *  Sec 1  z   0–28   tutorial start (sprint, vault, jump)
 *  Sec 2  z  33–84   rooftop jumps (+ first slide ducts)
 *  Sec 3  z 110–136  sliding challenge
 *  Sec 4  z 162–192  wall run (right wall)
 *  Sec 5  z 192–302  combination (vault + slide + second wall run)
 *  Sec 6  z 308–392  final sprint → finish gate
 */

export interface LevelData {
  spawn: { pos: THREE.Vector3; yaw: number };
  checkpoints: { pos: THREE.Vector3; yaw: number }[];
  triggers: TriggerBox[];
  finishTrigger: TriggerBox;
  hints: { z0: number; z1: number; text: string }[];
  update: (dt: number, time: number) => void;
}

// ------------------------------------------------------------------ textures

function noiseCanvas(
  width: number, height: number,
  base: string, speckle: string[],
  lines: { c: string; axis: 'x' | 'y'; every: number; w?: number }[]
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const n = Math.floor(width * height * 0.02);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = speckle[Math.floor(Math.random() * speckle.length)];
    const s = 1 + Math.random() * 2.2;
    ctx.fillRect(Math.random() * width, Math.random() * height, s, s);
  }
  for (const ln of lines) {
    ctx.strokeStyle = ln.c;
    ctx.lineWidth = ln.w ?? 2;
    for (let p = 0; p <= width; p += ln.every) {
      ctx.beginPath();
      if (ln.axis === 'x') { ctx.moveTo(p, 0); ctx.lineTo(p, height); }
      else { ctx.moveTo(0, p); ctx.lineTo(width, p); }
      ctx.stroke();
    }
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.018)';
    ctx.beginPath();
    ctx.ellipse(Math.random() * width, Math.random() * height, 10 + Math.random() * 40, 8 + Math.random() * 26, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makeTexture(canvas: HTMLCanvasElement, repeat: [number, number]): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d5262b';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  for (let i = 0; i < 8; i++) ctx.fillRect(i * 130, 0, 3, 256);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 900 140px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FINISH', 512, 136);
  ctx.fillRect(36, 42, 14, 172);
  ctx.fillRect(974, 42, 14, 172);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------ palette

const PALETTE = {
  white: 0xf3f1ed,
  whiteWarm: 0xeeeae5,
  concreteDark: 0xc9c7c2,
  gray: 0xa0a5aa,
  red: 0xd5262b,
  redDark: 0xa71d21,
  orange: 0xff8a2a,
  metal: 0x4a4e53,
  windowDark: 0x27313c
};

// ------------------------------------------------------------------ ctx scratch

const _vC = new THREE.Vector3();
const _vS = new THREE.Vector3();

interface Ctx {
  scene: THREE.Scene;
  collision: CollisionWorld;
  flags: FlagAnim[];
}

interface FlagAnim {
  mesh: THREE.Mesh;
  base: Float32Array;
  phase: number;
}

function mat(color: number, rough = 0.92, metal = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

// ------------------------------------------------------------------ builders

/** A solid building block: visual box + collider. */
function building(
  ctx: Ctx, xC: number, zC: number, w: number, d: number, top: number,
  opts?: { wallColor?: number; grayTop?: boolean }
): void {
  const geo = new THREE.BoxGeometry(w, top, d);
  const wallMat = mat(opts?.wallColor ?? PALETTE.white, 0.94);
  const topMat = mat(opts?.grayTop ? PALETTE.concreteDark : PALETTE.whiteWarm, 0.97);
  if (!opts) { topMat.map = gTexRoof; topMat.needsUpdate = true; }
  const mesh = new THREE.Mesh(geo, [wallMat, wallMat, topMat, wallMat, wallMat, wallMat]);
  mesh.position.set(xC, top / 2, zC);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  ctx.collision.addBoxCentered(
    _vC.set(xC, top / 2, zC),
    _vS.set(w, top, d)
  );
}

/** Small solid prop with its own collider. */
function propBox(
  ctx: Ctx, xC: number, yBase: number, zC: number,
  w: number, h: number, d: number,
  material: THREE.Material
): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(xC, yBase + h / 2, zC);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  ctx.collision.addBoxCentered(
    _vC.set(xC, yBase + h / 2, zC),
    _vS.set(w, h, d)
  );
}

/** Visual-only box (no collider). */
function decoBox(
  ctx: Ctx, xC: number, yC: number, zC: number, w: number, h: number, d: number,
  material: THREE.Material, rotY = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(xC, yC, zC);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  return mesh;
}

/** Flat red chevron decal on a roof surface. Default orientation points +Z. */
function chevron(ctx: Ctx, x: number, y: number, z: number): void {
  const shape = new THREE.Shape();
  shape.moveTo(-0.62, -0.5);
  shape.lineTo(0.62, -0.5);
  shape.lineTo(0, 0.62);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: PALETTE.red, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = Math.PI; // triangle tip towards +Z
  mesh.position.set(x, y + 0.015, z);
  ctx.scene.add(mesh);
}

/** Orange/white rooftop flag with a sine wave animation. */
function flag(ctx: Ctx, x: number, yBase: number, z: number, color: number, height = 2.6): void {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, height, 8), mat(0xbfc3c6, 0.5, 0.4));
  pole.position.set(x, yBase + height / 2, z);
  pole.castShadow = true;
  ctx.scene.add(pole);

  const w = 0.95, h = 0.62;
  const geo = new THREE.PlaneGeometry(w, h, 7, 3);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, roughness: 0.85, side: THREE.DoubleSide
  }));
  mesh.castShadow = true;
  const base = Float32Array.from(geo.attributes.position.array);
  ctx.flags.push({ mesh, base, phase: Math.random() * 6.28 });
  mesh.position.set(x + 0.05, yBase + height - h / 2 - 0.08, z);
}

/** Red pipes hugging a wall face (visual only). */
function wallRedPipes(ctx: Ctx, xFace: number, dirSign: number, y0: number, y1: number, z0: number, z1: number): void {
  const red = mat(PALETTE.red, 0.7);
  decoBox(ctx, xFace + dirSign * 0.06, (y0 + y1) / 2, (z0 + z1) / 2, 0.1, y1 - y0, 0.1, red);
  decoBox(ctx, xFace + dirSign * 0.06, y1, (z0 + z1) / 2, 0.09, 0.09, z1 - z0, red);
  decoBox(ctx, xFace + dirSign * 0.06, y0, (z0 + z1) / 2, 0.09, 0.09, z1 - z0, red);
}

// ------------------------------------------------------------------ route objects

/** Slide duct: full-width row with a low opening — the player must slide. */
function slideDuct(ctx: Ctx, centerX: number, roofTop: number, z: number, spanX: number): void {
  const openingHalf = 1.62;
  const blockH = 1.02;
  const lintelBase = roofTop + 1.12;
  const lintelH = 0.9;
  const depth = 1.0;
  const halfSpan = spanX / 2;
  const sideW = halfSpan - openingHalf;

  const red = mat(PALETTE.red, 0.72);
  const dark = mat(PALETTE.windowDark, 0.88);

  // side blocks
  propBox(ctx, centerX - (openingHalf + sideW / 2), roofTop, z, sideW, blockH, depth, red);
  propBox(ctx, centerX + (openingHalf + sideW / 2), roofTop, z, sideW, blockH, depth, red);
  // lintel above the opening (full span)
  propBox(ctx, centerX, lintelBase, z, spanX, lintelH, depth, red);

  // dark grate panels on the near face (player arrives from -Z)
  decoBox(ctx, centerX - (openingHalf + sideW / 2), roofTop + blockH * 0.5, z - depth / 2 - 0.021, sideW * 0.72, 0.55, 0.04, dark);
  decoBox(ctx, centerX + (openingHalf + sideW / 2), roofTop + blockH * 0.5, z - depth / 2 - 0.021, sideW * 0.72, 0.55, 0.04, dark);
  decoBox(ctx, centerX, lintelBase + lintelH / 2, z - depth / 2 - 0.021, openingHalf * 1.2, 0.55, 0.04, dark);

  chevron(ctx, centerX, roofTop, z - 2.6);
}

/** Red vault crate. */
function vaultBox(ctx: Ctx, x: number, roofTop: number, z: number): void {
  propBox(ctx, x, roofTop, z, 2.5, 1.14, 1.25, mat(PALETTE.red, 0.74));
  decoBox(ctx, x, roofTop + 1.17, z, 2.56, 0.06, 1.31, mat(PALETTE.redDark, 0.8));
  chevron(ctx, x, roofTop, z - 2.3);
}

/** AC unit (vaultable, blocks the way). */
function acUnit(ctx: Ctx, x: number, roofTop: number, z: number, rotY = 0): void {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.12, 1.5), mat(0xdfe3e6, 0.82));
  body.position.y = 0.56;
  const grill = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.06), mat(PALETTE.windowDark, 0.9));
  grill.position.set(0, 0.6, 0.78);
  const topCap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.09, 1.6), mat(0xb9bec2, 0.85));
  topCap.position.y = 1.14;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8), mat(0x8b9094, 0.5, 0.35));
  pipe.position.set(0.6, 1.3, -0.3);
  g.add(body, grill, topCap, pipe);
  g.position.set(x, roofTop, z);
  g.rotation.y = rotY;
  ctx.scene.add(g);
  ctx.collision.addBoxCentered(_vC.set(x, roofTop + 0.56, z), _vS.set(1.95, 1.12, 1.55));
}

/** Guard railing segment along an edge (x const, z varies). */
function railing(ctx: Ctx, x: number, z0: number, z1: number, roofTop: number): void {
  const length = Math.abs(z1 - z0);
  const gray = mat(0xa9adb2, 0.55, 0.25);
  const nPosts = Math.max(2, Math.round(length / 2.2));
  for (let i = 0; i <= nPosts; i++) {
    const t = i / nPosts;
    const pz = z0 + (z1 - z0) * t;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 6), gray);
    post.position.set(x, roofTop + 0.31, pz);
    post.castShadow = true;
    ctx.scene.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, length), mat(0x8f9499, 0.5, 0.35));
  bar.position.set(x, roofTop + 0.6, (z0 + z1) / 2);
  bar.castShadow = true;
  ctx.scene.add(bar);
  // solid block so it is a physical rail (thin, vaultable)
  ctx.collision.addBoxCentered(
    _vC.set(x, roofTop + 0.3, (z0 + z1) / 2),
    _vS.set(0.13, 0.6, length)
  );
}

/** Rooftop red door (landmark, decorative). */
function redDoor(ctx: Ctx, x: number, roofTop: number, z: number, rotY = 0): void {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.35, 0.16), mat(0xe8e5df, 0.9));
  frame.position.y = 1.17;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.18, 2.1, 0.1), mat(PALETTE.red, 0.72));
  door.position.set(0, 1.05, 0.1);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.05), mat(PALETTE.windowDark));
  bar.position.set(0, 1.2, 0.18);
  g.add(frame, door, bar);
  g.position.set(x, roofTop, z);
  g.rotation.y = rotY;
  ctx.scene.add(g);
}

/** Rooftop pipe cluster, decorative. */
function pipesCluster(ctx: Ctx, x: number, roofTop: number, z: number, seed = 0): void {
  const metal = mat(0x9aa0a5, 0.55, 0.3);
  for (let i = 0; i < 3; i++) {
    const h = 0.9 + ((seed * 37 + i * 53) % 60) / 100;
    const px = x + ((seed * 13 + i * 29) % 50) / 50 - 0.5;
    const pz = z + ((seed * 17 + i * 31) % 40) / 40 - 0.5;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, h, 10), metal);
    pipe.position.set(px, roofTop + h / 2, pz);
    pipe.castShadow = true;
    ctx.scene.add(pipe);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 10), mat(0x777d82, 0.6));
    cap.position.set(px, roofTop + h, pz);
    cap.castShadow = true;
    ctx.scene.add(cap);
  }
}

/** Checkpoint portal: two red posts + crossbar you run through. */
function checkpointPortal(ctx: Ctx, x: number, roofTop: number, z: number, halfX = 2.6): void {
  const red = mat(PALETTE.red, 0.72);
  decoBox(ctx, x - halfX, roofTop + 1.25, z, 0.42, 2.5, 0.5, red);
  decoBox(ctx, x + halfX, roofTop + 1.25, z, 0.42, 2.5, 0.5, red);
  decoBox(ctx, x, roofTop + 2.45, z, halfX * 2 + 0.5, 0.38, 0.42, red);
  decoBox(ctx, x, roofTop + 0.012, z, halfX * 2 - 0.4, 0.02, 2.6, mat(0xffffff, 0.9));
  decoBox(ctx, x, roofTop + 0.02, z, halfX * 2 - 0.6, 0.02, 2.4, mat(PALETTE.red, 0.85));
  chevron(ctx, x, roofTop, z - 3.6);
}

/** Finish gate with banner. */
function finishGate(ctx: Ctx, x: number, roofTop: number, z: number): void {
  const red = mat(PALETTE.red, 0.72);
  decoBox(ctx, x - 3.6, roofTop + 2.1, z, 0.62, 4.2, 0.62, red);
  decoBox(ctx, x + 3.6, roofTop + 2.1, z, 0.62, 4.2, 0.62, red);
  decoBox(ctx, x, roofTop + 4.28, z, 7.9, 0.4, 0.55, red);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 1.9),
    new THREE.MeshBasicMaterial({ map: makeBannerTexture(), side: THREE.DoubleSide })
  );
  banner.position.set(x, roofTop + 3.15, z);
  ctx.scene.add(banner);
  // floor line
  decoBox(ctx, x, roofTop + 0.012, z, 8.4, 0.02, 1.5, mat(0xffffff, 0.9));
  decoBox(ctx, x, roofTop + 0.02, z, 8.0, 0.02, 1.2, mat(PALETTE.windowDark, 0.9));
  chevron(ctx, x, roofTop, z - 6.5);
}

/** Background red tower crane (visual only). */
function crane(ctx: Ctx, x: number, z: number, height: number, dir: number): void {
  const red = mat(0xd6262b, 0.7);
  const gray = mat(0x9aa0a5, 0.8);
  const g = new THREE.Group();

  const base = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 4.4), red);
  base.position.set(0, 0.55, 0);
  g.add(base);

  const segments = Math.floor(height / 3);
  for (let i = 0; i < segments; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.9, 1.1), red);
    seg.position.set(0, 1.1 + i * 3, 0);
    g.add(seg);
  }

  const jib = new THREE.Mesh(new THREE.BoxGeometry(26, 0.75, 0.75), red);
  jib.position.set(dir * 12.4, height + 1.4, 0);
  g.add(jib);

  const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 0.85), red);
  counter.position.set(-dir * 4, height + 1.45, 0);
  g.add(counter);

  const weight = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 1.7), gray);
  weight.position.set(-dir * 6.4, height + 0.7, 0);
  g.add(weight);

  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 12, 4), mat(0x2a2d31));
  cable.position.set(dir * 17, height - 4.6, 0);
  g.add(cable);

  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.55), gray);
  hook.position.set(dir * 17, height - 10.6, 0);
  g.add(hook);

  g.position.set(x, 0, z);
  g.rotation.y = 0.4;
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; } });
  ctx.scene.add(g);
}

// ------------------------------------------------------------------ level build

let gTexRoof: THREE.CanvasTexture;

export function buildLevel(scene: THREE.Scene, collision: CollisionWorld): LevelData {
  const ctx: Ctx = { scene, collision, flags: [] };

  const roofCanvas = noiseCanvas(512, 512, '#f1efeb',
    ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.04)', 'rgba(120,115,105,0.05)'],
    [
      { c: 'rgba(0,0,0,0.06)', axis: 'x', every: 128, w: 2 },
      { c: 'rgba(0,0,0,0.06)', axis: 'y', every: 128, w: 2 },
      { c: 'rgba(0,0,0,0.025)', axis: 'x', every: 32, w: 1 }
    ]);
  gTexRoof = makeTexture(roofCanvas, [5, 5]);

  // ================= Section 1 — tutorial start (z 0..28)
  building(ctx, 0, 14, 18, 28, 24);
  vaultBox(ctx, 0, 24, 16);
  acUnit(ctx, -4.6, 24, 8.5, 0.2);
  acUnit(ctx, 4.8, 24, 22, -0.35);
  pipesCluster(ctx, -5.5, 24, 20, 3);
  redDoor(ctx, 6.2, 24, 8, Math.PI / 2);
  flag(ctx, -6.5, 24, 12, PALETTE.orange);
  flag(ctx, 7.5, 24, 26, 0xf6f4ef);
  crane(ctx, -36, -4, 46, 1);
  chevron(ctx, 0, 24, 26.5);

  // gap A z 28..33 → Section 2 (z 33..58)
  building(ctx, 0, 45.5, 18, 25, 24.5);
  slideDuct(ctx, 0, 24.5, 40, 17.6);
  slideDuct(ctx, 0, 24.5, 48, 17.6);
  acUnit(ctx, -4.4, 24.5, 54, 0.4);
  chevron(ctx, 0, 24.5, 30.4);
  chevron(ctx, 0, 24.5, 56.6);
  wallRedPipes(ctx, -8.96, 1, 17, 20.4, 35, 56);
  flag(ctx, 6.8, 24.5, 35, PALETTE.orange);

  // gap B z 58..64 (rise +0.5)
  building(ctx, 0, 74, 16, 20, 25);
  vaultBox(ctx, 0, 25, 70);
  pipesCluster(ctx, 5.2, 25, 66.5, 5);
  chevron(ctx, 0, 25, 62.4);
  chevron(ctx, 0, 25, 87);

  // gap C z 84..90 → narrow bridge (z 90..104)
  building(ctx, 0, 97, 5, 14, 25);
  railing(ctx, -2.28, 90.5, 103.5, 25);
  railing(ctx, 2.28, 90.5, 103.5, 25);
  chevron(ctx, 0, 25, 92.2);

  // gap D z 104..110 (drop -2) → Section 3 (z 110..136)
  building(ctx, 0, 123, 14, 26, 23);
  slideDuct(ctx, 0, 23, 116, 13.8);
  vaultBox(ctx, 0, 23, 122.5);
  slideDuct(ctx, 0, 23, 129, 13.8);
  acUnit(ctx, -4.6, 23, 132.5, 0.2);
  acUnit(ctx, 4.9, 23, 112, -0.4);
  chevron(ctx, 0, 23, 108.6);
  chevron(ctx, 0, 23, 134);

  // gap E z 136..141.4 → wall-run launch (z 141.4..161.4)
  building(ctx, 0, 151.4, 16.4, 20, 23);
  redDoor(ctx, -6.8, 23, 147, -Math.PI / 2);
  pipesCluster(ctx, -5, 23, 154, 7);
  flag(ctx, -7.1, 23, 150, 0xf6f4ef);
  chevron(ctx, -3.8, 23, 158.6);

  // wall-run tower W1: face x=-8.4 (player's right at yaw PI), z 158..198, top 31
  building(ctx, -12.35, 178, 7.9, 40, 31, { wallColor: 0xdcd9d3 });
  wallRedPipes(ctx, -8.42, 1, 23.4, 26.6, 161, 195);
  decoBox(ctx, -8.35, 24.6, 178, 0.05, 2.8, 33, mat(PALETTE.red, 0.85));

  // (wall-run gap 161.4..187.4 — 26 m along the wall)
  // Section 5 (z 187.4..215.4, x -8.6..13)
  building(ctx, 2.2, 201.4, 21.6, 28, 24);
  checkpointPortal(ctx, 1, 24, 190);
  vaultBox(ctx, 4, 24, 194.4);
  slideDuct(ctx, 4, 24, 200.4, 17.8);
  acUnit(ctx, -3.2, 24, 209, 0.3);
  chevron(ctx, 4, 24, 213.9);

  // gap F z 215.4..221.4 → (z 221.4..246.4)
  building(ctx, 0, 233.9, 16, 25, 24);
  slideDuct(ctx, 0, 24, 227.4, 15.8);
  pipesCluster(ctx, -5.5, 24, 239, 9);
  chevron(ctx, 0, 24, 218.4);

  // wall-run tower W2: face x=+8.6 (player's left at yaw PI), z 234..296
  building(ctx, 12.3, 265, 7.4, 62, 31, { wallColor: 0xdcd9d3 });
  wallRedPipes(ctx, 8.64, -1, 23.4, 26.6, 240, 292);
  decoBox(ctx, 8.565, 24.6, 265, 0.05, 2.8, 52, mat(PALETTE.red, 0.85));
  chevron(ctx, 7.4, 24, 244.4);

  // (wall-run gap 246.4..272 — 25.6 m along the left wall)
  // Section 5b (z 272..296, x -14..8)
  building(ctx, -3, 284, 22, 24, 25);
  checkpointPortal(ctx, -3, 25, 273.8);
  vaultBox(ctx, -3, 25, 280.5);
  redDoor(ctx, 1, 25, 287.5, Math.PI);
  chevron(ctx, -3, 25, 294.4);

  // gap H z 296..301.5 → Section 6 (z 301.5..325.5)
  building(ctx, -2, 313.5, 13, 24, 24);
  vaultBox(ctx, -2, 24, 306.5);
  slideDuct(ctx, -2, 24, 313.5, 12.8);
  acUnit(ctx, 4, 24, 320.5, 0.5);
  chevron(ctx, -2, 24, 323.5);

  // gap I z 325.5..331 → final runway (z 331..354.5)
  building(ctx, -2, 342.75, 12, 23.5, 23.5);
  flag(ctx, -6.8, 23.5, 338, PALETTE.orange);
  flag(ctx, 3, 23.5, 350, 0xf6f4ef);
  chevron(ctx, -2, 23.5, 335.5);

  // gap J z 354.5..361 → finish roof (z 361..408)
  building(ctx, 0, 384.5, 20, 47, 23);
  finishGate(ctx, 0, 23, 392);
  acUnit(ctx, -7.5, 23, 366.5, 0.3);
  acUnit(ctx, 6.8, 23, 400, -0.4);
  flag(ctx, -8.4, 23, 395.5, PALETTE.orange);
  flag(ctx, 8.6, 23, 388.5, PALETTE.orange);
  flag(ctx, -5.5, 23, 372, 0xf6f4ef);
  pipesCluster(ctx, 7.8, 23, 368, 11);

  // ================= Checkpoint respawns
  const checkpointDefs = [
    { pos: new THREE.Vector3(0, 24.5, 55.5), yaw: Math.PI },
    { pos: new THREE.Vector3(0, 25, 92.5), yaw: Math.PI },
    { pos: new THREE.Vector3(0, 23, 144), yaw: Math.PI },
    { pos: new THREE.Vector3(1, 24, 190), yaw: Math.PI },
    { pos: new THREE.Vector3(-3, 25, 273.8), yaw: Math.PI }
  ];
  checkpointPortal(ctx, 0, 24.5, 55.5);
  checkpointPortal(ctx, 0, 25, 92.5, 1.9);
  checkpointPortal(ctx, 0, 23, 144);
  checkpointPortal(ctx, -3, 25, 273.8);

  const triggers: TriggerBox[] = [];
  const mkTrigger = (x: number, topY: number, z: number, halfX: number): void => {
    triggers.push(collision.addTriggerBox(
      triggers.length,
      x - halfX, topY, z - 3.2,
      x + halfX, topY + 5, z + 3.2
    ));
  };
  mkTrigger(0, 24.5, 55.5, 5);
  mkTrigger(0, 25, 92.5, 2.4);
  mkTrigger(0, 23, 144, 6);
  mkTrigger(1, 24, 190, 5);
  mkTrigger(-3, 25, 273.8, 5);

  const finishTrigger = collision.addTriggerBox(99, -5.5, 22.5, 390.8, 5.5, 27.5, 393.6);

  // ================= Contextual hints along the route
  const hints = [
    { z0: 3, z1: 13, text: 'Hold <b>SHIFT</b> + <b>W</b> to sprint' },
    { z0: 14, z1: 24, text: 'Press <b>E</b> at the red box to vault it' },
    { z0: 26, z1: 31.5, text: 'Sprint to the edge and press <b>SPACE</b> to jump' },
    { z0: 33, z1: 43, text: 'Hold <b>CTRL</b> or <b>C</b> while running to slide under the duct' },
    { z0: 57, z1: 63.5, text: 'Sprint-jump across the gap' },
    { z0: 65, z1: 69, text: 'Vault the red box with <b>E</b>' },
    { z0: 84, z1: 89.5, text: 'Jump onto the narrow bridge' },
    { z0: 103, z1: 109, text: 'Slide challenge — keep your speed' },
    { z0: 122, z1: 127.5, text: 'Vault here, then slide again' },
    { z0: 142, z1: 152, text: 'Big gap: sprint-jump from the edge and drift <b>RIGHT</b> into the wall' },
    { z0: 178, z1: 186, text: 'Run along the wall — jump off to the left when it ends' },
    { z0: 193, z1: 201, text: 'Vault the box, then slide the duct' },
    { z0: 216, z1: 226.5, text: 'Sprint-jump the gap — then slide' },
    { z0: 240, z1: 247, text: 'Left wall-run: sprint-jump and drift <b>LEFT</b>' },
    { z0: 264, z1: 274, text: 'Run off the wall onto the roof — vault the red box' },
    { z0: 302, z1: 314, text: 'Vault, slide, then full sprint — almost there' },
    { z0: 346, z1: 353.5, text: 'Final sprint!' },
    { z0: 355, z1: 360.5, text: 'One last jump — then finish!' },
    { z0: 384, z1: 391, text: 'FINISH LINE AHEAD' }
  ];

  const spawn = { pos: new THREE.Vector3(0, 24, 6), yaw: Math.PI };

  return {
    spawn,
    checkpoints: checkpointDefs,
    triggers,
    finishTrigger,
    hints,
    update: (dt: number, time: number) => {
      void dt;
      for (const f of ctx.flags) {
        const geo = f.mesh.geometry as THREE.PlaneGeometry;
        const posAttr = geo.attributes.position as THREE.BufferAttribute;
        const arr = posAttr.array as ArrayLike<number> as Float32Array;
        for (let i = 0; i < posAttr.count; i++) {
          const bx = f.base[i * 3];
          const by = f.base[i * 3 + 1];
          const u = (bx + 0.475) / 0.95;
          const wave = Math.sin(u * 2.6 + time * 6.5 + f.phase) * 0.16 * u
            + Math.sin(u * 5.1 - time * 4.3 + f.phase * 1.7) * 0.05 * u;
          arr[i * 3 + 2] = wave;
          arr[i * 3 + 1] = by + wave * 0.3 * u;
        }
        posAttr.needsUpdate = true;
      }
    }
  };
}
