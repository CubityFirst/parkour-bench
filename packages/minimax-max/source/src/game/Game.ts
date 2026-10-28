import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { CAMERA, PHYSICS } from './Config';
import { GameState } from './GameState';
import { Input } from './Input';
import { AudioManager } from '../audio/AudioManager';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerController, type PlayerInputState } from '../player/PlayerController';
import { ViewModel } from '../player/ViewModel';
import { Checkpoints } from '../world/Checkpoints';
import { CityGenerator } from '../world/CityGenerator';
import { Level } from '../world/Level';
import { buildLevelMeshes } from '../world/LevelRenderer';
import { createMaterials } from '../world/Materials';
import { Sky } from '../world/Sky';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';

const FIXED_STEP = 1 / 120;
const MAX_FRAME_TIME = 0.1;

/** Main game class: owns the renderer, the world and the game loop. */
export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA.fovBase, 1, 0.05, 2000);
  private readonly state = new GameState();
  private readonly input: Input;
  private readonly audio = new AudioManager();
  private readonly hud = new HUD();
  private readonly menu: Menu;

  private readonly level = new Level();
  private readonly checkpoints: Checkpoints;
  private readonly player: PlayerController;
  private readonly cameraRig: FirstPersonCamera;
  private readonly viewModel: ViewModel;
  private readonly sky = new Sky();
  private readonly sun: DirectionalLight;

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private accumulator = 0;
  private lastTime = 0;
  private runTime = 0;
  private running = false;
  private stepDistance = 0;
  private hintIndex = 0;
  private sectionIndex = 0;
  private finished = false;
  /** Edge triggered key presses, consumed by the next physics step. */
  private pendingJump = false;
  private pendingSlide = false;
  private pendingVault = false;
  /** Debug switch: freezes the live loop so scripted simulations are exact. */
  debugFreeze = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.input = new Input(canvas);
    this.checkpoints = new Checkpoints(this.level);
    this.player = new PlayerController(this.level.world);
    this.cameraRig = new FirstPersonCamera(this.camera);
    this.viewModel = new ViewModel(this.camera);

    this.menu = new Menu(this.state, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => this.restartFromCheckpoint(),
      onRestartLevel: () => this.restartLevel(),
      onQuitToMenu: () => this.quitToMenu(),
      onSettingsChange: () => this.applySettings(),
    });

    // Lighting.
    this.sun = new DirectionalLight(0xfff4e2, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.camera.left = -42;
    this.sun.shadow.camera.right = 42;
    this.sun.shadow.camera.top = 42;
    this.sun.shadow.camera.bottom = -42;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const hemi = new HemisphereLight(0xcfe8ff, 0xf3f0ea, 0.62);
    this.scene.add(hemi);
    const fill = new DirectionalLight(0xd8e8ff, 0.32);
    fill.position.set(-40, 30, -60);
    this.scene.add(fill);

    this.scene.fog = new Fog(new Color(0xcadcea), 260, 1250);
  }

  /** Builds the world and shows the main menu. */
  boot(): void {
    const materials = createMaterials();
    this.scene.add(this.sky.mesh);
    this.scene.environment = this.sky.createEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.55;

    const city = new CityGenerator(materials);
    this.scene.add(city.group);
    this.scene.add(buildLevelMeshes(this.level, materials));

    this.scene.add(this.camera);
    this.player.respawn(this.level.spawn.position.x, this.level.spawn.position.y, this.level.spawn.position.z, this.level.spawn.yaw);
    this.cameraRig.reset(this.level.spawn.yaw);
    this.updateCamera(0);

    this.input.onLockChange = (locked) => {
      if (!locked && this.state.phase === 'playing') this.pause();
    };
    this.canvas.addEventListener('click', () => {
      if (this.state.phase === 'playing') this.input.requestLock();
    });

    this.applySettings();
    this.setupComposer();
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    this.menu.hideLoading();
    this.menu.showMenu();
    this.state.setPhase('menu');
    this.hud.hide();

    this.lastTime = performance.now();
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  private setupComposer(): void {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      0.17,
      0.5,
      0.95,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloomPass = bloom;
    this.applySettings();
  }

  private applySettings(): void {
    if (this.bloomPass) {
      this.bloomPass.enabled = this.state.settings.bloom;
    }
    this.audio.setEnabled(this.state.settings.sound);
    this.renderer.toneMappingExposure = this.state.settings.bloom ? 0.94 : 0.98;
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
  }

  // -----------------------------------------------------------------------
  // flow
  // -----------------------------------------------------------------------

  startRun(): void {
    this.audio.init();
    this.restartLevel();
  }

  restartLevel(): void {
    this.finished = false;
    this.runTime = 0;
    this.hintIndex = 0;
    this.sectionIndex = 0;
    this.stepDistance = 0;
    this.pendingJump = false;
    this.pendingSlide = false;
    this.pendingVault = false;
    this.checkpoints.reset();
    this.player.falls = 0;
    this.player.respawn(
      this.level.spawn.position.x,
      this.level.spawn.position.y,
      this.level.spawn.position.z,
      this.level.spawn.yaw,
    );
    this.cameraRig.reset(this.level.spawn.yaw);
    this.updateCamera(0);
    this.hud.show();
    this.hud.setTimer(0);
    this.hud.setSection(1, this.level.sections[0]?.name ?? '');
    this.menu.hideMenu();
    this.menu.hidePause();
    this.menu.hideComplete();
    this.state.setPhase('playing');
    this.input.requestLock();
  }

  restartFromCheckpoint(): void {
    const position = this.checkpoints.spawnPosition;
    this.player.respawn(position.x, position.y, position.z, this.checkpoints.spawnYaw);
    this.cameraRig.reset(this.checkpoints.spawnYaw);
    this.updateCamera(0);
    this.state.setPhase('playing');
    this.menu.hidePause();
    this.input.requestLock();
  }

  pause(): void {
    if (this.state.phase !== 'playing') return;
    this.state.setPhase('paused');
    this.input.releaseLock();
    this.menu.showPause();
    this.audio.slideStop();
    this.audio.setWind(0);
  }

  resume(): void {
    if (this.state.phase !== 'paused') return;
    this.state.setPhase('playing');
    this.menu.hidePause();
    this.input.requestLock();
  }

  quitToMenu(): void {
    this.state.setPhase('menu');
    this.input.releaseLock();
    this.menu.hidePause();
    this.menu.hideComplete();
    this.menu.showMenu();
    this.hud.hide();
    this.audio.slideStop();
    this.audio.setWind(0);
  }

  private completeRun(): void {
    this.finished = true;
    this.state.setPhase('complete');
    this.input.releaseLock();
    this.audio.complete();
    this.audio.slideStop();
    this.audio.setWind(0);
    const isRecord = this.state.recordTime(this.runTime);
    this.menu.showComplete(this.runTime, this.state.bestTime ?? this.runTime, this.player.falls, isRecord);
    this.menu.updateBest();
  }

  // -----------------------------------------------------------------------
  // loop
  // -----------------------------------------------------------------------

  private loop = (time: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);

    const rawDelta = Math.min(MAX_FRAME_TIME, (time - this.lastTime) / 1000);
    this.lastTime = time;

    if (this.state.phase === 'playing' && !this.debugFreeze) {
      this.handleLook();
      this.pendingJump = this.pendingJump || this.input.wasPressed('Space');
      this.pendingSlide =
        this.pendingSlide ||
        this.input.wasPressed('ControlLeft') ||
        this.input.wasPressed('ControlRight') ||
        this.input.wasPressed('KeyC');
      this.pendingVault = this.pendingVault || this.input.wasPressed('KeyE');
      if (this.input.wasPressed('KeyR')) {
        this.restartFromCheckpoint();
      }
      if (this.input.wasPressed('Escape')) {
        this.pause();
      }
      this.accumulator += rawDelta;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < 12) {
        this.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        steps++;
      }
      if (steps >= 12) this.accumulator = 0;
      this.updateCamera(rawDelta);
      this.runTime += rawDelta;
      this.hud.setTimer(this.runTime);
      this.hud.setSpeed(this.player.speed, PHYSICS.sprintSpeed);
      this.hud.update(rawDelta);
      this.updateProgress();
    } else {
      this.accumulator = 0;
    }

    this.input.endFrame();
    this.viewModel.update(rawDelta, this.player);
    this.render();
  };

  private handleLook(): void {
    const delta = this.input.consumeMouseDelta();
    if (delta.x !== 0 || delta.y !== 0) {
      this.cameraRig.applyLook(delta.x, delta.y, this.state.settings.sensitivity);
    }
  }

  private fixedUpdate(dt: number): void {
    const input = this.playerInput();
    input.jumpPressed = this.pendingJump;
    input.slidePressed = this.pendingSlide;
    input.vaultPressed = this.pendingVault;
    this.pendingJump = false;
    this.pendingSlide = false;
    this.pendingVault = false;
    this.simulateStep(dt, input);
  }

  private simulateStep(dt: number, input: PlayerInputState): void {
    this.player.update(dt, input, { yaw: this.cameraRig.yaw, pitch: this.cameraRig.pitch });
    this.handleParkourEvents();
    this.checkFall();
    this.checkFinish();
  }

  private playerInput() {
    const down = (code: string): boolean => this.input.isDown(code);
    return {
      forward:
        (down('KeyW') ? 1 : 0) +
        (down('ArrowUp') ? 1 : 0) -
        (down('KeyS') ? 1 : 0) -
        (down('ArrowDown') ? 1 : 0),
      strafe:
        (down('KeyD') ? 1 : 0) +
        (down('ArrowRight') ? 1 : 0) -
        (down('KeyA') ? 1 : 0) -
        (down('ArrowLeft') ? 1 : 0),
      sprint: down('ShiftLeft') || down('ShiftRight'),
      jumpPressed: false,
      jumpHeld: down('Space'),
      slidePressed: false,
      slideHeld: down('ControlLeft') || down('ControlRight') || down('KeyC'),
      vaultPressed: false,
    };
  }

  private handleParkourEvents(): void {
    const events = this.player.parkour.events;
    for (const event of events) {
      switch (event) {
        case 'slideStart':
          this.audio.slideStart();
          break;
        case 'slideEnd':
          this.audio.slideStop();
          break;
        case 'vault':
        case 'mantle':
          this.audio.jump();
          break;
        case 'wallRunStart':
          this.audio.jump();
          break;
        case 'wallJump':
          this.audio.jump();
          break;
        default:
          break;
      }
    }
    events.length = 0;

    // Landing feedback.
    if (this.player.landImpact > 0) {
      const impact = this.player.landImpact;
      this.player.landImpact = 0;
      this.cameraRig.onLand(impact);
      this.audio.land(impact);
    }

    // Footsteps.
    if (this.player.physics.grounded && this.player.speed > 1.2) {
      this.stepDistance += this.player.speed * FIXED_STEP;
      const stride = this.player.speed > PHYSICS.walkSpeed ? 2.1 : 1.7;
      if (this.stepDistance > stride) {
        this.stepDistance = 0;
        this.audio.footstep(Math.min(1, this.player.speed / PHYSICS.sprintSpeed));
      }
    } else {
      this.stepDistance = 1.4;
    }

    // Wind rises with the speed.
    const windTarget =
      this.player.speed > PHYSICS.walkSpeed
        ? Math.min(1, (this.player.speed - PHYSICS.walkSpeed) / (PHYSICS.sprintSpeed - PHYSICS.walkSpeed))
        : 0;
    this.audio.setWind(windTarget * 0.9);
  }

  private checkFall(): void {
    if (this.player.physics.position.y > PHYSICS.fallY) return;
    this.player.falls++;
    this.audio.fall();
    const position = this.checkpoints.spawnPosition;
    this.player.respawn(position.x, position.y, position.z, this.checkpoints.spawnYaw);
    this.cameraRig.reset(this.checkpoints.spawnYaw);
    this.updateCamera(0);
    this.hud.showToast('FELL  ·  RESPAWNING AT CHECKPOINT', 1.6);
  }

  private checkFinish(): void {
    if (this.finished) return;
    const position = this.player.physics.position;
    const { min, max } = this.level.finish;
    if (
      position.x >= min.x &&
      position.x <= max.x &&
      position.y >= min.y - 1 &&
      position.y <= max.y &&
      position.z >= min.z &&
      position.z <= max.z
    ) {
      this.completeRun();
    }
  }

  /** Checkpoints, hints and the section indicator. */
  private updateProgress(): void {
    const position = this.player.physics.position;

    const checkpoint = this.checkpoints.update(position);
    if (checkpoint) {
      this.audio.checkpoint();
      this.hud.showToast(`CHECKPOINT  ·  ${checkpoint.label}`, 2.2);
    }

    for (let i = this.hintIndex; i < this.level.hints.length; i++) {
      const hint = this.level.hints[i];
      if (position.distanceTo(hint.position) <= hint.radius) {
        this.hud.showHint(hint.text, 5);
        this.hintIndex = i + 1;
        break;
      }
    }

    for (const section of this.level.sections) {
      if (section.index <= this.sectionIndex) continue;
      if (position.distanceTo(section.position) <= section.radius) {
        this.sectionIndex = section.index;
        this.hud.setSection(section.index, section.name);
        if (section.index >= 2) this.hud.fadeKeyHints();
        break;
      }
    }
  }

  private updateCamera(dt: number): void {
    const strafe = this.playerInput().strafe;
    this.cameraRig.update(dt, this.player, strafe, this.state.settings.cameraMotion);

    // Keep the sun and the sky centred on the player.
    const focus = this.player.physics.position;
    const sunDirection = this.sky.sunDirection;
    this.sun.position.set(
      focus.x + sunDirection.x * 90,
      focus.y + sunDirection.y * 90,
      focus.z + sunDirection.z * 90,
    );
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sky.mesh.position.copy(this.camera.position);
  }

  private render(): void {
    if (this.composer && this.state.settings.bloom) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Debug helper used by the automated smoke test. */
  get debugState() {
    return {
      phase: this.state.phase,
      position: this.player.physics.position.clone(),
      speed: this.player.speed,
      grounded: this.player.physics.grounded,
      state: this.player.parkour.state,
      yaw: this.cameraRig.yaw,
    };
  }

  /** Render statistics used by the smoke test. */
  get debugRenderInfo() {
    let meshes = 0;
    this.scene.traverse((object) => {
      if ((object as { isMesh?: boolean }).isMesh) meshes++;
    });
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      meshes,
    };
  }

  /** Exposed for the smoke test: teleports the player. */
  debugTeleport(x: number, y: number, z: number, yaw?: number): void {
    this.player.respawn(x, y, z, yaw ?? this.cameraRig.yaw);
    this.cameraRig.reset(yaw ?? this.cameraRig.yaw);
    this.updateCamera(0);
  }

  /**
   * Exposed for the smoke test: advances the simulation without rendering so
   * a full run can be verified deterministically.
   */
  debugSimulate(
    seconds: number,
    state: {
      forward?: number;
      strafe?: number;
      sprint?: boolean;
      jump?: boolean;
      slide?: boolean;
      vault?: boolean;
      yaw?: number;
      pitch?: number;
    } = {},
  ): unknown {
    if (state.yaw !== undefined) this.cameraRig.yaw = state.yaw;
    if (state.pitch !== undefined) this.cameraRig.pitch = state.pitch;
    const steps = Math.max(1, Math.ceil(seconds / FIXED_STEP));
    for (let i = 0; i < steps; i++) {
      this.simulateStep(FIXED_STEP, {
        forward: state.forward ?? 0,
        strafe: state.strafe ?? 0,
        sprint: state.sprint ?? true,
        jumpPressed: !!state.jump && i === 0,
        jumpHeld: !!state.jump,
        slidePressed: !!state.slide && i === 0,
        slideHeld: !!state.slide,
        vaultPressed: !!state.vault && i === 0,
      });
    }
    return this.debugState;
  }

  /** Exposed for the smoke test: presses a key for one frame. */
  debugPress(code: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }

  /** Exposed for the smoke test: jumps back to the main menu. */
  debugQuitToMenu(): void {
    this.quitToMenu();
  }

  /** Exposed for the smoke test: starts a fresh run. */
  debugStartRun(): void {
    this.startRun();
  }
}
