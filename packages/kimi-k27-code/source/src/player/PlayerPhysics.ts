import * as THREE from 'three';
import { CollisionWorld } from '../world/CollisionWorld.js';

export interface PlayerState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  height: number;
  standingHeight: number;
  slidingHeight: number;
  onGround: boolean;
  crouching: boolean;
  sliding: boolean;
}

export class PlayerPhysics {
  state: PlayerState;
  gravity = -28;
  groundFriction = 10;
  airFriction = 0.5;
  maxSpeed = 7;
  sprintSpeed = 13;
  acceleration = 60;
  airAcceleration = 16;
  jumpVelocity = 8.5;
  coyoteTime = 0.12;
  jumpBufferTime = 0.12;

  coyoteTimer = 0;
  jumpBufferTimer = 0;
  slideTimer = 0;
  jumpedThisFrame = false;

  constructor(startPosition: THREE.Vector3) {
    this.state = {
      position: startPosition.clone(),
      velocity: new THREE.Vector3(),
      radius: 0.4,
      height: 1.7,
      standingHeight: 1.7,
      slidingHeight: 0.6,
      onGround: false,
      crouching: false,
      sliding: false,
    };
  }

  reset(position: THREE.Vector3) {
    this.state.position.copy(position);
    this.state.velocity.set(0, 0, 0);
    this.state.onGround = false;
    this.state.crouching = false;
    this.state.sliding = false;
    this.state.height = this.state.standingHeight;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.slideTimer = 0;
  }

  getBounds(position?: THREE.Vector3) {
    const pos = position || this.state.position;
    return {
      min: new THREE.Vector3(pos.x - this.state.radius, pos.y, pos.z - this.state.radius),
      max: new THREE.Vector3(pos.x + this.state.radius, pos.y + this.state.height, pos.z + this.state.radius)
    };
  }

  private collideSweep(moveDir: THREE.Vector3, dist: number, world: CollisionWorld): { position: THREE.Vector3; hitNormal: THREE.Vector3; hit: boolean } {
    let remaining = dist;
    let pos = this.state.position.clone();
    let hitNormal = new THREE.Vector3(0, -1, 0);
    let anyHit = false;

    // Iteratively sweep and slide against collision
    for (let iter = 0; iter < 5 && remaining > 0.001; iter++) {
      const bounds = this.getBounds(pos);
      const result = world.sweep(bounds.min, bounds.max, moveDir, remaining, (b) => b.type !== 'trigger');
      if (!result.box) {
        pos.add(moveDir.clone().multiplyScalar(remaining));
        break;
      }

      anyHit = true;
      const travel = remaining * Math.max(0, result.fraction - 0.001);
      if (travel < 0.001) {
        // already touching; try to slide
        const slide = moveDir.clone().sub(result.normal.clone().multiplyScalar(moveDir.dot(result.normal)));
        if (slide.lengthSq() > 0.001) {
          moveDir.copy(slide.normalize());
          continue;
        }
        break;
      }

      pos.add(moveDir.clone().multiplyScalar(travel));
      remaining -= travel;
      hitNormal = result.normal;

      const removal = moveDir.dot(result.normal);
      if (removal > 0) break;
      const slide = moveDir.clone().sub(result.normal.clone().multiplyScalar(removal));
      if (slide.lengthSq() < 0.0001) break;
      moveDir.copy(slide.normalize());
    }

    return { position: pos, hitNormal, hit: anyHit };
  }

