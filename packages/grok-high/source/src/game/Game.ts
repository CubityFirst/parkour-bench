import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { Input } from '../input/Input';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { PlayerView } from '../player/PlayerView';
import { FIXED_DT } from '../player/constants';
import { blankInput } from '../player/types';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { CityGenerator, createSky } from '../world/CityGenerator';
import { Level } from '../world/Level';
import { GameState, motionScale, saveBest } from './GameState';
import { Simulation } from './Simulation';

/** Renderer, pointer lock, fixed-step loop, and the menu shell. */
export class Game {
  readonly state = new GameState();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sim = new Simulation();
  private readonly camera: FirstPersonCamera;
  private readonly view: PlayerView;
  private readonly level: Level;
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly audio = new AudioManager();
  private readonly input: Input;
  private readonly hud: HUD;
  private readonly debugGroup: THREE.Group;
  private readonly sunFocus = new THREE.Vector3();
  private accumulator = 0;
  private time = 0;
  private last = performance.now();
  private strafe = 0;
  private ignoreLook = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0xc5dff0, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = new THREE.Fog(0xc5dff0, 55, 210);
    this.scene.add(new THREE.HemisphereLight(0xc5e4ff, 0xd9d3cb, 0.55));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
    this.sun = new THREE.DirectionalLight(0xfff4e5, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.04;
    const shadow = this.sun.shadow.camera as THREE.OrthographicCamera;
    shadow.left = -28;
    shadow.right = 28;
    shadow.top = 28;
    shadow.bottom = -28;
    shadow.near = 2;
    shadow.far = 90;
    shadow.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    new CityGenerator(this.scene);
    this.sky = createSky();
    this.scene.add(this.sky);
    this.level = new Level(this.scene, this.sim.layout);
    this.level.setReached(0);

    this.camera = new FirstPersonCamera(window.innerWidth / window.innerHeight);
    this.camera.yaw = this.sim.player.spawnYaw;
    this.camera.syncRig();
    this.scene.add(this.camera.rig);
    this.view = new PlayerView(this.camera.camera, this.scene);
    this.view.setVisible(false);
    this.debugGroup = this.buildDebug();
    this.scene.add(this.debugGroup);

    this.input = new Input(canvas);
    this.hud = new HUD(document.body);
    new Menu(document.body, this.state.settings, {
      onStart: () => this.start(),
      onResume: () => this.resume(),
      onRestart: () => this.restartLevel(),
      onQuit: () => this.quit(),
    });

    this.sim.player.onJump = () => this.audio.jump();
    this.sim.player.onLand = (impact) => this.audio.land(impact);
    this.sim.player.onStep = (speed) => this.audio.footstep(speed);
    this.sim.player.onSlide = (active) => this.audio.setSlide(active);
    this.sim.onCheckpoint = () => {
      this.audio.checkpoint();
      this.level.setReached(this.sim.flags.checkpoint);
    };
    this.sim.onFinish = () => this.finish();

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.showFatal('The graphics context was lost.');
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    canvas.addEventListener('click', () => {
      if (this.state.mode === 'playing' && document.pointerLockElement !== canvas) this.lock();
    });

    this.hud.setMode('menu');
    this.resize();
    requestAnimationFrame(this.loop);
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.frame(dt);
    this.renderer.render(this.scene, this.camera.camera);
    requestAnimationFrame(this.loop);
  };

