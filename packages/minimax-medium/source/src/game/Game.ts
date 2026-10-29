import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { Input } from '../core/Input';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { ParkourSystem } from '../player/ParkourSystem';
import { PlayerBody } from '../player/PlayerBody';
import { CFG, PlayerPhysics, type MoveIntent } from '../player/PlayerPhysics';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { buildCity, type CityRect } from '../world/CityGenerator';
import { CollisionWorld } from '../world/CollisionWorld';
import { buildLevel, type LevelData } from '../world/Level';
import { createMaterials, PALETTE, type MaterialSet } from '../world/Materials';
import { Sky } from '../world/Sky';
import { GameState } from './GameState';

const FIXED_STEP = 1 / 120;
const MAX_FRAME = 0.25;

const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpWish = new THREE.Vector3();

/**
 * The game: renderer, world, player and all of the glue between them.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly materials: MaterialSet;
  private readonly sky = new Sky();
  private readonly sun: THREE.DirectionalLight;

  private readonly input: Input;
  private readonly hud: HUD;
  private readonly menu: Menu;
  private readonly audio = new AudioManager();

  private readonly level: LevelData;
  private readonly world: CollisionWorld;

  private readonly physics: PlayerPhysics;
  private readonly parkour: ParkourSystem;
  private readonly cam: FirstPersonCamera;
  private readonly body: PlayerBody;

  private state: GameState = GameState.Loading;
  private accumulator = 0;
  private lastTime = 0;
  private runTime = 0;

  private checkpointIndex = 0;
  private sectionIndex = -1;
  private spawnPosition = new THREE.Vector3();
  private spawnYaw = 0;

  private pendingJump = false;
  private pendingSlide = false;
  private pendingInteract = false;
  private readonly intent: MoveIntent = {
    wish: new THREE.Vector3(),
    sprint: false,
    jumpPressed: false,
    jumpHeld: false,
    moving: false,
    slideHeld: false,
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    // ---------------------------------------------------------- renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;

    // ------------------------------------------------------------- scene
    this.scene.fog = new THREE.Fog(PALETTE.haze, 260, 1100);
    this.scene.add(this.sky.mesh);

    this.camera = new THREE.PerspectiveCamera(
      74,
      window.innerWidth / window.innerHeight,
      0.08,
      2600
    );
    this.scene.add(this.camera);

    this.materials = createMaterials();
    this.scene.environment = this.sky.buildEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.85;

    // ------------------------------------------------------------ lights
    // Strong warm key light plus a cool sky fill gives the bright, high
    // contrast look of the reference rooftops.
    const hemi = new THREE.HemisphereLight(0xa9d4ff, 0x70798a, 0.55);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d6, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -42;
    shadowCam.right = 42;
    shadowCam.top = 42;
    shadowCam.bottom = -42;
    shadowCam.near = 1;
    shadowCam.far = 240;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // ------------------------------------------------------------- level
    this.level = buildLevel(this.materials);
    this.scene.add(this.level.group);
    this.world = this.level.world;

    const blocked: CityRect[] = [
      { xMin: -16, xMax: 18, zMin: -36, zMax: 8 },
      { xMin: -12, xMax: 12, zMin: -60, zMax: -38 },
      { xMin: 0, xMax: 22, zMin: -82, zMax: -62 },
      { xMin: -12, xMax: 10, zMin: -106, zMax: -84 },
      { xMin: -14, xMax: 14, zMin: -136, zMax: -108 },
      { xMin: 6, xMax: 19, zMin: -164, zMax: -138 },
      { xMin: 6, xMax: 32, zMin: -196, zMax: -170 },
      { xMin: 0, xMax: 28, zMin: -228, zMax: -198 },
      { xMin: -8, xMax: 16, zMin: -270, zMax: -230 },
      { xMin: -10, xMax: 10, zMin: -298, zMax: -272 },
    ];
    buildCity(this.materials, blocked, this.scene);

    // ------------------------------------------------------------ player
    this.physics = new PlayerPhysics(this.world);
    this.cam = new FirstPersonCamera(this.camera);
    this.body = new PlayerBody(this.camera);

    this.parkour = new ParkourSystem(this.physics, this.world, {
      onJump: () => this.audio.jump(),
      onLand: (impact) => {
        this.audio.land(impact);
        this.cam.onLand(impact);
      },
      onSlide: () => this.audio.slideStart(),
      onVault: () => {
        this.audio.vault();
        this.cam.onVault();
      },
      onMantle: () => this.audio.vault(),
      onWallRun: () => this.audio.wallRun(),
    });

    this.spawnPosition.copy(this.level.spawn.position);
    this.spawnYaw = this.level.spawn.yaw;
    this.physics.reset(this.spawnPosition);

    // --------------------------------------------------------------- ui
    this.hud = new HUD();
    this.menu = new Menu({
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => {
        this.respawn(true);
        this.resume();
      },
      onRestartLevel: () => {
        this.restartLevel();
        this.resume();
      },
      onQuit: () => this.toMenu(),
      onSensitivity: (v) => (this.cam.sensitivity = v),
      onMotion: (v) => (this.cam.motionScale = v),
      onVolume: (v) => this.audio.setVolume(v),
    });
    this.cam.sensitivity = this.menu.settings.sensitivity;
    this.cam.motionScale = this.menu.settings.motion;
    this.audio.setVolume(this.menu.settings.volume);

    this.input = new Input(canvas);

    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === GameState.Playing) this.pause();
    });

    canvas.addEventListener('click', () => {
      if (this.state === GameState.Playing && !this.input.locked) this.input.requestLock();
    });

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === GameState.Playing) this.pause();
    });

    this.menu.hideLoading();
    this.menu.showMain();
    this.state = GameState.Menu;
    this.hud.hide();

    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ==================================================================
  // lifecycle
  // ==================================================================
  private startRun(): void {
    this.audio.init();
    this.restartLevel();
    this.state = GameState.Playing;
    this.menu.hideAll();
    this.hud.show();
    this.input.requestLock();
    this.hud.showToast('GO', 1.2);
    this.hud.showHint('WASD MOVE · SHIFT SPRINT · SPACE JUMP · CTRL SLIDE · E VAULT', 6);
  }

  private restartLevel(): void {
    this.runTime = 0;
    this.checkpointIndex = 0;
    this.sectionIndex = -1;
    this.spawnPosition.copy(this.level.spawn.position);
    this.spawnYaw = this.level.spawn.yaw;
    this.level.checkpointPads.forEach((pad) => {
      const m = pad.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.25;
    });
    this.physics.reset(this.spawnPosition);
    this.cam.yaw = this.spawnYaw;
    this.cam.pitch = 0;
    this.cam.reset();
    this.updateSection(true);
  }

  private resume(): void {
    if (this.state === GameState.Finished) return;
    this.state = GameState.Playing;
    this.menu.hideAll();
    this.hud.show();
    this.input.requestLock();
  }

  private pause(): void {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Paused;
    this.input.releaseLock();
    this.hud.hide();
    this.menu.showPause(
      this.runTime,
      this.level.checkpoints[Math.min(this.checkpointIndex, this.level.checkpoints.length - 1)].label
    );
  }

  private toMenu(): void {
    this.state = GameState.Menu;
    this.input.releaseLock();
    this.hud.hide();
    this.menu.showMain();
  }

  private complete(): void {
    if (this.state === GameState.Finished) return;
    this.state = GameState.Finished;
    this.input.releaseLock();
    this.audio.complete();
    this.hud.hide();
    this.menu.showFinish(this.runTime);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  // ==================================================================
  // main loop
  // ==================================================================
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);

    const dt = Math.min(MAX_FRAME, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.state === GameState.Playing) {
      this.runTime += dt;

      // discrete input
      if (this.input.wasPressed('Space')) this.pendingJump = true;
      if (this.input.wasPressed('KeyC') || this.input.wasPressed('ControlLeft')) {
        this.pendingSlide = true;
      }
      if (this.input.wasPressed('KeyE')) this.pendingInteract = true;
      if (this.input.wasPressed('KeyR')) this.respawn(true);

      this.cam.look(this.input.mouseDX, this.input.mouseDY);

      this.accumulator += dt;
      let guard = 0;
      while (this.accumulator >= FIXED_STEP && guard < 12) {
        this.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        guard++;
      }
      if (guard >= 12) this.accumulator = 0;
    }

    this.input.endFrame();
    this.render(dt);
  };

  private fixedUpdate(dt: number): void {
    const intent = this.buildIntent();
    const slidePressed = this.pendingSlide;
    const interactPressed = this.pendingInteract;
    this.pendingJump = false;
    this.pendingSlide = false;
    this.pendingInteract = false;

    // forward / right basis for the controller
    this.cam.flatForward(tmpForward);
    this.physics.updateBasis(tmpForward);

    this.parkour.update(dt, {
      wish: intent.wish,
      sprint: intent.sprint,
      jumpPressed: intent.jumpPressed,
      jumpHeld: intent.jumpHeld,
      moving: intent.moving,
      slideHeld: intent.slideHeld,
      slidePressed,
      interactPressed,
    });

    // smooth the collision height between standing and sliding
    const p = this.physics;
    const rate = p.heightTarget > p.height ? 11 : 18;
    p.height += (p.heightTarget - p.height) * Math.min(1, rate * dt);

    this.physics.step(dt, intent);

    // footsteps
    if (this.physics.grounded && !this.physics.sliding) {
      this.audio.footstep(this.physics.horizontalSpeed > CFG.walkSpeed);
    }

    this.checkProgress();
  }

  private buildIntent(): MoveIntent {
    const i = this.input;
    this.cam.flatForward(tmpForward);
    tmpRight.set(Math.cos(this.cam.yaw), 0, -Math.sin(this.cam.yaw));

    tmpWish.set(0, 0, 0);
    if (i.isDown('KeyW') || i.isDown('ArrowUp')) tmpWish.add(tmpForward);
    if (i.isDown('KeyS') || i.isDown('ArrowDown')) tmpWish.sub(tmpForward);
    if (i.isDown('KeyD') || i.isDown('ArrowRight')) tmpWish.add(tmpRight);
    if (i.isDown('KeyA') || i.isDown('ArrowLeft')) tmpWish.sub(tmpRight);

    const moving = tmpWish.lengthSq() > 0.0001;
    if (moving) tmpWish.normalize();

    this.intent.wish.copy(tmpWish);
    this.intent.sprint = i.isDown('ShiftLeft') || i.isDown('ShiftRight');
    this.intent.jumpPressed = this.pendingJump;
    this.intent.jumpHeld = i.isDown('Space');
    this.intent.moving = moving;
    this.intent.slideHeld = i.isDown('ControlLeft') || i.isDown('ControlRight') || i.isDown('KeyC');
    return this.intent;
  }

  // ==================================================================
  // progression
  // ==================================================================
  private checkProgress(): void {
    const p = this.physics.position;

    // fell off the roof
    if (p.y < this.level.killY) {
      this.respawn(true);
      return;
    }

    // checkpoints
    for (let i = this.checkpointIndex + 1; i < this.level.checkpoints.length; i++) {
      const cp = this.level.checkpoints[i];
      const dx = p.x - cp.position.x;
      const dz = p.z - cp.position.z;
      const dy = p.y - cp.position.y;
      if (dx * dx + dz * dz < 2.6 * 2.6 && Math.abs(dy) < 2.5) {
        this.checkpointIndex = i;
        this.spawnPosition.copy(cp.position);
        this.spawnYaw = cp.yaw;
        const pad = this.level.checkpointPads[i];
        if (pad) {
          const m = pad.material as THREE.MeshStandardMaterial;
          m.emissiveIntensity = 1.6;
        }
        this.audio.checkpoint();
        this.hud.flashCheckpoint();
        this.hud.showToast(`CHECKPOINT · ${cp.label}`, 1.6);
      }
    }

    // finish
    const f = this.level.finish;
    const dx = p.x - f.position.x;
    const dz = p.z - f.position.z;
    if (dx * dx + dz * dz < f.radius * f.radius && Math.abs(p.y - f.position.y) < 3) {
      this.complete();
      return;
    }

    this.updateSection(false);
  }

  private updateSection(force: boolean): void {
    const p = this.physics.position;
    let index = -1;
    for (let i = 0; i < this.level.sections.length; i++) {
      if (p.z <= this.level.sections[i].z) index = i;
    }
    if (index !== this.sectionIndex && index >= 0) {
      this.sectionIndex = index;
      const section = this.level.sections[index];
      this.hud.setSection(section.name);
      if (!force) this.hud.showHint(section.hint, 4.5);
    }
  }

  private respawn(toCheckpoint: boolean): void {
    const target = toCheckpoint ? this.spawnPosition : this.level.spawn.position;
    const yaw = toCheckpoint ? this.spawnYaw : this.level.spawn.yaw;
    this.physics.reset(target);
    this.cam.yaw = yaw;
    this.cam.pitch = 0;
    this.cam.reset();
    if (toCheckpoint && this.checkpointIndex > 0) {
      this.hud.showToast('RESPAWN', 1);
    }
  }

  // ==================================================================
  // rendering
  // ==================================================================
  private render(dt: number): void {
    const p = this.physics;

    // camera
    const strafe = this.input.isDown('KeyD') || this.input.isDown('ArrowRight')
      ? 1
      : this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')
        ? -1
        : 0;
    let wallSide = 0;
    if (p.wallRun) {
      // +1 when the wall is on the player's right
      const rx = Math.cos(this.cam.yaw);
      const rz = -Math.sin(this.cam.yaw);
      wallSide = p.wallRun.normal.x * rx + p.wallRun.normal.z * rz > 0 ? 1 : -1;
    }
    this.cam.update(dt, p, strafe, wallSide);
    this.body.update(dt, p);

    // sun follows the player so the shadow map stays crisp
    this.sky.mesh.position.copy(this.camera.position);
    this.sun.position
      .copy(this.camera.position)
      .addScaledVector(this.sky.sunDirection, 90);
    this.sun.target.position.copy(this.camera.position);
    this.sun.target.updateMatrixWorld();

    this.audio.update(p.horizontalSpeed, p.sliding);

    if (this.state === GameState.Playing) {
      this.hud.setTimer(this.runTime);
      this.hud.setSpeed(p.horizontalSpeed / CFG.sprintSpeed);
    }
    this.hud.update(dt);

    this.renderer.render(this.scene, this.camera);
  }
}
