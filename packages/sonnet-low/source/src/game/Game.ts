import * as THREE from 'three';
import { GameState } from './GameState';
import { Level } from '../world/Level';
import { buildCity, makeSky, SUN_DIR } from '../world/CityGenerator';
import { PlayerController } from '../player/PlayerController';
import { AudioManager } from '../audio/AudioManager';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';

const STEP = 1 / 120; // fixed physics timestep

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private level: Level;
  private player: PlayerController;
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private state = new GameState();
  private audio = new AudioManager();
  private hud = new HUD();
  private menu: Menu;
  private acc = 0;
  private last = performance.now();
  private idleTime = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // sky + image-based lighting generated from it (gives the glass its blue reflections)
    this.sky = makeSky();
    this.scene.add(this.sky);
    const envScene = new THREE.Scene();
    envScene.add(makeSky());
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.fog = new THREE.Fog(0xc2dcf0, 80, 720);

    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xe8edf2, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);

    this.level = new Level();
    this.scene.add(this.level.group);
    this.scene.add(buildCity(this.level.facade));

    this.player = new PlayerController(this.level.world, window.innerWidth / window.innerHeight);
    this.scene.add(this.player.cam.camera);
    this.player.events = {
      jump: () => this.audio.jump(),
      land: (i) => this.audio.land(i),
      step: (s) => this.audio.footstep(s),
      slide: (on) => this.audio.setSlide(on),
      mantle: () => this.audio.mantle(),
    };

    this.menu = new Menu(this.state, {
      onStart: () => this.startRun(),
      onResume: () => this.requestLock(),
      onRestart: () => this.startRun(),
    });

    this.resetRun();
    this.menu.showMain();
    this.bindEvents();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---------- run flow ----------
  private resetRun(): void {
    this.state.time = 0;
    this.state.running = false;
    this.level.checkpoints.reset();
    this.level.resetCheckpointVisuals();
    this.player.respawn(this.level.spawn, 0);
    this.hud.setTime(0);
    this.hud.setHint('');
  }

  private startRun(): void {
    this.audio.init();
    this.resetRun();
    this.state.running = true;
    this.state.phase = 'playing';
    this.menu.hide();
    this.hud.show(true);
    this.requestLock();
  }

  private requestLock(): void {
    this.audio.init();
    this.state.phase = 'playing';
    this.menu.hide();
    this.hud.show(true);
    this.player.clearInput();
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => { /* user can click the canvas to retry */ });
    } catch { /* ignore */ }
  }

  private pause(): void {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'paused';
    this.player.clearInput();
    this.audio.setSlide(false);
    this.audio.setWind(0);
    this.menu.showPause();
  }

  private respawn(): void {
    this.player.respawn(this.level.checkpoints.respawn, 0);
    this.hud.flash();
    this.audio.respawn();
  }

  private finish(): void {
    this.state.running = false;
    this.state.phase = 'finished';
    const isNew = this.state.recordFinish(this.state.time);
    this.audio.finish();
    this.audio.setSlide(false);
    this.audio.setWind(0);
    this.player.clearInput();
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show(false);
    this.menu.showFinish(this.state.time, this.state.best!, isNew);
  }

  // ---------- events ----------
  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.player.cam.camera.aspect = window.innerWidth / window.innerHeight;
      this.player.cam.camera.updateProjectionMatrix();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) {
        this.state.phase = 'playing';
        this.menu.hide();
      } else if (this.state.phase === 'playing') {
        this.pause();
      }
    });
    document.addEventListener('pointerlockerror', () => { /* keep playing; click canvas to retry */ });
    this.canvas.addEventListener('click', () => {
      if (this.state.phase === 'playing' && document.pointerLockElement !== this.canvas) this.requestLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (this.state.phase !== 'playing' || document.pointerLockElement !== this.canvas) return;
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return; // ignore spikes
      this.player.cam.look(e.movementX, e.movementY, this.state.settings.sensitivity);
    });
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ControlLeft', 'ControlRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (this.state.phase !== 'playing') return;
      if (e.repeat) return;
      if (e.code === 'KeyR') { this.respawn(); return; }
      if (e.code === 'Escape' && document.pointerLockElement !== this.canvas) { this.pause(); return; }
      this.player.keyDown(e.code);
    });
    window.addEventListener('keyup', (e) => this.player.keyUp(e.code));
    window.addEventListener('blur', () => this.player.clearInput());
  }

  // ---------- simulation ----------
  private simulate(dt: number): void {
    const p = this.player.physics;
    this.player.update(dt);
    if (this.state.running) this.state.time += dt;

    const cp = this.level.checkpoints.update(p.pos);
    if (cp) {
      this.level.activateCheckpointVisual(cp.disc);
      this.hud.toast('CHECKPOINT');
      this.audio.checkpoint();
    }
    if (p.pos.y < this.level.killY) { this.respawn(); return; }

    const f = this.level.finish;
    if (p.pos.x > f.minX && p.pos.x < f.maxX && p.pos.y > f.minY && p.pos.y < f.maxY && p.pos.z > f.minZ && p.pos.z < f.maxZ) {
      this.finish();
    }
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    this.player.cam.reduceMotion = this.state.settings.reduceMotion;

    if (this.state.phase === 'playing') {
      this.acc += dt;
      while (this.acc >= STEP && this.state.phase === 'playing') {
        this.simulate(STEP);
        this.acc -= STEP;
      }
      this.player.updateCamera(dt, this.acc / STEP);
      this.hud.setTime(this.state.time);
      this.hud.setSpeed(this.player.hSpeed);
      this.audio.setWind(this.player.hSpeed);
      const d = -this.player.physics.pos.z;
      const hint = this.level.hints.find((h) => d >= h.d0 && d < h.d1);
      this.hud.setHint(hint ? hint.text : '');
    } else if (this.state.phase === 'menu') {
      // gentle idle camera sway behind the menu
      this.idleTime += dt;
      this.player.cam.yaw = Math.sin(this.idleTime * 0.15) * 0.35;
      this.player.cam.pitch = -0.08;
      this.player.updateCamera(dt, 1);
    }

    // sun + shadow frustum follow the camera so shadows stay sharp near the player
    const c = this.player.cam.camera.position;
    this.sun.target.position.set(c.x, c.y - 6, c.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 140);
    this.sky.position.copy(c);

    this.renderer.render(this.scene, this.player.cam.camera);
  };
}
