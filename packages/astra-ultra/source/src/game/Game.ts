import * as THREE from 'three';
import { Level } from '../world/Level';
import { PlayerController } from '../player/PlayerController';
import { AudioManager } from '../audio/AudioManager';
import { Interface, type Settings } from '../ui/Interface';

export type GameState = 'menu' | 'playing' | 'paused' | 'finished';
const STEP = 1 / 120;

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, .08, 1300);
  readonly renderer: THREE.WebGLRenderer;
  readonly level: Level;
  readonly player: PlayerController;
  readonly ui: Interface;
  readonly audio = new AudioManager();
  state: GameState = 'menu';
  elapsed = 0;
  checkpointIndex = 0;
  falls = 0;
  private best: number | null = null;
  private accumulator = 0;
  private lastFrame = 0;
  private animation = 0;
  private uiTime = 0;
  private sun = new THREE.DirectionalLight(0xfff4db, 3.3);
  private sky: THREE.Mesh;
  private disposed = false;
  private pointerFailure = false;
  private lastHint = '';
  private routeHints = [
    '[W A S D] Move · [SHIFT] Sprint · [SPACE] Jump',
    '[SHIFT] Build speed · Hold [SPACE] to clear the gaps',
    'Get low. Press [C] or [CTRL] while sprinting to slide',
    'Follow the red stripe to the wall · Sprint + [SPACE] beside it',
    '[E] Vault · [C] Slide · Jump along the red wall',
    'The last stretch. Keep your speed. Follow the red.',
  ];

  constructor(root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.id = 'world';
    this.renderer.domElement.setAttribute('aria-label', 'Redline rooftop parkour game');
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x9ed5e8);
    this.scene.fog = new THREE.Fog(0xbcdce5, 110, 530);
    this.sky = this.createSky();
    this.scene.add(this.sky, this.camera);
    this.scene.add(new THREE.HemisphereLight(0xc3eaff, 0x718d96, 1.25));
    this.sun.position.set(-70, 140, 45);
    this.sun.target.position.set(0, 35, -40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 5, far: 280 });
    this.sun.shadow.normalBias = .035;
    this.sun.shadow.bias = -.00012;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);
    this.level = new Level(this.scene);
    this.player = new PlayerController(this.camera, this.level.world, this.renderer.domElement);
    this.player.reset(this.level.spawn);
    this.ui = new Interface(root);
    this.ui.onStart = () => this.start();
    this.ui.onRestart = () => this.start();
    this.ui.onResume = () => this.resume();
    this.ui.onMenu = () => this.menu();
    this.ui.onSettings = (settings) => this.settings(settings);
    this.ui.el('pause-button').onclick = () => this.pause();
    this.player.onEvent = (event) => this.audio.play(event);
    this.settings(this.ui.settings);
    try {
      const stored = localStorage.getItem('redline.best');
      if (stored && Number.isFinite(Number(stored)) && Number(stored) > 0) this.best = Number(stored);
    } catch { /* The course is playable without browser storage. */ }
    this.ui.setBest(this.best);
    this.ui.mode('menu');
    this.menuCamera(0);
    window.addEventListener('resize', this.resize);
    document.addEventListener('pointerlockchange', this.pointerLockChange);
    document.addEventListener('keydown', this.keyDown);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    this.renderer.domElement.addEventListener('click', () => { if (this.state === 'playing' && !document.pointerLockElement) this.lockPointer(); });
    this.animation = requestAnimationFrame(this.frame);
  }

  private createSky(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(1100, 24, 12);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x087fbf) }, horizon: { value: new THREE.Color(0xb5def1) } },
      vertexShader: `varying vec3 vPosition; void main(){ vPosition = position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPosition;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y); }
        void main(){ vec3 d=normalize(vPosition); float h=max(0.,d.y); vec3 col=mix(horizon,top,pow(h,.42));
          vec2 uv=d.xz/(max(.07,d.y)+.22)*2.8; float cloud=noise(uv)*.6+noise(uv*2.1)*.25+noise(uv*4.2)*.15;
          float mask=smoothstep(.58,.8,cloud)*smoothstep(.02,.15,h)*(1.-smoothstep(.45,.8,h));
          col=mix(col,vec3(.96,.98,1.),mask*.8); gl_FragColor=vec4(col,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return new THREE.Mesh(geometry, material);
  }

  private settings(settings: Settings) {
    this.player.sensitivity = settings.sensitivity;
    this.player.reducedMotion = settings.reducedMotion;
    this.audio.setVolume(settings.volume);
  }

  start() {
    this.audio.init();
    this.elapsed = 0;
    this.falls = 0;
    this.checkpointIndex = 0;
    this.accumulator = 0;
    this.player.reset(this.level.spawn);
    this.player.enabled = true;
    this.state = 'playing';
    this.camera.fov = 75;
    this.camera.updateProjectionMatrix();
    this.ui.mode('playing');
    this.setSection(0);
    this.lockPointer();
  }

  private lockPointer() {
    this.pointerFailure = false;
    try {
      const result = this.renderer.domElement.requestPointerLock();
      if (result instanceof Promise) result.catch(() => {
        if (this.state !== 'playing') return;
        this.pointerFailure = true;
        this.ui.toast('Drag to look · click to capture the mouse', 'MOUSE LOOK');
      });
    } catch {
      this.pointerFailure = true;
      this.ui.toast('Drag to look · click to capture the mouse', 'MOUSE LOOK');
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.player.enabled = false;
    this.player.input.clear();
    this.accumulator = 0;
    this.ui.mode('paused');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.init();
    this.state = 'playing';
    this.player.enabled = true;
    this.ui.mode('playing');
    this.lockPointer();
  }

  menu() {
    this.state = 'menu';
    this.player.enabled = false;
    this.player.input.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.mode('menu');
    this.ui.setBest(this.best);
    this.camera.children.forEach(child => { child.visible = false; });
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
  }

  respawn() {
    this.falls++;
    const checkpoint = this.level.checkpoints[this.checkpointIndex];
    this.player.reset(checkpoint.position, checkpoint.yaw);
    this.ui.respawn();
    this.audio.play('respawn');
  }

  private setSection(index: number) {
    const section = this.level.checkpoints[index];
    this.ui.section(index, section.name, this.routeHints[index]);
    this.lastHint = this.routeHints[index];
  }

  private contextualHint() {
    const p = this.player.position;
    let hint = this.routeHints[this.checkpointIndex];
    if (this.player.wallRunning) hint = 'Stay close to the wall · [SPACE] Jump away';
    else {
      for (const solid of this.level.world.colliders) {
        const ahead = p.z - solid.max.z;
        if (solid.kind === 'wallrun' && p.z < solid.max.z + 10 && p.z > solid.min.z) {
          hint = `Move ${solid.min.x > 0 ? 'right' : 'left'} to the red stripe · [SHIFT] + [SPACE] Wall-run`;
          break;
        }
        if (ahead < -3 || ahead > 8 || p.x < solid.min.x - .3 || p.x > solid.max.x + .3) continue;
        if (solid.name === 'Low ventilation duct') { hint = '[SHIFT] Build speed · [C] / [CTRL] Slide under the duct'; break; }
        if (solid.name === 'Vault barrier') { hint = '[E] Vault the red barrier. Keep your momentum.'; break; }
      }
    }
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.ui.hint(hint);
    }
  }

  private complete() {
    this.state = 'finished';
    this.player.enabled = false;
    this.player.input.clear();
    this.audio.play('finish');
    const newBest = this.best === null || this.elapsed < this.best;
    if (newBest) {
      this.best = this.elapsed;
      try { localStorage.setItem('redline.best', this.elapsed.toString()); } catch { /* Optional persistence. */ }
    }
    this.ui.finish(this.elapsed, this.best!, newBest, this.falls);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Simulation is independent of rendering; substeps prevent tunnelling at sprint speed. */
  tick(dt: number) {
    if (this.state !== 'playing') return;
    this.elapsed += dt;
    this.player.update(dt);
    const p = this.player.position;
    if (p.y < 23) { this.respawn(); return; }
    const next = this.level.checkpoints[this.checkpointIndex + 1];
    if (next && p.z <= next.position.z && p.z > next.position.z - 25 && Math.abs(p.x - next.position.x) < 10 && Math.abs(p.y - next.position.y) < 3 && this.player.grounded) {
      this.checkpointIndex++;
      this.setSection(this.checkpointIndex);
      this.ui.toast(`${String(this.checkpointIndex + 1).padStart(2,'0')} / ${next.name}`);
      this.audio.play('checkpoint');
    }
    if (this.checkpointIndex === this.level.checkpoints.length - 1 && p.z <= this.level.finish.z && Math.abs(p.x - this.level.finish.x) < 6 && Math.abs(p.y - this.level.finish.y) < 3) this.complete();
  }

  private menuCamera(time: number) {
    const sway = this.ui?.settings.reducedMotion ? 0 : Math.sin(time * .08) * .6;
    this.camera.position.set(8 + sway, 44.6, 17);
    this.camera.lookAt(-1, 43, -47);
  }

  private frame = (timestamp: number) => {
    if (this.disposed) return;
    const dt = this.lastFrame ? Math.min((timestamp - this.lastFrame) / 1000, .1) : 0;
    this.lastFrame = timestamp;
    const time = timestamp / 1000;
    if (this.state === 'playing') {
      this.accumulator += dt;
      while (this.accumulator >= STEP) { this.tick(STEP); this.accumulator -= STEP; }
      this.player.render(dt, time);
    } else if (this.state === 'menu') this.menuCamera(time);
    this.sky.position.copy(this.camera.position);
    // Shadow coverage follows the runner in world units instead of redrawing the whole city.
    const shadowZ = Math.round(this.camera.position.z / 12) * 12 - 35;
    this.sun.position.set(-70, 140, shadowZ + 85);
    this.sun.target.position.set(0, 35, shadowZ);
    this.level.update(time);
    this.audio.update(this.player.speed, this.state === 'playing');
    this.uiTime += dt;
    if (this.uiTime > 1 / 20 && this.state === 'playing') {
      this.ui.update(this.elapsed, this.player.speed, this.player.action, this.player.position.z - this.level.finish.z);
      this.contextualHint();
      this.uiTime = 0;
    }
    this.renderer.render(this.scene, this.camera);
    this.animation = requestAnimationFrame(this.frame);
  };

  private resize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  };
  private pointerLockChange = () => {
    if (!document.pointerLockElement && this.state === 'playing' && !this.pointerFailure) this.pause();
  };
  private keyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && this.state === 'playing') this.pause();
    if (event.code === 'KeyR' && this.state === 'playing' && !event.repeat) this.respawn();
  };
  private blur = () => { if (this.state === 'playing') this.pause(); };
  private visibility = () => { if (document.hidden && this.state === 'playing') this.pause(); };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('pointerlockchange', this.pointerLockChange);
    document.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
    this.player.dispose(); this.audio.dispose(); this.level.dispose();
    this.sky.geometry.dispose(); (this.sky.material as THREE.Material).dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
