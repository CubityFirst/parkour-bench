import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialKey, MaterialSet } from './Materials';

/**
 * Accumulates many small boxes / shapes into one merged mesh per material.
 * Keeps the draw-call count of the level in the low tens while still allowing
 * a detailed, hand-placed city.
 */
export class MeshBuilder {
  private readonly groups = new Map<MaterialKey, THREE.BufferGeometry[]>();

  constructor(private readonly materials: MaterialSet) {}

  add(key: MaterialKey, geometry: THREE.BufferGeometry): void {
    let list = this.groups.get(key);
    if (!list) {
      list = [];
      this.groups.set(key, list);
    }
    list.push(geometry);
  }

  /** Adds an axis aligned box. `rotY` rotates around Y (radians). */
  box(
    key: MaterialKey,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    rotY = 0
  ): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY !== 0) g.rotateY(rotY);
    g.translate(cx, cy, cz);
    this.add(key, g);
  }

  cylinder(
    key: MaterialKey,
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    height: number,
    axis: 'x' | 'y' | 'z' = 'y',
    segments = 12
  ): void {
    const g = new THREE.CylinderGeometry(radius, radius, height, segments);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(cx, cy, cz);
    this.add(key, g);
  }

  /** Flat arrow decal used as runner-vision guidance on the ground. */
  arrow(
    key: MaterialKey,
    cx: number,
    cy: number,
    cz: number,
    dirX: number,
    dirZ: number,
    size = 1.6
  ): void {
    const shape = new THREE.Shape();
    const w = size * 0.5;
    const l = size;
    shape.moveTo(0, l * 0.5);
    shape.lineTo(w, -l * 0.1);
    shape.lineTo(w * 0.38, -l * 0.1);
    shape.lineTo(w * 0.38, -l * 0.5);
    shape.lineTo(-w * 0.38, -l * 0.5);
    shape.lineTo(-w * 0.38, -l * 0.1);
    shape.lineTo(-w, -l * 0.1);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // tip now points towards -Z
    // rotate so the tip points along (dirX, dirZ)
    const rot = Math.atan2(-dirX, -dirZ);
    g.rotateY(rot);
    g.translate(cx, cy, cz);
    this.add(key, g);
  }

  /** Builds the merged meshes and adds them to `parent`. */
  build(parent: THREE.Object3D, castShadow = true, receiveShadow = true): THREE.Group {
    const group = new THREE.Group();
    group.name = 'static-geometry';

    for (const [key, list] of this.groups) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.materials[key]);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.name = `merged-${key}`;
      group.add(mesh);
      list.forEach((g) => g.dispose());
    }
    this.groups.clear();
    parent.add(group);
    return group;
  }
}
