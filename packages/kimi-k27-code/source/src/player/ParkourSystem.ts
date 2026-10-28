import * as THREE from 'three';
import { PlayerPhysics } from './PlayerPhysics.js';
import { CollisionWorld } from '../world/CollisionWorld.js';

export class ParkourSystem {
  wallRunTimer = 0;
  wallRunSide = 0; // -1 left, 1 right, 0 none
  wallRunNormal = new THREE.Vector3();
  vaultTimer = 0;
  ledgeTimer = 0;

  private tmp = new THREE.Vector3();

  update(dt: number, physics: PlayerPhysics, world: CollisionWorld, forward: THREE.Vector3, right: THREE.Vector3, jumpPressed: boolean, vaultPressed: boolean) {
    const s = physics.state;

    // === Wall run ===
    if (this.wallRunTimer > 0) {
      this.wallRunTimer -= dt;
      // Move along wall
      const along = forward.clone().projectOnPlane(this.wallRunNormal).normalize();
      const targetV = along.multiplyScalar(12);
      s.velocity.x = targetV.x;
      s.velocity.z = targetV.z;
      s.velocity.y = Math.max(s.velocity.y, -2);
      s.velocity.y += physics.gravity * dt * 0.25; // reduced gravity

      // Integrate position
      const move = s.velocity.clone().multiplyScalar(dt);
      const bounds = physics.getBounds();
      const result = world.sweep(bounds.min, bounds.max, move.clone().normalize(), move.length(), (b) => b.type !== 'trigger');
      if (result.box && result.fraction < 1) {
        s.position.add(move.multiplyScalar(Math.max(0, result.fraction - 0.001)));
        // if hit something other than the wall, stop wall run
        if (result.normal.y > 0.5) {
          s.onGround = true;
          this.endWallRun();
        }
      } else {
        s.position.add(move);
      }

      // Jump off wall
      if (jumpPressed) {
        const away = this.wallRunNormal.clone().multiplyScalar(8);
        s.velocity.add(away);
        s.velocity.y = Math.max(s.velocity.y, 7);
        this.endWallRun();
      }

      if (s.onGround || this.wallRunTimer <= 0) {
        this.endWallRun();
      }
      return; // parkour overrides normal physics integration
    }

    // Detect wall run
    if (!s.onGround && s.velocity.y < 5 && !s.sliding) {
      const speedXZ = new THREE.Vector3(s.velocity.x, 0, s.velocity.z).length();
      if (speedXZ > 6) {
        for (const side of [-1, 1] as const) {
          const dir = right.clone().multiplyScalar(side);
          const origin = s.position.clone().add(new THREE.Vector3(0, s.height * 0.6, 0));
          const hit = world.raycast(origin, dir, s.radius + 0.5, (b) => b.type === 'wallrun');
          if (hit) {
            // must be moving somewhat along the wall, not directly into it
            const dot = forward.dot(hit.normal);
            if (Math.abs(dot) < 0.85) {
              this.wallRunTimer = 1.0;
              this.wallRunSide = side;
              this.wallRunNormal.copy(hit.normal);
              s.velocity.y = Math.max(s.velocity.y, 1);
              break;
            }
          }
        }
      }
    }

    // === Vaulting ===
    if (this.vaultTimer > 0) {
      this.vaultTimer -= dt;
      const progress = 1 - this.vaultTimer / 0.35;
      if (progress <= 1) {
        const vaultOffset = Math.sin(progress * Math.PI) * 0.8;
        s.position.y += vaultOffset * dt * 3;
      }
      if (this.vaultTimer <= 0) {
        s.velocity.y = Math.max(s.velocity.y, 0);
      }
      return;
    }

    if (vaultPressed && s.onGround && !s.sliding) {
      const origin = s.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      const hit = world.raycast(origin, forward, s.radius + 1.0, (b) => b.type === 'vault');
      if (hit && hit.box && hit.box.max.y - s.position.y < 1.6) {
        this.vaultTimer = 0.35;
        s.velocity.y = 4;
      }
    }

    // === Ledge recovery ===
    if (this.ledgeTimer > 0) {
      this.ledgeTimer -= dt;
      const t = 1 - this.ledgeTimer / 0.5;
      s.position.y = THREE.MathUtils.lerp(this.ledgeStartY, this.ledgeTargetY, t);
      if (this.ledgeTimer <= 0) {
        s.onGround = true;
        s.velocity.set(0, 0, 0);
      }
      return;
    }

    if (!s.onGround && s.velocity.y < 0 && !s.sliding) {
      // Check if player is just below a ledge
      const forwardOrigin = s.position.clone().add(new THREE.Vector3(0, s.height - 0.2, 0));
      const wallHit = world.raycast(forwardOrigin, forward, s.radius + 0.35, (b) => b.type !== 'trigger');
      if (wallHit && wallHit.normal.y < 0.3) {
        // check top surface above
        const topOrigin = wallHit.point.clone().add(new THREE.Vector3(0, 1.5, 0)).add(forward.clone().multiplyScalar(0.1));
        const downHit = world.raycast(topOrigin, new THREE.Vector3(0, -1, 0), 2.0, (b) => b.type !== 'trigger');
        if (downHit && downHit.normal.y > 0.5) {
          const topY = downHit.point.y;
          if (topY > s.position.y + s.height - 0.3 && topY < s.position.y + s.height + 1.2) {
            this.ledgeTimer = 0.5;
            this.ledgeStartY = s.position.y;
            this.ledgeTargetY = topY + 0.05;
            s.velocity.set(0, 0, 0);
          }
        }
      }
    }
  }

  private endWallRun() {
    this.wallRunTimer = 0;
    this.wallRunSide = 0;
  }

  private ledgeStartY = 0;
  private ledgeTargetY = 0;

  get isWallRunning() {
    return this.wallRunTimer > 0;
  }

  get isVaulting() {
    return this.vaultTimer > 0;
  }
}
