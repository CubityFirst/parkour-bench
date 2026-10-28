import * as THREE from 'three';
import { GameState } from './GameState.js';
import { PlayerController } from '../player/PlayerController.js';
import { CollisionWorld } from '../world/CollisionWorld.js';
import { CityGenerator } from '../world/CityGenerator.js';
import { Level } from '../world/Level.js';
import { Checkpoints } from '../world/Checkpoints.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { AudioManager } from '../audio/AudioManager.js';

export class Game {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  world: CollisionWorld;
  state: GameState;
  audio: AudioManager;
  player: PlayerController;
  level: Level;
  checkpoints: Checkpoints;
  hud: HUD;
  menu: Menu;

  private lastTime = performance.now();
  private accumulator = 0;
  private fixedDt = 1 / 120;
  private canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x5fbfff);
    this.scene.fog = new THREE.Fog(0x5fbfff, 80, 320);

    this.world = new CollisionWorld();
    this.state = new GameState();
    this.audio = new AudioManager();

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.7);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff8e7, 2.2);
    sun.position.set(80, 140, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    this.scene.add(sun);

    // Background city
    const cityRoot = new THREE.Object3D();
    CityGenerator(cityRoot);
    this.scene.add(cityRoot);

    // Level
    this.checkpoints = new Checkpoints(this.world, this.scene);
    this.level = new Level(this.world, this.checkpoints);
    this.scene.add(this.level.result.root);

    // Player
    this.player = new PlayerController(
      this.level.result.startPosition,
      this.world,
      this.audio,
      this.canvas,
      this.state.mouseSensitivity,
      this.state.cameraMotion as 'normal' | 'low'
    );
    this.scene.add(this.player.camera.camera);

    // UI
    this.hud = new HUD(
      this.state,
      () => this.resume(),
      () => this.restart(),
      () => this.toMenu()
    );
    this.menu = new Menu(
      this.state,
      () => this.start(),
      () => this.resume(),
      () => this.restart(),
      (value) => this.player.setSensitivity(value),
      (value) => this.player.setMotion(value)
    );

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.state.phase === 'playing') this.pause();
        else if (this.state.phase === 'paused') this.resume();
      }
      if (e.key.toLowerCase() === 'r') {
        if (this.state.phase === 'playing' || this.state.phase === 'paused') this.respawn();
      }
    });

    this.loop();
  }

  start() {
    this.audio.init();
    this.audio.resume();
    this.state.startRun();
    this.player.reset(this.level.result.startPosition);
    this.menu.hideAll();
    this.hud.show();
    this.canvas.requestPointerLock();
  }

  pause() {
    this.state.pause();
    this.hud.setPause(true);
    document.exitPointerLock();
  }

  resume() {
    if (this.state.phase === 'finished') return;
    this.state.resume();
    this.hud.setPause(false);
    this.canvas.requestPointerLock();
  }

  restart() {
    this.state.startRun();
    this.player.reset(this.level.result.startPosition);
    this.menu.hideAll();
    this.hud.show();
    this.hud.setPause(false);
    this.canvas.requestPointerLock();
  }

  respawn() {
    const cp = this.checkpoints.list.find((c) => c.index === this.state.currentCheckpoint);
    const pos = cp ? cp.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : this.level.result.startPosition.clone();
    this.player.reset(pos);
  }

  toMenu() {
    this.state.phase = 'menu';
    this.hud.hide();
    this.menu.showMain();
    document.exitPointerLock();
  }

  onPointerLockChange() {
    if (document.pointerLockElement !== this.canvas && this.state.phase === 'playing') {
      // auto-pause when clicking away
      // this.pause(); // can be annoying; leave manual
    }
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.player.handleResize(window.innerWidth, window.innerHeight);
  }

  private loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.state.phase === 'playing') {
      this.accumulator += frameDt;
      while (this.accumulator >= this.fixedDt) {
        this.player.update(this.fixedDt);
        this.checkGameplay();
        this.accumulator -= this.fixedDt;
      }
      this.state.updateTimer();
      this.hud.update();
      this.updateHints();
    }

    this.renderer.render(this.scene, this.player.camera.camera);
  }

  private checkGameplay() {
    const pos = this.player.getPosition();

    // Checkpoints
    const cpIndex = this.checkpoints.checkPlayer(pos, this.state.currentCheckpoint);
    if (cpIndex !== null) {
      this.state.setCheckpoint(cpIndex);
      this.audio.checkpoint();
    }

    // Fall off
    if (pos.y < -20) {
      this.respawn();
    }

    // Finish
    const finish = this.level.result.finishPosition;
    const dx = pos.x - finish.x;
    const dz = pos.z - finish.z;
    if (dx * dx + dz * dz < this.level.result.finishRadius * this.level.result.finishRadius) {
      this.audio.finish();
      this.state.finish();
      this.hud.hide();
      document.exitPointerLock();
    }
  }

  private updateHints() {
    const pos = this.player.getPosition();
    const z = pos.z;
    let hint = '';
    if (z < 12) hint = 'WASD to move, SPACE to jump, SHIFT to sprint';
    else if (z < 28) hint = 'Press E near low obstacles to vault';
    else if (z < 70) hint = 'Sprint and jump across the gaps';
    else if (z < 145) hint = 'Follow the red markers';
    else if (z < 178) hint = 'Press CTRL or C to slide under vents';
    else if (z < 210) hint = 'Run alongside the red wall to wall-run';
    else if (z < 300) hint = 'Chain vaults, jumps, slides and wall-runs';
    else hint = 'Sprint to the red finish!';
    this.hud.setHint(hint);
  }
}
