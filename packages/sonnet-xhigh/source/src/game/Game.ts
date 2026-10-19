/**
 * Game - owns the renderer, scene and every subsystem, runs the main loop and drives
 * the high level flow (menu -> run -> pause -> finish).
 *
 * Simulation uses a fixed time step (see FIXED_DT) decoupled from the render rate; the
 * rendered body / camera are interpolated between the last two physics states so
 * movement is smooth at any refresh rate and behaves identically at any frame rate.
 */

import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { MOVE } from '../player/MovementConfig';
import { makePlayerInput, PlayerController, type PlayerInput } from '../player/PlayerController';
import { PlayerBody } from '../player/PlayerBody';
import { CheckpointManager } from '../world/Checkpoints';
import { CityGenerator } from '../world/CityGenerator';
import { Level } from '../world/Level';
import { buildLevelSpec, type CheckpointSpec } from '../world/LevelSpec';
import { createMaterials, HAZE_COLOR, type MaterialSet } from '../world/Materials';
import { Sky } from '../world/Sky';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { GameState } from './GameState';
import { Input } from './Input';
import { formatTime, loadBestTime, saveBestTime, SettingsStore } from './Settings';

/** Physics step: 120 Hz. */
const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 10;
const SUN_DIR = new THREE.Vector3(0.55, 0.72, -0.3).normalize();
const SHADOW_RANGE = 72;
const SHADOW_MAP = 2048;

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();

  private readonly settings = new SettingsStore();
  private readonly state = new GameState();
  private readonly hud: HUD;
  private readonly menu: Menu;
  private readonly audio = new AudioManager();
  private readonly input: Input;

  private materials!: MaterialSet;
  private sky!: Sky;
  private envTexture: THREE.Texture | null = null;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private level!: Level;
  private city!: CityGenerator;
  private controller!: PlayerController;
  private fpCamera!: FirstPersonCamera;
  private body!: PlayerBody;
  private checkpoints!: CheckpointManager;

  private readonly playerInput: PlayerInput = makePlayerInput();
  private readonly mouse = { x: 0, y: 0 };

  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private clock = 0;
  private disposed = false;
  private lockErrors = 0;
  private lockLostAt = -100;
  private debugVisible = false;
  /** Testing aid: when set the live simulation is skipped (see debugApi().run). */
  private debugFreeze = false;

  // adaptive resolution
  private pixelRatio = 1;
  private maxPixelRatio = 1;
  private frameTimes: number[] = [];

  // fps counter
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private static readonly WORLD_UP = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.hud = new HUD();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.menu = new Menu(this.settings, {
      onStart: () => this.startRun(true),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => { this.resume(); this.respawn(this.checkpoints.current, false); },
      onRestartLevel: () => this.startRun(false),
      onQuitToMenu: () => this.quitToMenu(),
      onFinishRestart: () => this.startRun(false),
      onClick: () => this.audio.uiClick(),
    });
    this.input = new Input(this.canvas, {
      onLockChange: (locked) => this.onLockChange(locked),
      onLockError: () => this.onLockError(),
      onRestartCheckpoint: () => {
        if (this.state.phase === 'playing') this.respawn(this.checkpoints.current, false);
      },
      onPauseKey: () => {
        if (this.state.phase === 'playing') this.pause();
      },
      onToggleDebug: () => { this.debugVisible = !this.debugVisible; if (!this.debugVisible) this.hud.setDebug(null); },
    });
  }

  // ===================================================================== setup

  async init(): Promise<void> {
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false;
    r.info.autoReset = false; // two passes per frame (world + arms): reset manually so stats cover both
    r.setClearColor(HAZE_COLOR, 1);

    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.pixelRatio = this.maxPixelRatio;
    this.resize();

    this.materials = createMaterials();

    // ---- sky, fog, lights
    this.sky = new Sky(SUN_DIR);
    this.scene.add(this.sky.mesh);
    this.envTexture = this.sky.createEnvironment(r);
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new THREE.FogExp2(HAZE_COLOR, 0.0015);

    this.hemi = new THREE.HemisphereLight(0xe4eefa, 0xe6e3dd, 0.62);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1da, 5.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_RANGE; sc.right = SHADOW_RANGE; sc.top = SHADOW_RANGE; sc.bottom = -SHADOW_RANGE;
    sc.near = 20; sc.far = 520;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);

    // ---- world
    const spec = buildLevelSpec();
    this.level = new Level(spec, this.materials);
    this.scene.add(this.level.group);
    this.city = new CityGenerator(spec.footprints, this.materials);
    this.scene.add(this.city.group);
    this.checkpoints = new CheckpointManager(spec.checkpoints, this.level.markers);

    // ---- player
    this.controller = new PlayerController(this.level.world);
    this.fpCamera = new FirstPersonCamera(window.innerWidth / Math.max(1, window.innerHeight));
    this.body = new PlayerBody(this.envTexture);
    this.scene.add(this.body.legs);
    this.body.legs.visible = false;
    this.wirePlayerEvents();

    this.applySettings();
    this.settings.onChange(() => this.applySettings());

    this.respawn({ ...spec.checkpoints[0], pos: spec.spawn.pos, yaw: spec.spawn.yaw }, false, true);
    this.menu.setBest(loadBestTime());

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    // Compile shaders before showing the menu to avoid a first-frame hitch.
    this.updateMenuCamera(0);
    this.updateSun();
    try {
      await this.renderer.compileAsync(this.scene, this.fpCamera.camera);
    } catch {
      /* compileAsync is an optimisation only */
    }

    this.state.phase = 'menu';
    this.menu.show('menu');
    this.lastTime = performance.now() / 1000;
    this.raf = requestAnimationFrame(this.frame);

    // URL switches useful for testing / embedded browsers.
    const params = new URLSearchParams(window.location.search);
    if (params.has('nolock')) this.input.enableDragMode();
    if (params.has('debug')) this.debugVisible = true;
  }

  private wirePlayerEvents(): void {
    this.controller.listener = {
      onJump: () => { this.audio.jump(); this.fpCamera.onJump(); },
      onWallJump: () => { this.audio.wallJump(); this.fpCamera.onJump(); },
      onLand: (impact) => { this.audio.land(impact); this.fpCamera.onLand(impact); },
      onFootstep: (sprinting) => this.audio.footstep(sprinting),
      onSlideStart: () => this.audio.slideStart(),
      onVault: () => this.audio.vault(),
      onMantle: () => this.audio.mantle(),
      onWallRunStart: () => this.audio.wallRunStart(),
    };
  }

  private applySettings(): void {
    const s = this.settings.get();
    this.fpCamera.sensitivity = s.sensitivity;
    this.fpCamera.motion = s.reduceMotion ? 0.25 : 1;
    this.audio.setVolume(s.volume);
  }

  // ===================================================================== flow

  /** Starts (or restarts) a run from the very beginning. */
  private startRun(firstTime: boolean): void {
    void firstTime;
    this.audio.init();
    this.blurFocus();
    this.state.resetRun();
    this.checkpoints.reset();
    this.hud.setProgress(this.checkpoints.count, 0);
    const spec = this.level.spec;
    this.respawn({ ...spec.checkpoints[0], pos: spec.spawn.pos, yaw: spec.spawn.yaw }, false, true);
    this.menu.show('none');
    this.hud.setVisible(true);
    this.hud.clearHint();
    this.hud.setTime(0);
    this.body.legs.visible = true;
    this.state.phase = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.accumulator = 0;
    this.lastTime = performance.now() / 1000;
    if (!this.input.dragMode) this.input.requestLock();
  }

  private pause(): void {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.hud.clearHint();
    this.menu.show('pause');
  }

  private resume(): void {
    if (this.state.phase !== 'paused' && this.state.phase !== 'playing') return;
    this.blurFocus();
    this.menu.show('none');
    this.state.phase = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.accumulator = 0;
    this.lastTime = performance.now() / 1000;
    if (!this.input.dragMode && !this.input.locked) this.input.requestLock();
  }

  private quitToMenu(): void {
    this.state.phase = 'menu';
    this.input.enabled = false;
    this.input.reset();
    this.input.exitLock();
    this.hud.setVisible(false);
    this.hud.clearHint();
    this.body.legs.visible = false;
    this.menu.setBest(loadBestTime());
    this.menu.show('menu');
  }

  private finishRun(): void {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'finished';
    this.input.enabled = false;
    this.input.reset();
    this.input.exitLock();
    this.hud.clearHint();
    this.audio.finish();
    const time = this.state.runTime;
    const isRecord = saveBestTime(time);
    const best = loadBestTime() ?? time;
    this.menu.setBest(best);
    this.menu.showFinish(time, best, isRecord, this.state.deaths);
  }

  private onLockChange(locked: boolean): void {
    if (locked) {
      this.lockErrors = 0;
      return;
    }
    // Esc (or the browser) released the mouse during play: pause.
    this.lockLostAt = performance.now() / 1000;
    if (this.state.phase === 'playing') this.pause();
  }

  private onLockError(): void {
    this.lockErrors++;
    const phase = this.state.phase;
    if (phase !== 'playing' && phase !== 'paused') return;
    const justReleased = performance.now() / 1000 - this.lockLostAt < 2.5;
    if (justReleased && this.lockErrors < 2) {
      // Browsers refuse a re-lock right after Esc; ask the player to click again.
      if (phase === 'playing') this.pause();
      return;
    }
    // Pointer lock is not available here (embedded browser, automation...): drag-to-look.
    this.input.enableDragMode();
    this.hud.showMessage('Mouse lock unavailable<small>Hold the left mouse button and drag to look</small>');
  }

  private blurFocus(): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) active.blur();
  }

  /** Teleports the player to a checkpoint (or the spawn) and clears movement state. */
  private respawn(
    cp: Pick<CheckpointSpec, 'pos' | 'yaw'>,
    countDeath: boolean,
    silent = false,
  ): void {
    this.controller.respawn(cp.pos[0], cp.pos[1], cp.pos[2]);
    this.fpCamera.setLook(cp.yaw, 0);
    this.fpCamera.reset();
    this.accumulator = 0;
    this.input.consumeEdges();
    if (countDeath) this.state.deaths++;
    if (!silent) {
      this.hud.flash();
      this.audio.respawn();
    }
  }

  // ===================================================================== loop

  private readonly frame = (nowMs: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = nowMs / 1000;
    let dt = now - this.lastTime;
    this.lastTime = now;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;
    this.clock += dt;

    this.trackPerformance(dt);

    const phase = this.state.phase;
    let alpha = 1;
    if (phase === 'playing' && !this.debugFreeze) {
      alpha = this.simulate(dt);
    } else if (phase === 'menu') {
      this.updateMenuCamera(this.clock);
    } else if (phase === 'paused' || phase === 'finished') {
      // freeze the world; keep the last camera pose
    }

    if (phase === 'playing' || phase === 'paused' || phase === 'finished') {
      this.fpCamera.update(phase === 'playing' ? dt : 0, this.controller, alpha);
      this.body.update(phase === 'playing' ? dt : 0, this.controller, this.fpCamera, alpha);
    }

    this.sky.update(this.fpCamera.camera, this.clock);
    this.materials.time.value = this.clock;
    this.updateSun();
    this.render(phase);

    // ---- audio + HUD
    const p = this.controller.physics;
    this.audio.update({
      speed: p.horizontalSpeed,
      grounded: p.grounded,
      sliding: this.controller.state === 'slide',
      wallRunning: this.controller.state === 'wallrun',
      active: phase === 'playing',
    });
    if (phase === 'playing') {
      this.hud.setTime(this.state.runTime);
      const sf = Math.max(0, Math.min(1, (p.horizontalSpeed - 7.5) / 4.5)) * 0.9 * (this.settings.get().reduceMotion ? 0.4 : 1);
      this.hud.setSpeedFx(sf);
      this.updateHints();
    } else {
      this.hud.setSpeedFx(0);
    }
    if (this.debugVisible) this.updateDebug();
  };

  /** Runs the fixed-step simulation and returns the interpolation alpha. */
  private simulate(dt: number): number {
    const ctrl = this.controller;
    const p = ctrl.physics;

    // Mouse look (applied once per frame, smoothed).
    this.input.consumeMouse(this.mouse);
    if (this.mouse.x !== 0 || this.mouse.y !== 0) this.fpCamera.addMouse(this.mouse.x, this.mouse.y);
    this.fpCamera.smoothLook(dt);

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.input.sample(this.playerInput);
      if (!this.state.timerRunning && (this.playerInput.moveX !== 0 || this.playerInput.moveZ !== 0 || this.playerInput.jumpPressed)) {
        this.state.timerRunning = true;
      }
      ctrl.update(FIXED_DT, this.playerInput, this.fpCamera.yaw);
      this.input.consumeEdges();
      this.state.tick(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;

      if (this.afterStep()) {
        // respawned or finished: drop remaining time so nothing is simulated twice
        this.accumulator = 0;
        break;
      }
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    void p;
    return Math.min(1, this.accumulator / FIXED_DT);
  }

  /** Per physics step game rules. Returns true if the step changed the run (respawn/finish). */
  private afterStep(): boolean {
    const p = this.controller.physics;
    const spec = this.level.spec;

    // Fell off the rooftops
    if (p.y < MOVE.killHeight) {
      this.respawn(this.checkpoints.current, true);
      return true;
    }

    // Checkpoints
    const cp = this.checkpoints.update(p.x, p.y + 0.5, p.z);
    if (cp) {
      this.state.checkpointsReached = cp.index;
      this.hud.setProgress(this.checkpoints.count, cp.index);
      this.hud.showCheckpoint(cp.label, this.state.runTime);
      this.audio.checkpoint();
    }

    // Finish line
    const f = spec.finish;
    const y = p.y + 0.5;
    if (
      p.x >= f.triggerMin[0] && p.x <= f.triggerMax[0] &&
      y >= f.triggerMin[1] && y <= f.triggerMax[1] &&
      p.z >= f.triggerMin[2] && p.z <= f.triggerMax[2]
    ) {
      this.finishRun();
      return true;
    }
    return false;
  }

  private updateHints(): void {
    const ctrl = this.controller;
    const p = ctrl.physics;
    let text: string | null = null;
    if (ctrl.state === 'wallrun') {
      text = '[SPACE] kick off the wall — or keep running';
    } else if (ctrl.parkour.vaultAvailable) {
      text = '[E] vault';
    } else {
      for (const h of this.level.spec.hints) {
        if (
          p.x >= h.min[0] && p.x <= h.max[0] &&
          p.y >= h.min[1] && p.y <= h.max[1] &&
          p.z >= h.min[2] && p.z <= h.max[2]
        ) {
          text = h.text;
          break;
        }
      }
    }
    this.hud.setHint(text, this.clock);
  }

  // ===================================================================== rendering

  private updateMenuCamera(t: number): void {
    const cam = this.fpCamera.camera;
    const spawn = this.level.spec.spawn.pos;
    const a = t * 0.08;
    cam.position.set(spawn[0] + 6 + Math.sin(a) * 4, spawn[1] + 3.2 + Math.sin(a * 1.3) * 0.5, spawn[2] + 13);
    cam.fov = 62;
    cam.updateProjectionMatrix();
    cam.lookAt(spawn[0] - 4 + Math.sin(a * 0.7) * 2, spawn[1] + 3.4, spawn[2] - 40);
    this.fpCamera.fov = 62;
  }

  /** Keeps the shadow frustum around the player, snapped to shadow texels (no shimmering). */
  private updateSun(): void {
    const cam = this.fpCamera.camera;
    cam.getWorldDirection(this.tmpDir);
    this.tmpDir.y = 0;
    if (this.tmpDir.lengthSq() > 1e-6) this.tmpDir.normalize();
    // Bias the shadow window forward: that is where the player looks.
    const center = this.tmpV.copy(cam.position).addScaledVector(this.tmpDir, 22);

    const lightDir = SUN_DIR;
    const right = this.tmpRight.crossVectors(lightDir, Game.WORLD_UP).normalize();
    const up = this.tmpUp.crossVectors(right, lightDir).normalize();
    const texel = (SHADOW_RANGE * 2) / SHADOW_MAP;
    const cx = center.dot(right);
    const cy = center.dot(up);
    const sx = Math.round(cx / texel) * texel - cx;
    const sy = Math.round(cy / texel) * texel - cy;
    center.addScaledVector(right, sx).addScaledVector(up, sy);

    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(lightDir, 260);
    this.sun.target.updateMatrixWorld();
  }

  private render(phase: string): void {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, this.fpCamera.camera);
    if (phase === 'playing' || phase === 'paused' || phase === 'finished') {
      r.clearDepth();
      r.render(this.body.viewScene, this.body.viewCamera);
    }
  }

  private readonly onResize = (): void => this.resize();

  private resize(): void {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.fpCamera?.resize(w / h);
  }

  private readonly onVisibility = (): void => {
    if (document.hidden && this.state.phase === 'playing') this.pause();
  };

  /** Lowers / raises the render resolution to hold a steady frame rate. */
  private trackPerformance(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length >= 90) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      let next = this.pixelRatio;
      if (avg > 22 && this.pixelRatio > 0.8) next = Math.max(0.8, this.pixelRatio - 0.25);
      else if (avg < 11.5 && this.pixelRatio < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25);
      if (next !== this.pixelRatio) {
        this.pixelRatio = next;
        this.resize();
      }
    }
  }

  private updateDebug(): void {
    const c = this.controller;
    const p = c.physics;
    const w = c.parkour;
    this.hud.setDebug(
      [
        `fps ${this.fps.toFixed(0)}  px ratio ${this.pixelRatio.toFixed(2)}  draws ${this.renderer.info.render.calls}  tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k`,
        `phase ${this.state.phase}  state ${c.state}  grounded ${p.grounded}`,
        `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
        `vel ${p.vx.toFixed(1)} ${p.vy.toFixed(1)} ${p.vz.toFixed(1)}  speed ${p.horizontalSpeed.toFixed(1)}`,
        `wall budget ${w.wallBudget.toFixed(2)}  cooldown ${w.wallCooldown.toFixed(2)}`,
        `time ${formatTime(this.state.runTime)}  falls ${this.state.deaths}  city blocks ${this.city.blockCount}`,
      ].join('\n'),
    );
  }

  // ===================================================================== testing hooks

  /** Small API used by automated checks (exposed as window.__game in dev builds). */
  debugApi() {
    return {
      startWithoutLock: () => {
        this.input.enableDragMode();
        this.startRun(true);
      },
      teleport: (x: number, y: number, z: number, yaw = 0, pitch = 0) => {
        this.controller.respawn(x, y, z);
        this.fpCamera.setLook(yaw, pitch);
      },
      teleportCheckpoint: (index: number) => {
        const cp = this.level.spec.checkpoints[index];
        if (cp) this.respawn(cp, false, true);
      },
      look: (yaw: number, pitch: number) => this.fpCamera.setLook(yaw, pitch),
      /** The designer route annotated in the level (used by the automated playthrough). */
      route: () => this.level.spec.route,
      state: () => ({
        phase: this.state.phase,
        move: this.controller.state,
        pos: [this.controller.physics.x, this.controller.physics.y, this.controller.physics.z],
        vel: [this.controller.physics.vx, this.controller.physics.vy, this.controller.physics.vz],
        grounded: this.controller.physics.grounded,
        time: this.state.runTime,
        fps: this.fps,
        draws: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }),
      setDebug: (v: boolean) => { this.debugVisible = v; if (!v) this.hud.setDebug(null); },
      /** Freezes / unfreezes the live simulation so scripted scenarios can be stepped manually. */
      freeze: (v: boolean) => { this.debugFreeze = v; },
      /** Steps the simulation deterministically for `seconds` with the given input. */
      run: (seconds: number, patch: Partial<PlayerInput> = {}) => {
        const input = { ...makePlayerInput(), ...patch };
        const steps = Math.round(seconds / FIXED_DT);
        for (let i = 0; i < steps; i++) {
          this.controller.update(FIXED_DT, input, this.fpCamera.yaw);
          input.jumpPressed = false;
          input.slidePressed = false;
          input.interactPressed = false;
          if (this.state.timerRunning || input.moveZ !== 0) this.state.timerRunning = true;
          this.state.tick(FIXED_DT);
          if (this.afterStep()) break;
        }
      },
      input: this.input,
      controller: this.controller,
      finish: () => this.finishRun(),
    };
  }

  // ===================================================================== teardown

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.body?.dispose();
    this.level?.dispose();
    this.city?.dispose();
    this.sky?.dispose();
    this.materials?.dispose();
    this.envTexture?.dispose();
    this.sun?.shadow.map?.dispose();
    this.renderer.dispose();
  }
}
