import * as THREE from 'three';
import { Input } from '../player/Input';
import { PlayerController } from '../player/PlayerController';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { Level, CHECKPOINTS } from '../world/Level';
import { createAtmosphere } from '../world/Atmosphere';
import { AudioManager } from '../audio/AudioManager';
import { UI } from '../ui/UI';

export type GameState = 'menu' | 'playing' | 'paused' | 'finished';
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 1800);
  readonly level: Level;
  readonly player: PlayerController;
  readonly input: Input;
  readonly firstPerson: FirstPersonCamera;
  readonly audio = new AudioManager();
  readonly ui = new UI();
  private atmosphere: ReturnType<typeof createAtmosphere>;
  state: GameState = 'menu';
  checkpoint = 0;
  elapsed = 0;
  private accumulator = 0;
  private lastTime = 0;
  private hudTick = 0;
  private visualTime = 0;
  private runStarted = false;
  private frameId = 0;
  private previewTarget = new THREE.Vector3(-3, 33.6, -65);
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.atmosphere = createAtmosphere(this.scene);
    this.level = new Level(this.scene);
    this.player = new PlayerController(this.level.world);
    this.input = new Input(canvas, () => this.pause(), () => this.respawn());
    this.firstPerson = new FirstPersonCamera(this.camera, this.player, this.input);
    this.scene.add(this.camera);
    this.player.onEvent = (event, strength) => {
      this.audio.play(event);
      if (event === 'land') this.firstPerson.land(strength);
    };
    this.ui.on('start', () => this.start());
    this.ui.on('resume', () => this.resume());
    this.ui.on('pause-button', () => this.pause());
    this.ui.on('again', () => this.start());
    this.ui.on('checkpoint-restart', () => { this.respawn(); this.resume(); });
    this.ui.on('quit', () => this.title());
    this.ui.on('finish-quit', () => this.title());
    this.ui.on('settings', () => this.settings());
    this.ui.on('pause-settings', () => this.settings());
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    this.preview(0);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => {
      document.querySelector('#loading')!.setAttribute('style', 'opacity:0;pointer-events:none');
      setTimeout(() => document.querySelector('#loading')?.remove(), 550);
    });
    this.frameId = requestAnimationFrame(t => this.frame(t));
    // Development-only access for course regression tests and performance profiling.
    if (import.meta.env.DEV) Object.defineProperty(window, '__upshift', { value: this, configurable: true });
  }
  start() {
    this.elapsed = 0; this.checkpoint = 0; this.runStarted = false;
    this.player.reset(new THREE.Vector3(0, 32.01, -5));
    this.input.yaw = 0; this.input.pitch = 0; this.input.clear();
    this.firstPerson.reset(); this.updateSector(); this.resume();
  }
  resume() {
    this.state = 'playing'; this.input.enabled = true; this.accumulator = 0;
    this.input.clear(); this.ui.showState('playing'); this.firstPerson.setVisible(true);
    this.audio.init();
    try {
      const lock = this.canvas.requestPointerLock();
      if (lock) lock.catch(() => { if (this.state === 'playing') this.pause(); });
    } catch { this.pause(); }
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this.input.enabled = false; this.input.clear();
    this.ui.showState('paused');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  title() {
    this.state = 'menu'; this.input.enabled = false; this.input.clear();
    this.firstPerson.setVisible(false); this.ui.showState('menu'); this.ui.refreshBest();
    if (document.pointerLockElement) document.exitPointerLock();
    this.atmosphere.sun.position.set(-70, 110, 55); this.atmosphere.sun.target.position.set(0, 25, -35);
  }
  respawn() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const cp = CHECKPOINTS[this.checkpoint];
    this.player.reset(new THREE.Vector3(0, cp.y + 0.01, -cp.progress));
    this.input.yaw = 0; this.input.pitch = 0; this.input.clear(); this.accumulator = 0;
    this.firstPerson.reset(); this.ui.flashRespawn();
    this.ui.toast(`Back on the roof / ${cp.name}`);
  }
  private updateSector() {
    const cp = CHECKPOINTS[this.checkpoint];
    this.ui.sector(this.checkpoint, cp.name, cp.hint, cp.action);
  }
  private complete() {
    this.state = 'finished'; this.input.enabled = false; this.input.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    const previous = Number(localStorage.getItem('upshift-best') || Infinity);
    const best = Math.min(previous, this.elapsed);
    localStorage.setItem('upshift-best', String(best));
    this.ui.complete(this.elapsed, best, this.elapsed < previous);
    this.ui.showState('finished'); this.audio.play('finish');
  }
  private fixedUpdate(dt: number) {
    const controls = this.input.sample();
    if (controls.forward || controls.strafe || controls.jumpPressed) this.runStarted = true;
    if (this.runStarted) this.elapsed += dt;
    this.player.update(dt, controls, this.input.yaw);
    const progress = -this.player.position.z;
    const next = CHECKPOINTS[this.checkpoint + 1];
    if (next && progress >= next.progress && this.player.position.y > next.y - 0.3 && this.player.position.y < next.y + 4 && Math.abs(this.player.position.x) < 8) {
      this.checkpoint++; this.updateSector(); this.ui.toast(`0${this.checkpoint + 1} / ${next.name}`); this.audio.play('checkpoint');
    }
    if (this.checkpoint === 5 && progress >= this.level.finish && progress < this.level.finish + 5 && Math.abs(this.player.position.x) < 4 && this.player.position.y > 33.8 && this.player.position.y < 38) this.complete();
    if (this.player.position.y < 18 || this.player.position.y < CHECKPOINTS[this.checkpoint].y - 13) this.respawn();
  }
  private preview(time: number) {
    this.camera.position.set(7.5 + Math.sin(time * 0.08) * 0.7, 36.8 + Math.sin(time * 0.13) * 0.2, 12);
    this.camera.fov = 64; this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.previewTarget);
    this.atmosphere.sun.target.position.set(0, 25, -35);
  }
  private frame(now: number) {
    this.frameId = requestAnimationFrame(t => this.frame(t));
    const dt = Math.min((now - (this.lastTime || now)) / 1000, 0.06);
    this.lastTime = now; this.visualTime += dt;
    if (this.state === 'playing') {
      this.accumulator += dt;
      while (this.accumulator >= 1 / 120 && this.state === 'playing') {
        this.fixedUpdate(1 / 120); this.accumulator -= 1 / 120;
      }
      this.firstPerson.update(dt);
      const z = this.player.position.z;
      this.atmosphere.sun.position.set(-70, 110, z + 55);
      this.atmosphere.sun.target.position.set(0, 25, z - 35);
      this.hudTick += dt;
      if (this.hudTick > 0.05) { this.hudTick = 0; this.ui.update(this.elapsed, this.player.speed, this.player.mode, -z); }
    } else if (this.state === 'menu') this.preview(this.visualTime);
    this.audio.update(dt, this.player.speed, this.player.grounded, this.player.slideTime > 0, this.state === 'playing');
    this.atmosphere.sky.position.copy(this.camera.position);
    this.level.animate(this.visualTime);
    this.renderer.render(this.scene, this.camera);
  }
  private settings() {
    this.ui.modal(`<div class="eyebrow"><span class="red-line"></span> YOUR RUN. YOUR WAY.</div><h2>Dial it in.</h2><p>A little adjustment goes a long way.</p>
      <div class="settings-row"><div><span>Mouse sensitivity</span><small>Find your perfect pace.</small></div><div class="setting-control"><input id="sensitivity" aria-label="Mouse sensitivity" type="range" min="0.25" max="2.5" step="0.05" value="${this.input.sensitivity}"><output id="sensitivity-value">${this.input.sensitivity.toFixed(1)}</output></div></div>
      <div class="settings-row"><div><span>Camera motion</span><small>Head bob, landing impact, and camera roll.</small></div><button id="motion-toggle" class="toggle ${this.firstPerson.reducedMotion ? '' : 'active'}">${this.firstPerson.reducedMotion ? 'Reduced' : 'Full motion'}</button></div>
      <div class="settings-row"><div><span>Sound effects</span><small>The sound of staying in motion.</small></div><button id="sound-toggle" class="toggle ${this.audio.enabled ? 'active' : ''}">${this.audio.enabled ? 'On' : 'Off'}</button></div>
      <p class="settings-foot">Your preferences are saved automatically on this device.</p>`);
    document.querySelector('#sensitivity')!.addEventListener('input', e => {
      this.input.sensitivity = Number((e.target as HTMLInputElement).value);
      localStorage.setItem('upshift-sensitivity', String(this.input.sensitivity));
      document.querySelector('#sensitivity-value')!.textContent = this.input.sensitivity.toFixed(1);
    });
    this.ui.on('motion-toggle', () => {
      this.firstPerson.reducedMotion = !this.firstPerson.reducedMotion;
      localStorage.setItem('upshift-motion', this.firstPerson.reducedMotion ? 'reduced' : 'full');
      const button = document.querySelector('#motion-toggle')!;
      button.textContent = this.firstPerson.reducedMotion ? 'Reduced' : 'Full motion';
      button.classList.toggle('active', !this.firstPerson.reducedMotion);
    });
    this.ui.on('sound-toggle', () => {
      this.audio.toggle(); const button = document.querySelector('#sound-toggle')!;
      button.textContent = this.audio.enabled ? 'On' : 'Off'; button.classList.toggle('active', this.audio.enabled);
    });
  }
  private resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  dispose() {
    cancelAnimationFrame(this.frameId);
    this.renderer.dispose();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(m => m.dispose());
      }
    });
  }
}
