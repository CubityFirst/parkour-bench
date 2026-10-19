import * as THREE from "three";

export type GamePhase = "menu" | "running" | "paused" | "complete";

export class GameState {
  phase: GamePhase = "menu";
  elapsed = 0;
  checkpointIndex = 0;
  checkpointPosition = new THREE.Vector3();
  checkpointName = "START";

  start(position: THREE.Vector3): void {
    this.phase = "running";
    this.elapsed = 0;
    this.checkpointIndex = 0;
    this.checkpointName = "START";
    this.checkpointPosition.copy(position);
  }

  tick(dt: number): void {
    if (this.phase === "running") this.elapsed += dt;
  }

  pause(): void {
    if (this.phase === "running") this.phase = "paused";
  }

  resume(): void {
    if (this.phase === "paused") this.phase = "running";
  }

  setCheckpoint(index: number, name: string, position: THREE.Vector3): void {
    this.checkpointIndex = index;
    this.checkpointName = name;
    this.checkpointPosition.copy(position);
  }

  complete(): void {
    if (this.phase === "running") this.phase = "complete";
  }

  toMenu(): void {
    this.phase = "menu";
    this.elapsed = 0;
  }
}

