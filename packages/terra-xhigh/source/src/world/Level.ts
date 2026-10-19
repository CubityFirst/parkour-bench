import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld';
import type { Box, Trigger } from '../types';

export interface LevelData {
  world: CollisionWorld;
  spawn: THREE.Vector3;
  finish: Trigger;
  animate: (time: number) => void;
}

const WHITE = new THREE.MeshStandardMaterial({ color: 0xf6f8f6, roughness: 0.74, metalness: 0.03 });
const CONCRETE = new THREE.MeshStandardMaterial({ color: 0xd2d9dd, roughness: 0.87 });
const RED = new THREE.MeshStandardMaterial({ color: 0xe83b3c, roughness: 0.5, metalness: 0.08, emissive: 0x1e0000 });
const RED_GLOW = new THREE.MeshStandardMaterial({ color: 0xff554b, roughness: 0.35, emissive: 0x8e0b05, emissiveIntensity: 0.65 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x257aab, roughness: 0.16, metalness: 0.55, transparent: true, opacity: 0.78 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x1c2d3d, roughness: 0.48, metalness: 0.25 });

function meshBox(scene: THREE.Scene, center: THREE.Vector3, size: THREE.Vector3, material: THREE.Material, shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(center);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  scene.add(mesh);
  return mesh;
}

function labelSprite(text: string, color = '#e83b3c'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '700 54px Arial';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
  sprite.scale.set(4.6, 1.15, 1);
  return sprite;
}

