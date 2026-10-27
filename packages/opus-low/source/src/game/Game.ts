import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Input } from './Input';
import { GameState } from './GameState';
import { PlayerController, PlayerInput, MOVE } from '../player/PlayerController';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { Level, KILL_Y } from '../world/Level';
import { generateCity } from '../world/CityGenerator';
import { Checkpoints } from '../world/Checkpoints';
import { createMaterials } from '../world/Materials';
import { UI, Settings } from '../ui/UI';
import { AudioManager } from '../audio/AudioManager';

const FIXED_DT = 1 / 120;
const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private input: Input;
  level: Level;
  player: PlayerController;
  private fp: FirstPersonCamera;
  private checkpoints: Checkpoints;
  private ui: UI;
  private audio = new AudioManager();
  private state = new GameState();

  private accumulator = 0;
  private lastTime = performance.now();
  private prevPos = new THREE.Vector3();
  private renderPos = new THREE.Vector3();
  private stepDistance = 0;
  private playerInput: PlayerInput = { forward: 0, right: 0, sprint: false, jumpHeld: false, slideHeld: false, yaw: 0 };

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 2000);
    this.scene.add(this.camera);

    // Lighting: soft environment reflections + hemisphere fill + strong sun.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xa9a39a, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff4e2, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.scene.fog = new THREE.Fog(0xcfe0f0, 90, 620);
    this.sky = this.createSky();
    this.scene.add(this.sky);

    const mats = createMaterials();
    this.level = new Level(mats);
    this.scene.add(this.level.group);
    this.scene.add(generateCity(mats));
    this.checkpoints = new Checkpoints(this.level.checkpoints, this.scene);

    this.player = new PlayerController(this.level.world);
    this.fp = new FirstPersonCamera(this.camera);
    this.input = new Input(this.renderer.domElement);

    this.ui = new UI({
      start: () => this.startRun(),
      resume: () => this.resume(),
      restart: () => this.startRun(),
      menu: () => this.toMenu(),
      settings: (s) => this.applySettings(s),
    });
    this.applySettings(this.ui.settings);

    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state.mode === 'playing') this.pause();
    });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Menu backdrop: stand at the start looking down the route.
    this.respawnAt(this.level.start.pos, 0);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private createSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: SUN_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 horizon = vec3(0.80, 0.88, 0.95);
          vec3 zenith = vec3(0.16, 0.45, 0.86);
          vec3 col = mix(horizon, zenith, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.95, 0.85) * (pow(s, 400.0) * 1.5 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    return sky;
  }

  private applySettings(s: Settings) {
    this.fp.sensitivity = s.sensitivity;
    this.fp.motion = s.motion === 'reduced' ? 0.3 : 1;
  }

  // ------------------------------------------------------------ flow

  private startRun() {
    this.audio.init();
    this.checkpoints.reset();
    this.state.reset();
    this.respawnAt(this.level.start.pos, this.level.start.yaw);
    this.state.mode = 'playing';
    this.ui.show('playing');
    this.ui.showToast('GO');
    this.input.lock();
  }

  private resume() {
    this.audio.init();
    this.state.mode = 'playing';
    this.ui.show('playing');
    this.lastTime = performance.now();
    this.input.lock();
  }

  private pause() {
    this.state.mode = 'paused';
    this.ui.show('paused');
    this.audio.silence();
  }

  private toMenu() {
    this.state.mode = 'menu';
    this.ui.show('menu');
    this.audio.silence();
    this.input.unlock();
  }

  private finishRun() {
    this.state.mode = 'finished';
    this.audio.finish();
    this.audio.silence();
    this.input.unlock();
    this.ui.showFinish(this.state.time);
  }

  private respawnAt(pos: THREE.Vector3, yaw: number) {
    this.player.respawn(pos);
    this.prevPos.copy(pos);
    this.renderPos.copy(pos);
    this.fp.reset(yaw);
    this.accumulator = 0;
  }

  private respawnCheckpoint() {
    const i = this.checkpoints.current;
    const def = i >= 0 ? this.level.checkpoints[i] : this.level.start;
    this.respawnAt(def.pos, def.yaw);
  }

  // ------------------------------------------------------------ loop

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.state.mode === 'playing') this.updatePlaying(dt);
    else this.renderPos.copy(this.player.body.pos);

    this.fp.update(dt, this.player, this.renderPos, this.playerInput);
    this.sky.position.copy(this.camera.position);
    // Shadow camera follows the player.
    this.sun.target.position.copy(this.renderPos);
    this.sun.position.copy(this.renderPos).addScaledVector(SUN_DIR, 120);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  private updatePlaying(dt: number) {
    const inp = this.input;
    this.fp.applyMouse(inp.mouseDX, inp.mouseDY);

    const pi = this.playerInput;
    pi.forward = (inp.down('KeyW', 'ArrowUp') ? 1 : 0) - (inp.down('KeyS', 'ArrowDown') ? 1 : 0);
    pi.right = (inp.down('KeyD', 'ArrowRight') ? 1 : 0) - (inp.down('KeyA', 'ArrowLeft') ? 1 : 0);
    pi.sprint = inp.down('ShiftLeft', 'ShiftRight');
    pi.jumpHeld = inp.down('Space');
    pi.slideHeld = inp.down('ControlLeft', 'ControlRight', 'KeyC');
    pi.yaw = this.fp.yaw;

    if (inp.wasPressed('Space')) this.player.jumpBuffer = MOVE.jumpBuffer;
    if (inp.wasPressed('ControlLeft', 'ControlRight', 'KeyC')) this.player.slideBuffer = 0.2;
    if (inp.wasPressed('KeyE')) this.player.vaultBuffer = 0.2;
    if (inp.wasPressed('KeyR')) { this.respawnCheckpoint(); return; }

    // Fixed-timestep simulation with render interpolation.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 12) {
      this.prevPos.copy(this.player.body.pos);
      this.player.step(FIXED_DT, pi);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    this.renderPos.lerpVectors(this.prevPos, this.player.body.pos, this.accumulator / FIXED_DT);

    this.handleEvents(dt);
    this.state.time += dt;
    this.ui.setTime(this.state.time);

    const pos = this.player.body.pos;
    const cp = this.checkpoints.update(pos, this.state.time);
    if (cp >= 0) { this.ui.showToast(this.level.checkpoints[cp].name); this.audio.checkpoint(); }

    const hint = this.level.hints.find((h) => pos.z <= h.zMax && pos.z > h.zMin);
    this.ui.setHint(hint ? hint.text : '');

    if (pos.y < KILL_Y) { this.respawnCheckpoint(); this.ui.showToast('RESPAWN'); }

    const f = this.level.finish;
    if (pos.x > f.min.x && pos.x < f.max.x && pos.y > f.min.y && pos.y < f.max.y && pos.z > f.min.z && pos.z < f.max.z) {
      this.finishRun();
    }
  }

  private handleEvents(dt: number) {
    const p = this.player;
    for (const e of p.events) {
      this.fp.handleEvent(e);
      switch (e.type) {
        case 'jump': this.audio.jump(); break;
        case 'land': if (e.impact > 2) this.audio.land(e.impact); this.stepDistance = 0; break;
        case 'vault': case 'mantle': this.audio.vault(); break;
        case 'wallStart': this.audio.vault(); break;
      }
    }
    p.events.length = 0;

    const hs = p.horizontalSpeed;
    if (p.body.grounded && p.state === 'move' && hs > 1) {
      this.stepDistance += hs * dt;
      if (this.stepDistance > (hs > 8 ? 2.6 : 2.0)) { this.stepDistance = 0; this.audio.footstep(); }
    }
    if (p.state === 'wallrun') {
      this.stepDistance += hs * dt;
      if (this.stepDistance > 2.2) { this.stepDistance = 0; this.audio.footstep(); }
    }
    this.audio.setContinuous(hs, p.state === 'slide' && p.body.grounded);
  }
}
