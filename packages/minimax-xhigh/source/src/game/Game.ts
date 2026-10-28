import * as THREE from 'three';

import { CAMERA, PLAYER } from './Config';
import { GameState } from './GameState';
import { Input } from '../core/Input';
import { createPalette, Palette } from '../core/Materials';
import { CollisionWorld } from '../world/CollisionWorld';
import { buildLevel, LevelData } from '../world/Level';
import { createCity } from '../world/CityGenerator';
import { createEnvironment, createSky, SUN_DIRECTION } from '../world/Sky';
import { PlayerController } from '../player/PlayerController';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerBody } from '../player/PlayerBody';
import { HUD } from '../ui/HUD';
import { loadBestTime, loadSettings, Menu, saveBestTime, Settings } from '../ui/Menu';
import { AudioManager } from '../audio/AudioManager';

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private fpCam: FirstPersonCamera;
  private body: PlayerBody;

  private palette: Palette;
  private world = new CollisionWorld();
  private level: LevelData;
  private input: Input;
  private player: PlayerController;
  private hud = new HUD();
  private menu: Menu;
  private audio = new AudioManager();

  private sun: THREE.DirectionalLight;
  private sunTarget = new THREE.Object3D();
  private sky: THREE.Mesh;

  private state = GameState.Menu;
  private settings: Settings;
  private lastTime = 0;
  private accumulator = 0;
  private runTime = 0;
  private checkpointIndex = 0;
  private shownHints = new Set<string>();
  private bestTime = loadBestTime();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = loadSettings();

    // ---- renderer ------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ---- scene ---------------------------------------------------------
    this.palette = createPalette();
    const sky = createSky();
    this.sky = sky.mesh;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(sky.horizonColor.getHex(), 150, 1500);
    this.scene.environment = createEnvironment(this.renderer, sky);
    // The sky reflection is only a subtle fill — the sun has to stay dominant
    // so that shadows read clearly on the white rooftops.
    this.scene.environmentIntensity = 0.38;

    // ---- lighting ------------------------------------------------------
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x55636e, 0.62);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff3e0, 3.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 340;
    this.sun.shadow.camera.left = -48;
    this.sun.shadow.camera.right = 48;
    this.sun.shadow.camera.top = 48;
    this.sun.shadow.camera.bottom = -48;
    // The ortho shadow camera keeps its default projection matrix unless it is
    // refreshed after the bounds above were changed.
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.radius = 3.2;
    this.sun.shadow.blurSamples = 12;
    this.scene.add(this.sun);
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    // ---- world ---------------------------------------------------------
    this.level = buildLevel(this.world, this.palette);
    this.scene.add(this.level.group);
    this.scene.add(createCity(this.palette, { x0: this.level.spawn.position.x - 40, x1: 420 }));

    // ---- player --------------------------------------------------------
    this.player = new PlayerController(this.world);
    this.player.respawn(this.level.spawn.position, this.level.spawn.yaw);

    this.fpCam = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.camera = this.fpCam.camera;
    this.body = new PlayerBody(this.palette);
    this.camera.add(this.body.group);
    this.scene.add(this.camera);

    // ---- input ---------------------------------------------------------
    this.input = new Input(canvas);
    this.input.onLockChange((locked) => {
      if (!locked && this.state === GameState.Playing) this.pause();
    });

    // ---- ui ------------------------------------------------------------
    this.menu = new Menu(
      {
        onStart: () => this.startRun(),
        onResume: () => this.resume(),
        onRestartCheckpoint: () => this.respawnAtCheckpoint(),
        onRestartLevel: () => this.startRun(),
        onMainMenu: () => this.toMainMenu(),
        onSensitivity: (v) => (this.fpCam.sensitivity = v),
        onMotion: (reduced) => (this.fpCam.motionScale = reduced ? 0.35 : 1),
        onSound: (on) => this.audio.setEnabled(on),
      },
      this.settings,
    );

    this.fpCam.sensitivity = this.settings.sensitivity;
    this.fpCam.motionScale = this.settings.reducedMotion ? 0.35 : 1;
    this.audio.setEnabled(this.settings.sound);
    this.menu.setBest(this.bestTime);

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === GameState.Playing) this.pause();
      if (e.code === 'KeyR' && this.state === GameState.Playing) this.respawnAtCheckpoint();
    });

    this.menu.hideLoading();
    this.menu.showMainMenu();
    this.updateCameraTransform(0);
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  start(): void {
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private startRun(): void {
    this.audio.init();
    this.audio.resume();
    this.menu.hideAll();
    this.hud.show();
    this.hud.clearMessages();
    this.runTime = 0;
    this.checkpointIndex = 0;
    this.shownHints.clear();
    this.accumulator = 0;
    this.player.respawn(this.level.spawn.position, this.level.spawn.yaw);
    this.state = GameState.Playing;
    this.input.requestLock();
    this.hud.showToast('ROOFTOP FLOW <span class="accent">·</span> GO');
    this.hud.setTimer(0);
  }

  private pause(): void {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Paused;
    this.menu.showPause();
    this.input.releaseLock();
  }

  private resume(): void {
    if (this.state !== GameState.Paused) return;
    this.menu.hidePause();
    this.state = GameState.Playing;
    this.input.requestLock();
    this.audio.resume();
  }

  private toMainMenu(): void {
    this.state = GameState.Menu;
    this.menu.hidePause();
    this.menu.showMainMenu();
    this.hud.hide();
    this.input.releaseLock();
  }

  private respawnAtCheckpoint(): void {
    const cp = this.level.checkpoints[this.checkpointIndex];
    this.player.respawn(cp.position, cp.yaw);
    this.accumulator = 0;
    this.hud.showToast('CHECKPOINT RESTORED');
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.fpCam.resize(w / h);
  }

  // ------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.state === GameState.Playing) {
      this.runTime += dt;
      this.handleLook();
      this.player.handleActions(this.input);
      this.player.setSlideHeld(this.input.crouchHeld);

      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= PLAYER.stepTime && steps < 12) {
        this.player.step(PLAYER.stepTime);
        this.accumulator -= PLAYER.stepTime;
        steps++;
      }
      if (steps >= 12) this.accumulator = 0;

      this.processEvents();
      this.checkTriggers();
      if (this.debugJumpAt !== null && this.player.position.x >= this.debugJumpAt && this.player.grounded) {
        this.player.requestJump();
        this.debugJumpAt = null;
      }
      this.updateCameraTransform(dt);
      this.audio.update(this.player.speed, this.player.sliding, PLAYER.sprintSpeed);
      this.hud.setTimer(this.runTime);
      this.hud.setSpeed(this.player.speed, PLAYER.sprintSpeed);
      this.hud.update(dt);
      this.updateProgress();
    } else {
      // Keep the scene alive behind the menus.
      this.fpCam.update(dt, this.player);
      this.body.update(dt, this.player);
      this.hud.update(dt);
    }

    this.updateSun();
    this.sky.position.copy(this.camera.position);
    this.sky.updateMatrix();
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  private handleLook(): void {
    if (!this.input.locked) return;
    const sens = CAMERA.mouseSensitivity * this.fpCam.sensitivity;
    this.player.yaw -= this.input.mouseDX * sens;
    this.player.pitch -= this.input.mouseDY * sens;
    const limit = CAMERA.pitchLimit;
    this.player.pitch = Math.max(-limit, Math.min(limit, this.player.pitch));
  }

  private processEvents(): void {
    const events = this.player.events;
    for (const ev of events) {
      switch (ev) {
        case 'jump':
          this.audio.jump();
          break;
        case 'land':
          this.audio.land(this.player.landImpact);
          this.fpCam.impact(this.player.landImpact);
          break;
        case 'footstep':
          this.audio.footstep(this.player.speed > PLAYER.walkSpeed + 0.4);
          break;
        case 'slideStart':
          this.audio.slideStart();
          break;
        case 'slideEnd':
          this.audio.slideEnd();
          break;
        case 'vault':
        case 'mantle':
          this.audio.vault();
          this.fpCam.vault();
          break;
        case 'wallRunStart':
          this.audio.wallRun();
          break;
        case 'wallJump':
          this.audio.jump();
          break;
      }
    }
    events.length = 0;
  }

  private checkTriggers(): void {
    const pos = this.player.position;

    // Fell off the world.
    if (pos.y < PLAYER.fallLimit) {
      this.respawnAtCheckpoint();
      return;
    }

    // Checkpoints. Progress only ever moves forward, and a checkpoint that
    // was jumped clean over still counts as reached.
    let activated = -1;
    for (let i = this.checkpointIndex + 1; i < this.level.checkpoints.length; i++) {
      const cp = this.level.checkpoints[i];
      const dz = Math.abs(pos.z - cp.position.z);
      const dy = Math.abs(pos.y - cp.position.y);
      if (Math.abs(pos.x - cp.position.x) < 3.2 && dz < 5 && dy < 3.5) {
        activated = i;
        break;
      }
      if (pos.x > cp.position.x + 2.2) {
        activated = i;
        break;
      }
    }
    if (activated >= 0) {
      this.checkpointIndex = activated;
      this.audio.checkpoint();
      this.hud.showToast(`CHECKPOINT <span class="accent">·</span> ${this.level.checkpoints[activated].label}`);
    }

    // Contextual hints.
    for (const hint of this.level.hints) {
      if (this.shownHints.has(hint.text)) continue;
      const d = Math.hypot(pos.x - hint.position.x, pos.z - hint.position.z);
      if (d < hint.radius && Math.abs(pos.y - hint.position.y) < 6) {
        this.shownHints.add(hint.text);
        this.hud.showHint(hint.text);
      }
    }

    // Finish line.
    const finish = this.level.finish;
    if (Math.abs(pos.x - finish.position.x) < finish.radius && Math.abs(pos.z - finish.position.z) < 6 && Math.abs(pos.y - finish.position.y) < 4) {
      this.finishRun();
    }
  }

  private finishRun(): void {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Finished;
    this.input.releaseLock();
    this.hud.hide();
    this.audio.finish();
    const time = this.runTime;
    if (this.bestTime <= 0 || time < this.bestTime) {
      this.bestTime = time;
      saveBestTime(time);
    }
    this.menu.showFinish(time, this.bestTime);
  }

  private updateProgress(): void {
    const x = this.player.position.x;
    let label = this.level.sections[0].label;
    for (const s of this.level.sections) {
      if (x >= s.x) label = s.label;
    }
    const ratio = (x - this.level.spawn.position.x) / this.level.routeLength;
    this.hud.setProgress(ratio, label);
  }

  private updateCameraTransform(dt: number): void {
    this.fpCam.update(dt, this.player);
    this.body.update(dt, this.player);
  }

  private updateSun(): void {
    const target = this.player.position;
    this.sunTarget.position.set(target.x, target.y, target.z);
    this.sun.position.set(
      target.x + SUN_DIRECTION.x * 130,
      target.y + SUN_DIRECTION.y * 130,
      target.z + SUN_DIRECTION.z * 130,
    );
    this.sunTarget.updateMatrixWorld();
  }

  /** Lightweight state dump, handy for debugging and automated smoke tests. */
  debugState(): Record<string, unknown> {
    return {
      state: this.state,
      x: +this.player.position.x.toFixed(2),
      y: +this.player.position.y.toFixed(2),
      z: +this.player.position.z.toFixed(2),
      vx: +this.player.velocity.x.toFixed(2),
      vy: +this.player.velocity.y.toFixed(2),
      speed: +this.player.speed.toFixed(2),
      grounded: this.player.grounded,
      sliding: this.player.sliding,
      wallSide: this.player.wallSide,
      height: +this.player.height.toFixed(2),
      time: +this.runTime.toFixed(2),
      checkpoint: this.checkpointIndex,
      draws: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  /** Move the player directly (used by the automated smoke test). */
  debugTeleport(x: number, y: number, z: number, yaw?: number): void {
    this.player.respawn(new THREE.Vector3(x, y, z), yaw ?? this.player.yaw);
  }
  /** Point the camera somewhere else (used by the automated smoke test). */
  debugLook(yaw: number, pitch: number): void {
    this.player.yaw = yaw;
    this.player.pitch = pitch;
  }

  /** Jump automatically once the player reaches a given X (smoke test helper). */
  debugArmJump(x: number): void {
    this.debugJumpAt = x;
  }

  private debugJumpAt: number | null = null;
}