export function createLevel(scene: THREE.Scene): LevelData {
  const world = new CollisionWorld();
  const animated: THREE.Object3D[] = [];

  const solid = (center: [number, number, number], size: [number, number, number], opts: Partial<Box> = {}, material: THREE.Material = WHITE): Box => {
    const c = new THREE.Vector3(...center);
    const s = new THREE.Vector3(...size);
    meshBox(scene, c, s, material);
    return world.add({ min: c.clone().sub(s.clone().multiplyScalar(0.5)), max: c.clone().add(s.clone().multiplyScalar(0.5)), ...opts });
  };
  const prop = (center: [number, number, number], size: [number, number, number], material: THREE.Material = CONCRETE, shadow = true): THREE.Mesh =>
    meshBox(scene, new THREE.Vector3(...center), new THREE.Vector3(...size), material, shadow);
  const roof = (name: string, x: number, z: number, w: number, d: number, h = 0): void => {
    solid([x, h - 20, z], [w, 40, d], { tag: name }, WHITE);
    prop([x, h + 0.09, z], [w - 0.16, 0.18, d - 0.16], CONCRETE);
    const title = labelSprite(name, '#687a85');
    title.position.set(x, h + 2.2, z + d / 2 - 1.25);
    scene.add(title);
  };
  const redLine = (x: number, z: number, w: number, d: number, y = 0.19): void => { prop([x, y, z], [w, 0.08, d], RED_GLOW); };
  const checkpoint = (id: string, label: string, x: number, z: number, spawn: [number, number, number]): void => {
    const arch = new THREE.Group();
    const left = prop([x - 2.2, 1.8, z], [0.22, 3.6, 0.22], RED_GLOW);
    const right = prop([x + 2.2, 1.8, z], [0.22, 3.6, 0.22], RED_GLOW);
    const top = prop([x, 3.5, z], [4.6, 0.22, 0.22], RED_GLOW);
    arch.add(left, right, top);
    scene.add(arch);
    const labelMesh = labelSprite(label);
    labelMesh.position.set(x, 4.25, z);
    scene.add(labelMesh);
    world.triggers.push({ id, kind: 'checkpoint', label, center: new THREE.Vector3(x, 1.6, z), size: new THREE.Vector3(5.5, 4, 1.25), spawn: new THREE.Vector3(...spawn) });
  };

  // 1. Warm-up rooftop: run, vault and clear a friendly first gap.
  roof('RUN / JUMP', 0, 15, 24, 40);
  redLine(0, 5.5, 1.2, 14);
  solid([0, 0.55, 1.2], [2.1, 1.1, 0.55], { vaultable: true, tag: 'warmup vault' }, RED);
  prop([-7.5, 0.65, 12], [3.2, 1.3, 2.1]);
  prop([7.2, 0.65, 19], [2.7, 1.3, 2.3]);
  redLine(0, -4.1, 10, 0.55);

  // 2. A sequence of rooftops, deliberately broad enough to make high speed landings fair.
  roof('ROOFTOP JUMPS', 0, -17, 18, 18);
  checkpoint('cp1', 'CHECKPOINT 01', 0, -12.5, [0, 0.04, -16]);
  redLine(0, -24.9, 8, 0.55);
  roof('KEEP FLOWING', -1.1, -42, 15, 17);
  redLine(-1.1, -49.9, 8, 0.55);
  roof('HIGH LINE', 1.5, -65.5, 17, 16);
  checkpoint('cp2', 'CHECKPOINT 02', 1.5, -59.2, [1.5, 0.04, -64]);
  redLine(1.5, -72.6, 9, 0.55);

  // 3. Slide tunnel. The clearance is intentionally too low for a standing runner.
  roof('SLIDE CHANNEL', 1.5, -94.5, 17, 29);
  const tunnelXs = [-86, -94, -102];
  tunnelXs.forEach((z) => {
    solid([1.5, 1.65, z], [15.7, 1.35, 0.72], { tag: 'low beam' }, DARK);
    prop([-6.2, 1.0, z], [0.18, 2, 0.72], RED);
    prop([9.2, 1.0, z], [0.18, 2, 0.72], RED);
    redLine(1.5, z + 0.52, 2.2, 0.08);
  });
  prop([-4.8, 0.55, -108], [2.6, 1.1, 2.6]);
  checkpoint('cp3', 'CHECKPOINT 03', 1.5, -107.7, [1.5, 0.04, -109.2]);
  redLine(-2.1, -108.9, 4, 0.48);

  // 4. The wall-run gap: red wall at the left, big landing roof after the void.
  roof('WALL RUN', 1.5, -115.5, 17, 10);
  solid([-7.15, 4.1, -130.5], [0.55, 8.2, 28], { runnable: true, tag: 'red run wall' }, RED);
  for (let z = -119; z >= -142; z -= 4) redLine(-5.9, z, 1.4, 2.1, 0.15);
  const wallSign = labelSprite('JUMP + HOLD THE RED WALL');
  wallSign.position.set(-5.7, 7.4, -124);
  wallSign.rotation.y = Math.PI / 2;
  scene.add(wallSign);
  roof('LAND CLEAN', 1.5, -148, 20, 18);
  checkpoint('cp4', 'CHECKPOINT 04', 1.5, -142.7, [1.5, 0.04, -147]);
  redLine(1.5, -155.9, 9, 0.55);

  // 5. A compact combination roof with mandatory vault and low rail.
  roof('COMBINATION', 1.5, -171.5, 19, 25);
  solid([1.5, 0.68, -164], [4.2, 1.36, 0.75], { vaultable: true, tag: 'red vault' }, RED);
  prop([-5.8, 0.65, -173], [2.6, 1.3, 3.1]);
  prop([7.4, 0.65, -176], [2.6, 1.3, 2.5]);
  solid([1.5, 1.7, -180], [15.5, 1.3, 0.65], { tag: 'low final beam' }, DARK);
  redLine(1.5, -182.8, 9, 0.55);
  checkpoint('cp5', 'CHECKPOINT 05', 1.5, -178.3, [1.5, 0.04, -179]);

  // 6. Final sprint and the finish beacon.
  roof('FINAL SPRINT', 1.5, -200.5, 20, 31);
  redLine(1.5, -189.2, 2, 11.2);
  prop([-5.3, 0.62, -199], [2.7, 1.24, 3.2]);
  prop([7.7, 0.62, -207], [2.7, 1.24, 2.4]);
  redLine(1.5, -211.2, 8, 0.55);
  const finish = { id: 'finish', kind: 'finish' as const, label: 'FINISH', center: new THREE.Vector3(1.5, 2, -213.2), size: new THREE.Vector3(10, 5, 1.4) };
  world.triggers.push(finish);
  const finishTower = new THREE.Group();
  [0, 1].forEach((i) => {
    const p = prop([i ? 5.4 : -2.4, 3.1, -214], [0.42, 6.2, 0.42], RED_GLOW);
    finishTower.add(p);
  });
  const beam = prop([1.5, 6.05, -214], [8.2, 0.42, 0.42], RED_GLOW);
  finishTower.add(beam);
  const finishLabel = labelSprite('FINISH');
  finishLabel.position.set(1.5, 7.4, -214);
  finishTower.add(finishLabel);
  scene.add(finishTower);
  animated.push(finishTower);

  // Readable red wayfinding arrows at each committed jump edge.
  [-4, -25, -50, -73, -156, -183, -212].forEach((z) => {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.4, 3), RED);
    arrow.position.set(1.5, 0.4, z);
    arrow.rotation.x = Math.PI / 2;
    scene.add(arrow);
  });

  // Decorative city: low-cost shared-material silhouettes and glass towers outside the course.
  const rng = (seed: number) => {
    const x = Math.sin(seed * 923.71) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 98; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (25 + rng(i + 1) * 72);
    const z = 38 - rng(i + 4) * 310;
    const h = 14 + rng(i + 10) * 86;
    const w = 6 + rng(i + 15) * 13;
    const d = 7 + rng(i + 20) * 17;
    const material = i % 3 === 0 ? GLASS : (i % 3 === 1 ? WHITE : DARK);
    meshBox(scene, new THREE.Vector3(x, h / 2 - 12, z), new THREE.Vector3(w, h, d), material, false);
    if (i % 7 === 0) prop([x, h - 11.7, z], [w + 0.5, 0.45, d + 0.5], RED, false);
  }
  for (let i = 0; i < 20; i++) {
    const x = -50 + i * 5.2;
    const z = -248 - (i % 3) * 9;
    const h = 25 + (i % 5) * 12;
    meshBox(scene, new THREE.Vector3(x, h / 2 - 10, z), new THREE.Vector3(4, h, 8), i % 2 ? GLASS : WHITE, false);
  }

  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff3cf, transparent: true, opacity: 0.45 }));
  sunDisc.position.set(-75, 82, -95);
  scene.add(sunDisc);

  return {
    world,
    spawn: new THREE.Vector3(0, 0.04, 26),
    finish,
    animate: (time) => {
      finishTower.position.y = Math.sin(time * 0.002) * 0.12;
      animated.forEach((item) => item.rotation.y = Math.sin(time * 0.00035) * 0.012);
    }
  };
}
