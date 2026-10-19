import * as THREE from 'three';
import { Level } from '../world/Level.ts';
import { CityGenerator } from '../world/CityGenerator.ts';
import { Checkpoints } from '../world/Checkpoints.ts';
import { Sky, HORIZON_COLOR, SUN_DIRECTION } from '../world/Sky.ts';
import { overlaps } from '../world/CollisionWorld.ts';
import type { AABB } from '../world/CollisionWorld.ts';
import { PlayerController, MoveState } from '../player/PlayerController.ts';
import { FirstPersonCamera } from '../player/FirstPersonCamera.ts';
import { PlayerBody } from '../player/PlayerBody.ts';
import { Input } from './Input.ts';
import { Phase, RunState, loadSettings } from './GameState.ts';
import type { PhaseName, Settings } from './GameState.ts';
import { HUD } from '../ui/HUD.ts';
import { Menu } from '../ui/Menu.ts';
import { AudioManager } from '../audio/AudioManager.ts';

/** Fixed physics step. Movement is fully independent of the render frame rate. */
const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 12;
const MAX_PIXEL_RATIO = 1.75;

/**
 * Top-level orchestrator: owns the renderer, scene, player, UI and the main loop.
 * Rendering, physics, input, audio and UI each live in their own modules; this class only wires
 * them together and handles the game flow (menu → run → pause → finish).
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sky = new Sky();
  private readonly level = new Level();
  private readonly city: CityGenerator;
  private readonly checkpoints: Checkpoints;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private envTexture: THREE.Texture | null = null;

  private readonly controller: PlayerController;
  private readonly rig: FirstPersonCamera;
  private readonly body = new PlayerBody();
  private readonly input: Input;
  private readonly hud = new HUD();
  private readonly menu: Menu;
  private readonly audio = new AudioManager();
  private readonly settings: Settings;
  private readonly run = new RunState();

  private phase: PhaseName = Phase.Menu;
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private rafId = 0;
  private maxSection = 0;
  private respawnTimer = -1;
  private lockWanted = false;
  private hasLock = false;
  private lockRetries = 0;
  private pixelRatio = 1;
  private frameAvg = 16.7;
  private perfTimer = 0;
  private perfCooldown = 3;

  private readonly onResize = (): void => this.resize();
  private readonly onLockChange = (): void => this.handleLockChange();
  private readonly onLockError = (): void => this.handleLockError();
  private readonly onVisibility = (): void => {
    if (document.hidden && this.phase === Phase.Playing) this.pause();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(this.pixelRatio);

    // ---- scene: sky, fog, lights -------------------------------------------------------
    this.scene.background = HORIZON_COLOR;
    this.scene.fog = new THREE.FogExp2(HORIZON_COLOR, 0.00115);
    this.scene.add(this.sky.mesh);
    this.envTexture = this.sky.buildEnvironment(this.renderer);
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.5;

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0xe9e6df, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -46;
    sc.right = 46;
    sc.top = 46;
    sc.bottom = -46;
    sc.near = 1;
    sc.far = 420;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);

    // ---- world -------------------------------------------------------------------------
    this.scene.add(this.level.root);
    this.city = new CityGenerator(this.level.desc.footprints);
    this.scene.add(this.city.group);
    this.checkpoints = new Checkpoints(this.level.desc.checkpoints);
    this.scene.add(this.checkpoints.group);

    // ---- player ------------------------------------------------------------------------
    this.controller = new PlayerController(this.level.world);
    this.rig = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.input = new Input(canvas);

    this.menu = new Menu(this.settings, {
      onStart: () => this.startGame(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => {
        this.respawn(true);
        this.resume();
      },
      onRestartRun: () => this.restartRun(),
      onSettingsChanged: (s) => this.applySettings(s),
    });
    this.applySettings(this.settings);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();

    const spawn = this.level.desc.spawn;
    this.controller.respawn(spawn.x, spawn.y, spawn.z, spawn.yaw);
    this.input.yaw = spawn.yaw;
    this.menu.showMain(this.run.best);
    this.hud.hide();

    this.rafId = requestAnimationFrame(this.frame);
  }

  // ===========================================================================================
  // Flow
  // ===========================================================================================

  private applySettings(s: Settings): void {
    this.input.sensitivity = s.sensitivity;
    this.rig.motionScale = s.reduceMotion ? 0.15 : 1;
    this.audio.setVolume(s.volume);
  }

  /** Starts a fresh run (from the main menu). Must be triggered by a user gesture. */
  startGame(): void {
    this.audio.init();
    this.resetRun();
    this.menu.hide();
    this.hud.show();
    this.phase = Phase.Playing;
    this.input.setActive(true);
    this.input.dragLook = false;
    this.requestLock();
  }

  private resetRun(): void {
    this.run.reset();
    this.checkpoints.reset();
    this.maxSection = 0;
    this.respawnTimer = -1;
    this.hud.fade(false);
    this.hud.setTime(0);
    this.respawn(false);
    this.hud.toast('GO', 1100);
  }

  private restartRun(): void {
    this.audio.init();
    this.resetRun();
    this.menu.hide();
    this.hud.show();
    this.phase = Phase.Playing;
    this.input.setActive(true);
    this.requestLock();
  }

  private pause(): void {
    if (this.phase !== Phase.Playing) return;
    this.phase = Phase.Paused;
    this.input.setActive(false);
    this.audio.silence();
    this.hud.setHint(null);
    this.hud.setVaultPrompt(false);
    this.menu.showPause();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private resume(): void {
    if (this.phase !== Phase.Paused) return;
    this.menu.hide();
    this.phase = Phase.Playing;
    this.input.setActive(true);
    this.last = performance.now();
    this.requestLock();
  }

  private finishRun(): void {
    if (this.phase !== Phase.Playing) return;
    const isBest = this.run.finish();
    this.phase = Phase.Finished;
    this.input.setActive(false);
    this.audio.silence();
    this.audio.complete();
    this.hud.setHint(null);
    this.hud.setVaultPrompt(false);
    this.lockWanted = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.menu.showFinish(this.run.time, this.run.best ?? this.run.time, this.run.falls, isBest);
  }

  /** Puts the player on the latest checkpoint (or the start) with all movement state reset. */
  private respawn(announce: boolean): void {
    const cp = this.checkpoints.respawnPoint();
    const sp = this.level.desc.spawn;
    const x = cp ? cp.x : sp.x;
    const y = cp ? cp.y : sp.y;
    const z = cp ? cp.z : sp.z;
    const yaw = cp ? cp.yaw : sp.yaw;
    this.controller.respawn(x, y, z, yaw);
    this.input.yaw = yaw;
    this.input.pitch = 0;
    this.input.clear();
    this.acc = 0;
    this.rig.snap(this.controller);
    this.rig.camera.position.set(x, y + 1.65, z);
    if (announce) this.audio.respawn();
  }

  // ---- pointer lock -----------------------------------------------------------------------

  private requestLock(): void {
    this.lockWanted = true;
    this.lockRetries = 0;
    this.tryLock();
  }

  private tryLock(): void {
    if (!this.lockWanted || document.pointerLockElement === this.canvas) return;
    try {
      const result = (this.canvas.requestPointerLock as () => Promise<void> | void)();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => this.handleLockError());
      }
    } catch {
      this.handleLockError();
    }
  }

  private handleLockChange(): void {
    const locked = document.pointerLockElement === this.canvas;
    if (locked) {
      this.hasLock = true;
      this.input.dragLook = false;
      this.hud.setNotice('');
      this.lockRetries = 0;
      return;
    }
    // Lock was released (Esc, alt-tab...). Pause when playing - but only if we really had it.
    const hadLock = this.hasLock;
    this.hasLock = false;
    if (hadLock && this.phase === Phase.Playing && this.lockWanted) this.pause();
  }

  private handleLockError(): void {
    if (!this.lockWanted) return;
    if (this.lockRetries < 2) {
      // Browsers refuse re-locking for ~1 s after the user pressed Esc; retry shortly.
      this.lockRetries++;
      window.setTimeout(() => this.tryLock(), 1100);
      return;
    }
    // Pointer lock unavailable (embedded frame, permissions...): fall back to drag-to-look.
    this.input.dragLook = true;
    this.hud.setNotice('POINTER LOCK UNAVAILABLE — DRAG THE MOUSE TO LOOK');
  }

  // ===========================================================================================
  // Main loop
  // ===========================================================================================

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dtMs = now - this.last;
    this.last = now;
    const dt = Math.min(dtMs / 1000, 0.1);
    this.time += dt;
    this.trackPerformance(dtMs, dt);

    if (this.phase === Phase.Playing) {
      if (this.input.escapeRequested) {
        this.input.escapeRequested = false;
        if (document.pointerLockElement !== this.canvas) this.pause();
      }
      this.simulate(dt);
    }
    this.input.escapeRequested = false;

    this.updateView(dt);
    this.render();
  };

  private simulate(dt: number): void {
    if (this.respawnTimer >= 0) {
      // Falling-off fade: freeze the player until the screen is white, then respawn.
      this.respawnTimer -= dt;
      if (this.respawnTimer < 0) {
        this.respawn(true);
        this.hud.fade(false);
      }
      return;
    }

    if (this.input.restartRequested) {
      this.input.restartRequested = false;
      this.run.falls += 0;
      this.respawn(true);
      this.hud.toast('BACK TO CHECKPOINT', 1200);
    }

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      const inp = this.input.snapshot();
      if (!this.run.running && (inp.moveX !== 0 || inp.moveY !== 0 || inp.jumpPressed)) this.run.running = true;
      this.controller.update(STEP, inp);
      this.input.clearEdges();
      this.rig.addStep(this.controller.stepDelta);
      this.processEvents();
      this.acc -= STEP;
      steps++;
      if (this.run.running) this.run.time += STEP;
      this.afterTick();
      if (this.phase !== Phase.Playing || this.respawnTimer >= 0) break;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
  }

  private processEvents(): void {
    const c = this.controller;
    for (const ev of c.events) {
      switch (ev.type) {
        case 'jump':
          this.audio.jump();
          this.rig.onTakeoff();
          break;
        case 'wallJump':
          this.audio.wallJump();
          break;
        case 'land':
          this.audio.land(ev.impact);
          this.rig.onLand(ev.impact);
          break;
        case 'step':
          this.audio.footstep(ev.speed, ev.wall);
          break;
        case 'slideStart':
          this.audio.slideStart();
          break;
        case 'vault':
          this.audio.vault();
          break;
        case 'mantle':
          this.audio.mantle();
          break;
        case 'wallStart':
          this.audio.wallStart();
          break;
        default:
          break;
      }
    }
    c.events.length = 0;
  }

  private afterTick(): void {
    const p = this.controller.phys;

    // Checkpoints
    const cp = this.checkpoints.update(p.x, p.y, p.z, this.time);
    if (cp !== null) {
      this.hud.toast(this.level.desc.checkpoints[cp].name);
      this.audio.checkpoint();
    }

    // Finish line
    const box = p.aabb(this.playerBox);
    if (overlaps(box, this.level.desc.finish.trigger)) {
      this.finishRun();
      return;
    }

    // Fell off the rooftops
    if (p.y < this.level.desc.killY) {
      this.run.falls++;
      this.respawnTimer = 0.3;
      this.hud.fade(true);
      return;
    }

    // Section titles
    for (const s of this.level.desc.sections) {
      if (s.index > this.maxSection && s.box.minX < p.x && p.x < s.box.maxX && s.box.minZ < p.z && p.z < s.box.maxZ) {
        this.maxSection = s.index;
        this.hud.showSection(s.index, s.title);
      }
    }
  }

  private readonly playerBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  private updateView(dt: number): void {
    const c = this.controller;
    const camera = this.rig.camera;

    if (this.phase === Phase.Menu) {
      // Slow cinematic sweep over the start roof behind the menu.
      const t = this.time;
      camera.position.set(5.5 + Math.sin(t * 0.07) * 2, 22.4, 27.5);
      camera.rotation.set(-0.07, 0.38 + Math.sin(t * 0.09) * 0.22, 0);
      this.sky.follow(camera);
      this.updateSun(camera.position, 0);
      this.level.update(this.time);
      this.checkpoints.update(1e6, 1e6, 1e6, this.time);
      return;
    }

    if (this.phase === Phase.Playing) {
      const alpha = this.acc / STEP;
      this.rig.update(dt, c, this.input.yaw, this.input.pitch, alpha);
      this.body.update(dt, c, this.rig, this.input.yaw, this.input.pitch);

      this.hud.setTime(this.run.time);
      this.hud.setSpeed(c.speedH);
      this.hud.setVaultPrompt(c.canVaultNow());
      this.updateHint();
      this.audio.update(
        c.speedH,
        c.state === MoveState.Slide,
        c.state === MoveState.Air,
        c.state === MoveState.WallRun,
      );
    }

    this.sky.follow(camera);
    this.updateSun(camera.position, this.input.yaw);
    this.level.update(this.time);
  }

  private updateHint(): void {
    const c = this.controller;
    const p = c.phys;
    if (c.state === MoveState.WallRun) {
      this.hud.setHint('<kbd>SPACE</kbd> leap off the wall');
      return;
    }
    let html: string | null = null;
    for (const h of this.level.desc.hints) {
      const b = h.box;
      if (p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY && p.z > b.minZ && p.z < b.maxZ) {
        html = h.html;
        break;
      }
    }
    this.hud.setHint(html);
  }

  /** Keeps the shadow frustum centred just ahead of the player, snapped to shadow-map texels. */
  private readonly sunRight = new THREE.Vector3();
  private readonly sunUp = new THREE.Vector3();
  private readonly sunTarget = new THREE.Vector3();
  private updateSun(center: THREE.Vector3, yaw: number): void {
    const dir = SUN_DIRECTION;
    this.sunRight.crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    this.sunUp.crossVectors(dir, this.sunRight).normalize();
    const texel = 92 / 2048;
    const ahead = 14;
    this.sunTarget.set(center.x - Math.sin(yaw) * ahead, center.y - 2, center.z - Math.cos(yaw) * ahead);
    const tx = Math.round(this.sunTarget.dot(this.sunRight) / texel) * texel;
    const ty = Math.round(this.sunTarget.dot(this.sunUp) / texel) * texel;
    const tz = this.sunTarget.dot(dir);
    this.sunTarget.set(0, 0, 0).addScaledVector(this.sunRight, tx).addScaledVector(this.sunUp, ty).addScaledVector(dir, tz);
    this.sun.target.position.copy(this.sunTarget);
    this.sun.position.copy(this.sunTarget).addScaledVector(dir, 160);
    this.sun.target.updateMatrixWorld();
  }

  private render(): void {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.rig.camera);
    if (this.phase === Phase.Playing || this.phase === Phase.Paused) {
      r.clearDepth();
      r.render(this.body.scene, this.body.camera);
    }
  }

  // ===========================================================================================
  // Misc
  // ===========================================================================================

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
  }

  /** Very small dynamic-resolution controller: trades pixel ratio for a steady frame rate. */
  private trackPerformance(dtMs: number, dt: number): void {
    if (dtMs > 250) return; // ignore hitches (tab switches, pauses)
    this.frameAvg += (dtMs - this.frameAvg) * 0.05;
    this.perfTimer += dt;
    this.perfCooldown -= dt;
    if (this.perfTimer < 1 || this.perfCooldown > 0) return;
    this.perfTimer = 0;
    const maxRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (this.frameAvg > 21 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.125);
      this.perfCooldown = 4;
      this.resize();
    } else if (this.frameAvg < 11 && this.pixelRatio < maxRatio) {
      this.pixelRatio = Math.min(maxRatio, this.pixelRatio + 0.125);
      this.perfCooldown = 6;
      this.resize();
    }
  }

  /** Dev hook (`?shot=x,y,z,yaw,pitch`): jump straight into play at a position, without pointer lock. */
  debugShot(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.resetRun();
    this.menu.hide();
    this.hud.show();
    this.phase = Phase.Playing;
    this.controller.respawn(x, y, z, yaw);
    this.input.yaw = yaw;
    this.input.pitch = pitch;
    this.rig.snap(this.controller);
  }

  /** Test / debugging hook. */
  debug(): { controller: PlayerController; teleport: (x: number, y: number, z: number, yaw?: number) => void } {
    return {
      controller: this.controller,
      teleport: (x, y, z, yaw = 0) => {
        this.controller.respawn(x, y, z, yaw);
        this.input.yaw = yaw;
        this.rig.snap(this.controller);
      },
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.level.dispose();
    this.city.dispose();
    this.checkpoints.dispose();
    this.sky.dispose();
    this.body.dispose();
    this.envTexture?.dispose();
    this.renderer.dispose();
  }
}
