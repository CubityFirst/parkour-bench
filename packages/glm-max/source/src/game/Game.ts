import * as THREE from 'three';
import { GameState } from './GameState';
import { CollisionWorld } from '../world/CollisionWorld';
import { buildLevel, LevelData } from '../world/Level';
import { CityGenerator } from '../world/CityGenerator';
import { Checkpoints } from '../world/Checkpoints';
import { PlayerController, PlayerEvents } from '../player/PlayerController';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { AudioManager } from '../audio/AudioManager';

/**
 * Game — renderer/scene bootstrap, fixed-timestep simulation loop,
 * run flow (menu → run → checkpoints → finish) and audio/camera wiring.
 */

const FIXED_STEP = 1 / 120;
const MAX_ACCUM = 0.25;

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private collision = new CollisionWorld();
  private sun!: THREE.DirectionalLight;
  private sunTarget = new THREE.Object3D();
  private level!: LevelData;
  private checkpoints!: Checkpoints;
  private player!: PlayerController;
  private fpCam!: FirstPersonCamera;
  private hud!: HUD;
  private menu!: Menu;
  private audio = new AudioManager();

  private accumulator = 0;
  private lastNow = 0;
  private rafId = 0;
  private locked = false;

  private skyMat!: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3(0.42, 0.74, 0.34).normalize();

  constructor(
    private canvas: HTMLCanvasElement,
    private gameState = new GameState()
  ) {}

  // ---------------------------------------------------------------- init

  init(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Diagnostic mode for software rasterizers (smoke tests): no shadows.
    if (new URLSearchParams(window.location.search).has('fast')) {
      this.renderer.shadowMap.enabled = false;
    }

    this.scene.background = new THREE.Color(0xbfd9ec);

    this.buildSky();
    this.buildLights();
    this.buildWorld();

    // player + camera
    this.player = new PlayerController(this.collision);
    this.player.setRespawn(this.level.spawn.pos, this.level.spawn.yaw);
    this.fpCam = new FirstPersonCamera(this.player, this.gameState, document.body, () => {
      this.audio.footstep(performance.now() / 1000, this.player.isSprinting() && !this.player.wallRunning());
    });
    this.fpCam.attachHands();
    // The camera must be part of the scene graph so attached hands render.
    this.scene.add(this.fpCam.camera);
    this.wirePlayerEvents();

    this.hud = new HUD();
    this.menu = new Menu(this.gameState, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestartRun: () => { this.audio.uiClick(); this.startRun(); },
      onQuit: () => this.quitToTitle(),
      onFinishRestart: () => { this.audio.uiClick(); this.startRun(); },
      onFinishQuit: () => this.quitToTitle()
    });

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.canvas.addEventListener('mousedown', this.onCanvasMouseDown);
    window.addEventListener('keydown', this.onKeyDown);

    this.resetRunState(false);
    this.menu.showMenu();
    this.lastNow = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private buildSky(): void {
    const top = new THREE.Color(0x3d76c4);
    const mid = new THREE.Color(0x9cc4e6);
    const bottom = new THREE.Color(0xdcebf5);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: top },
        uMid: { value: mid },
        uBottom: { value: bottom },
        uSunDir: { value: this.sunDir.clone() }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uBottom;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          float t = pow(clamp(h, 0.0, 1.0), 0.6);
          vec3 col = mix(uBottom, uMid, t * 0.85);
          col = mix(col, uTop, smoothstep(0.42, 1.0, h));
          vec3 sun = normalize(uSunDir);
          float d = max(dot(normalize(vDir), sun), 0.0);
          col += (pow(d, 420.0) * 1.35 + pow(d, 9.0) * 0.22) * vec3(1.0, 0.97, 0.9);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1700, 28, 16), this.skyMat);
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0xcfdfe9, 170, 660);
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xcfe4f5, 0x8b8c86, 0.82);
    this.scene.add(hemi);

    // Low-contrast fill so north-facing walls keep close to the white look.
    const fill = new THREE.DirectionalLight(0xe8f1f8, 0.62);
    fill.position.set(-60, 80, -70);
    this.scene.add(fill);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -62;
    this.sun.shadow.camera.right = 62;
    this.sun.shadow.camera.top = 62;
    this.sun.shadow.camera.bottom = -62;
    this.sun.shadow.bias = -0.00028;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 3.2;
    this.sun.position.set(60, 110, 50);
    this.sunTarget.position.set(0, 24, 0);
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;
  }

  private buildWorld(): void {
    this.level = buildLevel(this.scene, this.collision);
    new CityGenerator(this.scene);
    this.checkpoints = new Checkpoints(
      this.collision,
      this.level.spawn,
      this.level.checkpoints,
      () => this.finishRun(),
      this.level.finishTrigger
    );
    this.checkpoints.addTriggers(this.level.triggers);
    this.checkpoints.activateSpawn();
  }

  private wirePlayerEvents(): void {
    const ev: PlayerEvents = {};
    ev.onFootstep = (sprinting) => {
      this.audio.footstep(performance.now() / 1000, sprinting);
    };
    ev.onJump = () => { this.audio.jump(); this.fpCam.onJump(); };
    ev.onLand = (impact) => { this.audio.land(impact); this.fpCam.onLand(impact); };
    ev.onSlideStart = () => this.audio.slideStart();
    ev.onSlideEnd = () => this.audio.slideEnd();
    ev.onVault = () => { this.audio.vault(); this.fpCam.onVault(); };
    ev.onMantle = () => { this.audio.mantle(); this.fpCam.onMantle(); };
    ev.onWallrunStart = () => { /* wind rises via audio.update */ };
    ev.onWallrunEnd = () => { /* nothing */ };
    ev.onHeadBump = () => this.audio.headBump();
    Object.assign(this.player.events, ev);
  }

  // ---------------------------------------------------------------- run flow

  startRun(): void {
    this.audio.init();
    this.audio.resume();
    this.audio.uiClick();
    this.resetRunState(true);
    this.menu.showGame();
    this.hud.show();
    this.gameState.runState = 'running';
    this.lockCanvas();
  }

  resetRunState(spawnPlay: boolean): void {
    this.gameState.resetRun();
    this.checkpoints.resetRun();
    this.checkpoints.resetFinish();
    this.checkpoints.activateSpawn();
    this.player.setRespawn(this.level.spawn.pos, this.level.spawn.yaw);
    this.player.respawn();
    this.player.clearInputState();
    this.accumulator = 0;
    this.fpCam.snapToPlayer();
    this.hud.setCheckpoints(0, this.level.checkpoints.length);
    this.hud.setHint(null);
    this.hud.setTimer(0);
    if (spawnPlay) this.hud.show();
  }

  pause(): void {
    if (this.gameState.runState !== 'running') return;
    this.gameState.runState = 'paused';
    this.hud.setHint(null);
    this.menu.showPause();
    if (this.locked) document.exitPointerLock();
  }

  resume(): void {
    if (this.gameState.runState !== 'paused') return;
    this.menu.hidePause();
    this.gameState.runState = 'running';
    this.audio.uiClick();
    this.lockCanvas();
  }

  quitToTitle(): void {
    this.gameState.runState = 'menu';
    this.player.clearInputState();
    this.hud.hide();
    this.menu.showMenu();
    if (this.locked) document.exitPointerLock();
  }

  finishRun(): void {
    if (this.gameState.runState !== 'running') return;
    this.gameState.runState = 'finished';
    const time = this.gameState.runTime;
    const prevBest = this.gameState.bestTime;
    const isNew = this.gameState.finishRun(time);
    this.audio.finish();
    this.menu.showFinish(time, prevBest, isNew);
    this.menu.refreshBest();
    this.hud.setHint(null);
    if (this.locked) document.exitPointerLock();
  }

  respawnPlayer(): void {
    this.audio.respawn();
    this.hud.flashFade(false);
    this.player.respawn();
    this.fpCam.snapToPlayer();
    this.hud.setHint(null);
  }

  restartFromCheckpoint(): void {
    if (this.gameState.runState !== 'running') return;
    this.respawnPlayer();
  }

  private lockCanvas(): void {
    void (this.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {
      this.showFocusHint(true);
    });
  }

  private showFocusHint(on: boolean): void {
    document.getElementById('focus-hint')!.classList.toggle('hidden', !on);
  }

  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked && this.gameState.runState === 'running') {
      this.pause();
    }
    this.showFocusHint(false);
  };

  private onPointerLockError = (): void => {
    if (this.gameState.runState === 'running' && !this.locked) {
      this.pause();
      this.showFocusHint(true);
    }
  };

  private onCanvasMouseDown = (): void => {
    if (this.gameState.runState === 'running' && !this.locked) {
      this.showFocusHint(false);
      this.lockCanvas();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR' && this.gameState.runState === 'running') {
      this.restartFromCheckpoint();
    }
    void e;
  };

  private onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  };

  // ---------------------------------------------------------------- loop

  private frame = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0.0001, (nowMs - this.lastNow) / 1000));
    this.lastNow = nowMs;
    const t = nowMs / 1000;

    if (this.gameState.runState === 'running') {
      // fixed-step simulation
      this.accumulator += dt;
      if (this.accumulator > MAX_ACCUM) this.accumulator = MAX_ACCUM;
      while (this.accumulator >= FIXED_STEP) {
        this.accumulator -= FIXED_STEP;
        this.player.update(FIXED_STEP);
        this.gameState.runTime += FIXED_STEP;
      }

      // camera follows
      this.fpCam.update(dt);

      // triggers
      const trig = this.checkpoints.update(this.player.pos);
      if (trig) {
        if (trig.type === 'finish') {
          this.finishRun();
        } else {
          const cp = this.checkpoints.state.list[trig.index];
          this.player.setRespawn(cp.pos, cp.yaw);
          this.hud.showToast(`CHECKPOINT <span class="accent">${trig.index}</span>/${this.level.checkpoints.length}`);
          this.hud.setCheckpoints(trig.index, this.level.checkpoints.length);
          this.audio.checkpoint();
        }
      }

      // fell off the rooftops
      if (this.player.hasFallen() && this.gameState.runState === 'running') {
        this.respawnPlayer();
      }

      // hints
      this.updateHints();

      // audio
      this.audio.update(dt, this.player.speed(), this.player.sliding(), this.player.wallRunning());

      // HUD
      this.hud.update(dt, this.gameState.runTime);
    }

    // world + light updates (also keeps the menu backdrop alive)
    this.level.update(dt, t);
    const p = this.player.pos;
    this.sun.position.copy(p).addScaledVector(this.sunDir, 150);
    this.sunTarget.position.copy(p);

    this.renderer.render(this.scene, this.fpCam.camera);
  };

  private hintIndex = -1;

  private updateHints(): void {
    const z = this.player.pos.z;
    let found = -1;
    for (let i = 0; i < this.level.hints.length; i++) {
      const h = this.level.hints[i];
      if (z >= h.z0 && z <= h.z1) { found = i; break; }
    }
    if (found === -1) {
      this.hud.setHint(null);
      this.hintIndex = -1;
      return;
    }
    if (found !== this.hintIndex) {
      this.hintIndex = found;
      this.hud.setHint(this.level.hints[found].text);
    }
  }
}
