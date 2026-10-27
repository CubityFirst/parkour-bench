import {
  ACESFilmicToneMapping, Color, DirectionalLight, Fog, HemisphereLight, PCFShadowMap, Scene,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { AudioManager } from '../audio/AudioManager';
import { PHYS } from '../config';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerBody } from '../player/PlayerBody';
import { PlayerController } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { generateCity } from '../world/CityGenerator';
import { pointInTrigger } from '../world/CollisionWorld';
import { Level } from '../world/Level';
import { createMaterials } from '../world/Materials';
import { createSky, SUN_DIR } from '../world/Sky';
import { GameState } from './GameState';
import { Input } from './Input';

/**
 * Owns the renderer, scene and main loop. Simulation runs at a fixed 120 Hz;
 * rendering interpolates between the last two simulation states.
 */
export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly state = new GameState();
  readonly input: Input;
  readonly level: Level;
  readonly player: PlayerController;
  readonly fpCam: FirstPersonCamera;
  readonly audio = new AudioManager();
  private body: PlayerBody;
  private hud: HUD;
  private menu: Menu;
  private sun: DirectionalLight;
  private accumulator = 0;
  private lastTime = performance.now();
  private respawnFlash = 0;
  /** Allow automation/tests to drive the sim without pointer lock. */
  autopilot = false;
  /** When true the rAF loop stops ticking; tests call tick() themselves. */
  manualClock = false;
  /** Tests can disable rendering to fast-forward the simulation. */
  renderEnabled = true;

  constructor(container: HTMLElement) {
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    container.append(renderer.domElement);
    this.renderer = renderer;

    // ---- Environment
    const sky = createSky(renderer);
    this.scene.add(sky.group);
    this.scene.environment = sky.envMap;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new Color(0xcfe3f3);
    this.scene.fog = new Fog(0xcfe2f1, 110, 820);

    const hemi = new HemisphereLight(0xcfe6ff, 0xf1ece4, 0.9);
    this.scene.add(hemi);
    const sun = new DirectionalLight(0xfff3e0, 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 10; sc.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // ---- World
    const mats = createMaterials(renderer);
    this.level = new Level(mats);
    this.scene.add(this.level.group);
    this.scene.add(generateCity(mats, this.level.routeBounds, this.level.world));

    // ---- Player
    this.input = new Input(renderer.domElement);
    this.player = new PlayerController(this.level.world, this.input);
    this.fpCam = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.scene.add(this.fpCam.camera);
    this.body = new PlayerBody(this.fpCam.camera);
    this.bindPlayerEvents();
    const s = this.level.spawn;
    this.player.respawn(s.x, s.y, s.z, s.yaw);

    // ---- UI
    this.hud = new HUD(container);
    this.menu = new Menu(container, this.state.settings, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => { this.respawnAtCheckpoint(); this.resume(); },
      onRestartLevel: () => this.startRun(),
      onMainMenu: () => this.toMainMenu(),
      onSettingsChanged: () => { this.applySettings(); this.state.saveSettings(); },
      onClick: () => this.audio.uiClick(),
    });
    this.applySettings();
    this.menu.showMain(this.state.best);

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    renderer.domElement.addEventListener('click', () => {
      if (this.state.phase === 'playing' && !this.isLocked()) this.lockPointer();
    });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', (e) => {
      // Fallback pause key when pointer lock isn't active (Esc normally exits the lock itself).
      if (e.code === 'KeyP' && this.state.phase === 'playing') this.pause();
    });
    requestAnimationFrame(this.frame);
  }

  private bindPlayerEvents(): void {
    const a = this.audio, cam = this.fpCam;
    this.player.events = {
      onJump: () => { a.jump(); cam.jump(); },
      onLand: (impact) => { if (impact > 2) { a.land(impact); cam.land(impact); } },
      onFootstep: (sp) => a.footstep(sp),
      onSlideStart: () => a.land(4),
      onWallRunStart: () => a.wallRun(),
      onWallJump: () => a.jump(),
      onVault: () => a.vault(),
      onMantle: () => a.vault(),
    };
  }

  private applySettings(): void {
    const s = this.state.settings;
    this.fpCam.sensitivity = s.sensitivity;
    this.fpCam.reducedMotion = s.reducedMotion;
    this.audio.setVolume(s.volume);
  }

  // ---------------------------------------------------------------- flow

  private isLocked(): boolean { return document.pointerLockElement === this.renderer.domElement; }

  private lockPointer(): void {
    const el = this.renderer.domElement as HTMLCanvasElement & { requestPointerLock(o?: unknown): Promise<void> | void };
    try {
      const p = el.requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => { if (this.state.phase === 'playing') this.menu.showResumeHint(); });
      }
    } catch { this.menu.showResumeHint(); }
  }

  startRun(): void {
    this.audio.init();
    this.audio.resume();
    this.level.checkpoints.reset();
    const s = this.level.spawn;
    this.player.respawn(s.x, s.y, s.z, s.yaw);
    this.fpCam.resetEffects();
    this.state.time = 0;
    this.state.phase = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.menu.hide();
    this.hud.show(true);
    this.hud.showToast('GO', 'Reach the red finish gate');
    this.accumulator = 0;
    if (!this.autopilot) this.lockPointer();
  }

  private resume(): void {
    if (this.state.phase !== 'paused' && this.state.phase !== 'playing') return;
    this.audio.resume();
    this.state.phase = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.menu.hide();
    this.hud.show(true);
    this.lastTime = performance.now();
    if (!this.autopilot) this.lockPointer();
  }

  private pause(): void {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.audio.update(0, false, false);
    this.menu.showPause();
    if (this.isLocked()) document.exitPointerLock();
  }

  private toMainMenu(): void {
    this.state.phase = 'menu';
    this.input.enabled = false;
    this.hud.show(false);
    this.audio.update(0, false, false);
    if (this.isLocked()) document.exitPointerLock();
    this.menu.showMain(this.state.best);
  }

  private finishRun(): void {
    this.state.phase = 'finished';
    this.input.enabled = false;
    this.input.reset();
    const t = this.state.time;
    const isNew = this.state.submitTime(t);
    this.audio.finish();
    this.audio.update(0, false, false);
    if (this.isLocked()) document.exitPointerLock();
    this.hud.show(false);
    this.menu.showFinish(t, this.state.best, isNew);
  }

  respawnAtCheckpoint(): void {
    const r = this.level.checkpoints.respawn;
    this.player.respawn(r.x, r.y, r.z, r.yaw);
    this.fpCam.resetEffects();
    this.hud.flash();
    this.audio.respawn();
    this.respawnFlash = 0.3;
  }

  private onPointerLockChange = () => {
    if (!this.isLocked() && this.state.phase === 'playing' && !this.autopilot) this.pause();
  };

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.fpCam.camera.aspect = w / h;
    this.fpCam.camera.updateProjectionMatrix();
  };

  // ---------------------------------------------------------------- loop

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.manualClock) this.tick(dt);
  };

  /** Advance one rendered frame (public for automated testing). */
  tick(dt: number): void {
    const playing = this.state.phase === 'playing';
    if (playing) {
      const m = this.input.takeMouse();
      this.fpCam.applyMouse(this.player, m.dx, m.dy);
      this.accumulator += dt;
      const fixed = PHYS.fixedDt;
      let steps = 0;
      while (this.accumulator >= fixed && steps < 24) {
        this.simStep(fixed);
        this.accumulator -= fixed;
        steps++;
        if (this.state.phase !== 'playing') break;
      }
      if (steps >= 24) this.accumulator = 0;
    }

    const alpha = playing ? this.accumulator / PHYS.fixedDt : 1;
    this.fpCam.update(this.player, Math.min(1, alpha), dt);
    this.body.update(this.player, dt, this.state.settings.reducedMotion);
    this.updateSun();

    if (playing) {
      const p = this.player;
      const pos = p.body.position;
      this.hud.setTime(this.state.time, this.state.best);
      this.hud.setHint(this.level.hintAt(pos.x, pos.y, pos.z), dt);
      this.hud.setAction(this.actionPrompt());
      this.hud.setSpeed(p.speed / PHYS.slideMaxSpeed);
      this.audio.update(p.speed, p.state === 'slide', p.state === 'air' || p.state === 'wallrun');
    }
    this.hud.update(dt);
    if (this.respawnFlash > 0) this.respawnFlash -= dt;

    if (this.renderEnabled) this.renderer.render(this.scene, this.fpCam.camera);
  }

  private actionPrompt(): string | null {
    const p = this.player;
    if (p.state === 'wallrun') return '<kbd>SPACE</kbd>WALL JUMP';
    if (p.state === 'slide') return '<kbd>SPACE</kbd>JUMP OUT';
    if (p.canVault) return '<kbd>E</kbd>VAULT';
    return null;
  }

  private simStep(dt: number): void {
    if (this.input.consume('restart')) { this.respawnAtCheckpoint(); return; }
    this.player.step(dt);
    this.state.time += dt;

    const pos = this.player.body.position;
    if (pos.y < PHYS.killY) {
      this.respawnAtCheckpoint();
      return;
    }
    const cp = this.level.checkpoints.update(pos.x, pos.y + 0.5, pos.z);
    if (cp) {
      this.hud.showToast('CHECKPOINT', cp.name);
      this.audio.checkpoint();
    }
    if (pointInTrigger(this.level.finish, pos.x, pos.y + 0.5, pos.z)) this.finishRun();
  }

  private sunTarget = new Vector3();
  private updateSun(): void {
    // Keep the shadow frustum centred on the player, snapped to texels to avoid shimmering.
    const p = this.player.body.position;
    const texel = 110 / 2048;
    this.sunTarget.set(Math.round(p.x / texel) * texel, Math.round(p.y / texel) * texel, Math.round(p.z / texel) * texel);
    this.sun.target.position.copy(this.sunTarget);
    this.sun.position.copy(this.sunTarget).addScaledVector(SUN_DIR, 150);
    this.sun.target.updateMatrixWorld();
  }
}
