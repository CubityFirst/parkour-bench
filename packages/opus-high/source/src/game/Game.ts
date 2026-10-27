import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerBody } from '../player/PlayerBody';
import { EMPTY_INPUT, PlayerController, type InputSnapshot } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { Checkpoints } from '../world/Checkpoints';
import { CityGenerator } from '../world/CityGenerator';
import { Level, zoneContains } from '../world/Level';
import { Materials } from '../world/Materials';
import { Sky } from '../world/Sky';
import { GamePhase, RunState, loadBestTime, loadSettings, saveSettings, submitTime, type Settings } from './GameState';
import { Input } from './Input';

/** Physics runs at a fixed 120 Hz regardless of the display refresh rate. */
export const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 12;

/**
 * Top-level game object: owns the renderer, world, player and UI, and runs the
 * fixed-timestep simulation loop.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly materials: Materials;
  readonly level: Level;
  readonly city: CityGenerator;
  readonly checkpoints: Checkpoints;
  readonly sky: Sky;
  readonly player: PlayerController;
  readonly view: FirstPersonCamera;
  readonly body: PlayerBody;
  readonly audio = new AudioManager();
  readonly hud = new HUD();
  readonly menu: Menu;
  readonly input: Input;
  readonly run = new RunState();

  phase: GamePhase = GamePhase.Menu;
  settings: Settings;

  private clock = new THREE.Clock();
  private accumulator = 0;
  private elapsed = 0;
  private currentSection = 0;
  private lastCheckpointToast = -10;
  private pointerLocked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;

    this.sky = new Sky(this.scene, this.renderer, 2048);
    this.materials = new Materials();
    this.level = new Level(this.materials);
    this.scene.add(this.level.group);
    this.city = new CityGenerator(this.materials, this.level.footprints);
    this.scene.add(this.city.group);
    this.checkpoints = new Checkpoints(this.level);
    this.scene.add(this.checkpoints.group);

    this.view = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.body = new PlayerBody();
    this.scene.add(this.body.legs);

    this.player = new PlayerController(this.level.collision, {
      jump: (kind) => {
        this.audio.jump(kind);
        this.view.onJump();
      },
      land: (impact) => {
        if (impact > 2) this.audio.land(impact);
        this.view.onLand(impact);
      },
      footstep: (speed) => this.audio.footstep(speed),
      slideStart: () => {
        this.audio.slideStart();
        this.view.onSlideStart();
      },
      vault: () => {
        this.audio.vault();
        this.view.onVault();
      },
      mantle: () => {
        this.audio.mantle();
        this.view.onMantle();
      },
      wallRunStart: () => this.audio.wallRunStart(),
    });

    this.input = new Input(canvas);
    this.menu = new Menu(this.settings, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => {
        this.resume();
        this.respawn();
      },
      onRestartLevel: () => this.startRun(),
      onQuitToMenu: () => this.quitToMenu(),
      onSettingsChanged: (s) => this.applySettings(s),
      onClick: () => this.audio.click(),
    });
    this.applySettings(this.settings);
    this.menu.setBest(loadBestTime());

    this.resetPlayer(0);
    this.bindEvents();
    this.precompile();
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  private bindEvents(): void {
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked && this.phase === GamePhase.Playing) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      // Browsers refuse re-locking right after Esc; fall back to the pause menu.
      if (this.phase === GamePhase.Playing && !this.pointerLocked) this.pause();
    });
    this.canvas.addEventListener('click', () => {
      if (this.phase === GamePhase.Playing && !this.pointerLocked) this.lockPointer();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || this.phase !== GamePhase.Playing) return;
      // Browsers normally release pointer lock on Esc themselves (which pauses via
      // pointerlockchange); this covers the cases where they do not.
      if (this.pointerLocked) document.exitPointerLock();
      this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === GamePhase.Playing) this.pause();
    });
    // Guard against Ctrl+W (slide + forward) closing the tab mid-run.
    window.addEventListener('beforeunload', (e) => {
      if (this.phase === GamePhase.Playing || this.phase === GamePhase.Paused) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /** Compiles shaders up front so the first frames of a run do not hitch. */
  private precompile(): void {
    this.view.updateMenu(0, this.level.checkpoints[0].spawn);
    this.renderer.compile(this.scene, this.view.camera);
    this.renderer.compile(this.body.overlayScene, this.body.overlayCamera);
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.view.sensitivity = s.sensitivity;
    this.view.motion = s.motion;
    this.body.motion = s.motion;
    this.audio.setVolume(s.volume);
    saveSettings(s);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.view.resize(w / h);
  }

  private lockPointer(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* pointer lock unavailable (e.g. embedded or headless) */
    }
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  startRun(): void {
    this.audio.init();
    this.audio.setPaused(false);
    this.checkpoints.reset();
    this.run.reset();
    this.hud.reset();
    this.resetPlayer(0);
    this.currentSection = 0;
    this.phase = GamePhase.Playing;
    this.menu.show('none');
    this.hud.show(true);
    this.input.clear();
    this.input.enabled = true;
    this.accumulator = 0;
    this.lockPointer();
  }

  pause(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.phase = GamePhase.Paused;
    this.input.enabled = false;
    this.input.clear();
    this.audio.setPaused(true);
    this.menu.show('pause');
  }

  resume(): void {
    if (this.phase !== GamePhase.Paused) return;
    this.phase = GamePhase.Playing;
    this.menu.show('none');
    this.input.clear();
    this.input.enabled = true;
    this.audio.setPaused(false);
    this.accumulator = 0;
    this.lockPointer();
  }

  quitToMenu(): void {
    this.phase = GamePhase.Menu;
    this.input.enabled = false;
    this.input.clear();
    this.audio.setPaused(true);
    this.hud.show(false);
    this.menu.setBest(loadBestTime());
    this.menu.show('menu');
    if (document.pointerLockElement) document.exitPointerLock();
    this.resetPlayer(0);
  }

  private finish(): void {
    this.run.finished = true;
    this.phase = GamePhase.Finished;
    this.input.enabled = false;
    this.input.clear();
    this.audio.setPaused(true);
    this.audio.finish();
    const record = submitTime(this.run.time);
    this.hud.show(false);
    this.menu.showFinish(this.run.time, loadBestTime(), record, this.run.respawns);
    this.menu.setBest(loadBestTime());
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private resetPlayer(checkpointIndex: number): void {
    const cp = this.level.checkpoints[checkpointIndex];
    this.player.reset(cp.spawn, cp.yaw);
    this.view.setOrientation(cp.yaw, 0);
  }

  /** Respawn at the latest checkpoint with all movement state cleared. */
  respawn(): void {
    this.resetPlayer(this.checkpoints.current);
    this.run.respawns++;
    this.hud.flashWhite();
    this.audio.respawn();
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  /** One fixed physics step. Exposed so automated tests can drive the game. */
  step(dt: number, input: InputSnapshot): void {
    if (!this.run.started && (input.forward !== 0 || input.right !== 0 || input.jumpPressed)) this.run.started = true;
    this.player.fixedUpdate(dt, input, this.view.yaw);
    if (this.run.started && !this.run.finished) this.run.time += dt;

    const pos = this.player.position;
    const cp = this.checkpoints.check(pos);
    if (cp) {
      this.hud.showToast('CHECKPOINT', cp.label);
      this.audio.checkpoint();
      this.lastCheckpointToast = this.elapsed;
    }
    if (!this.run.finished && this.checkpoints.reachedFinish(pos)) {
      this.finish();
      return;
    }
    if (pos.y < this.level.killY) this.respawn();
  }

  private updateZones(): void {
    const pos = this.player.position;
    let hint: string | null = null;
    for (const h of this.level.hints) {
      if (zoneContains(h.zone, pos)) {
        hint = h.text;
        break;
      }
    }
    this.hud.setHint(hint);

    for (const s of this.level.sections) {
      if (zoneContains(s.zone, pos)) {
        if (s.index !== this.currentSection) {
          const first = s.index > this.currentSection;
          this.currentSection = s.index;
          this.hud.setSection(s.index, s.title);
          if (first && s.index > 1 && this.elapsed - this.lastCheckpointToast > 1.5) {
            this.hud.showToast(s.title, `SECTION ${String(s.index).padStart(2, '0')}`);
          }
        }
        break;
      }
    }
    this.hud.setProgress(-pos.z / this.level.routeLength);
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  start(): void {
    this.menu.hideLoading();
    this.menu.show('menu');
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;

    if (this.phase === GamePhase.Playing) {
      const [mx, my] = this.input.takeMouseDelta();
      this.view.look(mx, my);
      if (this.input.consume('KeyR')) this.respawn();

      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.step(FIXED_DT, this.input.snapshot());
        this.accumulator -= FIXED_DT;
        steps++;
        if (this.phase !== GamePhase.Playing) break;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.updateZones();
    }

    const alpha = this.phase === GamePhase.Playing ? this.accumulator / FIXED_DT : 1;
    if (this.phase === GamePhase.Menu) {
      this.view.updateMenu(this.elapsed, this.level.checkpoints[0].spawn);
    } else {
      this.view.update(dt, this.player, alpha);
    }
    this.body.legs.visible = this.phase !== GamePhase.Menu;
    this.body.update(dt, this.player, this.view.camera, alpha);
    this.checkpoints.update(dt);
    this.sky.update(this.elapsed, this.view.camera.position, this.player.position);

    if (this.phase === GamePhase.Playing) {
      const speed = this.player.horizontalSpeed;
      this.audio.updateMovement(speed, this.player.sliding, !this.player.grounded);
      const motion = this.settings.motion === 'full' ? 1 : this.settings.motion === 'reduced' ? 0.5 : 0;
      this.hud.setSpeed(speed, Math.max(0, Math.min(1, (speed - 10) / 5)) * 0.8 * motion);
      this.hud.setTime(this.run.time);
    }
    this.hud.update(dt);

    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.view.camera);
    if (this.phase !== GamePhase.Menu) {
      this.renderer.clearDepth();
      this.renderer.render(this.body.overlayScene, this.body.overlayCamera);
    }
  }

  // ---------------------------------------------------------------------------
  // Test hooks
  // ---------------------------------------------------------------------------

  /** Runs `steps` physics steps with a fixed input (used by automated route tests). */
  simulate(input: Partial<InputSnapshot>, steps: number, yaw?: number): void {
    if (yaw !== undefined) this.view.yaw = yaw;
    for (let i = 0; i < steps; i++) {
      this.step(FIXED_DT, { ...EMPTY_INPUT, ...input });
      if (i === 0) input = { ...input, jumpPressed: false, slidePressed: false, vaultPressed: false };
    }
  }
}
