import * as THREE from 'three';
import { PlayerPhysics } from './PlayerPhysics.js';
import { FirstPersonCamera } from './FirstPersonCamera.js';
import { ParkourSystem } from './ParkourSystem.js';
import { CollisionWorld } from '../world/CollisionWorld.js';
import { AudioManager } from '../audio/AudioManager.js';

export class PlayerController {
  physics: PlayerPhysics;
  camera: FirstPersonCamera;
  parkour: ParkourSystem;

  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private jumpPressed = false;
  private jumpHeld = false;
  private slidePressed = false;
  private vaultPressed = false;
  private lastGrounded = false;
  private lastSpeed = 0;
  private footstepTimer = 0;

  private cameraHolder = new THREE.Object3D();

  constructor(
    startPosition: THREE.Vector3,
    private world: CollisionWorld,
    private audio: AudioManager,
    private canvas: HTMLCanvasElement,
    private sensitivity: number,
    private motion: 'normal' | 'low'
  ) {
    this.physics = new PlayerPhysics(startPosition);
    this.camera = new FirstPersonCamera(canvas.clientWidth / canvas.clientHeight);
    this.camera.setMotion(this.motion);
    this.parkour = new ParkourSystem();
    this.setupInput();
  }

  setSensitivity(s: number) {
    this.sensitivity = s;
  }

  setMotion(m: 'normal' | 'low') {
    this.motion = m;
    this.camera.setMotion(m);
  }

  private setupInput() {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === ' ') { this.jumpPressed = true; this.jumpHeld = true; }
      if (e.key.toLowerCase() === 'c' || e.key === 'Control') this.slidePressed = true;
      if (e.key.toLowerCase() === 'e') this.vaultPressed = true;
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.key === ' ') { this.jumpPressed = false; this.jumpHeld = false; }
      if (e.key.toLowerCase() === 'c' || e.key === 'Control') this.slidePressed = false;
      if (e.key.toLowerCase() === 'e') this.vaultPressed = false;
    });

    this.canvas.addEventListener('click', () => {
      this.canvas.requestPointerLock();
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }

  reset(position: THREE.Vector3) {
    this.physics.reset(position);
    this.camera.camera.position.copy(position);
    this.camera.camera.position.y += this.physics.state.height;
    this.camera.yaw = Math.PI;
    this.camera.pitch = 0;
    this.camera.currentHeight = this.physics.state.height;
    this.camera.targetHeight = this.physics.state.height;
    this.parkour.wallRunTimer = 0;
    this.parkour.vaultTimer = 0;
    this.parkour.ledgeTimer = 0;
    this.lastGrounded = false;
  }

  update(dt: number) {
    // Mouse look
    if (this.mouseDX !== 0 || this.mouseDY !== 0) {
      this.camera.handleMouse(this.mouseDX, this.mouseDY, this.sensitivity);
      this.mouseDX = 0;
      this.mouseDY = 0;
    }

    const forward = this.camera.getForward();
    const right = this.camera.getRight();
    forward.y = 0;
    forward.normalize();
    right.y = 0;
    right.normalize();

    let input = new THREE.Vector3();
    if (this.keys.has('w')) input.add(forward);
    if (this.keys.has('s')) input.sub(forward);
    if (this.keys.has('a')) input.sub(right);
    if (this.keys.has('d')) input.add(right);
    if (input.lengthSq() > 0) input.normalize();

    const sprinting = this.keys.has('shift') && !this.physics.state.sliding;

    // Parkour update (wall run, vault, ledge) may override physics integration
    this.parkour.update(dt, this.physics, this.world, forward, right, this.jumpPressed, this.vaultPressed);

    if (!this.parkour.isWallRunning && !this.parkour.isVaulting && this.parkour.ledgeTimer <= 0) {
      this.physics.update(dt, this.world, input, sprinting, this.jumpPressed, this.jumpHeld, this.slidePressed);
    }

    const s = this.physics.state;

    // Audio feedback
    const speed = new THREE.Vector3(s.velocity.x, 0, s.velocity.z).length();
    this.audio.updateWind(speed, s.onGround);

    if (s.onGround && speed > 1 && !s.sliding) {
      this.footstepTimer -= dt * (speed * 0.5);
      if (this.footstepTimer <= 0) {
        this.audio.footstep();
        this.footstepTimer = 1;
      }
    }

    if (this.physics.jumpedThisFrame) {
      this.audio.jump();
      this.physics.jumpedThisFrame = false;
    }

    if (!this.lastGrounded && s.onGround) {
      this.audio.land();
      this.camera.triggerLanding();
    }

    if (this.parkour.isVaulting && this.parkour.vaultTimer > 0.3) {
      this.camera.triggerVault();
    }

    if (s.sliding && !this.wasSliding) {
      this.audio.slide();
    }
    this.wasSliding = s.sliding;

    // Camera follow
    this.camera.setHeight(s.height);
    this.camera.camera.position.x = s.position.x;
    this.camera.camera.position.z = s.position.z;
    this.camera.camera.position.y = s.position.y + this.camera.currentHeight;

    this.camera.update(dt, speed, s.onGround, s.sliding, this.parkour.isVaulting, this.parkour.wallRunSide);

    this.lastGrounded = s.onGround;
    this.lastSpeed = speed;

    // Clear one-frame actions
    if (this.jumpPressed) this.jumpPressed = false;
    if (this.vaultPressed) this.vaultPressed = false;
  }

  private wasSliding = false;

  getPosition() {
    return this.physics.state.position;
  }

  handleResize(width: number, height: number) {
    this.camera.setAspect(width / height);
  }
}
