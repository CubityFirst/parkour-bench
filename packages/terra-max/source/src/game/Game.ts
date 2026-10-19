import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { PlayerController } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { Level } from '../world/Level';
import { Input } from './Input';

type GameState = 'menu' | 'armed' | 'playing' | 'paused' | 'complete';

const FIXED_STEP = 1 / 120;
const BEST_TIME_KEY = 'skyline-flow-best-time';

/** Owns rendering, fixed-step play state, presentation, and menu transitions. */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.06, 460);
  private readonly yawRig = new THREE.Group();
  private readonly pitchRig = new THREE.Group();
  private readonly arms = new THREE.Group();
  private readonly input = new Input();
  private readonly hud = new HUD();
  private readonly audio = new AudioManager();
  private readonly level = new Level();
  private readonly player = new PlayerController(this.level.collision, this.input);
  private readonly activatedCheckpoints = new Set<string>();
  private checkpointPosition = this.level.spawn.clone();
  private state: GameState = 'menu';
  private elapsed = 0;
  private accumulator = 0;
  private lastFrame = performance.now();
  private armPhase = 0;
  private lastFov = 75;

  constructor() {
    const element = document.getElementById('gameCanvas');
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Game canvas is missing.');
    this.canvas = element;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene.background = new THREE.Color(0x75c5eb);
    this.scene.fog = new THREE.FogExp2(0x93d2ea, 0.0045);
    this.addLights();
    this.scene.add(this.level.group);
    this.buildCameraRig();
    this.player.reset(this.level.spawn);
    this.bindUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('click', () => {
      if (this.state === 'paused') this.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private addLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xd8f5ff, 0x6b7b80, 2.15);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff4df, 3.25);
    sun.position.set(-55, 82, -46);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 190;
    sun.shadow.camera.left = -85;
    sun.shadow.camera.right = 85;
    sun.shadow.camera.top = 85;
    sun.shadow.camera.bottom = -85;
    sun.shadow.bias = -0.00018;
    this.scene.add(sun);

    const warmBounce = new THREE.DirectionalLight(0xa9dcff, 0.45);
    warmBounce.position.set(70, 30, 120);
    this.scene.add(warmBounce);
  }

  private buildCameraRig(): void {
    this.yawRig.add(this.pitchRig);
    this.pitchRig.add(this.camera);
    this.camera.add(this.arms);
    this.scene.add(this.yawRig);

    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf3f5f2, roughness: 0.82 });
    const glove = new THREE.MeshStandardMaterial({ color: 0xd74742, roughness: 0.56 });
    const createArm = (side: number) => {
      const arm = new THREE.Group();
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), sleeve);
      forearm.position.z = -0.23;
      forearm.rotation.x = -0.36;
      arm.add(forearm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.13, 0.18), glove);
      hand.position.set(0, -0.04, -0.57);
      hand.rotation.x = -0.32;
      arm.add(hand);
      arm.position.set(side * 0.49, -0.42, -0.79);
      arm.rotation.z = side * 0.12;
      return arm;
    };
    this.arms.add(createArm(-1), createArm(1));
  }

  private bindUI(): void {
    this.hud.onStart(() => this.beginNewRun());
    this.hud.onResume(() => this.requestPointerLock());
    this.hud.onRunAgain(() => this.beginNewRun());
    this.hud.onCheckpointRestart(() => this.restartAtCheckpoint());
  }

  private beginNewRun(): void {
    this.activatedCheckpoints.clear();
    this.checkpointPosition.copy(this.level.spawn);
    this.player.reset(this.level.spawn);
    this.elapsed = 0;
    this.hud.setTimer(0);
    this.hud.setProgress(0);
    this.hud.setHint(this.level.getHint(this.player.position));
    this.audio.unlock();
    this.state = 'armed';
    this.requestPointerLock();
  }

  private restartAtCheckpoint(): void {
    this.player.reset(this.checkpointPosition);
    this.hud.notify('BACK TO CHECKPOINT');
    if (document.pointerLockElement === this.canvas) {
      this.state = 'playing';
      this.hud.showGame();
    } else {
      this.state = 'armed';
      this.requestPointerLock();
    }
  }

  private requestPointerLock(): void {
    this.audio.unlock();
    void this.canvas.requestPointerLock();
  }

  private onPointerLockChange(): void {
    if (document.pointerLockElement === this.canvas) {
      if (this.state !== 'complete') {
        this.state = 'playing';
        this.hud.showGame();
        this.lastFrame = performance.now();
      }
      return;
    }
    if (this.state === 'playing') {
      this.state = 'paused';
      this.hud.showPause();
    }
  }

  private frame(): void {
    const now = performance.now();
    const frameDelta = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.state === 'playing') {
      const look = this.input.consumeLook();
      this.player.setLook(look.x, look.y, this.hud.getSensitivity());
      this.player.reducedMotion = this.hud.useReducedMotion();
      if (this.input.consumePressed('KeyR')) this.restartAtCheckpoint();

      this.accumulator += frameDelta;
      while (this.accumulator >= FIXED_STEP && this.state === 'playing') {
        this.step(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
    } else {
      this.accumulator = 0;
      this.input.consumeLook();
    }

    this.updatePresentation(frameDelta);
    this.renderer.render(this.scene, this.camera);
  }

  private step(delta: number): void {
    const events = this.player.update(delta);
    this.elapsed += delta;
    if (events.jumped) this.audio.jump();
    if (events.landed) this.audio.land(events.hardLanding);
    if (events.startedSlide) this.audio.slide();
    if (events.vaulted) this.audio.vault();
    this.audio.step(this.player.getSpeed(), this.player.grounded);

    if (this.player.position.y < -31) {
      this.player.reset(this.checkpointPosition);
      this.hud.notify('FALL DETECTED · CHECKPOINT RESTORED');
      return;
    }

    const checkpoint = this.level.findCheckpoint(this.player.position, this.activatedCheckpoints);
    if (checkpoint) {
      this.activatedCheckpoints.add(checkpoint.id);
      this.checkpointPosition.copy(checkpoint.position);
      this.hud.notify(`CHECKPOINT // ${checkpoint.name}`);
      this.audio.checkpoint();
    }

    if (this.level.isFinished(this.player.position)) this.completeRun();
  }

  private completeRun(): void {
    if (this.state !== 'playing') return;
    this.state = 'complete';
    const currentBest = this.getBestTime();
    const best = currentBest === null || this.elapsed < currentBest ? this.elapsed : currentBest;
    try {
      localStorage.setItem(BEST_TIME_KEY, String(best));
    } catch {
      // The run remains complete if a privacy setting blocks local storage.
    }
    this.audio.complete();
    if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
    this.hud.showFinish(this.elapsed, best);
  }

  private getBestTime(): number | null {
    try {
      const saved = Number(localStorage.getItem(BEST_TIME_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : null;
    } catch {
      return null;
    }
  }

  private updatePresentation(delta: number): void {
    this.yawRig.position.copy(this.player.position);
    this.yawRig.rotation.y = this.player.getYaw();
    this.pitchRig.rotation.x = this.player.getPitch();
    this.camera.position.y = this.player.getCameraY();
    this.camera.rotation.z = this.player.cameraRoll;
    if (Math.abs(this.lastFov - this.player.cameraFov) > 0.02) {
      this.lastFov = this.player.cameraFov;
      this.camera.fov = this.lastFov;
      this.camera.updateProjectionMatrix();
    }

    const speed = this.player.getSpeed();
    this.armPhase += delta * (this.player.grounded ? Math.max(1.5, speed * 1.7) : 3.2);
    const vaultProgress = this.player.getVaultProgress();
    this.arms.children.forEach((arm, index) => {
      const direction = index === 0 ? -1 : 1;
      const swing = Math.sin(this.armPhase + index * Math.PI) * Math.min(0.22, speed * 0.016);
      arm.rotation.x = this.player.wallRunning ? -0.35 : vaultProgress > 0 ? -0.9 + vaultProgress * 0.25 : swing;
      arm.rotation.z = direction * (this.player.wallRunning ? 0.42 : 0.12);
    });

    if (this.state === 'playing') {
      this.hud.setTimer(this.elapsed);
      this.hud.setHint(this.level.getHint(this.player.position));
      this.hud.setProgress(this.level.getProgress(this.player.position));
    }
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
