import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AudioManager } from '../audio/AudioManager.ts';
import { FirstPersonCamera } from '../player/FirstPersonCamera.ts';
import { makeZipline } from '../player/ParkourSystem.ts';
import { PlayerBody } from '../player/PlayerBody.ts';
import { PlayerConfig as PC } from '../player/PlayerConfig.ts';
import { MoveMode, PlayerController, emptyInput, type PlayerEvent } from '../player/PlayerController.ts';
import { HUD } from '../ui/HUD.ts';
import { Menu } from '../ui/Menu.ts';
import { Checkpoints } from '../world/Checkpoints.ts';
import { generateCity } from '../world/CityGenerator.ts';
import { buildCollisionWorld } from '../world/buildCollision.ts';
import { Level } from '../world/Level.ts';
import { buildLevelDef, type LevelDef, type ZoneDef } from '../world/LevelData.ts';
import { Materials } from '../world/Materials.ts';
import { SUN_DIRECTION, Sky } from '../world/Sky.ts';
import { RunState, loadBestSplits, loadBestTime, submitTime } from './GameState.ts';
import { Input } from './Input.ts';
import { hasSavedSettings, loadSettings, motionScale, saveSettings, type Settings } from './Settings.ts';

/**
 * Clamps HDR colour before bloom and forces opaque alpha. A single out-of-range pixel
 * (e.g. an extreme specular highlight) would otherwise be smeared across the frame by the blur.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = clamp(c, vec3(0.0), vec3(64.0));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Physics runs at a fixed 120 Hz regardless of the display refresh rate. */
const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 12;
const SHADOW_EXTENT = 62;

const inZone = (z: ZoneDef, p: THREE.Vector3) =>
  p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];

