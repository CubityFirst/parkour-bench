import * as THREE from 'three';
import { TIMING } from './GameState';
import { Level } from '../world/Level';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerController } from '../player/PlayerController';
import { Input } from '../player/Input';
import { Audio } from '../audio/AudioManager';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';

type State = 'menu' | 'playing' | 'paused' | 'finish';

/**
 * Top-level game coordinator: renderer/world setup, the loop, checkpoint
 * logic, respawn, UI wiring and audio hooks.
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private level: Level;
  private cam: FirstPersonCamera;
  private input = new Input();
  private audio = new Audio();
  private hud = new HUD();
  private menu: Menu;
  private player: PlayerController;

  private state: State = 'menu';
  private runTime = 0;
  private currentCheckpoint = -1; // -1 = start spawn
  private visitedHints = new Set<number>();
  private lastAttack = 0;

  private animationId = 0;
  private prevTime = performance.now();
  private onLockedBound = this.onPointerLockChange.bind(this);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.cam = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.menu = new Menu();
    this.level = new Level();

    this.setupScene();
    this.player = new PlayerController(this.level.collision, this.cam, this.input, this.audio);
    this.player.respawn(this.level.playerStart(), true);
    this.player.onRespawn = () => {
      this.audio.respawn();
    };

    this.hud.buildIcons(this.level.checkpoints.length + 1);

    this.wireUi(canvas);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onLockedBound);

    this.state = 'menu';
    this.menu.showMenu();
    this.loop();
  }

  private setupScene(): void {
    // Sky + atmosphere
    this.scene.background = new THREE.Color(0x9ec9e8);
    this.scene.fog = new THREE.Fog(0xaad2ea, 90, 620);

    // Sun
    const sun = new THREE.DirectionalLight(0xfff2df, 2.0);
    sun.position.set(60, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadowRange = 130;
    sun.shadow.camera.left = -shadowRange;
    sun.shadow.camera.right = shadowRange;
    sun.shadow.camera.top = shadowRange;
    sun.shadow.camera.bottom = -shadowRange;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0006;
    sun.target.position.set(100, 6, 0);
    this.scene.add(sun);
    this.scene.add(sun.target);

    const hemi = new THREE.HemisphereLight(0xcfe6f5, 0x8d8f94, 0.85);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(amb);

    this.scene.add(this.level.group);
  }

  private wireUi(canvas: HTMLCanvasElement): void {
    this.menu.on = (requested, action) => {
      if (requested === 'playing') {
        if (this.state === 'finish' || action === 'restart') {
          this.restartRun();
        }
        this.beginPlay();
      } else if (requested === 'menu') {
        this.state = 'menu';
      }
    };
    this.menu.onSettings = (s) => {
      this.input.sensitivity = s.sensitivity;
      this.cam.intensity = s.cameraMotion ? 1.0 : 0.35;
    };
    // apply initial settings
    this.input.sensitivity = this.menu.settings.sensitivity;
    this.cam.intensity = this.menu.settings.cameraMotion ? 1.0 : 0.35;

    this.input.lockElement = canvas;
    this.input.attach();

    this.escHint = () => {
      if (this.state === 'playing' && !this.input.isLocked()) {
        this.pause();
      }
    };
  }

  private escHint: (() => void) | null = null;

  private onPointerLockChange(): void {
    this.escHint?.();
  }

  // --------------------------------------------------------------------------
  // State transitions
  // --------------------------------------------------------------------------
  private beginPlay(): void {
    this.audio.resume();
    this.state = 'playing';
    this.menu.hideAll();
    this.hud.show();
    this.input.requestLock();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menu.showPause();
    document.exitPointerLock();
  }

  private restartRun(): void {
    this.currentCheckpoint = -1;
    this.visitedHints.clear();
    this.runTime = 0;
    this.hud.resetIcons(this.level.checkpoints.length + 1);
    this.player.respawn(this.level.playerStart(), true);
    this.lastAttack = 0;
  }

  private finishLevel(): void {
    this.state = 'finish';
    document.exitPointerLock();
    this.menu.showFinish(this.runTime);
    this.hud.hide();
    this.audio.finish();
    this.input.releaseAll();
  }

  // --------------------------------------------------------------------------
  // Gameplay checks
  // --------------------------------------------------------------------------
  private inZone(
    p: THREE.Vector3,
    min: THREE.Vector3,
    max: THREE.Vector3
  ): boolean {
    return (
      p.x > min.x && p.x < max.x &&
      p.y > min.y && p.y < max.y &&
      p.z > min.z && p.z < max.z
    );
  }

  private updateGameplay(_dt: number): void {
    const p = this.player.position;

    // Checkpoints
    if (this.currentCheckpoint < this.level.checkpoints.length - 1) {
      const next = this.level.checkpoints[this.currentCheckpoint + 1];
      if (next && this.inZone(p, next.min, next.max)) {
        this.currentCheckpoint++;
        this.player.setRespawn(next.position.clone());
        this.audio.checkpoint();
        this.hud.toastMsg(`Checkpoint — ${next.label}`);
        this.hud.activateIcon(this.currentCheckpoint + 1);
      }
    }

    // Finish
    if (this.level.finishZone && this.inZone(p, this.level.finishZone.min, this.level.finishZone.max)) {
      this.finishLevel();
      return;
    }

    // Hint volumes
    this.level.hints.forEach((h, i) => {
      if (!this.visitedHints.has(i) && this.inZone(p, h.min, h.max)) {
        this.visitedHints.add(i);
        this.hud.hint(h.text, 3.8);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Main loop
  // --------------------------------------------------------------------------
  private loop = (): void => {
    this.animationId = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.prevTime) / 1000;
    this.prevTime = now;
    dt = Math.min(dt, TIMING.maxFrameDt);

    if (this.state === 'playing') {
      this.runTime += dt;
      this.player.update(dt);
      this.input.postUpdate();
      this.updateGameplay(dt);
      this.hud.update(dt);
      this.hud.setTimer(this.runTime);
      this.audio.level(this.player.speed, 18);
      // R = manual restart to checkpoint
      if (this.input.down('KeyR') && performance.now() - this.lastAttack > 500) {
        this.lastAttack = performance.now();
        this.player.respawn(this.respawnPoint());
      }
    }

    if (this.state === 'playing') {
      this.level.updateAnimations(this.runTime);
    }

    this.renderer.render(this.scene, this.cam.camera);
  };

  private respawnPoint(): THREE.Vector3 {
    return this.currentCheckpoint === -1
      ? this.level.playerStart()
      : this.level.checkpoints[this.currentCheckpoint].position.clone();
  }

  private onResize = (): void => {
    this.cam.setAspect(window.innerWidth / window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockedBound);
    this.input.detach();
    this.level.dispose();
    this.renderer.dispose();
  }
}
