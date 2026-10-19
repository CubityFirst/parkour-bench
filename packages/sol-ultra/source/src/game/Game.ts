import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { Level } from '../world/Level';
import { createSky } from '../world/Sky';
import { HUD } from '../ui/HUD';
import { AudioManager } from '../audio/AudioManager';
import type { GameState } from './GameState';

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.055, 1200);
  readonly renderer: THREE.WebGLRenderer;
  readonly level: Level;
  readonly player: PlayerController;
  readonly hud: HUD;
  readonly audio = new AudioManager();
  state: GameState = 'menu';
  elapsed = 0;
  section = 0;
  best: number | null = null;
  private accumulator = 0;
  private lastFrame = 0;
  private raf = 0;
  private sun: THREE.DirectionalLight;
  private wasLocked = false;
  private shadowUpdate = 0;
  private readonly fixedStep = 1 / 120;

  constructor(root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Three dimensional rooftop course');
    root.appendChild(this.renderer.domElement);
    this.scene.fog = new THREE.Fog('#bddce8', 135, 530);
    createSky(this.scene);
    this.scene.add(new THREE.HemisphereLight('#d7efff', '#4c7387', 1.75));
    this.sun = new THREE.DirectionalLight('#fff3da', 3.35);
    this.sun.position.set(45, 75, -35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -60, right: 60, top: 65, bottom: -65, near: 1, far: 230 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);
    this.level = new Level(this.scene);
    this.player = new PlayerController(this.camera, this.level.world);
    this.scene.add(this.camera);
    this.player.respawn(this.level.start, this.level.startYaw);
    this.player.render(0, 0);
    try {
      const saved = Number(localStorage.getItem('stride-best'));
      if (Number.isFinite(saved) && saved > 0) this.best = saved;
    } catch { /* Local storage is optional in private browsing. */ }
    this.hud = new HUD({
      start: () => this.startRun(),
      resume: () => this.resume(),
      restart: () => this.startRun(),
      settings: (settings) => {
        this.player.sensitivity = settings.sensitivity;
        this.player.reducedMotion = settings.reducedMotion;
        this.audio.setEnabled(settings.sound);
      }
    });
    this.hud.setScreen('menu');
    this.setMenuCamera(0);
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing' && document.pointerLockElement !== this.renderer.domElement) this.lockPointer();
    });
  }

  private lockPointer() {
    try {
      const result = this.renderer.domElement.requestPointerLock();
      if (result) result.catch(() => { this.hud.notify('CLICK THE CITY TO FOCUS', 'WASD to move · Mouse to look'); });
    } catch { this.hud.notify('CLICK THE CITY TO FOCUS'); }
  }

  startRun() {
    this.state = 'playing';
    this.elapsed = 0;
    this.section = 0;
    this.accumulator = 0;
    this.player.respawn(this.level.start, this.level.startYaw);
    this.player.input.clear();
    this.player.enabled = true;
    this.player.events.length = 0;
    this.hud.setScreen('playing');
    this.hud.notify('YOUR RUN STARTS HERE', 'Follow the red. Find your flow.');
    void this.audio.unlock();
    this.lockPointer();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.player.enabled = false;
    this.player.input.clear();
    this.hud.setScreen('paused');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.player.enabled = true;
    this.player.input.clear();
    this.hud.setScreen('playing');
    void this.audio.unlock();
    this.lockPointer();
  }

  respawn() {
    const checkpoint = this.level.checkpoints[this.section];
    this.player.respawn(checkpoint?.position ?? this.level.start, this.level.startYaw);
    this.player.input.clear();
    this.hud.notify('BACK IN THE FLOW', `Checkpoint ${String(this.section + 1).padStart(2, '0')} · Keep moving`);
  }

  private finishRun() {
    if (this.state !== 'playing') return;
    this.state = 'finished';
    this.player.enabled = false;
    this.player.input.clear();
    this.best = Math.min(this.best ?? Infinity, this.elapsed);
    try { localStorage.setItem('stride-best', String(this.best)); } catch { /* optional persistence */ }
    this.hud.complete(this.elapsed, this.best);
    this.audio.play('finish');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private advanceRoute() {
    const p = this.player.position;
    if (p.y < -20) { this.respawn(); return; }
    for (let i = this.section + 1; i < this.level.checkpoints.length; i++) {
      const point = this.level.checkpoints[i];
      if (p.z <= point.position.z && Math.abs(p.x - point.position.x) < 15 && Math.abs(p.y - point.position.y) < 4) {
        this.section = i;
        this.audio.play('checkpoint');
        this.hud.notify(`CHECKPOINT ${String(i + 1).padStart(2, '0')}`, point.title);
      }
    }
    if (this.level.finish.containsPoint(p)) this.finishRun();
  }

  private contextualHint(fallback: string): string {
    if (this.player.state === 'WALL RUN') return 'Keep moving along the wall · SPACE to jump away';
    if (this.player.state === 'VAULTING') return 'Keep your momentum · Line up your next landing';
    const p = this.player.position;
    const forwardX = -Math.sin(this.player.yaw);
    const forwardZ = -Math.cos(this.player.yaw);
    for (const { box, kind } of this.level.world.colliders) {
      const dx = (box.min.x + box.max.x) * 0.5 - p.x;
      const dz = (box.min.z + box.max.z) * 0.5 - p.z;
      const ahead = dx * forwardX + dz * forwardZ;
      const lateral = Math.abs(dx * -forwardZ + dz * forwardX);
      if (ahead < 0 || ahead > 7 || lateral > (box.max.x - box.min.x) * 0.5 + 0.3) continue;
      if (kind === 'vault') return ahead < 2.1 ? 'Press E to vault the red barrier' : 'Red barrier ahead · E to vault';
      if (box.min.y - p.y > 0.85 && box.min.y - p.y < 1.25) return 'Hold C / CTRL to slide under the red duct';
    }
    if (forwardZ < -0.7) {
      const floor = this.level.world.colliders.find(({ box }) =>
        Math.abs(box.max.y - p.y) < 0.15 && p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z && box.max.z - box.min.z > 10);
      if (floor && p.z - floor.box.min.z < 7 && p.z > -680) {
        const wall = this.level.world.colliders.find(({ box, kind }) => kind === 'wallrun' && p.z > box.min.z && p.z < box.max.z + 4);
        return wall ? 'Sprint + jump beside the red wall · Keep moving forward' : 'Hold SHIFT + SPACE for a long running jump';
      }
    }
    return fallback;
  }

  private setMenuCamera(time: number) {
    const start = this.level.start;
    this.camera.position.set(start.x + 5.5 + Math.sin(time * 0.11) * 0.22, start.y + 3.1, start.z + 4);
    this.camera.lookAt(start.x + 0.5, start.y + 2.5, start.z - 44);
    this.camera.fov = 76;
    this.camera.updateProjectionMatrix();
  }

  startLoop() {
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const frameDelta = (now - this.lastFrame) / 1000;
    const dt = Math.min(frameDelta, 0.06);
    this.lastFrame = now;
    const time = now / 1000;
    if (this.state === 'playing') {
      this.elapsed += frameDelta;
      this.accumulator += dt;
      while (this.accumulator >= this.fixedStep) {
        this.player.update(this.fixedStep);
        this.advanceRoute();
        this.accumulator -= this.fixedStep;
        if (this.state !== 'playing') { this.accumulator = 0; break; }
      }
      this.player.render(dt, time);
      for (const event of this.player.events.splice(0)) this.audio.play(event);
    } else if (this.state === 'menu') {
      this.setMenuCamera(time);
    }
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    this.audio.update(dt, speed, this.player.grounded, this.player.state === 'SLIDING', this.state === 'playing');
    const current = this.level.checkpoints[this.section];
    this.hud.update({
      time: this.elapsed,
      best: this.best,
      speed,
      section: this.section,
      sectionTitle: current?.title ?? 'THE FIRST STEP',
      hint: this.contextualHint(current?.hint ?? 'WASD to move · SHIFT to sprint · Follow the red'),
      progress: THREE.MathUtils.clamp((this.level.start.z - this.player.position.z) / this.level.length, 0, 1),
      state: this.player.state
    });
    this.level.update(time);
    // Keep a single compact shadow volume around the current rooftop.
    this.shadowUpdate += dt;
    if (this.shadowUpdate > 0.12) {
      const p = this.state === 'menu' ? this.level.start : this.player.position;
      this.sun.position.set(p.x + 45, 75, p.z - 35);
      this.sun.target.position.set(p.x, 0, p.z - 15);
      this.sun.target.updateMatrixWorld();
      this.shadowUpdate = 0;
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private onResize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && this.state === 'playing') this.pause();
    if (event.code === 'KeyR' && this.state === 'playing' && !event.repeat) this.respawn();
    if (this.state === 'playing' && ['Space', 'ControlLeft', 'ControlRight', 'Tab'].includes(event.code)) event.preventDefault();
  };
  private onPointerLock = () => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (!locked && this.wasLocked && this.state === 'playing') this.pause();
    this.wasLocked = locked;
  };
  private onBlur = () => { this.pause(); };
  private onVisibility = () => { if (document.hidden) this.pause(); };

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.player.dispose();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    this.renderer.dispose();
  }
}
