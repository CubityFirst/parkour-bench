import { Box3, Vector3 } from "three";

export interface Collider {
  bounds: Box3;
  kind: "roof" | "solid" | "vault" | "wallrun";
  name: string;
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];

  add(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    kind: Collider["kind"] = "solid",
    name = "",
  ): Collider {
    const collider = {
      bounds: new Box3(
        new Vector3(x - w / 2, y - h / 2, z - d / 2),
        new Vector3(x + w / 2, y + h / 2, z + d / 2),
      ),
      kind,
      name,
    };
    this.colliders.push(collider);
    return collider;
  }

  nearby(position: Vector3, radius = 3): Collider[] {
    return this.colliders.filter(
      ({ bounds: b }) =>
        position.x + radius > b.min.x &&
        position.x - radius < b.max.x &&
        position.z + radius > b.min.z &&
        position.z - radius < b.max.z &&
        position.y + 4 > b.min.y &&
        position.y - 3 < b.max.y,
    );
  }

  overlaps(
    position: Vector3,
    height: number,
    radius: number,
    ignore?: Collider,
  ): boolean {
    return this.nearby(position).some(
      (c) => c !== ignore && this.intersects(position, height, radius, c),
    );
  }

  intersects(p: Vector3, height: number, radius: number, c: Collider): boolean {
    const b = c.bounds;
    const epsilon = 0.001;
    return (
      p.x + radius > b.min.x + epsilon &&
      p.x - radius < b.max.x - epsilon &&
      p.z + radius > b.min.z + epsilon &&
      p.z - radius < b.max.z - epsilon &&
      p.y + height > b.min.y + epsilon &&
      p.y < b.max.y - epsilon
    );
  }

  floorAt(x: number, z: number, maxY = Infinity): number | undefined {
    let top: number | undefined;
    for (const { bounds: b, kind } of this.colliders) {
      if (kind !== "roof") continue;
      if (
        x > b.min.x &&
        x < b.max.x &&
        z > b.min.z &&
        z < b.max.z &&
        b.max.y <= maxY
      ) {
        top = Math.max(top ?? -Infinity, b.max.y);
      }
    }
    return top;
  }
}