  update(dt: number, world: CollisionWorld, inputDir: THREE.Vector3, sprinting: boolean, jumpPressed: boolean, jumpHeld: boolean, slideRequested: boolean) {
    const s = this.state;

    // Slide state
    if (slideRequested && !s.sliding && s.onGround && s.velocity.length() > 3) {
      s.sliding = true;
      s.crouching = true;
      s.height = s.slidingHeight;
      this.slideTimer = 0.8;
    }

    if (s.sliding) {
      this.slideTimer -= dt;
      if (!slideRequested && this.slideTimer <= 0) {
        // try stand up
        const bounds = this.getBounds();
        bounds.max.y += s.standingHeight - s.slidingHeight;
        if (!world.intersectsBox(bounds.min, bounds.max, (b) => b.type !== 'trigger')) {
          s.sliding = false;
          s.crouching = false;
          s.height = s.standingHeight;
        }
      }
      if (this.slideTimer <= -0.5) {
        s.sliding = false;
        s.crouching = false;
        s.height = s.standingHeight;
      }
    }

    // Ground detection
    const groundDist = 0.08;
    const groundRayOrigin = s.position.clone().add(new THREE.Vector3(0, 0.05, 0));
    const ground = world.groundBelow(groundRayOrigin, groundDist + 0.1, (b) => b.type !== 'trigger');
    const wasGrounded = s.onGround;
    s.onGround = !!ground && s.velocity.y <= 0.1;

    if (s.onGround && !wasGrounded) {
      s.position.y = ground!.y;
      s.velocity.y = 0;
    }

    // Coyote time and jump buffer
    if (s.onGround) {
      this.coyoteTimer = this.coyoteTime;
    } else {
      this.coyoteTimer -= dt;
    }
    if (jumpPressed) this.jumpBufferTimer = this.jumpBufferTime;
    else this.jumpBufferTimer -= dt;

    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      s.velocity.y = this.jumpVelocity;
      s.onGround = false;
      this.jumpedThisFrame = true;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
    }

    // Variable jump height
    if (!jumpHeld && s.velocity.y > 0) {
      s.velocity.y -= 22 * dt;
    }

    // Horizontal movement
    const targetSpeed = sprinting ? this.sprintSpeed : this.maxSpeed;
    const currentSpeed = new THREE.Vector3(s.velocity.x, 0, s.velocity.z).length();

    if (inputDir.lengthSq() > 0) {
      const accel = s.onGround ? this.acceleration : this.airAcceleration;
      const cappedInput = inputDir.clone().multiplyScalar(targetSpeed);
      const diff = cappedInput.clone().sub(new THREE.Vector3(s.velocity.x, 0, s.velocity.z));
      const add = diff.normalize().multiplyScalar(Math.min(diff.length(), accel * dt));
      s.velocity.x += add.x;
      s.velocity.z += add.z;
    }

    // Friction
    const speedXZ = new THREE.Vector3(s.velocity.x, 0, s.velocity.z).length();
    if (s.onGround) {
      let friction = this.groundFriction;
      if (s.sliding) friction = 1.5;
      const drop = speedXZ * friction * dt;
      const newSpeed = Math.max(0, speedXZ - drop);
      if (speedXZ > 0) {
        s.velocity.x = (s.velocity.x / speedXZ) * newSpeed;
        s.velocity.z = (s.velocity.z / speedXZ) * newSpeed;
      }
    } else {
      const drop = speedXZ * this.airFriction * dt;
      const newSpeed = Math.max(0, speedXZ - drop);
      if (speedXZ > 0) {
        s.velocity.x = (s.velocity.x / speedXZ) * newSpeed;
        s.velocity.z = (s.velocity.z / speedXZ) * newSpeed;
      }
    }

    // Gravity
    s.velocity.y += this.gravity * dt;
    s.velocity.y = Math.max(s.velocity.y, -40);

    // Integrate
    const move = s.velocity.clone().multiplyScalar(dt);
    if (move.lengthSq() > 0) {
      const result = this.collideSweep(move.clone().normalize(), move.length(), world);
      s.position.copy(result.position);
      if (result.hit && result.hitNormal.y > 0.5) {
        s.onGround = true;
        s.velocity.y = 0;
      } else if (result.hit && result.hitNormal.y < -0.5) {
        s.velocity.y = Math.min(0, s.velocity.y);
      }
    }

    // After moving, if on ground snap down
    if (!s.onGround && s.velocity.y <= 0) {
      const snap = world.groundBelow(s.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.2, (b) => b.type !== 'trigger');
      if (snap) {
        s.position.y = snap.y;
        s.velocity.y = 0;
        s.onGround = true;
      }
    }
  }
}
