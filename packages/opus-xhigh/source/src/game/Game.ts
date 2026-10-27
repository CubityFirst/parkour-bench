import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FirstPersonCamera, type CameraSettings } from '../player/FirstPersonCamera';
import { MOVE, PHYSICS_DT } from '../player/MovementConfig';
import { PlayerBody } from '../player/PlayerBody';
import { PlayerController, type PlayerInput } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { Beacon, Checkpoints, inside } from '../world/Checkpoints';
import { generateCity } from '../world/CityGenerator';
import { CollisionWorld } from '../world/CollisionWorld';
import { buildLevel, type LevelData } from '../world/Level';
import { createMaterials } from '../world/Materials';
import { MeshBatcher } from '../world/MeshBatcher';
import { HAZE_COLOR, SUN_DIRECTION, Sky } from '../world/Sky';
import { formatTime, GameState, type GamePhase } from './GameState';
import { Input } from './Input';
import { loadSettings, saveSettings, type Settings } from './Settings';

const SHADOW_EXTENT = 46;
const SHADOW_MAP_SIZE = 2048;
const MAX_FRAME_TIME = 0.1;

/**
 * Top-level game object: owns the renderer, world, player and UI, runs the
 * fixed-timestep simulation loop and moves between menu / playing / paused /
 * finished.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky = new Sky();
  private readonly sun: THREE.DirectionalLight;
  private readonly world = new CollisionWorld();
  private readonly settings: Settings;
  private readonly cameraSettings: CameraSettings;
  private readonly state = new GameState();
  private readonly audio = new AudioManager();
  private readonly hud = new HUD();
  private readonly input: Input;
  private readonly menu: Menu;
  private readonly player: PlayerController;
  private readonly fpCam: FirstPersonCamera;

  private level!: LevelData;
  private checkpoints!: Checkpoints;
  private finishBeacon!: Beacon;
  private body!: PlayerBody;

  private accumulator = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private respawnCountdown = -1;
  private readonly shownHints = new Set<string>();
  private readonly renderFeet = new THREE.Vector3();
  private readonly sunBasis = new THREE.Matrix4();
  private readonly sunBasisInv = new THREE.Matrix4();
  private debugVisible = new URLSearchParams(location.search).has('debug');
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private cueTimer = 0;
  private menuCameraTime = 0;
  /** Simulation speed multiplier (debug/slow-motion inspection only). */
  timeScale = 1;

  constructor(container: HTMLElement) {
    this.settings = loadSettings();
    this.cameraSettings = {
      sensitivity: this.settings.sensitivity,
      baseFov: this.settings.fov,
      motion: this.settings.cameraMotion === 'reduced' ? 0.3 : 1,
      invertY: this.settings.invertY,
    };

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.08, 3200);

    // Lighting: strong sun, cool sky fill, image-based light from the sky.
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_EXTENT;
    sc.right = SHADOW_EXTENT;
    sc.top = SHADOW_EXTENT;
    sc.bottom = -SHADOW_EXTENT;
    sc.near = 1;
    sc.far = 420;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xcfe5ff, 0xe9e3d8, 0.85));
    this.sunBasis.lookAt(SUN_DIRECTION, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.sunBasisInv.copy(this.sunBasis).invert();

    this.scene.fog = new THREE.Fog(HAZE_COLOR, 70, 1000);
    this.scene.add(this.sky.mesh);

    this.player = new PlayerController(this.world);
    this.fpCam = new FirstPersonCamera(this.camera, this.cameraSettings);
    this.input = new Input(this.renderer.domElement);

    this.menu = new Menu(this.settings, {
      start: () => this.startRun(),
      resume: () => this.resume(),
      restartCheckpoint: () => {
        this.respawn();
        this.resume();
      },
      restartLevel: () => this.startRun(),
      quit: () => this.quitToMenu(),
      settingsChanged: (s) => this.applySettings(s),
      click: () => this.audio.click(),
    });
    this.menu.setBestTime(this.state.bestTime);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.input.onKey = this.onKey;
    // Ctrl+W closes tabs in most browsers and can't be blocked, so guard the run.
    window.addEventListener('beforeunload', (e) => {
      if (this.state.phase === 'playing' && this.state.started) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    // Clicking the game while paused resumes it.
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state.phase === 'paused' && !this.menu.overlayOpen) this.resume();
    });
  }

  /** Builds the world. Split from the constructor so the loading screen can paint first. */
  async init(): Promise<void> {
    await nextFrame();
    const environment = this.sky.createEnvironment(this.renderer);
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.55;

    const materials = createMaterials(this.renderer);

    const routeBatch = new MeshBatcher();
    this.level = buildLevel(this.world, routeBatch);
    for (const mesh of routeBatch.build(materials)) this.scene.add(mesh);
    for (const obj of this.level.meshes) this.scene.add(obj);

    await nextFrame();
    const cityBatch = new MeshBatcher();
    const cityObjects = generateCity(this.world, cityBatch, materials, this.level.footprints);
    for (const mesh of cityBatch.build(materials, { castShadow: () => false })) this.scene.add(mesh);
    for (const obj of cityObjects) this.scene.add(obj);

    this.checkpoints = new Checkpoints(this.level.checkpoints);
    this.scene.add(this.checkpoints.group);
    this.finishBeacon = new Beacon(this.level.finish.beacon, 0xff2a1f, 1.4, 70, 0.7);
    this.scene.add(this.finishBeacon.group);
    this.hud.setCheckpointCount(this.level.checkpoints.length);

    this.body = new PlayerBody(SUN_DIRECTION, environment);
    this.scene.add(this.body.worldGroup);
    this.onResize();

    this.resetPlayer();
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.body.viewScene, this.body.viewCamera);

    this.setPhase('menu');
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);

    // Exposed for debugging and automated tests.
    (window as unknown as { __rooftop: unknown }).__rooftop = this;
  }

  // ---------------------------------------------------------------------------
  // Phase management
  // ---------------------------------------------------------------------------

  private setPhase(phase: GamePhase): void {
    this.state.phase = phase;
    this.input.enabled = phase === 'playing';
    this.hud.show(phase === 'playing' || phase === 'paused');
    switch (phase) {
      case 'menu':
        this.menu.setBestTime(this.state.bestTime);
        this.menu.show('menu');
        this.menuCameraTime = 0;
        break;
      case 'playing':
        this.menu.show(null);
        this.input.flushPresses();
        this.audio.resume();
        break;
      case 'paused':
        this.menu.setPauseStatus(this.state.started ? `Run time ${formatTime(this.state.time)}` : 'Click resume to capture the mouse.');
        this.menu.show('pause');
        break;
      case 'finished':
        break;
    }
  }

  private startRun(): void {
    this.audio.init();
    this.audio.setVolume(this.settings.volume);
    this.state.resetRun();
    this.checkpoints.reset();
    this.shownHints.clear();
    this.hud.reset();
    this.resetPlayer();
    this.requestPlay();
  }

  private resetPlayer(): void {
    const cp = this.level.checkpoints[0];
    this.player.respawn(cp.spawn);
    this.fpCam.setOrientation(cp.yaw, -0.04);
    this.fpCam.reset();
    this.accumulator = 0;
    this.respawnCountdown = -1;
    this.hud.setFade(false);
  }

  private requestPlay(): void {
    this.input.lock().then((ok) => {
      if (ok) this.setPhase('playing');
      else {
        this.setPhase('paused');
        this.menu.setPauseStatus('The browser needs a moment before re-capturing the mouse — click Resume again.');
      }
    });
  }

  private resume(): void {
    if (this.state.phase !== 'paused') return;
    this.audio.init();
    this.requestPlay();
  }

  private pause(): void {
    if (this.state.phase !== 'playing') return;
    this.setPhase('paused');
  }

  private quitToMenu(): void {
    this.input.unlock();
    this.setPhase('menu');
  }

  private finishRun(): void {
    this.state.phase = 'finished';
    this.checkpoints.update(this.player.pos);
    const isBest = this.state.finish();
    this.audio.finish();
    this.hud.setCheckpointProgress(this.level.checkpoints.length, true);
    this.input.unlock();
    this.setPhase('finished');
    this.hud.show(false);
    const names = this.level.checkpoints.map((c) => c.name);
    const prevBest = isBest ? [] : this.state.bestSplits;
    const splits = this.state.splits.map((t, i) => ({
      name: names[i + 1] ?? `Checkpoint ${i + 1}`,
      time: t,
      delta: prevBest[i] !== undefined ? t - prevBest[i] : undefined,
    }));
    splits.push({ name: 'Finish', time: this.state.time, delta: undefined });
    this.menu.showFinish({ time: this.state.time, best: this.state.bestTime, isBest, respawns: this.state.respawns, splits });
  }

  private readonly onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (!locked && this.state.phase === 'playing') this.pause();
  };

  private readonly onKey = (code: string): void => {
    if (code === 'F3') {
      this.debugVisible = !this.debugVisible;
      if (!this.debugVisible) this.hud.setDebug(null);
      return;
    }
    if (this.state.phase !== 'playing') return;
    if (code === 'KeyR') this.respawn();
    else if (code === 'KeyP') this.input.unlock();
  };

  private applySettings(s: Settings): void {
    this.cameraSettings.sensitivity = s.sensitivity;
    this.cameraSettings.baseFov = s.fov;
    this.cameraSettings.motion = s.cameraMotion === 'reduced' ? 0.3 : 1;
    this.cameraSettings.invertY = s.invertY;
    this.audio.setVolume(s.volume);
    saveSettings(s);
  }

  private readonly onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.body?.setAspect(w / h);
  };

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  private sampleInput(): PlayerInput {
    const i = this.input;
    return {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0),
      moveZ: (i.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (i.isDown('KeyS', 'ArrowDown') ? 1 : 0),
      sprint: i.isDown('ShiftLeft', 'ShiftRight'),
      jumpHeld: i.isDown('Space'),
      jumpPressed: i.consume('Space'),
      slideHeld: i.isDown('KeyC', 'ControlLeft', 'ControlRight', 'Mouse2'),
      slidePressed: i.consume('KeyC', 'ControlLeft', 'ControlRight', 'Mouse2'),
      vaultPressed: i.consume('KeyE'),
      yaw: this.fpCam.yaw,
    };
  }

  /** Optional input override used by automated tests (window.__rooftop.autopilot). */
  autopilot: ((dt: number, base: PlayerInput) => PlayerInput) | null = null;

  private fixedStep(dt: number): void {
    let input = this.sampleInput();
    if (this.autopilot) input = this.autopilot(dt, input);
    if (this.respawnCountdown >= 0) {
      // Falling into the fade: no control.
      input.moveX = 0;
      input.moveZ = 0;
      input.jumpPressed = false;
      input.slidePressed = false;
      input.vaultPressed = false;
    }
    this.player.step(dt, input);

    if (!this.state.started && (input.moveX !== 0 || input.moveZ !== 0 || input.jumpPressed)) this.state.started = true;
    if (this.state.started) this.state.time += dt;

    const pos = this.player.pos;
    const reached = this.checkpoints.update(pos);
    if (reached > 0) {
      this.state.splits[reached - 1] = this.state.time;
      const best = this.state.bestSplits[reached - 1];
      this.hud.showToast(`Checkpoint ${reached}/${this.level.checkpoints.length - 1}`, this.level.checkpoints[reached].name);
      this.hud.showSplit(this.state.time, best);
      this.hud.setCheckpointProgress(reached);
      this.audio.checkpoint();
    }

    for (const h of this.level.hints) {
      if (!this.shownHints.has(h.id) && inside(pos, h)) {
        this.shownHints.add(h.id);
        this.hud.showHint(h.text, h.id === 'move' ? 7 : 6);
      }
    }

    if (inside(pos, this.level.finish)) {
      this.finishRun();
      return;
    }

    if (pos.y < this.level.killY && this.respawnCountdown < 0) {
      this.respawnCountdown = 0.22;
      this.hud.setFade(true);
    }
  }

  /** Respawn at the active checkpoint with all movement state cleared. */
  respawn(): void {
    const cp = this.checkpoints.active;
    this.player.respawn(cp.spawn);
    this.fpCam.setOrientation(cp.yaw, -0.04);
    this.fpCam.reset();
    this.state.respawns++;
    this.respawnCountdown = -1;
    this.hud.setFade(true);
    window.setTimeout(() => this.hud.setFade(false), 60);
    this.audio.respawn();
    if (!this.shownHints.has('respawn')) {
      this.shownHints.add('respawn');
      this.hud.showHint('Back at the last checkpoint · press [R] to restart from it any time', 5);
    }
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(MAX_FRAME_TIME, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.elapsed += dt;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const phase = this.state.phase;
    const [mx, my] = this.input.takeMouse();
    let alpha = 1;
    if (phase === 'playing') {
      this.fpCam.look(mx, my);
      this.accumulator += dt * this.timeScale;
      while (this.accumulator >= PHYSICS_DT && this.state.phase === 'playing') {
        this.fixedStep(PHYSICS_DT);
        this.accumulator -= PHYSICS_DT;
      }
      alpha = this.accumulator / PHYSICS_DT;
      if (this.respawnCountdown >= 0) {
        this.respawnCountdown -= dt;
        if (this.respawnCountdown < 0) {
          this.respawn();
        }
      }
    }

    // Player events → camera & audio.
    for (const e of this.player.events) {
      this.fpCam.handleEvent(e);
      switch (e.type) {
        case 'footstep':
          this.audio.footstep(e.speed, e.wall);
          break;
        case 'jump':
        case 'walljump':
          this.audio.jump();
          break;
        case 'land':
          this.audio.land(e.impact, e.hard);
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
        case 'wallrunStart':
          this.audio.wallrunStart();
          break;
        default:
          break;
      }
    }
    this.player.events.length = 0;

    const inRun = phase === 'playing' || phase === 'paused' || phase === 'finished';
    if (inRun) {
      this.renderFeet.lerpVectors(this.player.prevPos, this.player.pos, alpha);
      const simDt = dt * this.timeScale;
      this.fpCam.update(phase === 'playing' ? simDt : 0, this.renderFeet, this.player);
      this.body.update(simDt, this.player, this.fpCam, this.renderFeet, phase === 'playing');
      this.updateSun(this.renderFeet);
    } else {
      this.updateMenuCamera(dt);
    }

    // HUD
    if (phase === 'playing') {
      this.hud.setTime(this.state.time);
      this.hud.update(dt);
      this.hud.setSpeedEffect(this.fpCam.speedFactor * 0.55 * this.cameraSettings.motion);
      this.cueTimer -= dt;
      if (this.cueTimer <= 0) {
        this.cueTimer = 0.1;
        this.hud.setActionCue(this.actionAvailable());
      }
    }
    this.audio.update(this.player.horizontalSpeed, -this.player.vel.y, this.player.state === 'slide', phase === 'playing');
    if (this.debugVisible) this.updateDebug();

    // World animation
    this.sky.update(this.elapsed, this.camera.position);
    this.checkpoints.animate(this.elapsed, dt);
    this.finishBeacon.update(this.elapsed, dt);

    // Render: world, then the arms on top with a cleared depth buffer.
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (phase === 'playing') {
      this.renderer.clearDepth();
      this.renderer.render(this.body.viewScene, this.body.viewCamera);
    }
  };

  /** Shadow camera follows the player, snapped to shadow-map texels to avoid shimmering. */
  private updateSun(focus: THREE.Vector3): void {
    const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
    const p = focus.clone().applyMatrix4(this.sunBasisInv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this.sunBasis);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIRECTION, 200);
    this.sun.target.updateMatrixWorld();
  }

  /** Slow establishing drift over the start roof, looking down the route, while the main menu is up. */
  private updateMenuCamera(dt: number): void {
    this.menuCameraTime += dt;
    const t = this.menuCameraTime * 0.12;
    this.camera.position.set(-11 + Math.sin(t) * 5, 7.5 + Math.sin(t * 0.7) * 1.2, 16 + Math.cos(t * 0.8) * 4);
    this.camera.lookAt(5 + Math.sin(t * 0.5) * 7, -2, -75);
    if (this.camera.fov !== 60) {
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
    }
    this.updateSun(new THREE.Vector3(0, 0, -20));
  }

  /** True when a vault or ledge is right in front of the player (crosshair cue). */
  private actionAvailable(): boolean {
    const p = this.player;
    if (p.traversal || (p.state !== 'ground' && p.state !== 'air')) return false;
    const dir = new THREE.Vector3(-Math.sin(this.fpCam.yaw), 0, -Math.cos(this.fpCam.yaw));
    if (p.state === 'ground') {
      if (this.player.parkour.findVault(p.pos, dir, 1.2)) return true;
      return this.player.parkour.findLedge(p.pos, dir, MOVE.LEDGE_MIN_HEIGHT, MOVE.LEDGE_REACH - 0.25) !== null;
    }
    return this.player.parkour.findLedge(p.pos, dir, MOVE.LEDGE_MIN_HEIGHT, MOVE.LEDGE_REACH) !== null;
  }

  private updateDebug(): void {
    const p = this.player;
    const info = this.renderer.info.render;
    this.hud.setDebug(
      [
        `fps ${this.fps.toFixed(0)}  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k`,
        `state ${p.state}${p.grounded ? ' (grounded)' : ''}`,
        `speed ${p.horizontalSpeed.toFixed(2)} m/s  vy ${p.vel.y.toFixed(2)}`,
        `pos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(2)} ${p.pos.z.toFixed(1)}`,
        `checkpoint ${this.checkpoints.current}`,
      ].join('\n'),
    );
  }

  /** Test helper: begin playing without pointer lock (automation only). */
  debugStart(): void {
    this.audio.init();
    this.state.resetRun();
    this.checkpoints.reset();
    this.shownHints.clear();
    this.hud.reset();
    this.resetPlayer();
    this.setPhase('playing');
  }

  get debugState(): { player: PlayerController; camera: FirstPersonCamera; state: GameState; level: LevelData; checkpoints: Checkpoints } {
    return { player: this.player, camera: this.fpCam, state: this.state, level: this.level, checkpoints: this.checkpoints };
  }

  /** Test helper: teleport to a checkpoint. */
  debugCheckpoint(index: number): void {
    this.checkpoints.current = Math.max(0, Math.min(index, this.level.checkpoints.length - 1));
    const cp = this.checkpoints.active;
    this.player.respawn(cp.spawn);
    this.fpCam.setOrientation(cp.yaw, -0.04);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
