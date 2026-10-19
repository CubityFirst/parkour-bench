import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerController } from '../player/PlayerController';
import { Input } from '../input/Input';
import { Aabb } from '../world/CollisionWorld';
import { buildCity, createSky, createStreet } from '../world/CityGenerator';
import { buildLevel, LevelData } from '../world/Level';
import { createMaterials } from '../world/Materials';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import {
  DEFAULT_SETTINGS,
  loadBestTime,
  loadSettings,
  Phase,
  saveBestTime,
  saveSettings,
  Settings,
} from './GameState';

/** Fixed physics step: 120 Hz, so movement feel does not depend on the display refresh rate. */
const FIXED_DT = 1 / 120;
/** Caps the frame time so a stalled tab cannot trigger a burst of physics steps. */
const MAX_FRAME_DT = 0.1;
/** How long a section hint stays on screen after entering a section. */
const HINT_DURATION = 6;

function insideAabb(box: Aabb, x: number, y: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && z >= box.minZ && z <= box.maxZ;
}

/**
 * Owns the game loop and coordinates the phases: menu, playing, paused and finished.
 * Physics runs at a fixed step; rendering and camera effects run once per frame.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private readonly input: Input;
  private readonly fpCamera: FirstPersonCamera;
  private readonly audio = new AudioManager();
  private readonly hud = new HUD();
  private readonly menu: Menu;
  private readonly level: LevelData;
  private readonly player: PlayerController;

  private settings: Settings;
  private phase = Phase.Menu;
  private activeCheckpoint = 0;
  private lastSectionIndex = -1;
  private hintTimer = 0;
  private runTime = 0;
  private accumulator = 0;
  private lastFrameTime = 0;
  private menuClock = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Scene: sky dome, haze fog, hemisphere fill and a directional sun with soft shadows.
    this.sky = createSky();
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xcfe6f5, 110, 560);
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0xc9c4ba, 1.1));

    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -70;
    shadowCam.right = 70;
    shadowCam.top = 70;
    shadowCam.bottom = -70;
    shadowCam.near = 1;
    shadowCam.far = 320;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Level and city.
    const materials = createMaterials();
    this.level = buildLevel(materials);
    this.scene.add(this.level.group);
    this.scene.add(createStreet());
    this.scene.add(buildCity(this.level.length, materials));

    // Input, camera and player. Camera and audio events are wired in before the player is created.
    this.input = new Input(canvas);
    this.fpCamera = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.fpCamera.reduceMotion = this.settings.reduceMotion;
    this.player = new PlayerController(this.level.world, this.level.spawn, {
      onJump: () => {
        this.audio.jump();
        this.fpCamera.onJump();
      },
      onWallJump: () => {
        this.audio.wallJump();
        this.fpCamera.onJump();
      },
      onLand: (strength) => {
        this.audio.land(strength);
        this.fpCamera.onLand(strength);
      },
      onSlideStart: () => this.audio.slide(),
      onWallRunStart: () => this.audio.wallRunStart(),
      onClimb: (kind) => this.audio.climb(kind),
      onFootstep: (sprinting) => this.audio.footstep(sprinting),
    });

    this.menu = new Menu(
      {
        onStart: () => this.startRun(),
        onResume: () => this.resume(),
        onRestart: () => this.startRun(),
        onMainMenu: () => this.showMainMenu(),
        onFinishRestart: () => this.startRun(),
        onSettingsChanged: (s) => this.applySettings(s),
      },
      this.settings,
    );

    this.wireEvents();
    this.fpCamera.snap(this.player);
    this.menu.showMain();
  }

  /** Starts the render loop. */
  start(): void {
    this.lastFrameTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- phases

  private startRun(): void {
    this.audio.init();
    this.phase = Phase.Playing;
    this.activeCheckpoint = 0;
    this.lastSectionIndex = -1;
    this.hintTimer = 0;
    this.runTime = 0;
    this.accumulator = 0;
    this.player.respawn(this.level.spawn);
    this.input.releaseAll();
    this.fpCamera.snap(this.player);
    this.menu.hideAll();
    this.hud.show();
    this.hud.setTime(0);
    this.requestLock();
  }

  private respawnAtCheckpoint(): void {
    const checkpoint = this.level.checkpoints[this.activeCheckpoint];
    this.player.respawn(checkpoint ? checkpoint.spawn : this.level.spawn);
    this.fpCamera.snap(this.player);
  }

  private pause(): void {
    if (this.phase !== Phase.Playing) return;
    this.phase = Phase.Paused;
    this.input.releaseAll();
    this.menu.showPause();
    this.exitLock();
  }

  private resume(): void {
    if (this.phase !== Phase.Paused) return;
    this.phase = Phase.Playing;
    this.accumulator = 0;
    this.menu.hidePause();
    this.requestLock();
  }

  private showMainMenu(): void {
    this.phase = Phase.Menu;
    this.hud.hide();
    this.menu.showMain();
    this.exitLock();
  }

  private finishRun(): void {
    this.phase = Phase.Finished;
    this.hud.hide();
    this.input.releaseAll();
    this.exitLock();

    const previous = loadBestTime();
    const isNewBest = previous === null || this.runTime < previous;
    if (isNewBest) saveBestTime(this.runTime);
    this.audio.finish();
    this.menu.showFinish(this.runTime, isNewBest ? this.runTime : previous, isNewBest);
  }

  // ---------------------------------------------------------------- pointer lock

  private requestLock(): void {
    if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock();
  }

  private exitLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private wireEvents(): void {
    // Clicking the canvas while playing re-captures the mouse, if the browser released it.
    this.canvas.addEventListener('click', () => {
      if (this.phase === Phase.Playing) this.requestLock();
    });

    // Losing pointer lock (Esc, alt-tab) pauses the run.
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && this.phase === Phase.Playing) this.pause();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.phase === Phase.Playing) this.pause();
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.fpCamera.resize(window.innerWidth / window.innerHeight);
    });
  }

  private applySettings(settings: Settings): void {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.fpCamera.reduceMotion = this.settings.reduceMotion;
    saveSettings(this.settings);
  }

  // ---------------------------------------------------------------- loop

  private frame(now: number): void {
    const dt = Math.min((now - this.lastFrameTime) / 1000, MAX_FRAME_DT);
    this.lastFrameTime = now;

    if (this.phase === Phase.Playing) {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) {
        this.fixedStep(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }
      this.updatePresentation(dt);
    } else {
      // Paused and finished: drop accumulated time and discard mouse motion.
      this.accumulator = 0;
      this.input.consumeMouse();
      if (this.phase === Phase.Menu) this.updateMenuCamera(dt);
    }

    // Keep the sky dome centred on the camera so it never reaches the far plane.
    this.sky.position.copy(this.fpCamera.camera.position);
    this.renderer.render(this.scene, this.fpCamera.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  /** One fixed physics step, including game-level rules. */
  private fixedStep(dt: number): void {
    this.player.step(dt, this.input);

    if (this.input.wasPressed('KeyR')) this.respawnAtCheckpoint();
    this.runTime += dt;

    const body = this.player.body;
    if (body.y < this.level.fallY) {
      this.respawnAtCheckpoint();
    }
    this.checkCheckpoints();
    this.checkSection();
    if (insideAabb(this.level.finish, body.x, body.y + 0.9, body.z)) {
      this.finishRun();
    }

    this.input.endStep();
  }

  /** Per-frame work: look, camera, HUD and audio. Runs at render rate. */
  private updatePresentation(dt: number): void {
    const look = this.input.consumeMouse();
    this.player.applyLook(look.x, look.y, this.settings.sensitivity);
    this.fpCamera.update(dt, this.player, this.input);

    // Shadow frustum follows the player so the nearby course stays crisp.
    const body = this.player.body;
    this.sun.position.set(body.x - 40, body.y + 90, body.z + 60);
    this.sun.target.position.set(body.x, body.y, body.z);
    this.sun.target.updateMatrixWorld();

    this.audio.setWind(THREE.MathUtils.clamp((this.player.horizontalSpeed - 7) / 6, 0, 1));
    this.hud.setTime(this.runTime);

    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
    }
    const hintText = this.hintTimer > 0 && this.lastSectionIndex >= 0 ? this.level.sections[this.lastSectionIndex].hint : null;
    this.hud.setHint(hintText);
  }

  private checkCheckpoints(): void {
    const body = this.player.body;
    // Checkpoints only advance: the player never falls back to an earlier one.
    for (let i = this.activeCheckpoint + 1; i < this.level.checkpoints.length; i++) {
      const checkpoint = this.level.checkpoints[i];
      if (insideAabb(checkpoint.trigger, body.x, body.y + 0.9, body.z)) {
        this.activeCheckpoint = i;
        this.hud.showCheckpoint(checkpoint.label);
        this.audio.checkpoint();
      }
    }
  }

  private checkSection(): void {
    const x = this.player.body.x;
    let index = 0;
    for (let i = 0; i < this.level.sections.length; i++) {
      if (x >= this.level.sections[i].startX) index = i;
    }
    if (index !== this.lastSectionIndex) {
      this.lastSectionIndex = index;
      this.hintTimer = HINT_DURATION;
      this.hud.setSection(this.level.sections[index].name);
    }
  }

  /** Slow drift over the course for the main menu background. */
  private updateMenuCamera(dt: number): void {
    this.menuClock += dt;
    const cam = this.fpCamera.camera;
    const t = this.menuClock;
    cam.position.set(14 + Math.sin(t * 0.05) * 3, 5.5, 16 + Math.cos(t * 0.04) * 2);
    cam.lookAt(this.level.spawn.x + 40, 2, 0);
    this.sun.position.set(this.level.spawn.x + 20, 90, 60);
    this.sun.target.position.set(this.level.spawn.x + 20, 0, 0);
    this.sun.target.updateMatrixWorld();
  }
}
