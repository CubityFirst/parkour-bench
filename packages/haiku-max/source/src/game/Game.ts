import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from '../input/InputManager';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { MOVE } from '../player/MovementConfig';
import { PlayerBody } from '../player/PlayerBody';
import { PlayerController } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { Checkpoints } from '../world/Checkpoints';
import { CityGenerator, HAZE_COLOR, createSky } from '../world/CityGenerator';
import { Level } from '../world/Level';
import { LEVEL_LAYOUT } from '../world/LevelLayout';
import { createMaterials } from '../world/Materials';
import { GamePhase, RunState, loadBestTime, saveBestTime } from './GameState';
import { loadSettings, saveSettings, type Settings } from './Settings';

/** Offset from the player to the sun. Shadows fall toward +X and -Z, away from the sun. */
const SUN_OFFSET = new THREE.Vector3(-60, 90, 70);
const SHADOW_HALF_SIZE = 45;
const START_HINT = 'WASD move · Shift sprint · Space jump · Ctrl slide · E vault · R checkpoint · Esc pause';
const START_HINT_SECONDS = 10;
/** Total length of the fade to black after a respawn. */
const RESPAWN_FADE = 0.5;

/**
 * Owns the phase machine, the fixed-step simulation loop and the render loop. Everything that
 * is not per-frame presentation happens inside a fixed step, so the run is deterministic.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: FirstPersonCamera;
  private readonly input = new InputManager();
  private readonly audio = new AudioManager();
  private readonly hud = new HUD();
  private readonly menu: Menu;
  private readonly level: Level;
  private readonly checkpoints: Checkpoints;
  private readonly player: PlayerController;
  private readonly body: PlayerBody;
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly run = new RunState();

  private settings: Settings;
  private bestTime: number | null;
  private phase = GamePhase.Menu;
  private accumulator = 0;
  private lastTime = 0;
  private fadeTime = 0;
  private menuTime = 0;

  constructor(container: HTMLElement) {
    this.settings = loadSettings();
    this.bestTime = loadBestTime();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Neutral tone mapping keeps the white rooftops white and the red accents red.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    const materials = createMaterials();

    // A generated room gives glass and metal something to reflect, with no external assets.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.background = new THREE.Color(HAZE_COLOR);
    this.scene.fog = new THREE.Fog(HAZE_COLOR, 160, 1250);
    this.sky = createSky();
    this.scene.add(this.sky, new CityGenerator(materials).group);

    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xdfe5ea, 0.9));
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.left = -SHADOW_HALF_SIZE;
    this.sun.shadow.camera.right = SHADOW_HALF_SIZE;
    this.sun.shadow.camera.top = SHADOW_HALF_SIZE;
    this.sun.shadow.camera.bottom = -SHADOW_HALF_SIZE;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);

    this.level = new Level(LEVEL_LAYOUT, materials);
    this.scene.add(this.level.group);
    this.checkpoints = new Checkpoints(LEVEL_LAYOUT);

    this.camera = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.camera.sensitivity = this.settings.sensitivity;
    this.camera.setMotion(this.settings.reducedMotion);
    this.scene.add(this.camera.camera);

    this.player = new PlayerController(this.level.world);
    this.player.events = {
      jump: () => {
        this.audio.jump();
        this.camera.onJump();
      },
      land: (impactSpeed) => {
        this.audio.land(impactSpeed);
        this.camera.onLand(impactSpeed);
      },
      slideStart: () => this.audio.slide(true),
      slideEnd: () => this.audio.slide(false),
      wallRunStart: () => this.audio.whoosh(),
      scripted: () => this.audio.whoosh(),
      step: () => this.audio.footstep(this.player.speed),
    };
    this.body = new PlayerBody(this.camera.camera);

    this.menu = new Menu(
      {
        onStart: () => this.startRun(),
        onResume: () => this.resume(),
        onCheckpoint: () => {
          this.respawn();
          this.resume();
        },
        onRestart: () => this.startRun(),
        onQuit: () => this.toMenu(),
        onSettings: (next) => this.applySettings(next),
      },
      this.settings,
    );
    this.menu.setBestTime(this.bestTime);
    this.hud.setBest(this.bestTime);

    this.respawnAtStart();
    this.menu.show('menu');

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    window.addEventListener('resize', this.onResize);
  }

  /** Starts the render loop. */
  start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** Begins a fresh run from the start. */
  private startRun(): void {
    this.audio.unlock();
    this.audio.setEnabled(this.settings.soundOn);
    this.run.reset();
    this.checkpoints.reset();
    this.respawnAtStart();
    this.input.clearPresses();
    this.phase = GamePhase.Playing;
    this.menu.show(null);
    this.hud.show(true);
    this.requestLock();
  }

  private resume(): void {
    if (this.phase !== GamePhase.Paused) return;
    this.audio.unlock();
    this.input.clearPresses();
    this.phase = GamePhase.Playing;
    this.menu.show(null);
    this.hud.show(true);
    this.requestLock();
  }

  private pause(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.phase = GamePhase.Paused;
    this.accumulator = 0;
    this.hud.show(false);
    this.menu.show('pause');
    this.exitLock();
  }

  private finish(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.phase = GamePhase.Finished;
    const time = this.run.time;
    const isNewBest = this.bestTime === null || time < this.bestTime;
    if (isNewBest) {
      this.bestTime = time;
      saveBestTime(time);
    }
    this.hud.show(false);
    this.hud.setBest(this.bestTime);
    this.menu.setBestTime(this.bestTime);
    this.menu.setFinish(time, this.bestTime, isNewBest);
    this.menu.show('finish');
    this.audio.complete();
    this.exitLock();
  }

  private toMenu(): void {
    this.phase = GamePhase.Menu;
    this.accumulator = 0;
    this.run.reset();
    this.checkpoints.reset();
    this.respawnAtStart();
    this.hud.show(false);
    this.menu.setBestTime(this.bestTime);
    this.menu.show('menu');
    this.exitLock();
  }

  /** Puts the player back at the latest checkpoint. The run clock keeps running. */
  private respawn(): void {
    const spawn = this.checkpoints.spawnPoint();
    this.player.reset(spawn.x, spawn.y, spawn.z);
    this.camera.setYaw(spawn.yaw);
    this.camera.snap();
    this.fadeTime = RESPAWN_FADE;
  }

  private respawnAtStart(): void {
    this.checkpoints.reset();
    this.respawn();
  }

  private requestLock(): void {
    const attempt = this.renderer.domElement.requestPointerLock() as unknown;
    if (attempt instanceof Promise) attempt.catch(() => this.onLockFailed());
  }

  private exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * The browser refused pointer lock. The run carries on with drag-to-look, and a click on the
   * game asks for the lock again.
   */
  private onLockFailed(): void {
    if (this.phase === GamePhase.Playing) this.hud.toast('Click the game to capture the mouse');
  }

  private readonly onCanvasClick = (): void => {
    if (this.phase === GamePhase.Playing && !document.pointerLockElement) this.requestLock();
  };

  private readonly onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    this.input.setLocked(locked);
    // Losing the lock by Esc or by switching tabs pauses the run.
    if (!locked && this.phase === GamePhase.Playing) this.pause();
  };

  private readonly onPointerLockError = (): void => {
    this.onLockFailed();
  };

  private readonly onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.setAspect(window.innerWidth / window.innerHeight);
  };

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(MOVE.maxFrameTime, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.phase === GamePhase.Playing) {
      this.accumulator += dt;
      while (this.phase === GamePhase.Playing && this.accumulator >= MOVE.fixedStep) {
        this.fixedUpdate(MOVE.fixedStep);
        this.accumulator -= MOVE.fixedStep;
      }
    } else {
      this.accumulator = 0;
    }

    const alpha = this.phase === GamePhase.Playing ? this.accumulator / MOVE.fixedStep : 1;
    this.updateView(dt, alpha);
    this.renderer.render(this.scene, this.camera.camera);
  };

  /** One simulation step: input, movement, then zone checks. */
  private fixedUpdate(dt: number): void {
    if (this.input.takePress('Escape')) {
      this.pause();
      return;
    }
    if (this.input.takePress('KeyM')) this.toggleSound();
    if (this.input.takePress('KeyR')) this.respawn();

    this.player.tick(dt, this.input.sample(), this.camera.yaw);
    this.run.time += dt;

    if (this.player.pos.y < MOVE.deathY) {
      this.respawn();
      return;
    }

    const event = this.checkpoints.check(this.player.pos);
    if (!event) return;
    if (event.kind === 'finish') {
      this.finish();
      return;
    }
    this.hud.toast(`CHECKPOINT · ${event.name.toUpperCase()}`);
    this.audio.checkpoint();
  }

  /** Per-frame presentation: camera, body, lights, HUD and audio levels. */
  private updateView(dt: number, alpha: number): void {
    const look = this.input.takeLook();
    if (this.phase === GamePhase.Menu) {
      // The title screen shows a slow, idle sway over the start roof.
      this.menuTime += dt;
      this.camera.setYaw(Math.sin(this.menuTime * 0.12) * 0.6);
    } else {
      this.camera.look(look.x, look.y);
    }

    this.camera.update(dt, this.player, alpha);
    this.body.update(dt, this.player);
    this.sky.position.copy(this.camera.camera.position);

    const p = this.player.pos;
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.position.set(p.x + SUN_OFFSET.x, SUN_OFFSET.y, p.z + SUN_OFFSET.z);

    // Fade to black and back over RESPAWN_FADE seconds.
    this.fadeTime = Math.max(0, this.fadeTime - dt);
    const half = RESPAWN_FADE / 2;
    this.hud.setFade(this.fadeTime > half ? (RESPAWN_FADE - this.fadeTime) / half : this.fadeTime / half);

    this.hud.update(dt);
    this.audio.update(this.player.speed);

    if (this.phase === GamePhase.Playing) {
      this.hud.setTime(this.run.time);
      this.hud.setReadout(this.player.speed, this.modeLabel());
      this.hud.setHint(this.contextHint());
    }
  }

  private contextHint(): string | null {
    if (this.player.mode === 'wallrun') return 'SPACE · wall jump';
    if (this.player.canVaultNow(this.camera.yaw)) return 'E · vault';
    if (this.run.time < START_HINT_SECONDS) return START_HINT;
    return null;
  }

  private modeLabel(): string {
    switch (this.player.mode) {
      case 'ground':
        if (this.player.crouched) return 'CROUCH';
        if (this.player.speed > MOVE.walkSpeed + 0.5) return 'SPRINT';
        return this.player.speed > 1 ? 'RUN' : 'STAND';
      case 'air':
        return 'AIR';
      case 'slide':
        return 'SLIDE';
      case 'wallrun':
        return 'WALL RUN';
      case 'vault':
        return 'VAULT';
      case 'mantle':
        return 'MANTLE';
    }
  }

  private toggleSound(): void {
    this.applySettings({ ...this.settings, soundOn: !this.settings.soundOn });
    this.menu.setSettings(this.settings);
    this.hud.toast(this.settings.soundOn ? 'Sound on' : 'Sound off');
  }

  private applySettings(next: Settings): void {
    this.settings = next;
    saveSettings(next);
    this.camera.sensitivity = next.sensitivity;
    this.camera.setMotion(next.reducedMotion);
    this.audio.setEnabled(next.soundOn);
  }
}
