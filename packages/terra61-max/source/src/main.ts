import * as THREE from 'three';
import { AudioManager } from './audio/AudioManager';
import { Input } from './player/Input';
import { PlayerController } from './player/PlayerController';
import { UI } from './ui/UI';
import { checkpoints, Level } from './world/Level';
import './styles/main.css';

type GameState = 'intro' | 'requesting' | 'running' | 'paused' | 'finished';

class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly level = new Level();
  private readonly camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 700);
  private readonly audio = new AudioManager();
  private readonly input: Input;
  private readonly player: PlayerController;
  private readonly ui: UI;
  private state: GameState = 'intro';
  private checkpoint = 0;
  private elapsed = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private readonly fixedStep = 1 / 120;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'First-person rooftop parkour game');
    document.querySelector('#app')!.append(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);
    this.player = new PlayerController(this.level.collision, this.camera, (event) => this.audio.movement(event));
    this.level.scene.add(this.camera);
    this.ui = new UI({
      start: () => this.start(),
      resume: () => this.requestRun(),
      restart: () => this.start(),
      settingsChanged: (settings) => this.audio.setEnabled(settings.sound),
    });
    this.ui.show('intro');
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => this.pointerLockChanged());
    document.addEventListener('pointerlockerror', () => this.pointerLockFailed());
    window.addEventListener('blur', () => {
      if (this.state === 'running' && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    });
    requestAnimationFrame((time) => this.frame(time));
  }

  private start(): void {
    this.checkpoint = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.input.clear();
    this.player.reset(checkpoints[0].position, true);
    this.requestRun();
  }

  private requestRun(): void {
    this.state = 'requesting';
    this.audio.start();
    try {
      const result = this.renderer.domElement.requestPointerLock();
      if (result && typeof result.catch === 'function') void result.catch(() => this.pointerLockFailed());
    } catch {
      this.pointerLockFailed();
    }
  }

  private pointerLockChanged(): void {
    if (document.pointerLockElement === this.renderer.domElement) {
      if (this.state === 'requesting') {
        this.state = 'running';
        this.accumulator = 0;
        this.ui.show('playing');
      }
    } else if (this.state === 'running') {
      this.state = 'paused';
      this.ui.show('pause');
    }
  }

  private pointerLockFailed(): void {
    if (this.state === 'requesting') {
      this.state = 'paused';
      this.ui.show('pause');
    }
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private frame(time: number): void {
    const dt = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.05) : 0;
    this.lastFrame = time;
    if (this.state === 'running') {
      const [mouseX, mouseY] = this.input.takeMouse();
      this.player.look(mouseX, mouseY, this.ui.settings.sensitivity, dt);
      this.accumulator += dt;
      while (this.accumulator >= this.fixedStep && this.state === 'running') {
        if (this.input.takeRestart()) this.respawn();
        this.player.step(this.fixedStep, this.input);
        this.elapsed += this.fixedStep;
        this.updateCourse();
        this.accumulator -= this.fixedStep;
      }
      this.ui.update(this.elapsed, this.player.position.z, this.player.speed, dt, this.player.wallRunning, this.player.sliding);
    }
    this.player.render(dt, this.ui.settings.reducedMotion, this.state === 'running');
    this.audio.update(dt, this.player.speed, this.player.grounded, this.player.sliding, this.state === 'running');
    this.level.follow(this.player.position);
    this.renderer.render(this.level.scene, this.camera);
    requestAnimationFrame((nextTime) => this.frame(nextTime));
  }

  private updateCourse(): void {
    const position = this.player.position;
    if (position.y < -16) {
      this.respawn();
      return;
    }
    if (!this.player.grounded || Math.abs(position.x) > 10) return;
    for (let index = this.checkpoint + 1; index < checkpoints.length; index++) {
      const checkpoint = checkpoints[index];
      if (position.z <= checkpoint.z && Math.abs(position.y - checkpoint.position.y) < 1.5) {
        this.checkpoint = index;
        this.ui.checkpoint(checkpoint.label);
        this.audio.checkpoint();
      }
    }
    if (position.z <= this.level.finishZ && Math.abs(position.x) < 4.2 && position.y > 0.5) this.finish();
  }

  private respawn(): void {
    this.player.reset(checkpoints[this.checkpoint].position, true);
    this.input.clear();
    this.ui.checkpoint(this.checkpoint ? `RETURNED TO ${checkpoints[this.checkpoint].label}` : 'BACK TO THE START');
  }

  private finish(): void {
    this.state = 'finished';
    this.audio.finish();
    let best = this.elapsed;
    try {
      const saved = Number(window.localStorage.getItem('rooftop-flow-best'));
      if (saved > 0) best = Math.min(saved, this.elapsed);
      window.localStorage.setItem('rooftop-flow-best', String(best));
    } catch {
      // The run remains playable when browser storage is unavailable.
    }
    this.ui.finish(this.elapsed, best);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }
}

try {
  new Game();
} catch (error) {
  console.error(error);
  document.body.innerHTML = '<div class="fatal-error"><strong>UNABLE TO START</strong><p>Rooftop Flow needs a desktop browser with WebGL enabled.</p></div>';
}
