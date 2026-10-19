import * as THREE from 'three';
import { Level, KILL_Y, Checkpoint } from '../world/Level';
import { buildWorld, FOG_COLOR, SUN_DIR, WorldVisuals } from '../world/CityGenerator';
import { Checkpoints } from '../world/Checkpoints';
import { PlayerController } from '../player/PlayerController';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerBody } from '../player/PlayerBody';
import { AudioManager } from '../audio/AudioManager';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { Input } from './Input';
import { GameState } from './GameState';

/** Fixed physics step (independent of render frame rate). */
const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 12;

/**
 * Top-level orchestration: renderer + scene, fixed-timestep loop, phase handling
 * (menu / playing / paused / finished), checkpoints, respawn and finish detection.
 */
export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private level = new Level();
  private world: WorldVisuals;
  private checkpoints: Checkpoints;
  private player: PlayerController;
  private cam: FirstPersonCamera;
  private body = new PlayerBody();
  private audio = new AudioManager();
  private hud = new HUD();
  private menu: Menu;
  private input: Input;
  private state = new GameState();
  private sun: THREE.DirectionalLight;

  private acc = 0;
  private last = performance.now();
  private clock = 0;
  private raf = 0;
  private disposed = false;

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = new THREE.Fog(FOG_COLOR, 140, 1100);

    // lighting: strong sun + bright sky/ground bounce
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xe9e6e0, 1.35));
    this.sun = new THREE.DirectionalLight(0xfff3dc, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.world = buildWorld(this.level, this.renderer);
    this.scene.add(this.world.group);
    this.checkpoints = new Checkpoints(this.level, this.world.checkpointMarkers);

    this.player = new PlayerController(this.level.world);
    this.cam = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.scene.add(this.cam.camera);
    this.body.attach(this.cam.camera, this.scene);
    this.wirePlayerEvents();

    this.input = new Input(this.canvas);
    this.input.onRestart = () => { if (this.state.phase === 'playing') this.respawn(); };

    this.cam.sensitivity = this.state.settings.sensitivity;
    this.cam.setReduceMotion(this.state.settings.reduceMotion);

    this.menu = new Menu({
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartCheckpoint: () => { this.respawn(); this.resume(); },
      onRestartLevel: () => this.startRun(),
      onSettings: (s) => {
        Object.assign(this.state.settings, s);
        this.cam.sensitivity = this.state.settings.sensitivity;
        this.cam.setReduceMotion(this.state.settings.reduceMotion);
        this.state.saveSettings();
      },
    }, this.state.settings);

    this.resetPlayerToSpawn();
    this.menu.showMenu(this.state.best);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('mousedown', this.onCanvasClick);

    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ wiring

  private wirePlayerEvents(): void {
    this.player.events = {
      jump: () => { this.audio.jump(); this.cam.onJump(); },
      land: (impact) => { this.audio.land(impact); this.cam.onLand(impact); },
      footstep: (sprint) => this.audio.footstep(sprint),
      wallRunStart: () => this.audio.wallJump(),
      wallJump: () => { this.audio.wallJump(); this.cam.onJump(); },
      vault: () => this.audio.vault(),
      mantle: () => this.audio.vault(),
    };
  }

  private resetPlayerToSpawn(): void {
    const s = this.level.spawn;
    this.player.respawn(s.x, s.y, s.z);
    this.cam.reset(s.yaw);
  }

  // ------------------------------------------------------------------ phases

  private startRun(): void {
    this.audio.init();
    this.state.resetRun();
    this.checkpoints.reset();
    this.resetPlayerToSpawn();
    this.beginPlaying();
  }

  private beginPlaying(): void {
    this.state.phase = 'playing';
    this.input.enabled = true;
    this.input.clear();
    this.input.takeMouse();
    this.menu.hideAll();
    this.hud.show(true);
    this.acc = 0;
    this.canvas.focus();
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { /* user can click the canvas to retry */ });
    } catch { /* ignore */ }
  }

  private pause(): void {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'paused';
    this.input.enabled = false;
    this.input.clear();
    this.audio.silenceLoops();
    this.menu.showPause();
    this.hud.setHint(null);
    this.hud.setVaultHint(false);
  }

  private resume(): void {
    if (this.state.phase !== 'paused') return;
    this.beginPlaying();
  }

  private finishRun(): void {
    this.state.phase = 'finished';
    this.state.timerRunning = false;
    this.input.enabled = false;
    this.audio.silenceLoops();
    this.audio.finish();
    const record = this.state.submit(this.state.time);
    this.hud.setHint(null);
    this.hud.setVaultHint(false);
    this.hud.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.showFinish(this.state.time, this.state.best ?? this.state.time, record);
  }

  private respawn(): void {
    const cp: Checkpoint = this.checkpoints.current;
    this.player.respawn(cp.x, cp.y, cp.z);
    this.cam.reset(cp.yaw);
    this.state.deaths++;
    this.audio.respawn();
    this.audio.silenceLoops();
    this.hud.flash();
  }

  // ------------------------------------------------------------------ events

  private onLockChange = (): void => {
    if (document.pointerLockElement !== this.canvas && this.state.phase === 'playing') this.pause();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && this.state.phase === 'playing') this.pause();
  };

  private onCanvasClick = (): void => {
    if (this.state.phase === 'playing' && document.pointerLockElement !== this.canvas) {
      try { this.canvas.requestPointerLock(); } catch { /* ignore */ }
    }
  };

  private onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.cam.resize(window.innerWidth / window.innerHeight);
  };

  // ------------------------------------------------------------------ simulation

  private step(): void {
    const input = this.input.poll(this.cam.yaw);
    if (!this.state.timerRunning && this.input.anyMovement) this.state.timerRunning = true;
    this.player.update(STEP, input);
    this.input.consumeEdges();
    if (this.state.timerRunning) this.state.time += STEP;

    const p = this.player.phys;
    const reached = this.checkpoints.check(p.x, p.y, p.z);
    if (reached) {
      this.hud.toast(reached.name);
      this.audio.checkpoint();
    }
    if (p.y < KILL_Y) { this.respawn(); return; }
    const f = this.level.finish;
    if (p.x > f.minX && p.x < f.maxX && p.y > f.minY && p.y < f.maxY && p.z > f.minZ && p.z < f.maxZ) {
      this.finishRun();
    }
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;

    const playing = this.state.phase === 'playing';
    if (playing) {
      const [mx, my] = this.input.takeMouse();
      this.cam.look(mx, my);
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME && this.state.phase === 'playing') {
        this.step();
        this.acc -= STEP;
        n++;
      }
      if (n === MAX_STEPS_PER_FRAME) this.acc = 0;
    } else if (this.state.phase === 'menu') {
      // slow idle look-around behind the menu
      this.cam.yaw = Math.sin(this.clock * 0.12) * 0.55;
      this.cam.pitch = -0.08;
    }

    const alpha = playing ? this.acc / STEP : 1;
    const pl = this.player;
    this.cam.update(dt, pl, alpha);
    this.body.update(dt, pl, alpha, this.cam.yaw);

    // sun + shadow frustum follow the player
    const p = pl.phys;
    const tx = Math.round(p.x / 2) * 2, ty = Math.round(p.y / 2) * 2, tz = Math.round(p.z / 2) * 2;
    this.sun.target.position.set(tx, ty, tz);
    this.sun.position.set(tx + SUN_DIR.x * 160, ty + SUN_DIR.y * 160, tz + SUN_DIR.z * 160);

    this.checkpoints.animate(this.clock);

    if (playing) {
      this.hud.setTime(this.state.time);
      this.hud.setSpeed(pl.speed);
      this.hud.setVaultHint(pl.canVaultHint);
      this.hud.setHint(this.hintFor(p.x, p.y, p.z));
      this.audio.setLoops(pl.speed, pl.mode === 'slide', pl.mode === 'wallrun', !p.grounded && pl.mode !== 'script');
    }

    this.renderer.render(this.scene, this.cam.camera);
  };

  private hintFor(x: number, y: number, z: number): string | null {
    if (y < 20) return null;
    for (const h of this.level.hints) {
      if (z <= h.maxZ && z >= h.minZ) return h.text;
    }
    return null;
  }

  // ------------------------------------------------------------------ teardown

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('mousedown', this.onCanvasClick);
    this.input.dispose();
    this.body.dispose();
    this.world.dispose();
    this.renderer.dispose();
  }

  /** Debug access for tests. */
  get debug() {
    return { player: this.player, state: this.state, cam: this.cam, level: this.level, checkpoints: this.checkpoints };
  }
}
