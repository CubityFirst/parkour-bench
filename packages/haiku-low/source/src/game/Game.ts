import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { MoveInput, PlayerController } from '../player/PlayerController';
import { Checkpoints } from '../world/Checkpoints';
import { buildCity } from '../world/CityGenerator';
import { Level } from '../world/Level';
import { HUD, formatTime } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { Input } from './Input';

/** Gameplay runs at a fixed 120 Hz so jumps and landings do not depend on frame rate. */
const FIXED_STEP = 1 / 120;
const MAX_FRAME_TIME = 0.1;
const FALL_LIMIT = -12;
const BEST_TIME_KEY = 'rooftop-flow.best-time';

type GameState = 'menu' | 'playing' | 'paused' | 'finished';

/** Owns the renderer, game state, the fixed-step loop, and the glue between input, player, level and UI. */
export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly level: Level;
  private readonly checkpoints: Checkpoints;
  private readonly player: PlayerController;
  private readonly view = new FirstPersonCamera();
  private readonly input = new Input();
  private readonly audio = new AudioManager();
  private readonly hud = new HUD();
  private readonly menu: Menu;
  private readonly intents: MoveInput = { moveX: 0, moveZ: 0, sprint: false, jumpHeld: false };

  private state: GameState = 'menu';
  private elapsed = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private sensitivity = 1;
  private reduceMotion = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene.background = new Color(0x86cdf5);
    this.scene.fog = new Fog(0xcfe9f7, 90, 380);
    this.setupLights();
    this.scene.add(this.view.camera);

    this.level = new Level(this.scene);
    buildCity(this.scene);
    this.checkpoints = new Checkpoints(this.level.checkpointDefs, this.level.startSpawn);
    this.player = new PlayerController(this.level.world);
    this.player.respawn(this.level.startSpawn);

    this.menu = new Menu({
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => {
        this.restartFromCheckpoint();
        this.resume();
      },
      onRestartRun: () => {
        this.resetRun();
        this.resume();
      },
      onFinishRestart: () => this.startRun(),
      onSensitivity: (value) => {
        this.sensitivity = value;
      },
      onReduceMotion: (enabled) => {
        this.reduceMotion = enabled;
      },
    });

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    this.handleResize();
    this.menu.showMain();
  }

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(MAX_FRAME_TIME, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.state === 'playing') {
      this.readFrameInput();
      this.accumulator += dt;
      while (this.accumulator >= FIXED_STEP && this.state === 'playing') {
        this.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      this.hud.setTime(this.elapsed);
      this.hud.setHint(this.level.hintAt(this.player.position.z));
      this.audio.setWind(this.player.horizontalSpeed);
    } else {
      this.accumulator = 0;
      this.audio.setWind(0);
    }

    this.view.update(dt, this.player, this.reduceMotion);
    this.renderer.render(this.scene, this.view.camera);
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private readonly handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.view.setAspect(width / height);
  };

  private readonly handleLockChange = (): void => {
    this.input.locked = document.pointerLockElement === this.canvas;
    if (!this.input.locked && this.state === 'playing') this.pause();
  };

  /** Reads per-frame input: mouse look, held movement keys, and key presses latched for the physics steps. */
  private readFrameInput(): void {
    const mouse = this.input.consumeMouse();
    if (mouse.x !== 0 || mouse.y !== 0) {
      this.player.look(mouse.x, mouse.y, this.sensitivity);
    }

    this.intents.moveX =
      (this.input.isHeld('KeyD', 'ArrowRight') ? 1 : 0) - (this.input.isHeld('KeyA', 'ArrowLeft') ? 1 : 0);
    this.intents.moveZ =
      (this.input.isHeld('KeyW', 'ArrowUp') ? 1 : 0) - (this.input.isHeld('KeyS', 'ArrowDown') ? 1 : 0);
    this.intents.sprint = this.input.isHeld('ShiftLeft', 'ShiftRight');
    this.intents.jumpHeld = this.input.isHeld('Space');

    if (this.input.wasPressed('Space')) this.player.queueJump();
    if (this.input.wasPressed('ControlLeft', 'ControlRight', 'KeyC')) this.player.requestSlide();
    if (this.input.wasPressed('KeyE')) this.player.requestVault();
    if (this.input.wasPressed('KeyR')) this.restartFromCheckpoint();
    if (this.input.wasPressed('Escape')) this.pause();
  }

  private fixedUpdate(dt: number): void {
    this.player.update(dt, this.intents);
    this.elapsed += dt;
    this.drainEvents();

    if (this.checkpoints.update(this.player.position)) {
      this.hud.flash('CHECKPOINT');
      this.audio.checkpoint();
    }

    if (this.player.position.y < FALL_LIMIT) {
      this.player.respawn(this.checkpoints.spawn);
      this.hud.flash('FELL  ·  RESPAWNED AT CHECKPOINT');
    }

    if (this.player.position.z < this.level.finishZ) {
      this.finishRun();
    }
  }

  private drainEvents(): void {
    for (const event of this.player.events) {
      switch (event.type) {
        case 'jump':
          this.audio.jump();
          this.view.addTakeoff();
          break;
        case 'land':
          this.audio.land(event.value);
          this.view.addImpulse(event.value);
          break;
        case 'slide':
          this.audio.slide();
          break;
        case 'step':
          this.audio.step();
          break;
        case 'wallrun':
          this.audio.wallRun();
          break;
        case 'vault':
        case 'mantle':
          this.audio.vault();
          break;
      }
    }
    this.player.events.length = 0;
  }

  private startRun(): void {
    this.audio.init();
    this.resetRun();
    this.state = 'playing';
    this.menu.hideAll();
    this.hud.show(true);
    this.canvas.requestPointerLock();
  }

  /** Resets the timer, checkpoints and player back to the start of the level. */
  private resetRun(): void {
    this.elapsed = 0;
    this.accumulator = 0;
    this.checkpoints.reset();
    this.player.respawn(this.checkpoints.spawn);
  }

  private restartFromCheckpoint(): void {
    this.player.respawn(this.checkpoints.spawn);
    this.hud.flash('RESTARTED FROM CHECKPOINT');
  }

  private resume(): void {
    this.audio.init();
    this.state = 'playing';
    this.menu.hideAll();
    this.hud.show(true);
    this.canvas.requestPointerLock();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.show(false);
    this.menu.showPause();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private finishRun(): void {
    this.state = 'finished';
    this.hud.show(false);
    const best = this.saveBestTime(this.elapsed);
    this.menu.showFinish(formatTime(this.elapsed), formatTime(best));
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.complete();
  }

  /** Stores the fastest completion time in localStorage and returns the best time so far. */
  private saveBestTime(time: number): number {
    try {
      const stored = Number(localStorage.getItem(BEST_TIME_KEY));
      if (stored > 0 && stored < time) return stored;
      localStorage.setItem(BEST_TIME_KEY, String(time));
    } catch {
      // Storage unavailable (private mode, disabled): report this run only
    }
    return time;
  }

  private setupLights(): void {
    const hemisphere = new HemisphereLight(0xdcf1ff, 0xb7c3cf, 1.25);

    const sun = new DirectionalLight(0xfff3dc, 2.6);
    sun.position.set(-40, 90, -20);
    sun.target.position.set(0, 0, -100);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    const shadowCamera = sun.shadow.camera;
    shadowCamera.left = -110;
    shadowCamera.right = 110;
    shadowCamera.top = 110;
    shadowCamera.bottom = -110;
    shadowCamera.near = 1;
    shadowCamera.far = 300;
    shadowCamera.updateProjectionMatrix();

    this.scene.add(hemisphere, sun, sun.target);
  }
}
