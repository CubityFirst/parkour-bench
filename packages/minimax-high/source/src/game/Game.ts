import * as THREE from 'three';
import { PHYS, RENDER } from '../core/Config';
import { clamp } from '../core/MathUtil';
import { AudioManager } from '../audio/AudioManager';
import { GameState } from './GameState';
import { Input } from './Input';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerController } from '../player/PlayerController';
import { CityGenerator } from '../world/CityGenerator';
import { CheckpointManager } from '../world/Checkpoints';
import { Level } from '../world/Level';
import { applyFog, Sky } from '../world/Sky';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';

interface RouteSection {
  x: number;
  name: string;
  hint: string;
}

const SECTIONS: RouteSection[] = [
  { x: 0, name: 'MOVEMENT', hint: 'WASD TO MOVE · SHIFT TO SPRINT · CTRL TO SLIDE' },
  { x: 60, name: 'ROOFTOP JUMPS', hint: 'SPRINT AND JUMP THE GAPS' },
  { x: 168, name: 'SLIDE', hint: 'HOLD CTRL TO SLIDE UNDER THE DUCT' },
  { x: 246, name: 'WALL RUN', hint: 'JUMP AT THE RED WALL TO WALL RUN IT' },
  { x: 322, name: 'COMBINATION', hint: 'CHAIN YOUR MOVES · E TO VAULT' },
  { x: 438, name: 'FINAL SPRINT', hint: 'SPRINT FOR THE RED GATE' },
];

const FIXED_STEP = 1 / 120;
const MAX_STEPS = 8;