/**
 * Owns the renderer, the world, the player and the UI, and runs the main loop.
 *
 * Loop: input is sampled into fixed 120 Hz physics steps (with an accumulator); rendering
 * interpolates the player between the last two physics states, so movement is identical at
 * any frame rate and still perfectly smooth on high-refresh displays.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sky: Sky;
  private readonly sun: THREE.DirectionalLight;
  private readonly materials: Materials;
  private readonly level: Level;
  private readonly checkpoints: Checkpoints;
  private readonly def: LevelDef;
  private readonly player: PlayerController;
  private readonly fp: FirstPersonCamera;
  private readonly body: PlayerBody;
  private readonly input: Input;
  private readonly hud: HUD;
  private readonly menu: Menu;
  private readonly audio = new AudioManager();
  private readonly run = new RunState();
  private settings: Settings;
  private best: number | null;
  private bestSplits: number[];

  private accumulator = 0;
  private lastFrame = -1;
  private elapsed = 0;
  private readonly stepInput = emptyInput();
  private readonly renderPos = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private promptTimer = 0;
  /** Respawn sequence: fading to white, then teleport and fade back. */
  private respawnPending = false;
  private finishTimer = -1;
  private lockCheckTimer = -1;
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  /** Post-processing chain (High quality): scene, arms overlay, subtle bloom, tone mapping. */
  private composer: EffectComposer | null = null;
  private bodyPass: RenderPass | null = null;
  private pendingFinish: Parameters<Menu['showFinish']>[0] | null = null;
  /** First-visit performance check: drop to Low quality once if the frame rate is poor. */
  private autoQuality: boolean;
  private perfTime = 0;
  private perfFrames = 0;
  private rafId = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.autoQuality = !hasSavedSettings();
    this.settings = loadSettings();
    this.best = loadBestTime();
    this.bestSplits = loadBestSplits();

    // ---------------------------------------------------------------- renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    // Count draw calls across all passes of a frame (reset manually in render()).
    this.renderer.info.autoReset = false;
    this.applyQuality();

    // ---------------------------------------------------------------- world
    this.def = buildLevelDef();
    const city = generateCity(this.def);
    this.materials = new Materials(this.renderer.capabilities.getMaxAnisotropy());
    this.level = new Level(this.def, city, this.materials);
    this.scene.add(this.level.root);
    this.checkpoints = new Checkpoints(this.def);
    this.scene.add(this.checkpoints.root);

    this.sky = new Sky();
    this.scene.add(this.sky.dome, this.sky.clouds);
    this.scene.environment = this.sky.createEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.42;
    this.scene.fog = new THREE.FogExp2(0xd3e6f4, 0.00085);

    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.7);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_EXTENT;
    sc.right = SHADOW_EXTENT;
    sc.top = SHADOW_EXTENT;
    sc.bottom = -SHADOW_EXTENT;
    sc.near = 1;
    sc.far = 420;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.2;
    this.sun.shadow.intensity = 1;
    this.applyShadowQuality();
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xc4dcff, 0xe2dacb, 0.3));
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIRECTION).normalize();
    this.lightUp.crossVectors(SUN_DIRECTION, this.lightRight).normalize();

    // ---------------------------------------------------------------- player
    const world = buildCollisionWorld(this.def, city.colliders);
    this.player = new PlayerController(world);
    this.player.ziplines = this.def.ziplines.map((z) => makeZipline(z.a, z.b));
    this.fp = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.body = new PlayerBody();
    this.body.shadowCaster.visible = false;
    this.body.legsRoot.visible = false;
    this.scene.add(this.body.shadowCaster, this.body.legsRoot);
    this.setupComposer();

    // ---------------------------------------------------------------- UI & input
    this.input = new Input(canvas);
    this.input.onLockLost = () => this.pause();
    this.input.onPausePressed = () => this.pause();
    this.input.onRestartPressed = () => this.beginRespawn();
    this.input.onActivity = () => {
      if (this.run.phase === 'playing' && !this.respawnPending) this.run.startTimer();
    };
    this.hud = new HUD(uiRoot, this.def.checkpoints.length);
    this.menu = new Menu(uiRoot, this.settings, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => {
        this.resume();
        this.teleportToCheckpoint();
        this.hud.fadeTo(0, 3, 1);
      },
      onRestartRun: () => this.startRun(),
      onQuitToMenu: () => this.quitToMenu(),
      onSettingsChange: (s) => this.applySettings(s),
      onClick: () => this.audio.click(),
    });

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    // Ctrl is the slide key and Ctrl+W closes tabs in some browsers: confirm before leaving mid-run.
    window.addEventListener('beforeunload', (e) => {
      if (this.run.phase === 'playing' && this.input.pointerLocked) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    this.onResize();
    this.resetRun();
    this.menu.showMain(this.best);
    this.hud.fadeTo(0, 1.5, 1);

    // Debug/test handle (used by automated browser checks).
    (window as unknown as { __roofline: unknown }).__roofline = {
      state: () => ({
        phase: this.run.phase,
        time: this.run.time,
        mode: this.player.mode,
        pos: this.player.position.toArray(),
        speed: this.player.horizontalSpeed,
        checkpoint: this.checkpoints.reached,
        locked: this.input.pointerLocked,
      }),
      teleport: (i: number) => {
        this.checkpoints.reached = Math.max(0, Math.min(this.def.checkpoints.length, i));
        this.teleportToCheckpoint();
      },
      look: (yaw: number, pitch: number) => {
        this.fp.yaw = yaw;
        this.fp.pitch = pitch;
      },
      renderer: this.renderer,
      composer: () => this.composer,
    };
  }

  start(): void {
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ flow

  private resetRun(): void {
    this.run.reset();
    this.checkpoints.reset();
    const s = this.def.spawn;
    this.player.respawn(s.pos[0], s.pos[1], s.pos[2]);
    this.fp.reset(s.yaw, 0);
    this.body.reset();
    this.hud.setProgress(0, this.def.checkpoints.length);
    this.hud.clearTransient();
    this.accumulator = 0;
    this.respawnPending = false;
    this.finishTimer = -1;
    this.input.clear();
  }

  private startRun(): void {
    this.audio.unlock();
    this.audio.setVolume(this.settings.volume);
    this.resetRun();
    this.run.phase = 'playing';
    this.menu.hide();
    this.hud.visible = true;
    this.body.shadowCaster.visible = true;
    this.body.legsRoot.visible = true;
    this.input.enabled = true;
    this.blurUi();
    this.input.requestPointerLock();
    this.lockCheckTimer = 0.6;
    this.hud.fadeTo(0, 2.6, 1);
  }

  private pause(): void {
    if (this.run.phase !== 'playing') return;
    this.run.phase = 'paused';
    this.input.enabled = false;
    this.input.clear();
    this.input.exitPointerLock();
    this.audio.setPaused(true);
    this.hud.setPrompt(null);
    this.menu.showPause();
  }

  private resume(): void {
    if (this.run.phase !== 'paused') return;
    this.audio.unlock();
    this.run.phase = 'playing';
    this.menu.hide();
    this.input.enabled = true;
    this.blurUi();
    this.input.requestPointerLock();
    this.lockCheckTimer = 0.6;
    this.lastFrame = -1;
  }

  private quitToMenu(): void {
    this.run.phase = 'menu';
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.audio.setPaused(true);
    this.hud.visible = false;
    this.body.shadowCaster.visible = false;
    this.body.legsRoot.visible = false;
    this.resetRun();
    this.menu.showMain(this.best);
  }

  private finish(): void {
    this.run.timerRunning = false;
    this.run.finalTime = this.run.time;
    this.run.phase = 'finished';
    this.run.newBest = submitTime(this.run.time, this.run.splits);
    const previousSplits = this.bestSplits;
    if (this.run.newBest) {
      this.best = this.run.time;
      this.bestSplits = [...this.run.splits];
    }
    this.audio.finish();
    this.hud.showMessage('Finish', '');
    this.input.enabled = false;
    this.input.clear();
    this.finishTimer = 1.1;
    this.pendingFinish = {
      time: this.run.time,
      best: this.best,
      newBest: this.run.newBest,
      splits: this.def.checkpoints.map((cp, i) => ({
        name: cp.name,
        time: this.run.splits[i] ?? 0,
        delta: previousSplits[i] !== undefined && this.run.splits[i] !== undefined ? this.run.splits[i] - previousSplits[i] : null,
      })),
      respawns: this.run.respawns,
    };
  }

  /** Starts the fade-to-white respawn (falls, or R). */
  private beginRespawn(): void {
    if (this.run.phase !== 'playing' || this.respawnPending) return;
    this.respawnPending = true;
    this.run.respawns++;
    this.audio.respawn();
    this.hud.fadeTo(1, 6);
  }

  private teleportToCheckpoint(): void {
    const rp = this.checkpoints.respawnPoint;
    this.player.respawn(rp.pos[0], rp.pos[1], rp.pos[2]);
    this.fp.reset(rp.yaw, 0);
    this.body.reset();
    this.audio.slideStop();
    this.audio.zipStop();
    this.input.clearPresses();
    this.accumulator = 0;
  }

  private applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    saveSettings(s);
    this.audio.setVolume(s.volume);
    if (qualityChanged) {
      this.applyQuality();
      this.applyShadowQuality();
      this.setupComposer();
      this.onResize();
    }
  }

  private applyQuality(): void {
    const cap = this.settings.quality === 'high' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  private applyShadowQuality(): void {
    if (!this.sun) return;
    const size = this.settings.quality === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  private setupComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bodyPass = null;
    if (this.settings.quality !== 'high') return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // HDR target with MSAA so bloom works on real highlights and edges stay anti-aliased.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.fp.camera));
    const bodyPass = new RenderPass(this.body.scene, this.body.camera);
    bodyPass.clear = false;
    bodyPass.clearDepth = true;
    composer.addPass(bodyPass);
    composer.addPass(new ShaderPass(SanitizeShader));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.6, 0.86));
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bodyPass = bodyPass;
  }

  private blurUi(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }

  private readonly onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.fp.setAspect(w / h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  };

  // ------------------------------------------------------------------ loop

  private frame(now: number): void {
    const rawDt = this.lastFrame < 0 ? 1 / 60 : (now - this.lastFrame) / 1000;
    const dt = Math.min(0.1, rawDt);
    this.lastFrame = now;
    this.checkPerformance(rawDt);
    this.elapsed += dt;
    const motion = motionScale(this.settings);
    const phase = this.run.phase;

    if (phase === 'playing' || phase === 'finished') {
      if (phase === 'playing') {
        const [mx, my] = this.input.takeMouse();
        this.fp.look(mx, my, this.settings.sensitivity, this.settings.invertY);
      }
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
        this.fixedStep(motion);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    // Respawn: once fully white, move the player and fade back in.
    if (this.respawnPending && this.hud.fadeOpacity >= 0.999) {
      this.respawnPending = false;
      this.teleportToCheckpoint();
      this.hud.fadeTo(0, 2.4);
    }

    if (phase === 'finished' && this.finishTimer > 0) {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0 && this.pendingFinish) {
        this.input.exitPointerLock();
        this.menu.showFinish(this.pendingFinish);
        this.pendingFinish = null;
      }
    }

    if (this.lockCheckTimer > 0) {
      this.lockCheckTimer -= dt;
      if (this.lockCheckTimer <= 0 && this.run.phase === 'playing' && !this.input.pointerLocked) {
        this.hud.showNotice('Click the game to capture the mouse', 5);
      }
    }

    if (phase === 'menu') {
      this.updateMenuCamera();
    } else {
      const alpha = phase === 'paused' ? 1 : this.accumulator / STEP;
      this.fp.update(phase === 'paused' ? 0 : dt, this.player, alpha, { fov: this.settings.fov, motion });
      this.renderPos.copy(this.player.prevPos).lerp(this.player.position, alpha);
      this.body.update(phase === 'paused' ? 0 : dt, this.player, this.fp.camera, this.renderPos, this.fp.yaw);
      this.updateHud(dt, motion);
      this.audio.updateLoops(
        phase === 'playing' ? this.player.horizontalSpeed : 0,
        this.player.mode === MoveMode.Air,
        phase === 'playing' && this.player.mode === MoveMode.Slide,
        phase === 'playing' && this.player.mode === MoveMode.Zipline ? this.player.zipSpeed : 0,
      );
    }

    this.hud.update(dt);
    this.level.update(this.elapsed);
    this.checkpoints.update(dt);
    this.sky.update(this.fp.camera.position, this.elapsed);
    this.updateSun();
    this.render(phase !== 'menu', dt);
  }

  /**
   * Measures real gameplay frame rate once (after shaders have warmed up). If it is well
   * below 60 fps on default settings, switch to Low quality and tell the player.
   */
  private checkPerformance(rawDt: number): void {
    if (!this.autoQuality || this.run.phase !== 'playing' || document.hidden || rawDt > 0.5) return;
    if (this.settings.quality !== 'high') {
      this.autoQuality = false;
      return;
    }
    this.perfTime += rawDt;
    this.perfFrames++;
    // Ignore the first second of play (shader compilation, pointer lock prompt).
    if (this.perfTime < 1) {
      this.perfFrames = 0;
      return;
    }
    if (this.perfTime < 5) return;
    const fps = this.perfFrames / (this.perfTime - 1);
    this.autoQuality = false;
    if (fps < 40) {
      this.applySettings({ ...this.settings, quality: 'low' });
      this.menu.syncSettings(this.settings);
      this.hud.showNotice('Graphics set to Low for a smoother frame rate (change it in Settings)', 5);
    }
  }

  private fixedStep(motion: number): void {
    const si = this.stepInput;
    if (this.run.phase === 'playing' && !this.respawnPending) {
      const [ax, az] = this.input.axes();
      si.moveX = ax;
      si.moveZ = az;
      si.sprint = az > 0 && (this.settings.autoSprint || this.input.isHeld('sprint'));
      si.jumpHeld = this.input.isHeld('jump');
      si.jumpPressed = this.input.consume('jump');
      si.crouchHeld = this.input.isHeld('crouch');
      si.crouchPressed = this.input.consume('crouch');
      si.interactPressed = this.input.consume('interact');
    } else {
      // Finished or mid-respawn: let the body coast to a stop with no input.
      si.moveX = 0;
      si.moveZ = 0;
      si.sprint = false;
      si.jumpHeld = false;
      si.jumpPressed = false;
      si.crouchHeld = false;
      si.crouchPressed = false;
      si.interactPressed = false;
    }
    si.yaw = this.fp.yaw;

    this.player.step(si, STEP);
    if (this.player.body.stepOffset !== 0) this.fp.absorbStep(this.player.body.stepOffset);
    for (const e of this.player.events) this.onPlayerEvent(e, motion);
    this.player.events.length = 0;

    if (this.run.phase !== 'playing') return;
    if (this.run.timerRunning) this.run.time += STEP;

    const p = this.player.position;
    this.centre.set(p.x, p.y + 0.9, p.z);
    const ev = this.checkpoints.check(this.centre);
    if (ev?.type === 'checkpoint') {
      const i = ev.index;
      this.run.splits[i] = this.run.time;
      const prev = this.bestSplits[i];
      this.hud.showCheckpoint(i, this.def.checkpoints.length, this.run.time, prev !== undefined ? this.run.time - prev : null);
      this.hud.setProgress(this.checkpoints.reached, this.def.checkpoints.length);
      this.audio.checkpoint();
    } else if (ev?.type === 'finish') {
      this.finish();
      return;
    }
    if (p.y < this.def.killY) this.beginRespawn();
  }

  private onPlayerEvent(e: PlayerEvent, motion: number): void {
    this.fp.onEvent(e, motion);
    switch (e.type) {
      case 'footstep':
        this.audio.footstep(e.intensity, e.metal, e.wall);
        break;
      case 'jump':
        this.audio.jump();
        break;
      case 'land':
        this.audio.land(e.impact, e.hard);
        break;
      case 'slideStart':
        this.audio.slideStart();
        break;
      case 'slideEnd':
        this.audio.slideStop();
        break;
      case 'wallRunStart':
        this.audio.wallRunStart();
        break;
      case 'wallJump':
        this.audio.wallJump();
        break;
      case 'vault':
        this.audio.vault();
        break;
      case 'mantle':
        this.audio.mantle();
        break;
      case 'zipAttach':
        this.audio.zipStart();
        break;
      case 'zipDetach':
        this.audio.zipStop();
        break;
      default:
        break;
    }
  }

  private updateHud(dt: number, motion: number): void {
    const playing = this.run.phase === 'playing';
    this.hud.setTime(this.run.time, this.best, this.run.timerRunning || this.run.time > 0);
    const speed = this.player.horizontalSpeed;
    this.hud.setSpeed(speed, PC.SPRINT_SPEED * 1.15);
    this.hud.setVignette(playing ? THREE.MathUtils.smoothstep(speed, 9.5, 16) * 0.85 * (0.3 + 0.7 * motion) : 0);

    let hint: string | null = null;
    if (playing && this.settings.hints) {
      const p = this.player.position;
      this.centre.set(p.x, p.y + 0.9, p.z);
      for (const h of this.def.hints) {
        if (inZone(h.zone, this.centre)) {
          hint = h.text;
          break;
        }
      }
    }
    this.hud.setHint(hint);

    this.promptTimer -= dt;
    if (this.promptTimer <= 0) {
      this.promptTimer = 0.08;
      this.hud.setPrompt(playing ? this.player.probePrompt(this.fp.yaw) : null);
    }
  }

  /** Slow cinematic drift over the start roof for the title screen. */
  private updateMenuCamera(): void {
    const t = this.elapsed;
    const cam = this.fp.camera;
    const sway = Math.sin(t * 0.12);
    cam.position.set(-30 + sway * 6, 58 + Math.sin(t * 0.09) * 1.5, 34 - sway * 3);
    cam.lookAt(18 + sway * 8, 34, -120);
    this.fp.currentFov = 84;
    this.fp.setAspect(cam.aspect);
  }

  /** Keeps the shadow frustum centred ahead of the camera, snapped to shadow-map texels. */
  private updateSun(): void {
    const cam = this.fp.camera;
    const dir = this.camDir;
    cam.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() > 1e-6) dir.normalize();
    this.focus.copy(cam.position).addScaledVector(dir, SHADOW_EXTENT * 0.45);
    if (this.run.phase === 'menu') this.focus.set(0, 40, -40);
    const texel = (2 * SHADOW_EXTENT) / this.sun.shadow.mapSize.x;
    const x = Math.round(this.focus.dot(this.lightRight) / texel) * texel;
    const y = Math.round(this.focus.dot(this.lightUp) / texel) * texel;
    const z = this.focus.dot(SUN_DIRECTION);
    this.focus.copy(this.lightRight).multiplyScalar(x).addScaledVector(this.lightUp, y).addScaledVector(SUN_DIRECTION, z);
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(SUN_DIRECTION, 200);
  }

  private render(withBody: boolean, dt: number): void {
    const r = this.renderer;
    r.info.reset();
    if (this.composer && this.bodyPass) {
      this.bodyPass.enabled = withBody;
      this.composer.render(dt);
      return;
    }
    r.setRenderTarget(null);
    r.clear();
    r.render(this.scene, this.fp.camera);
    if (withBody) {
      r.clearDepth();
      r.render(this.body.scene, this.body.camera);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.level.dispose();
    this.checkpoints.dispose();
    this.sky.dispose();
    this.body.dispose();
    this.materials.dispose();
    this.composer?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