  private frame(dt: number): void {
    if (this.input.debugToggle()) {
      this.state.debug = !this.state.debug;
      this.debugGroup.visible = this.state.debug;
    }
    const look = this.input.consumeLook();
    const playing = this.state.mode === 'playing';
    if (playing) {
      if (this.ignoreLook > 0) {
        this.ignoreLook -= 1;
      } else {
        this.camera.addLook(look.x, look.y, this.state.settings.sensitivity);
      }
      this.camera.syncRig();
      this.state.elapsed += dt;
      const basis = this.camera.basis();
      const input = this.input.snapshot();
      this.strafe = input.strafe;
      this.accumulator = Math.min(0.05, this.accumulator + dt);
      const serial = this.sim.flags.respawnSerial;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 6 && !this.sim.flags.finished) {
        this.sim.step(FIXED_DT, input, basis.fx, basis.fz, basis.rx, basis.rz);
        input.jumpPressed = false;
        input.vaultPressed = false;
        input.slidePressed = false;
        input.restart = false;
        this.accumulator -= FIXED_DT;
        steps += 1;
      }
      if (this.sim.flags.respawnSerial !== serial) this.onRespawn();
    } else {
      this.input.snapshot();
      this.accumulator = 0;
      this.strafe = 0;
    }

    const player = this.sim.player;
    if (this.state.mode === 'menu') {
      this.presentMenu();
    } else {
      this.camera.rig.position.set(player.x, player.y + player.eye, player.z);
      this.camera.syncRig();
      const basis = this.camera.basis();
      this.camera.updateEffects(player, this.strafe, dt, motionScale(this.state.settings), false);
      this.view.setVisible(true);
      this.view.update(player, basis.fx, basis.fz, basis.rx, basis.rz);
    }

