import { Vector3 } from "three";

export interface Solid {
  min: Vector3;
  max: Vector3;
  kind: "roof" | "obstacle" | "wall" | "ceiling";
  runnable?: boolean;
  tutorialAssist?: boolean;
}

export class CollisionWorld {
  solids: Solid[] = [];

  add(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    kind: Solid["kind"] = "obstacle",
    runnable = false,
  ) {
    const solid: Solid = {
      min: new Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new Vector3(x + w / 2, y + h / 2, z + d / 2),
      kind,
      runnable,
    };
    this.solids.push(solid);
    return solid;
  }

  nearby(position: Vector3, reach = 3): Solid[] {
    return this.solids.filter(
      (s) =>
        position.x > s.min.x - reach &&
        position.x < s.max.x + reach &&
        position.z > s.min.z - reach &&
        position.z < s.max.z + reach,
    );
  }

  overlaps(p: Vector3, height: number, radius = 0.32, ignore?: Solid) {
    return this.solids.some(
      (s) =>
        s !== ignore &&
        p.x + radius > s.min.x + 0.001 &&
        p.x - radius < s.max.x - 0.001 &&
        p.z + radius > s.min.z + 0.001 &&
        p.z - radius < s.max.z - 0.001 &&
        p.y + height > s.min.y + 0.015 &&
        p.y < s.max.y - 0.015,
    );
  }

  move(
    p: Vector3,
    velocity: Vector3,
    height: number,
    dt: number,
  ): { grounded: boolean; impact: number } {
    const radius = 0.32;
    let grounded = false,
      impact = 0;
    // Each fixed update moves less than a collider radius, preventing tunneling.
    for (const axis of ["x", "z", "y"] as const) {
      const delta = velocity[axis] * dt;
      p[axis] += delta;
      for (const s of this.nearby(p, 1)) {
        if (
          p.x + radius <= s.min.x + 0.0001 ||
          p.x - radius >= s.max.x - 0.0001 ||
          p.z + radius <= s.min.z + 0.0001 ||
          p.z - radius >= s.max.z - 0.0001 ||
          p.y + height <= s.min.y + 0.0001 ||
          p.y >= s.max.y - 0.0001
        )
          continue;
        if (axis === "y") {
          if (delta <= 0) {
            p.y = s.max.y;
            grounded = true;
            impact = Math.max(impact, -velocity.y);
          } else p.y = s.min.y - height;
        } else {
          p[axis] = delta > 0 ? s.min[axis] - radius : s.max[axis] + radius;
        }
        velocity[axis] = 0;
      }
    }
    return { grounded, impact };
  }
}
