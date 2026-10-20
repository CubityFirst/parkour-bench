import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager.ts';
import { FIXED_DT, MAX_STEPS_PER_FRAME, PLAYER } from '../config.ts';
import { Autopilot } from '../debug/Autopilot.ts';
import { Input } from '../input/Input.ts';
import { FirstPersonCamera } from '../player/FirstPersonCamera.ts';
import { PlayerController, createInput } from '../player/PlayerController.ts';
import { PlayerBodyView } from '../player/PlayerBody.ts';
import { RenderPipeline } from '../render/RenderPipeline.ts';
import type { Quality } from '../render/RenderPipeline.ts';
import { HUD } from '../ui/HUD.ts';
import { Menu } from '../ui/Menu.ts';
import { Checkpoints } from '../world/Checkpoints.ts';
import { CityGenerator } from '../world/CityGenerator.ts';
import type { HintDef, SectionDef } from '../world/LevelBuilder.ts';
import { Level } from '../world/Level.ts';
import { SUN_DIRECTION, Sky } from '../world/Sky.ts';
import { RunState, formatTime } from './GameState.ts';
import type { GamePhase } from './GameState.ts';
import { Settings } from './Settings.ts';

type RespawnStage = 'out' | 'in' | null;

const inside = (a: { min: number[]; max: number[] }, x: number, y: number, z: number, h: number): boolean => {
  const hw = PLAYER.halfWidth;
  return x + hw > a.min[0]! && x - hw < a.max[0]! && y + h > a.min[1]! && y < a.max[1]! && z + hw > a.min[2]! && z - hw < a.max[2]!;
};

/**
 * Top-level game: owns every subsystem, the fixed-timestep loop and the menu / pause / finish flow.
 *
 * The simulation (PlayerController) runs at a fixed 120 Hz independent of the display rate; the camera
 * renders the interpolated state, so movement feels identical at 30, 60 or 240 FPS.
 */
export class Game {
  phase: GamePhase = 'loading';

  private readonly settings = new Settings();
  private readonly pipeline: RenderPipeline;
  private readonly sky = new Sky();
  private readonly level: Level;
  private readonly city: CityGenerator;
  private readonly checkpoints: Checkpoints;
  private readonly player: PlayerController;
  private readonly fpCamera: FirstPersonCamera;
  private readonly bodyView = new PlayerBodyView();
  private readonly input: Input;
  private readonly hud = new HUD();
  private readonly audio = new AudioManager();
  private readonly menu: Menu;
  private readonly run = new RunState();

  private readonly playerInput = createInput();
  private readonly look = { dx: 0, dy: 0 };
  private accumulator = 0;
  private lastTime = 0;
  private clock = 0;
  private menuTime = 0;
  private rafId = 0;
  private disposed = false;

  /** Debug-only slow-motion factor (?debug API) for capturing fleeting moves in screenshots. */
  private timeScale = 1;
  /** Debug-only autopilot (?debug API) that drives the real controller along the route nodes. */
  private autopilot: Autopilot | null = null;
  /** Debug-only fly camera (set through the ?debug API) that bypasses the simulation. */
  private freeCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;
  private respawnStage: RespawnStage = null;
  private respawnTimer = 0;
  private finishTimer = 0;
  private pausedAt = 0;
  private shadeTimer = 0;

  // Hints / sections
  private readonly shownHints = new Set<string>();
  private activeHint: { def: HintDef; until: number } | null = null;
  private currentSection = 0;

  // Performance governor
  private frameMsEma = 16;
  private govTimer = 0;
  private qualityLevel: Quality;
  private playTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.pipeline = new RenderPipeline(canvas);
    this.pipeline.scene.add(this.sky.mesh);

    this.level = new Level();
    this.pipeline.scene.add(this.level.group);
    this.city = new CityGenerator(this.level.layout, this.level.materials);
    this.pipeline.scene.add(this.city.group);
    this.checkpoints = new Checkpoints(this.level.layout);
    this.pipeline.scene.add(this.checkpoints.group);

