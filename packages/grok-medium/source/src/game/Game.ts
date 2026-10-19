import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PHYS } from '../player/constants';
import { PlayerBody } from '../player/PlayerBody';
import { PlayerController } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { buildCity } from '../world/CityGenerator';
import { Level } from '../world/Level';
import { createMaterials } from '../world/Materials';
import { Input } from './Input';
import type { Settings } from './types';

const BEST_KEY = 'rooftop-flow-best';
const SENS_KEY = 'rooftop-flow-sens';
const MOTION_KEY = 'rooftop-flow-motion';

type Phase = 'menu' | 'playing' | 'paused' | 'finished';

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly input: Input;
  private readonly level: Level;
  private readonly player: PlayerController;
  private readonly fps: FirstPersonCamera;
  private readonly body: PlayerBody;
  private readonly hud: HUD;
  private readonly menu: Menu;
  private readonly audio = new AudioManager();
  private readonly sun: THREE.DirectionalLight;
  private readonly sunTarget = new THREE.Object3D();
  private readonly flash: HTMLElement;
  private phase: Phase = 'menu';
  private settings: Settings;
  private best: number | null;
  private time = 0;
  private timerOn = false;
  private acc = 0;
  private last = performance.now();
  private menuT = 0;
  private debug: THREE.LineSegments | null = null;
  private showDebug = false;

  constructor() {
    const canvas = document.querySelector('#c') as HTMLCanvasElement;
    const overlay = document.querySelector('#overlay') as HTMLElement;
    const hudRoot = document.querySelector('#hud') as HTMLElement;
    this.flash = document.querySelector('#flash') as HTMLElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = new THREE.Fog(0xc5e4f6, 48, 250);
    this.scene.add(new THREE.HemisphereLight(0xf4f8ff, 0xb7c3cc, 0.68));
    this.sun = new THREE.DirectionalLight(0xfff4e4, 2.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.04;
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -24;
    cam.right = 24;
    cam.top = 24;
    cam.bottom = -24;
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    const mats = createMaterials(this.renderer);
    this.level = new Level(this.scene, mats);
    buildCity(this.scene, mats, {
      minX: -32,
      maxX: 32,
      minZ: this.level.course.play.minZ,
      maxZ: this.level.course.play.maxZ,
    });

    const spawn = this.level.course.spawn;
    this.player = new PlayerController(this.level.solids, this.level.course.triggers, spawn, this.level.course.killY);
    this.fps = new FirstPersonCamera(this.player.view);
    this.scene.add(this.player.view);
    this.body = new PlayerBody(this.fps.camera, this.scene);
    this.fps.resize(window.innerWidth, window.innerHeight);

    this.settings = loadSettings();
    this.best = loadBest();
    this.input = new Input(canvas);
    this.menu = new Menu(overlay, this.settings);
    this.hud = new HUD(hudRoot, this.settings);
    this.hud.hide();
    this.menu.show(this.best);

    this.menu.onStart = () => this.startRun();
    this.menu.onChange = (s) => this.applySettings(s);
    this.hud.onChange = (s) => this.applySettings(s);
    this.hud.onResume = () => this.input.lock();
    this.hud.onRestart = () => this.startRun();
    this.hud.onFinishRestart = () => this.startRun();
    this.hud.onMenu = () => this.toMenu();

    document.addEventListener('pointerlockchange', () => {
      if (this.phase === 'finished' || this.phase === 'menu') return;
      if (this.input.locked) {
        this.phase = 'playing';
        this.hud.setPlaying();
      } else if (this.phase === 'playing') {
        this.phase = 'paused';
        this.hud.setPaused(this.settings);
      }
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.fps.resize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2') this.toggleDebug();
    });

    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  private startRun(): void {
    this.player.respawn(0);
    this.player.yaw = 0;
    this.player.pitch = 0;
    this.player.syncView();
    this.time = 0;
    this.timerOn = false;
    this.phase = 'playing';
    this.menu.hide();
    this.hud.setPlaying();
    this.hud.setTime(0);
    this.audio.resume();
    this.input.lock();
  }

  private toMenu(): void {
    this.phase = 'menu';
    this.timerOn = false;
    this.input.unlock();
    this.hud.hide();
    this.menu.show(this.best);
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    localStorage.setItem(SENS_KEY, String(settings.sensitivity));
    localStorage.setItem(MOTION_KEY, String(settings.motion));
    this.hud.syncSliders(settings);
  }

  snapshot(): {
    phase: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    grounded: boolean;
    h: number;
    checkpoint: number;
    sliding: boolean;
    wall: number;
  } {
    return {
      phase: this.phase,
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      yaw: this.player.yaw,
      grounded: this.player.grounded,
      h: this.player.h,
      checkpoint: this.player.checkpoint,
      sliding: this.player.sliding,
      wall: this.player.wallSide,
    };
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const sampled = this.input.sample();

    if (this.phase === 'menu') {
      this.menuT += dt;
      this.player.yaw = Math.sin(this.menuT * 0.22) * 0.42;
      this.player.pitch = -0.16 + Math.sin(this.menuT * 0.17) * 0.05;
      this.player.syncView();
    } else if (this.phase === 'playing') {
      if (!this.timerOn && (sampled.frame.forward || sampled.frame.strafe || sampled.frame.jumpPressed)) {
        this.timerOn = true;
      }
      this.player.addLook(sampled.dx, sampled.dy, this.settings.sensitivity);
      this.acc += dt;
      if (this.acc > 0.1) this.acc = 0.1;
      while (this.acc >= PHYS.fixedDt) {
        const ev = this.player.update(PHYS.fixedDt, sampled.frame);
        sampled.frame.jumpPressed = false;
        sampled.frame.vaultPressed = false;
        this.acc -= PHYS.fixedDt;
        if (this.timerOn) this.time += PHYS.fixedDt;
        this.applyEvents(ev);
        if (this.phase !== 'playing') break;
      }
      if (this.input.consumeRestart()) {
        this.player.respawn();
        this.flashHit();
      }
    }

    this.fps.update(dt, this.player, this.phase === 'menu' ? 0.35 : this.settings.motion);
    this.body.update(this.player, this.fps.bobPhase);
    this.level.update(now / 1000);
    this.audio.update(this.player.speed, PHYS.sprint, this.player.sliding);

    const px = this.player.x;
    const py = this.player.y + 8;
    const pz = this.player.z;
    this.sun.position.set(px + 20, py + 26, pz + 12);
    this.sunTarget.position.set(px, this.player.y, pz);
    this.sun.shadow.camera.updateProjectionMatrix();

    if (this.phase === 'playing' || this.phase === 'paused') {
      this.hud.setTime(this.time);
      this.hud.setHint(this.player.hint, this.player.prompt);
    }

    this.renderer.render(this.scene, this.fps.camera);
  }

  private applyEvents(ev: ReturnType<PlayerController['update']>): void {
    if (ev.jumped) this.audio.jump();
    if (ev.footstep) this.audio.footstep(this.player.speed);
    if (ev.landed) {
      this.audio.land(ev.impact);
      this.fps.kick(ev.impact, this.settings.motion);
    }
    if (ev.checkpointName) {
      this.audio.checkpoint();
      this.hud.toast(ev.checkpointName);
    }
    if (ev.respawn) this.flashHit();
    if (ev.finish && this.phase === 'playing') this.complete();
  }

  private complete(): void {
    this.phase = 'finished';
    this.timerOn = false;
    this.input.unlock();
    const previous = this.best;
    const isNew = previous === null || this.time < previous;
    if (isNew) {
      this.best = this.time;
      localStorage.setItem(BEST_KEY, String(this.time));
    }
    this.hud.setFinished(this.time, this.best ?? this.time, isNew);
    this.audio.finish();
  }

  private flashHit(): void {
    this.flash.classList.add('on');
    window.setTimeout(() => this.flash.classList.remove('on'), 140);
  }

  private toggleDebug(): void {
    this.showDebug = !this.showDebug;
    if (!this.showDebug) {
      if (this.debug) this.debug.visible = false;
      return;
    }
    if (!this.debug) {
      const positions: number[] = [];
      for (const s of this.level.solids) {
        const x0 = s.minX, x1 = s.maxX, y0 = s.minY, y1 = s.maxY, z0 = s.minZ, z1 = s.maxZ;
        const corners = [
          [x0, y0, z0], [x1, y0, z0], [x1, y0, z0], [x1, y0, z1], [x1, y0, z1], [x0, y0, z1], [x0, y0, z1], [x0, y0, z0],
          [x0, y1, z0], [x1, y1, z0], [x1, y1, z0], [x1, y1, z1], [x1, y1, z1], [x0, y1, z1], [x0, y1, z1], [x0, y1, z0],
          [x0, y0, z0], [x0, y1, z0], [x1, y0, z0], [x1, y1, z0], [x1, y0, z1], [x1, y1, z1], [x0, y0, z1], [x0, y1, z1],
        ];
        for (const c of corners) positions.push(c[0], c[1], c[2]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this.debug = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00e5ff }));
      this.scene.add(this.debug);
    }
    this.debug.visible = true;
  }
}

function loadSettings(): Settings {
  const sensRaw = localStorage.getItem(SENS_KEY);
  const motionRaw = localStorage.getItem(MOTION_KEY);
  const sensitivity = sensRaw === null ? NaN : Number(sensRaw);
  const motion = motionRaw === null ? NaN : Number(motionRaw);
  return {
    sensitivity: Number.isFinite(sensitivity) && sensitivity >= 0.4 && sensitivity <= 2 ? sensitivity : 1,
    motion: Number.isFinite(motion) && motion >= 0 && motion <= 1 ? motion : 1,
  };
}

function loadBest(): number | null {
  const n = Number(localStorage.getItem(BEST_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}