/**
 * The game: renderer, world, player, UI and the main loop.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: FirstPersonCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly sky = new Sky();
  private readonly level: Level;
  private readonly city: CityGenerator;
  private readonly player: PlayerController;
  private readonly checkpoints: CheckpointManager;
  private readonly input: Input;
  private readonly hud = new HUD();
  private readonly audio = new AudioManager();
  private readonly menu: Menu;
  private readonly state = new GameState();

  private accumulator = 0;
  private lastTime = performance.now();
  private finished = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // --- renderer -------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;

    // --- scene ----------------------------------------------------------
    this.scene.add(this.sky.mesh);
    applyFog(this.scene);
    this.scene.environment = this.sky.createEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.55;

    this.level = new Level();
    this.scene.add(this.level.group);
    this.city = new CityGenerator();
    this.scene.add(this.city.group);

    // --- lights ----------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xfff4e2, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    const shadowSize = RENDER.shadowRadius;
    this.sun.shadow.camera.left = -shadowSize;
    this.sun.shadow.camera.right = shadowSize;
    this.sun.shadow.camera.top = shadowSize;
    this.sun.shadow.camera.bottom = -shadowSize;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(new THREE.HemisphereLight(0xd8ecff, 0x8b98a4, 1.35));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // --- camera -----------------------------------------------------------
    this.camera = new FirstPersonCamera(window.innerWidth / window.innerHeight);

    // --- player -------------------------------------------------------------
    this.player = new PlayerController(this.level.world);
    this.player.respawn(this.level.spawn, this.level.spawnYaw);
    this.camera.reset(this.level.spawnYaw);
    this.wirePlayerEvents();

    this.checkpoints = new CheckpointManager(this.level.checkpoints);

    // --- input --------------------------------------------------------------
    this.input = new Input(this.canvas, (locked) => this.onPointerLockChange(locked));

    // --- ui ------------------------------------------------------------------
    this.menu = new Menu({
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => this.respawnAtCheckpoint(),
      onRestartRun: () => this.restartRun(),
      onMainMenu: () => this.toMainMenu(),
      onSettingsChanged: (settings) => {
        this.input.sensitivity = settings.sensitivity;
        this.camera.motionScale = settings.cameraMotion ? 1 : 0.25;
        this.audio.volume = settings.volume;
      },
    });
    this.input.sensitivity = this.menu.settings.sensitivity;
    this.camera.motionScale = this.menu.settings.cameraMotion ? 1 : 0.25;
    this.audio.volume = this.menu.settings.volume;

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state.phase === 'playing') this.pause();
    });

    this.state.phase = 'menu';
    this.menu.hideLoading();
    this.menu.showMain();
    this.hud.hide();

    this.loop();
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  private wirePlayerEvents(): void {
    this.player.events.onFootstep = (sprinting) => this.audio.footstep(sprinting);
    this.player.events.onJump = () => this.audio.jump();
    this.player.events.onLand = (impact) => {
      this.audio.land(impact);
      this.camera.land(impact);
    };
    this.player.events.onSlideStart = () => this.audio.startSlide();
    this.player.events.onSlideEnd = () => this.audio.stopSlide();
    this.player.events.onVault = () => {
      this.audio.vault();
      this.camera.vaultKick();
    };
    this.player.events.onMantle = () => {
      this.audio.vault();
      this.camera.vaultKick();
    };
    this.player.events.onWallRunStart = () => this.audio.wallRun();
    this.player.events.onWallRunEnd = () => this.audio.stopSlide();
  }

  // ------------------------------------------------------------------
  // State transitions
  // ------------------------------------------------------------------
  private startRun(): void {
    this.audio.init();
    this.restartRun();
    this.input.requestLock();
  }

  private restartRun(): void {
    this.state.reset();
    this.finished = false;
    this.checkpoints.reset();
    this.hud.reset();
    this.player.respawn(this.level.spawn, this.level.spawnYaw);
    this.camera.reset(this.level.spawnYaw);
    this.state.start();
    this.hud.show();
    this.hud.setSection(SECTIONS[0].name);
    this.hud.setHint(SECTIONS[0].hint);
    this.hud.notifyCheckpoint('START');
    this.menu.hideAll();
    this.audio.resume();
  }

  private respawnAtCheckpoint(): void {
    const checkpoint = this.checkpoints.active;
    if (checkpoint) {
      this.player.respawn(checkpoint.position, this.level.spawnYaw);
      this.camera.reset(this.level.spawnYaw);
    }
    this.state.phase = 'playing';
    this.hud.show();
    this.menu.hideAll();
    this.input.requestLock();
  }

  private pause(): void {
    if (this.state.phase !== 'playing') return;
    this.state.pause();
    this.input.exitLock();
    this.menu.showPause(this.state.elapsed);
    this.hud.hide();
    this.audio.stopSlide();
    this.audio.setWind(0);
  }

  private resume(): void {
    if (this.state.phase !== 'paused') return;
    this.state.resume();
    this.menu.hideAll();
    this.hud.show();
    this.input.requestLock();
    this.audio.resume();
  }

  private toMainMenu(): void {
    this.state.phase = 'menu';
    this.finished = false;
    this.state.reset();
    this.checkpoints.reset();
    this.player.respawn(this.level.spawn, this.level.spawnYaw);
    this.camera.reset(this.level.spawnYaw);
    this.hud.hide();
    this.hud.reset();
    this.menu.showMain();
    this.input.exitLock();
    this.audio.stopSlide();
    this.audio.setWind(0);
  }

  private onPointerLockChange(locked: boolean): void {
    if (!locked && this.state.phase === 'playing') {
      this.pause();
    }
  }

  private completeLevel(): void {
    if (this.finished) return;
    this.finished = true;
    this.state.finish();
    this.audio.finish();
    const isNewBest = this.menu.setBestTime(this.state.elapsed);
    this.input.exitLock();
    this.hud.hide();
    this.menu.showFinish(this.state.elapsed, isNewBest);
  }

  // ------------------------------------------------------------------
  // Loop
  // ------------------------------------------------------------------
  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    if (this.state.phase === 'playing') {
      this.updatePlaying(frameTime);
    } else {
      this.updateIdle(frameTime);
    }

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera.camera);
  };

  private updateIdle(dt: number): void {
    // Keep the camera at the start position so the menu shows the city.
    this.sky.follow(this.camera.camera);
    this.updateSun();
    this.hud.update(dt);
    if (this.state.phase === 'menu') {
      // Slow idle orbit looking down the route.
      const t = performance.now() * 0.00007;
      const focus = this.level.spawn;
      this.camera.camera.position.set(
        focus.x - 4 + Math.sin(t) * 6,
        focus.y + 17,
        focus.z + 13 + Math.cos(t) * 5
      );
      this.camera.camera.lookAt(focus.x + 46, focus.y - 2, focus.z);
    }
  }

  private updatePlaying(dt: number): void {
    // --- look -----------------------------------------------------------
    this.camera.handleMouse(this.input);
    this.player.yaw = this.camera.yaw;

    // --- restart from checkpoint -----------------------------------------
    if (this.input.wasPressed('KeyR')) {
      this.respawnAtCheckpoint();
      return;
    }

    // --- fixed step simulation ---------------------------------------------
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
      this.player.update(FIXED_STEP, this.input);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    this.state.elapsed += dt;

    // --- camera ------------------------------------------------------------
    this.camera.update(dt, this.player);
    this.sky.follow(this.camera.camera);
    this.updateSun();

    // --- fall out of the world ------------------------------------------------
    if (this.player.body.position.y < this.level.killY) {
      this.respawnAtCheckpoint();
      this.hud.notifyCheckpoint('FELL · RESPAWNED');
      return;
    }

    // --- checkpoints -----------------------------------------------------------
    const reached = this.checkpoints.update(this.player.body.position);
    if (reached) {
      this.hud.notifyCheckpoint(reached.label);
      this.audio.checkpoint();
    }

    // --- sections ----------------------------------------------------------------
    const x = this.player.body.position.x;
    let section = 0;
    for (let i = 0; i < SECTIONS.length; i++) {
      if (x >= SECTIONS[i].x) section = i;
    }
    if (section !== this.state.section) {
      this.state.section = section;
      this.hud.announceSection(SECTIONS[section].name);
      this.hud.setSection(SECTIONS[section].name);
      this.hud.setHint(SECTIONS[section].hint);
    }

    // --- finish -------------------------------------------------------------------
    const finish = this.level.finish;
    if (
      !this.finished &&
      this.player.body.position.x >= finish.x &&
      this.player.body.position.z > finish.z0 &&
      this.player.body.position.z < finish.z1 &&
      this.player.body.position.y > finish.y - 2 &&
      this.player.body.position.y < finish.y + 4
    ) {
      this.completeLevel();
      return;
    }

    // --- hud ------------------------------------------------------------------------
    this.hud.setTimer(this.state.elapsed);
    this.hud.setSpeed(this.player.speed / PHYS.sprintSpeed);
    this.hud.setPrompt(this.player.vaultTarget ? 'VAULT' : null);
    this.hud.update(dt);

    // --- audio -----------------------------------------------------------------------
    const speedFactor = clamp(this.player.speed / PHYS.sprintSpeed, 0, 1.2);
    this.audio.setWind(this.player.state === 'wallrun' ? 1.2 : speedFactor);

    // Slide amount for the camera.
    this.player.slideAmount = clamp(
      (PHYS.standHeight - this.player.body.height) / (PHYS.standHeight - PHYS.slideHeight),
      0,
      1
    );
  }

  private updateSun(): void {
    const focus = this.state.phase === 'menu' ? this.level.spawn : this.player.body.position;
    const dir = this.sky.sunDirection;
    this.sun.position.set(
      focus.x + dir.x * 110,
      focus.y + dir.y * 110,
      focus.z + dir.z * 110
    );
    this.sun.target.position.set(focus.x, focus.y, focus.z);
    this.sun.target.updateMatrixWorld();
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.pixelRatioCap));
    this.renderer.setSize(width, height);
    this.camera.resize(width / height);
  }
}
