import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from '../input/InputManager';
import { PlayerController, PlayerHooks } from '../player/PlayerController';
import { CityGenerator } from '../world/CityGenerator';
import { Level } from '../world/Level';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { Phase, Settings, loadBestTime, loadSettings, recordBestTime, saveSettings } from './GameState';

/** Fixed simulation step. Physics results are independent of render frame rate. */
const FIXED_STEP = 1 / 120;
/** Upper bound on one frame's delta, so a stalled tab does not explode the physics. */
const MAX_FRAME = 0.1;

/**
 * Owns the renderer, the loop, and the phase machine (menu, playing, paused, finished).
 * Only the playing phase advances physics and the run timer.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly level: Level;
  private readonly city: CityGenerator;
  private readonly input: InputManager;
  private readonly audio = new AudioManager();
  private readonly hud = new HUD();
  private readonly menu: Menu;
  private readonly controller: PlayerController;
  private settings: Settings = loadSettings();

  private phase: Phase = Phase.Menu;
  private accumulator = 0;
  private lastTime = 0;
  private runTime = 0;
  private menuTime = 0;
  private hintText = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.fog = new THREE.Fog('#bfe3f5', 140, 720);

    // Sunlight and sky fill. The shadow camera follows the player (see frame()).
    const hemi = new THREE.HemisphereLight('#d8efff', '#8f9aa6', 0.9);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff3dc', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.city = new CityGenerator();
    this.scene.add(this.city.group);
    this.level = new Level();
    this.scene.add(this.level.group);

    this.input = new InputManager();
    const hooks: Partial<PlayerHooks> = {
      onJump: () => this.audio.jump(),
      onLand: (impact) => this.audio.land(impact),
      onSlide: () => this.audio.slide(),
      onWallRun: () => this.audio.wallRun(),
      onWallJump: () => this.audio.wallJump(),
      onVault: () => this.audio.vault(),
      onMantle: () => this.audio.mantle(),
      onCheckpoint: (id) => this.onCheckpoint(id),
      onFall: () => this.setHint('You fell. Respawning at the last checkpoint.'),
      onFinish: () => this.finishRun(),
    };
    this.controller = new PlayerController(this.level, this.input, hooks, window.innerWidth / window.innerHeight);
    this.scene.add(this.controller.camera.camera);

    this.menu = new Menu(this.settings, {
      onStart: () => this.startRun(),
      onResume: () => this.requestLock(),
      onPauseRestart: () => this.startRun(),
      onPauseMenu: () => this.toMainMenu(),
      onFinishRestart: () => this.startRun(),
      onFinishMenu: () => this.toMainMenu(),
      onSettingsChange: (s) => {
        this.settings = s;
        saveSettings(s);
      },
    });
    this.menu.showMain();
    this.hud.setBest(loadBestTime());

    this.bindEvents();
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ----------------------------------------------------------- phases

  private startRun(): void {
    this.audio.unlock();
    this.controller.restart();
    this.runTime = 0;
    this.accumulator = 0;
    this.hud.hideFinish();
    this.menu.hideOverlays();
    this.hud.show(true);
    this.hud.setHint('');
    this.phase = Phase.Playing;
    this.requestLock();
  }

  private toMainMenu(): void {
    this.phase = Phase.Menu;
    this.controller.restart();
    this.hud.show(false);
    this.hud.hideFinish();
    this.menu.showMain();
    this.exitLock();
    this.hud.setBest(loadBestTime());
  }

  private pauseRun(): void {
    if (this.phase !== Phase.Playing) return;
    this.phase = Phase.Paused;
    this.input.releaseAll();
    this.menu.showPause();
  }

  private finishRun(): void {
    if (this.phase !== Phase.Playing) return;
    this.phase = Phase.Finished;
    this.input.releaseAll();
    const time = this.runTime;
    const previous = loadBestTime();
    const best = recordBestTime(time);
    const isNewBest = previous === null || time <= previous;
    this.hud.showFinish(time, best, isNewBest);
    this.hud.setBest(best);
    this.audio.complete();
    this.exitLock();
  }

  private onCheckpoint(id: string): void {
    this.audio.checkpoint();
    this.hud.flashCheckpoint();
    this.setHint(`Checkpoint ${id.replace('cp', '')} reached`);
  }

  private requestLock(): void {
    this.audio.unlock();
    this.canvas.requestPointerLock?.();
  }

  private exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ----------------------------------------------------------- events

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.controller.camera.setAspect(window.innerWidth / window.innerHeight);
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.input.locked = locked;
      if (locked && this.phase === Phase.Paused) {
        this.phase = Phase.Playing;
        this.menu.hideOverlays();
      } else if (!locked && this.phase === Phase.Playing) {
        // Esc, or the browser released the lock: pause the run.
        this.pauseRun();
      }
    });

    // Clicking the canvas during play re-locks the mouse if the lock was lost.
    this.canvas.addEventListener('click', () => {
      if (this.phase === Phase.Playing && !this.input.locked) this.requestLock();
    });
  }

  // ----------------------------------------------------------- loop

  private frame = (now: number): void => {
    const dt = Math.min(MAX_FRAME, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.phase === Phase.Playing) {
      this.stepPlaying(dt);
    } else if (this.phase === Phase.Menu) {
      this.menuTime += dt;
      // Slow pan of the spawn rooftop behind the title screen.
      this.controller.camera.setView(0.35 * Math.sin(this.menuTime * 0.2), -0.05);
    }

    this.controller.frameUpdate(dt, this.settings);
    this.updateFollowLight();
    this.renderer.render(this.scene, this.controller.camera.camera);
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private stepPlaying(dt: number): void {
    this.controller.latchInput();
    if (this.input.wasPressed('KeyR') && !this.controller.hasFinished) {
      this.controller.respawn();
    }
    if (this.input.locked) {
      this.controller.camera.look(this.input.mouseDX, this.input.mouseDY, this.settings);
    }

    this.accumulator += dt;
    while (this.accumulator >= FIXED_STEP) {
      this.controller.fixedStep(FIXED_STEP);
      if (!this.controller.hasFinished) this.runTime += FIXED_STEP;
      this.accumulator -= FIXED_STEP;
    }

    const p = this.controller.physics;
    this.audio.update(dt, p.speed, p.grounded, this.isSprinting());
    this.hud.setTimer(this.runTime);
    this.hud.setSpeed(p.speed);
    this.setHint(this.hintForPosition(p.pos.z));
  }

  private isSprinting(): boolean {
    return this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
  }

  /** Context hints tied to the route section the player is in. */
  private hintForPosition(z: number): string {
    if (z > -22) return 'SHIFT sprint  ·  SPACE jump  ·  CTRL slide  ·  E vault';
    if (z > -44) return 'Sprint and jump the gap';
    if (z > -88) return 'Jump up the rooftops. Red marks show the jumps';
    if (z > -124) return 'Hold CTRL to slide under the red ducts';
    if (z > -143) return 'Run the red wall. SPACE to leave the wall';
    if (z > -182) return 'E vaults the crate · jump onto the red ledge to mantle';
    return 'Sprint to the red finish arch';
  }

  private setHint(text: string): void {
    if (text === this.hintText) return;
    this.hintText = text;
    this.hud.setHint(text);
  }

  /** Keeps the shadow frustum centred on the player, so shadows stay sharp near them. */
  private updateFollowLight(): void {
    const p = this.controller.physics.pos;
    this.sun.position.set(p.x - 60, p.y + 90, p.z + 40);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();
  }
}
