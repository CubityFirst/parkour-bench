import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { ArmsView } from '../player/ArmsView';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerController, PlayerEvent, SPRINT_SPEED } from '../player/PlayerController';
import { PlayerPhysics } from '../player/PlayerPhysics';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { CollisionWorld, Vec3, containsPoint } from '../world/CollisionWorld';
import { buildCity } from '../world/CityGenerator';
import { Checkpoints } from '../world/Checkpoints';
import { LevelBuild, buildLevel } from '../world/Level';
import { Input } from './Input';
import { GameState, Settings, formatBest, formatTime } from './GameState';

/** Physics runs at a fixed 120 Hz regardless of display refresh rate. */
const FIXED_DT = 1 / 120;
/** Upper bound on catch-up steps after a long stall, so the game never spirals. */
const MAX_STEPS_PER_FRAME = 8;

/**
 * Owns the renderer, the scene, and the frame loop. It connects the layers:
 * input -> controller -> physics -> camera, plus the UI and run state.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly world = new CollisionWorld();
  private readonly level: LevelBuild;
  private readonly checkpoints: Checkpoints;
  private readonly physics: PlayerPhysics;
  private readonly controller: PlayerController;
  private readonly view: FirstPersonCamera;
  private readonly arms: ArmsView;
  private readonly input = new Input();
  private readonly state = new GameState();
  private readonly hud = new HUD();
  private readonly audio = new AudioManager();
  private readonly menu: Menu;

  private accumulator = 0;
  private lastFrame = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Light blue haze that fades distant towers into the sky.
    this.scene.background = new THREE.Color(0xbfe3f7);
    this.scene.fog = new THREE.Fog(0xcfe9fb, 120, 800);

    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0xb8c2cc, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -40;
    shadowCam.right = 40;
    shadowCam.top = 40;
    shadowCam.bottom = -40;
    shadowCam.near = 1;
    shadowCam.far = 260;
    shadowCam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.level = buildLevel(this.world);
    this.scene.add(this.level.group);
    buildCity(this.scene, this.level.materials);
    this.checkpoints = new Checkpoints(this.level.checkpoints, this.level.spawn);

    this.physics = new PlayerPhysics(this.world);
    this.controller = new PlayerController(this.physics, this.world);
    this.view = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.scene.add(this.view.camera);
    this.arms = new ArmsView(this.view.camera);

    this.menu = new Menu(
      {
        onStart: () => this.startRun(),
        onResume: () => this.resume(),
        onRestartCheckpoint: () => {
          this.respawn('RESPAWNED AT CHECKPOINT');
          this.resume();
        },
        onMainMenu: () => this.toMainMenu(),
        onFinishRestart: () => this.startRun(),
        onSettings: (s) => this.applySettings(s),
      },
      this.state.bestTimeMs,
    );

    this.respawnAtSpawn();
    this.hud.show(false);
    this.menu.show('menu');

    canvas.addEventListener('click', () => {
      if (this.state.screen === 'playing') this.requestLock();
    });
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('resize', () => this.onResize());
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---- Frame loop ----

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    const playing = this.state.screen === 'playing';
    if (playing) {
      const look = this.input.takeLook();
      this.view.look(look.dx, look.dy);

      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME && this.state.screen === 'playing') {
        this.fixedUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    const alpha = playing ? this.accumulator / FIXED_DT : 1;
    this.render(dt, alpha);
  };

  private fixedUpdate(dt: number): void {
    const p = this.physics;
    p.snapshotPrevious();
    this.state.tick(dt);

    const input = this.input.sample(this.view.yaw);
    this.controller.update(dt, input);
    this.input.endTick();
    this.handleEvents(this.controller.drainEvents());

    const pos = p.position;
    const reached = this.checkpoints.update(pos);
    if (reached) {
      this.hud.toast(`CHECKPOINT · ${reached.name}`);
      this.audio.checkpoint();
    }

    if (containsPoint(pos, this.level.finish.min, this.level.finish.max)) {
      this.finishRun();
      return;
    }

    if (pos.y < this.level.killY) {
      this.respawn('YOU FELL · RESPAWNING');
    }
  }

  private render(dt: number, alpha: number): void {
    const p = this.physics;
    const prev = p.previous;
    // Interpolate between the last two fixed steps so motion stays smooth at any refresh rate.
    const feet: Vec3 = {
      x: prev.x + (p.position.x - prev.x) * alpha,
      y: prev.y + (p.position.y - prev.y) * alpha,
      z: prev.z + (p.position.z - prev.z) * alpha,
    };

    this.view.update(dt, feet, this.controller);
    this.arms.update(dt, this.controller);
    this.updateSun(feet);
    this.updateHud(dt);
    this.renderer.render(this.scene, this.view.camera);
  }

  private updateSun(feet: Vec3): void {
    // The shadow frustum follows the player, so shadows stay sharp in the area around them.
    this.sun.target.position.set(feet.x, feet.y, feet.z);
    this.sun.position.set(feet.x + 45, feet.y + 90, feet.z + 30);
  }

  private updateHud(dt: number): void {
    this.hud.update(dt);
    if (this.state.screen !== 'playing') return;
    this.hud.setTime(this.state.runTime);
    this.hud.setSpeed(this.controller.speed);
    this.audio.setWind(Math.min(1, this.controller.speed / SPRINT_SPEED));

    let hint = '';
    if (this.controller.mode === 'wallrun') {
      hint = 'SPACE to jump off the wall';
    } else {
      for (const zone of this.level.hints) {
        if (containsPoint(this.physics.position, zone.min, zone.max)) {
          hint = zone.text;
          break;
        }
      }
    }
    this.hud.setHint(hint);
  }

  // ---- Events and sound ----

  private handleEvents(events: PlayerEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'jump':
          this.audio.jump();
          this.view.onJump();
          break;
        case 'land':
          this.audio.land(e.impact);
          this.view.onLand(e.impact);
          break;
        case 'step':
          this.audio.step();
          break;
        case 'slideStart':
          this.audio.slideStart();
          break;
        case 'slideEnd':
          this.audio.slideEnd();
          break;
        case 'wallrunStart':
          this.audio.wallRunStart();
          break;
        case 'vault':
        case 'mantle':
          this.audio.vault();
          break;
        case 'wallrunEnd':
          break;
      }
    }
  }

  // ---- Run flow ----

  private startRun(): void {
    this.audio.unlock();
    this.checkpoints.reset();
    this.hud.reset();
    this.state.startRun();
    this.respawnAtSpawn();
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.menu.show('none');
    this.hud.show(true);
    this.requestLock();
  }

  private resume(): void {
    this.state.screen = 'playing';
    this.state.resumeTimer();
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.menu.show('none');
    this.hud.show(true);
    this.requestLock();
  }

  private pause(): void {
    if (this.state.screen !== 'playing') return;
    this.state.screen = 'paused';
    this.state.pauseTimer();
    this.input.clear();
    this.hud.show(false);
    this.menu.show('pause');
  }

  private toMainMenu(): void {
    this.state.screen = 'menu';
    this.state.pauseTimer();
    this.input.clear();
    this.checkpoints.reset();
    this.hud.reset();
    this.hud.show(false);
    this.respawnAtSpawn();
    this.menu.setBest(this.state.bestTimeMs);
    this.menu.show('menu');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private finishRun(): void {
    const newBest = this.state.finishRun();
    this.audio.complete();
    this.input.clear();
    this.hud.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.setBest(this.state.bestTimeMs);
    this.menu.showFinish(formatTime(this.state.runTime), formatBest(this.state.bestTimeMs), newBest);
  }

  /** Respawns at the active checkpoint (or the level start) and resets all movement state. */
  private respawn(message?: string): void {
    const s = this.checkpoints.spawn;
    this.physics.reset(s.x, s.y, s.z);
    this.controller.reset();
    this.view.resetView(0);
    if (message) this.hud.toast(message, 1.8);
  }

  private respawnAtSpawn(): void {
    const s = this.checkpoints.spawn;
    this.physics.reset(s.x, s.y, s.z);
    this.controller.reset();
    this.view.resetView(0);
  }

  // ---- Browser glue ----

  private requestLock(): void {
    // requestPointerLock may return a promise that rejects if the user exits too quickly.
    const result = this.canvas.requestPointerLock() as unknown;
    if (result instanceof Promise) result.catch(() => undefined);
  }

  private onPointerLockChange(): void {
    // Losing the lock mid-run (Esc, alt-tab) opens the pause menu rather than letting the run continue.
    if (document.pointerLockElement !== this.canvas) this.pause();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      if (this.state.screen === 'playing') this.pause();
      return;
    }
    if (e.code === 'KeyR' && !e.repeat && this.state.screen === 'playing') {
      this.respawn('RESTART FROM CHECKPOINT');
    }
  }

  private applySettings(s: Settings): void {
    this.view.sensitivity = s.sensitivity;
    this.view.reduceMotion = s.reduceMotion;
  }

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.view.resize(window.innerWidth / window.innerHeight);
  }
}