    this.level.update(this.time);
    const airborne = player.state === 'air' || player.state === 'wallrun';
    this.audio.setSpeed(player.horizontalSpeed, airborne);
    this.followSun();
    this.sky.position.copy(this.camera.camera.getWorldPosition(this.sunFocus));
    this.hud.setLookHint(this.state.mode === 'playing' && document.pointerLockElement !== this.canvas);
    this.hud.update(this.state.elapsed * 1000, this.sim.flags, this.debugText(), this.state.debug);
  }

  private presentMenu(): void {
    const sway = Math.sin(this.time * 0.25) * 0.08;
    this.camera.yaw = -Math.PI / 2 + sway;
    this.camera.pitch = -0.28;
    this.camera.syncRig();
    this.camera.rig.position.set(3.2, 45.4, 6.6);
    this.camera.updateEffects(this.sim.player, 0, 0.016, 0, true);
    this.view.setVisible(false);
  }

  private followSun(): void {
    const player = this.sim.player;
    if (this.state.mode === 'menu') {
      this.sun.position.set(-16, 74, 28);
      this.sun.target.position.set(20, 40, 0);
    } else {
      this.sun.position.set(player.x - 20, player.y + 36, player.z + 16);
      this.sun.target.position.set(player.x + 8, player.y + 1, player.z);
    }
    this.sun.target.updateMatrixWorld();
  }

  private start(): void {
    this.audio.unlock();
    this.beginRun();
    this.lock();
  }

  private resume(): void {
    this.audio.unlock();
    if (this.state.mode === 'paused') this.lock();
  }

  private restartLevel(): void {
    this.audio.unlock();
    this.beginRun();
    this.lock();
  }

  private quit(): void {
    this.state.mode = 'menu';
    this.accumulator = 0;
    this.sim.reset();
    this.state.elapsed = 0;
    this.level.setReached(0);
    this.view.setVisible(false);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.hud.setMode('menu');
  }

  private beginRun(): void {
    this.sim.reset();
    this.state.elapsed = 0;
    this.state.mode = 'playing';
    this.accumulator = 0;
    this.camera.yaw = this.sim.player.spawnYaw;
    this.camera.pitch = -0.06;
    this.camera.syncRig();
    this.level.setReached(0);
    this.view.setVisible(true);
    this.hud.setMode('playing');
  }

  /** Mode is finished before the lock is released, so unlock does not open pause. */
  private finish(): void {
    if (this.state.mode === 'finished') return;
    this.state.mode = 'finished';
    this.accumulator = 0;
    const ms = this.state.elapsed * 1000;
    let isNew = false;
    if (ms > 1000 && (this.state.best === null || ms < this.state.best)) {
      this.state.best = ms;
      saveBest(ms);
      isNew = true;
    }
    this.audio.finish();
    this.hud.showFinish(ms, this.state.best, isNew);
    this.hud.setMode('finished');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private onRespawn(): void {
    this.camera.yaw = this.sim.player.spawnYaw;
    this.camera.pitch = -0.06;
    this.camera.syncRig();
    this.hud.flash();
    this.audio.respawn();
    this.level.setReached(this.sim.flags.checkpoint);
  }

  private onLockChange(): void {
    const locked = document.pointerLockElement === this.canvas;
    document.body.classList.toggle('is-locked', locked);
    if (locked) {
      this.ignoreLook = 2;
      if (this.state.mode === 'paused') this.state.mode = 'playing';
    } else if (this.state.mode === 'playing') {
      this.state.mode = 'paused';
      this.accumulator = 0;
    }
    this.hud.setMode(this.state.mode);
  }

  private lock(): void {
    try {
      const pending = this.canvas.requestPointerLock() as void | Promise<void>;
      if (pending && typeof (pending as Promise<void>).then === 'function') {
        void (pending as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* click the view to try again */
    }
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.resize(window.innerWidth / Math.max(1, window.innerHeight));
  }

  private showFatal(message: string): void {
    const fatal = document.querySelector('#fatal');
    if (fatal instanceof HTMLElement) {
      fatal.hidden = false;
      fatal.textContent = message;
    }
  }

  private debugText(): string {
    const player = this.sim.player;
    return [
      `SPD ${player.horizontalSpeed.toFixed(2)}`,
      `STATE ${player.state}`,
      `POS ${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}`,
      `CP ${this.sim.flags.checkpoint}`,
      `FALLS ${this.sim.flags.falls}`,
    ].join('\n');
  }

  private buildDebug(): THREE.Group {
    const group = new THREE.Group();
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const material = new THREE.LineBasicMaterial({ color: 0xff3344 });
    for (const solid of this.sim.layout.solids) {
      const line = new THREE.LineSegments(edges, material);
      line.scale.set(solid.maxX - solid.minX, solid.maxY - solid.minY, solid.maxZ - solid.minZ);
      line.position.set(
        (solid.minX + solid.maxX) * 0.5,
        (solid.minY + solid.maxY) * 0.5,
        (solid.minZ + solid.maxZ) * 0.5,
      );
      group.add(line);
    }
    group.visible = false;
    return group;
  }

  /**
   * Steps a synthetic W then D while facing +X. Returns cosines of travel vs the camera basis.
   * The menu loop does not step, so this does not fight live input. Resets the run afterward.
   */
  checkAxes(): { forward: number; strafe: number } {
    this.sim.reset();
    this.camera.yaw = -Math.PI / 2;
    this.camera.pitch = 0;
    this.camera.syncRig();
    const basis = this.camera.basis();
    const forward = blankInput();
    forward.forward = 1;
    const x0 = this.sim.player.x;
    const z0 = this.sim.player.z;
    for (let i = 0; i < 40; i++) this.sim.step(FIXED_DT, forward, basis.fx, basis.fz, basis.rx, basis.rz);
    const fdx = this.sim.player.x - x0;
    const fdz = this.sim.player.z - z0;
    const flen = Math.hypot(fdx, fdz) || 1;
    const forwardDot = (fdx * basis.fx + fdz * basis.fz) / flen;

    this.sim.reset();
    const strafe = blankInput();
    strafe.strafe = 1;
    const sx = this.sim.player.x;
    const sz = this.sim.player.z;
    for (let i = 0; i < 40; i++) this.sim.step(FIXED_DT, strafe, basis.fx, basis.fz, basis.rx, basis.rz);
    const sdx = this.sim.player.x - sx;
    const sdz = this.sim.player.z - sz;
    const slen = Math.hypot(sdx, sdz) || 1;
    const strafeDot = (sdx * basis.rx + sdz * basis.rz) / slen;
    this.sim.reset();
    this.state.elapsed = 0;
    return { forward: forwardDot, strafe: strafeDot };
  }
}