    this.player = new PlayerController(this.level.world);
    this.fpCamera = new FirstPersonCamera(this.pipeline.camera);
    this.pipeline.viewScene.add(this.bodyView.group);

    this.input = new Input(canvas);
    this.qualityLevel = this.settings.data.quality;
    this.menu = new Menu(this.settings, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => {
        this.resume();
        this.beginRespawn('restart');
      },
      onRestartLevel: () => this.startRun(),
      onQuitToMenu: () => this.quitToMenu(),
      onUiClick: () => this.audio.click(),
    });
    this.menu.setBest(this.run.best);

    this.wireEvents();
    this.applySettings();
    this.settings.onChange(() => this.applySettings());
    this.resize();
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.pipeline.setEnvironment(this.sky.buildEnvironment(this.pipeline.renderer));
    this.pipeline.setQuality(this.qualityLevel);

    // Put the player on the start roof so the menu backdrop and first frame are valid.
    const s = this.level.layout.start;
    this.player.reset(s.x, s.y, s.z);
    this.fpCamera.snapTo(this.player, s.yaw, 0);

    this.installDebugApi();
  }

  // ==========================================================================================
  // Lifecycle
  // ==========================================================================================

  /** Compile shaders behind the loading screen, then show the menu. */
  async boot(): Promise<void> {
    const { renderer, scene, viewScene, camera } = this.pipeline;
    try {
      await renderer.compileAsync(scene, camera);
      await renderer.compileAsync(viewScene, camera);
    } catch {
      /* compileAsync is only an optimisation */
    }
    this.updateMenuCamera();
    this.pipeline.render();
    this.phase = 'menu';
    this.menu.show('menu');
    document.getElementById('loading')?.classList.add('done');
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.level.dispose();
    this.city.dispose();
    this.checkpoints.dispose();
    this.sky.dispose();
    this.bodyView.dispose();
    this.pipeline.dispose();
  }

  private wireEvents(): void {
    const ev = this.player.events;
    ev.on('jump', (p) => {
      this.audio.jump(p.kind);
      this.fpCamera.onJump();
    });
    ev.on('land', (p) => {
      this.audio.land(p.impact, p.rolled);
      this.fpCamera.onLand(p.impact);
    });
    ev.on('step', (p) => this.audio.footstep(p.sprint, p.speed, p.wall));
    ev.on('slideStart', () => this.audio.slideStart());
    ev.on('wallRunStart', () => this.audio.wallRunStart());
    ev.on('scriptedStart', (p) => (p.kind === 'vault' ? this.audio.vault() : this.audio.mantle()));
    ev.on('bump', (p) => {
      this.audio.bump();
      this.fpCamera.onBump(p.speedLost);
    });

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.hud.setLockHint(false);
      } else if (this.phase === 'playing' && this.input.everLocked && !this.input.lockFailed) {
        this.pause();
      } else if (this.phase === 'playing') {
        this.hud.setLockHint(true);
      }
    };
    // Browsers normally swallow Esc while the pointer is locked (the lock-change event pauses us). If the
    // key does reach the page, pause here too; the 300 ms guard prevents a pause+resume double toggle.
    this.input.onEscape = () => {
      if (this.phase === 'playing') this.pause();
      else if (this.phase === 'paused' && performance.now() - this.pausedAt > 300) this.resume();
    };
    this.input.onRestartPressed = () => {
      if (this.phase === 'playing') this.beginRespawn('restart');
    };
  }

  private readonly onVisibility = (): void => {
    if (document.hidden && this.phase === 'playing') this.pause();
  };

  private readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pipeline.resize(w, h);
    this.fpCamera.setAspect(w / h);
    this.pipeline.camera.updateProjectionMatrix();
  };

  private applySettings(): void {
    const d = this.settings.data;
    this.fpCamera.settings.sensitivity = d.sensitivity;
    this.fpCamera.settings.hfov = d.fov;
    this.fpCamera.settings.motion = d.motion;
    this.audio.setVolume(d.volume);
    if (d.quality !== this.qualityLevel) {
      this.qualityLevel = d.quality;
      this.pipeline.setQuality(d.quality);
      this.frameMsEma = 16;
    }
  }

  // ==========================================================================================
  // Phase transitions
  // ==========================================================================================

  private startRun(): void {
    this.audio.init();
    this.audio.resume();
    this.run.reset();
    this.checkpoints.reset();
    this.shownHints.clear();
    this.activeHint = null;
    this.currentSection = 0;
    this.respawnStage = null;
    this.hud.fade(0, 0);
    this.hud.resetTransient();
    const s = this.checkpoints.respawn();
    this.player.reset(s.x, s.y, s.z);
    this.fpCamera.snapTo(this.player, s.yaw, 0);
    this.accumulator = 0;
    this.playTime = 0;
    this.menu.hideAll();
    this.hud.show();
    this.hud.setTimer(0);
    this.phase = 'playing';
    this.input.enabled = true;
    this.input.releaseAll();
    this.input.requestLock();
    this.hud.setLockHint(false);
    this.updateDynamicHud();
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.pausedAt = performance.now();
    this.input.releaseAll();
    this.input.enabled = false;
    this.input.exitLock();
    this.audio.suspend();
    this.hud.setLockHint(false);
    this.hud.hide();
    this.menu.show('pause');
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.menu.hideAll();
    this.hud.show();
    this.input.enabled = true;
    this.input.releaseAll();
    this.input.requestLock();
    this.audio.resume();
    this.lastTime = performance.now();
  }

  private quitToMenu(): void {
    this.phase = 'menu';
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.hud.hide();
    this.hud.fade(0, 0);
    this.audio.resume();
    this.menu.setBest(this.run.best);
    this.menu.show('menu');
    const s = this.level.layout.start;
    this.player.reset(s.x, s.y, s.z);
    this.fpCamera.snapTo(this.player, s.yaw, 0);
  }

  private completeLevel(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'finished';
    this.finishTimer = 0;
    this.input.releaseAll();
    this.input.enabled = false;
    this.pendingIsBest = this.run.complete();
    this.audio.finish();
    this.hud.setHint(null, null);
    this.hud.toast('LEVEL COMPLETE', formatTime(this.run.elapsed), 4000);
  }
  private pendingIsBest = false;

  // ==========================================================================================
  // Respawn
  // ==========================================================================================

  private respawnReason: 'fall' | 'restart' = 'fall';

  private beginRespawn(reason: 'fall' | 'restart'): void {
    if (this.respawnStage || this.phase !== 'playing') return;
    if (reason === 'fall') this.run.falls++;
    this.respawnReason = reason;
    this.respawnStage = 'out';
    this.respawnTimer = 0;
    this.hud.fade(1, 140);
    this.audio.respawn();
  }

  private doRespawn(): void {
    // With no checkpoint reached yet, a manual restart is a clean restart: the clock goes back to zero.
    if (this.respawnReason === 'restart' && this.checkpoints.current === 0) {
      this.run.reset();
      this.shownHints.clear();
      this.currentSection = 0;
      this.hud.setTimer(0);
    }
    const r = this.checkpoints.respawn();
    this.player.reset(r.x, r.y, r.z);
    this.fpCamera.snapTo(this.player, r.yaw, 0);
    this.accumulator = 0;
    this.activeHint = null;
    this.hud.setHint(null, null);
    this.input.releaseAll();
    if (this.autopilot) {
      const route = this.level.layout.route;
      const idx = r.id === 0 ? 0 : route.findIndex((n) => n.label === `cp${r.id}`) + 1;
      this.autopilot.start(r.x, r.z, r.yaw, idx);
    }
  }

  // ==========================================================================================
  // Main loop
  // ==========================================================================================

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1) * this.timeScale;
    this.clock += dt;

    if (this.freeCam) {
      const f = this.freeCam;
      const cam = this.pipeline.camera;
      cam.position.set(f.x, f.y, f.z);
      cam.quaternion.setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
      this.fpCamera.syncFov();
      this.bodyView.enabled = false;
      this.bodyView.group.visible = false;
      this.sky.update(cam.position, this.clock);
      this.level.update(this.clock);
      this.checkpoints.update(dt, -9999, -9999, -9999, 1);
      this.pipeline.render();
      return;
    }

    switch (this.phase) {
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'finished':
        this.updateFinished(dt);
        break;
      case 'menu':
      case 'loading':
        this.menuTime += dt;
        this.updateMenuCamera();
        this.audio.update(dt, { speed: 0, grounded: true, sliding: false, wallrun: false, scripted: false, active: false });
        break;
      case 'paused':
        this.fpCamera.update(0, 1, this.player);
        break;
    }

    this.sky.update(this.pipeline.camera.position, this.clock);
    this.level.update(this.clock);
    this.pipeline.render();
  };

  private updatePlaying(dt: number): void {
    this.playTime += dt;
    // --- look (applied first so this frame's physics ticks use the freshest yaw) ---
    this.input.consumeLook(this.look, dt);
    this.fpCamera.applyLook(this.look.dx, this.look.dy);

    // --- fixed-step simulation ---
    this.input.readHeld(this.playerInput);
    if (this.respawnStage) {
      // Controls are frozen while the white flash covers the screen.
      this.playerInput.moveX = this.playerInput.moveY = 0;
      this.playerInput.sprint = this.playerInput.jumpHeld = this.playerInput.slideHeld = false;
    }
    this.accumulator += dt;
    let steps = 0;
    let first = true;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      if (this.autopilot) {
        this.autopilot.update(this.player, this.playerInput, FIXED_DT);
        this.fpCamera.yaw = this.playerInput.yaw;
        first = false;
      } else if (first) {
        this.playerInput.yaw = this.fpCamera.yaw;
        // Edge presses are delivered on the first tick of the frame only.
        this.input.consumePresses(this.playerInput);
        first = false;
      } else {
        this.playerInput.yaw = this.fpCamera.yaw;
        this.playerInput.jumpPressed = this.playerInput.slidePressed = this.playerInput.vaultPressed = false;
      }
      if (this.respawnStage) this.playerInput.jumpPressed = this.playerInput.slidePressed = this.playerInput.vaultPressed = false;
      this.player.update(FIXED_DT, this.playerInput);
      this.fpCamera.capture(this.player);
      this.afterTick(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
      // The level may have just been completed: stop the clock on exactly this tick.
      if (this.phase !== 'playing') break;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    const alpha = this.accumulator / FIXED_DT;

    // --- respawn state machine ---
    if (this.respawnStage) {
      this.respawnTimer += dt;
      if (this.respawnStage === 'out' && this.respawnTimer > 0.17) {
        this.doRespawn();
        this.respawnStage = 'in';
        this.respawnTimer = 0;
        this.hud.fade(0, 420);
      } else if (this.respawnStage === 'in' && this.respawnTimer > 0.2) {
        this.respawnStage = null;
      }
    }

    // --- camera + view model ---
    this.fpCamera.update(dt, alpha, this.player);
    this.updateBodyView(dt);

    this.updateDynamicHud();
    this.updateAudio(dt);
    this.updateGovernor(dt);
  }

  private afterTick(dt: number): void {
    if (this.phase !== 'playing') return;
    const b = this.player.body;
    if (!this.run.started && (this.input.anyMovementHeld() || b.horizontalSpeed > 0.6 || b.y < this.level.layout.start.y - 0.5)) {
      this.run.started = true;
    }
    if (this.run.started) this.run.elapsed += dt;

    if (this.respawnStage) return;

    const reached = this.checkpoints.update(dt, b.x, b.y, b.z, b.height);
    if (reached) {
      this.audio.checkpoint();
      this.hud.toast(reached.name, formatTime(this.run.elapsed), 2400);
    }
    if (b.y < this.checkpoints.killY) {
      this.beginRespawn('fall');
      return;
    }
    if (this.checkpoints.finishReached(b.x, b.y, b.z, b.height)) this.completeLevel();
  }

  private updateFinished(dt: number): void {
    this.finishTimer += dt;
    // Slow-motion run-out after crossing the line.
    const slow = dt * 0.28;
    this.playerInput.moveX = 0;
    this.playerInput.moveY = this.finishTimer < 1.3 ? 1 : 0;
    this.playerInput.sprint = false;
    this.playerInput.jumpHeld = this.playerInput.slideHeld = false;
    this.playerInput.jumpPressed = this.playerInput.slidePressed = this.playerInput.vaultPressed = false;
    this.playerInput.yaw = this.fpCamera.yaw;
    this.accumulator += slow;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 4) {
      this.player.update(FIXED_DT, this.playerInput);
      this.fpCamera.capture(this.player);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    this.fpCamera.update(dt, this.accumulator / FIXED_DT, this.player);
    this.updateBodyView(dt);
    this.updateAudio(dt);
    if (this.finishTimer > 1.6 && this.menu.visible !== 'finish') {
      this.input.exitLock();
      this.hud.hide();
      this.menu.showFinish(this.run.elapsed, this.run.best ?? this.run.elapsed, this.run.falls, this.pendingIsBest);
    }
  }

  private updateBodyView(dt: number): void {
    const cam = this.fpCamera;
    this.bodyView.enabled = true;
    this.bodyView.update(dt, cam.camera, cam.feetPosition, cam.yaw, this.player);
    // Dim the arms when the player is standing in shadow.
    this.shadeTimer -= dt;
    if (this.shadeTimer <= 0) {
      this.shadeTimer = 0.15;
      const p = cam.camera.position;
      const hit = this.level.world.raycast(p.x, p.y, p.z, SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z, 160, this.rayScratch);
      this.shadeTarget = hit ? 1 : 0;
    }
    this.shadeValue += (this.shadeTarget - this.shadeValue) * (1 - Math.exp(-dt * 6));
    this.bodyView.setShade(this.shadeValue);
    this.pipeline.viewSun.intensity = 2.7 * this.bodyView.sunScale;
  }
  private readonly rayScratch = { collider: null, t: 0, tExit: 0, nx: 0, ny: 0, nz: 0 };
  private shadeTarget = 0;
  private shadeValue = 0;

  // ==========================================================================================
  // HUD / audio / governor
  // ==========================================================================================

  private updateDynamicHud(): void {
    const b = this.player.body;
    this.hud.setTimer(this.run.elapsed);
    this.hud.setSpeed(b.horizontalSpeed, this.player.flow);
    const sp = Math.min(1, Math.max(0, (b.horizontalSpeed - 7.4) / 3.4));
    this.hud.setSpeedFx(sp * sp * (3 - 2 * sp) * 0.85 * this.settings.data.motion);

    // Contextual hint priority: live move prompt > scripted level hints.
    const ledge = this.player.ledgeHint;
    this.hud.setCrosshairActive(ledge !== null && this.player.state !== 'scripted');
    if (ledge && this.player.state !== 'wallrun' && this.player.state !== 'scripted') {
      this.hud.setHint(['E'], ledge === 'vault' ? 'Vault' : 'Climb', true);
      return;
    }

    // Section label + level hints.
    const layout = this.level.layout;
    for (const sec of layout.sections as SectionDef[]) {
      if (sec.index !== this.currentSection && inside(sec.trigger, b.x, b.y, b.z, b.height)) {
        // Prefer the later section when zones overlap at a boundary.
        if (sec.index > this.currentSection || this.currentSection === 0) {
          this.currentSection = sec.index;
          this.hud.setSection(sec.index, sec.name);
        }
      }
    }
    const now = this.clock;
    if (!this.activeHint) {
      for (const h of layout.hints) {
        if (this.shownHints.has(h.id)) continue;
        if (inside(h.trigger, b.x, b.y, b.z, b.height)) {
          this.shownHints.add(h.id);
          this.activeHint = { def: h, until: now + h.duration };
          break;
        }
      }
    }
    if (this.activeHint) {
      const h = this.activeHint;
      const still = inside(h.def.trigger, b.x, b.y, b.z, b.height);
      if (now > h.until || (!still && now > h.until - h.def.duration + 1.6)) {
        this.activeHint = null;
        this.hud.setHint(null, null);
      } else {
        this.hud.setHint(h.def.keys, h.def.text, false);
      }
    } else {
      this.hud.setHint(null, null);
    }
  }

  private updateAudio(dt: number): void {
    const p = this.player;
    this.audio.update(dt, {
      speed: p.body.horizontalSpeed,
      grounded: p.state === 'ground',
      sliding: p.state === 'slide',
      wallrun: p.state === 'wallrun',
      scripted: p.state === 'scripted',
      active: this.phase === 'playing' || this.phase === 'finished',
    });
  }

  /** Lowers graphics quality automatically if the frame time stays high. */
  private updateGovernor(dt: number): void {
    if (this.playTime < 4) return;
    this.frameMsEma += (dt * 1000 - this.frameMsEma) * 0.04;
    this.govTimer += dt;
    if (this.govTimer < 3) return;
    this.govTimer = 0;
    if (this.frameMsEma > 27 && this.qualityLevel !== 'low') {
      this.qualityLevel = this.qualityLevel === 'high' ? 'medium' : 'low';
      this.pipeline.setQuality(this.qualityLevel);
      this.settings.set('quality', this.qualityLevel); // keep the menu in sync and start lighter next time
      this.frameMsEma = 16;
      this.hud.toast('GRAPHICS ADJUSTED', `${this.qualityLevel.toUpperCase()} QUALITY FOR SMOOTHER PLAY`, 2400);
    }
  }

  // ==========================================================================================
  // Menu backdrop
  // ==========================================================================================

  private updateMenuCamera(): void {
    const t = this.menuTime;
    const s = this.level.layout.start;
    const cam = this.pipeline.camera;
    // Slow cinematic drift over the start roof, looking across the city.
    cam.position.set(s.x + 4.6 + Math.sin(t * 0.09) * 1.4, s.y + 1.85 + Math.sin(t * 0.13) * 0.12, s.z - 1.5 - ((t * 0.18) % 24));
    const yaw = s.yaw + 0.62 + Math.sin(t * 0.05) * 0.08;
    const pitch = 0.035 + Math.sin(t * 0.07) * 0.012;
    const e = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(e);
    this.fpCamera.syncFov();
    this.bodyView.enabled = false;
  }

  // ==========================================================================================
  // Debug / test hooks (only with ?debug in the URL or in dev mode)
  // ==========================================================================================

  private installDebugApi(): void {
    const enabled = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;
    const api = {
      game: this,
      state: () => {
        const b = this.player.body;
        return {
          phase: this.phase,
          state: this.player.state,
          x: b.x,
          y: b.y,
          z: b.z,
          vx: b.vx,
          vy: b.vy,
          vz: b.vz,
          speed: b.horizontalSpeed,
          onGround: b.onGround,
          flow: this.player.flow,
          yaw: this.fpCamera.yaw,
          pitch: this.fpCamera.pitch,
          time: this.run.elapsed,
          checkpoint: this.checkpoints.current,
          falls: this.run.falls,
          rescues: b.rescues,
          quality: this.qualityLevel,
        };
      },
      /** Teleport to the start (0) or a checkpoint (1..5). */
      teleport: (id: number) => {
        const layout = this.level.layout;
        const cp = id === 0 ? layout.start : layout.checkpoints.find((c) => c.id === id);
        if (!cp) return false;
        this.player.reset(cp.x, cp.y, cp.z);
        this.fpCamera.snapTo(this.player, cp.yaw, 0);
        return true;
      },
      place: (x: number, y: number, z: number, yaw: number, pitch = 0) => {
        this.player.reset(x, y, z);
        this.fpCamera.snapTo(this.player, yaw, pitch);
      },
      autopilot: (on: boolean, fromCheckpoint = -1) => {
        if (!on) {
          this.autopilot = null;
          return;
        }
        const layout = this.level.layout;
        const cpId = fromCheckpoint >= 0 ? fromCheckpoint : this.checkpoints.current;
        const nodeIndex = cpId === 0 ? 0 : layout.route.findIndex((n) => n.label === `cp${cpId}`) + 1;
        const ap = new Autopilot(layout);
        const b = this.player.body;
        ap.start(b.x, b.z, this.fpCamera.yaw, nodeIndex);
        this.autopilot = ap;
      },
      look: (yaw: number, pitch: number) => {
        this.fpCamera.yaw = yaw;
        this.fpCamera.pitch = pitch;
      },
      timeScale: (k: number) => {
        this.timeScale = k;
      },
      freeCam: (x: number, y: number, z: number, yaw: number, pitch: number) => {
        this.freeCam = { x, y, z, yaw, pitch };
      },
      endFreeCam: () => {
        this.freeCam = null;
      },
      info: () => {
        const i = this.pipeline.renderer.info;
        return {
          calls: i.render.calls,
          triangles: i.render.triangles,
          geometries: i.memory.geometries,
          textures: i.memory.textures,
          programs: i.programs?.length ?? 0,
          pixelRatio: this.pipeline.renderer.getPixelRatio(),
        };
      },
      /** Synchronous GPU benchmark: average ms per frame (render + gl.finish) at a few vantage points. */
      bench: (frames = 90) => {
        const gl = this.pipeline.renderer.getContext();
        const cam = this.pipeline.camera;
        const spots: Array<[string, number, number, number, number, number]> = [
          ['start roof', 0, 63.65, 3, 0, 0],
          ['over the gaps', 0, 63, -92, 0, -0.08],
          ['slide alley', 20, 61.7, -193, -Math.PI / 2, 0],
          ['wall run', 112, 61.7, -188, -Math.PI / 2, 0.05],
          ['finish roof', 258, 50.6, -60, -Math.PI, 0],
          ['skyline from above', 135, 140, -95, -0.7, -0.45],
        ];
        const out: Array<{ spot: string; ms: number; calls: number; triangles: number }> = [];
        for (const [name, x, y, z, yaw, pitch] of spots) {
          cam.position.set(x, y, z);
          cam.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
          cam.updateMatrixWorld(true);
          for (let i = 0; i < 12; i++) this.pipeline.render();
          gl.finish();
          const t0 = performance.now();
          for (let i = 0; i < frames; i++) {
            this.pipeline.render();
            gl.finish();
          }
          const ms = (performance.now() - t0) / frames;
          const info = this.pipeline.renderer.info;
          out.push({ spot: name, ms: +ms.toFixed(2), calls: info.render.calls, triangles: info.render.triangles });
        }
        return out;
      },
      audio: this.audio,
      layout: this.level.layout,
      tune: (o: Parameters<RenderPipeline['tune']>[0]) => this.pipeline.tune(o),
      setQuality: (q: Quality) => this.pipeline.setQuality(q),
    };
    (window as unknown as { __rooftop: typeof api }).__rooftop = api;
  }
}
