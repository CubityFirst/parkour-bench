import { Checkpoint, Level } from './Level';
import { CheckpointMarker } from './CityGenerator';

/** Tracks the active checkpoint, detects triggers and lights up the markers. */
export class Checkpoints {
  active = 0;

  constructor(private level: Level, private markers: CheckpointMarker[]) {
    this.reset();
  }

  reset(): void {
    this.active = 0;
    this.markers.forEach((m) => this.paint(m, false));
  }

  get current(): Checkpoint {
    return this.level.checkpoints[this.active];
  }

  /** Returns the checkpoint that was just reached, if any (only forward progress counts). */
  check(x: number, y: number, z: number): Checkpoint | null {
    const cps = this.level.checkpoints;
    for (let i = this.active + 1; i < cps.length; i++) {
      const c = cps[i];
      if (x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) {
        this.active = i;
        this.markers.forEach((m, k) => this.paint(m, k < i));
        return c;
      }
    }
    return null;
  }

  private paint(m: CheckpointMarker, on: boolean): void {
    m.mat.color.set(on ? 0xffffff : 0xe0211b);
    m.mat.emissive.set(on ? 0x667788 : 0x330000);
    m.group.scale.setScalar(1);
    m.group.userData.on = on;
  }

  /** Gentle pulse for the next checkpoint marker. */
  animate(time: number): void {
    const next = this.markers[this.active]; // marker index = checkpoint id - 1, so [active] is the upcoming one
    this.markers.forEach((m) => { m.mat.emissiveIntensity = 1; });
    if (next) next.mat.emissiveIntensity = 1.5 + Math.sin(time * 4) * 1.2;
  }

  dispose(): void { /* materials are owned by the world visuals */ }
}

