import * as THREE from 'three';
import { CONST, COLORS } from '../constants';
import { GameState } from './GameState';
import { Input } from '../input/Input';
import { CollisionWorld } from '../world/CollisionWorld';
import { Level } from '../world/Level';
import { CityGenerator } from '../world/CityGenerator';
import { Checkpoints } from '../world/Checkpoints';
import { PlayerPhysics } from '../player/PlayerPhysics';
import { ParkourSystem } from '../player/ParkourSystem';
import { PlayerController } from '../player/PlayerController';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { AudioManager } from '../audio/AudioManager';

function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(COLORS.skyTop) },
      horizon: { value: new THREE.Color(COLORS.skyHorizon) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 c = mix(horizon, top, smoothstep(0.02, 0.5, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/**
 * Owns the renderer, scene, lights, world and UI; wires everything together and
 * runs the main loop.
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: FirstPersonCamera;

  private state = new GameState();
  private input = new Input();
  private audio = new AudioManager();
  private collision = new CollisionWorld();
  private level: Level;
  private checkpoints: Checkpoints;
  private player: PlayerPhysics;
  private controller: PlayerController;
  private hud: HUD;
  private menu: Menu;

  private sun: THREE.DirectionalLight;
  private lastTime = 0;
  private menuTime = 0;

  constructor(private container: HTMLElement) {
    // --- renderer ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // --- camera ---
    const cam = new THREE.PerspectiveCamera(
      CONST.fovBase,
      window.innerWidth / window.innerHeight,
      0.1,
      1500,
    );
    this.camera = new FirstPersonCamera(cam, this.state.settings);

    // --- scene / lights / sky ---
    this.scene.background = new THREE.Color(COLORS.skyHorizon);
    this.scene.fog = new THREE.Fog(COLORS.fog, 140, 720);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xd7dce1, 1.0);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sun.position.set(30, 46, 18);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    // visible sky dome
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(950, 32, 16), makeSkyMaterial());
    skyDome.renderOrder = -10;
    this.scene.add(skyDome);

    this.createEnvironment();

    // --- world ---
    this.level = new Level(this.collision);
    this.checkpoints = this.level.checkpoints;
    this.scene.add(this.level.group);
    new CityGenerator().generate(this.scene);

    // --- player ---
    this.player = new PlayerPhysics(this.collision);
    const parkour = new ParkourSystem(this.collision);
    this.controller = new PlayerController(
      this.player,
      this.collision,
      parkour,
      this.input,
      this.camera,
      this.audio,
    );

    // --- UI ---
    this.hud = new HUD(container);
    this.menu = new Menu(container, {
      onStart: () => this.startGame(),
      onResume: () => this.resume(),
      onRestartRun: () => this.startGame(),
      onToMenu: () => this.toMenu(),
      onSensitivity: (v) => (this.state.settings.sensitivity = v),
      onCameraMotion: (v) => (this.state.settings.cameraMotion = v),
    }, this.state.settings.sensitivity, this.state.settings.cameraMotion);

    // --- events ---
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);

    this.menu.showMain();
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.loop);
  }

  private createEnvironment(): void {
    // Cheap gradient environment map for glass/metal reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial());
    envScene.add(sphere);
    const rt = pmrem.fromScene(envScene, 0.05);
    this.scene.environment = rt.texture;
    pmrem.dispose();
    sphere.geometry.dispose();
    (sphere.material as THREE.Material).dispose();
  }

  // ------------------------------------------------------------- state flow

  private startGame(): void {
    this.audio.unlock();
    this.state.runTime = 0;
    this.checkpoints.reset();
    this.respawnFeet(this.level.spawn, this.level.spawnYaw);
    this.state.phase = 'playing';
    this.menu.hideAll();
    this.hud.show();
    this.hud.setTime(0);
    this.hud.setBest(this.state.bestTime);
    this.requestLock();
  }

  private resume(): void {
    this.state.phase = 'playing';
    this.menu.hideAll();
    this.hud.show();
    this.requestLock();
  }

  private toMenu(): void {
    this.state.phase = 'menu';
    this.hud.hide();
    this.audio.setWind(0);
    this.menu.showMain();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private requestLock(): void {
    this.renderer.domElement.requestPointerLock?.();
  }

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (locked) {
      if (this.state.phase === 'paused') {
        this.state.phase = 'playing';
        this.menu.hideAll();
        this.hud.show();
      }
    } else if (this.state.phase === 'playing') {
      this.state.phase = 'paused';
      this.audio.setWind(0);
      this.menu.showPause();
      this.hud.hide();
    }
  };

  private onPointerLockError = (): void => {
    if (this.state.phase === 'playing') {
      this.state.phase = 'paused';
      this.menu.showPause();
      this.hud.hide();
    }
  };

  private onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.camera.updateProjectionMatrix();
  };

  // ------------------------------------------------------------- gameplay

  private respawnFeet(feet: THREE.Vector3, yaw: number): void {
    const center = feet.clone();
    center.y += CONST.heightStand / 2;
    this.controller.reset(center, yaw);
  }

  private respawnAtCheckpoint(): void {
    const c = this.checkpoints.active;
    this.respawnFeet(c.position, c.yaw);
  }

  private finishRun(): void {
    const t = this.state.runTime;
    const isNewBest = this.state.submitRun(t);
    this.state.phase = 'finished';
    this.audio.finish();
    this.audio.setWind(0);
    this.hud.hide();
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.showFinish(t, this.state.bestTime ?? t, isNewBest);
  }

  private updateWorld(): void {
    const p = this.player.position;

    if (this.checkpoints.update(p)) {
      this.hud.checkpoint();
      this.audio.checkpoint();
    }

    if (this.checkpoints.checkFinish(p)) {
      this.finishRun();
      return;
    }

    if (p.y < CONST.killY || this.input.restartPressed) {
      this.respawnAtCheckpoint();
    }

    this.updateHint();
  }

  private updateHint(): void {
    const p = this.player.position;
    let hint: string | null = null;
    if (this.controller.canVault) {
      hint = '<span class="hint-key">E</span> Vault';
    } else if (p.x < 16) {
      if (p.x < 3) hint = '<span class="hint-key">WASD</span> Move &nbsp;·&nbsp; <span class="hint-key">Shift</span> Sprint';
      else if (p.x < 7) hint = '<span class="hint-key">Space</span> Jump &nbsp;·&nbsp; <span class="hint-key">E</span> Vault';
      else if (p.x < 11) hint = '<span class="hint-key">Ctrl</span> Slide';
    }
    this.hud.setHint(hint);
  }

  private updateSun(): void {
    const p = this.player.position;
    this.sun.position.set(p.x + 30, p.y + 46, p.z + 18);
    this.sun.target.position.copy(p);
    this.sun.target.updateMatrixWorld();

    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    const s = 42;
    const snap = s / 1024;
    cam.left = Math.round((p.x - s) / snap) * snap;
    cam.right = Math.round((p.x + s) / snap) * snap;
    cam.top = Math.round((p.z + s) / snap) * snap;
    cam.bottom = Math.round((p.z - s) / snap) * snap;
    cam.updateProjectionMatrix();
  }

  private windLevel(): number {
    const s = this.controller.horizontalSpeed;
    return Math.max(0, Math.min(1, (s - 6) / 6));
  }

  // ------------------------------------------------------------- loop

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0);
    this.lastTime = now;

    this.updateSun();

    if (this.state.phase === 'playing') {
      this.state.runTime += dt;
      this.camera.applyLook(this.input.lookDX, this.input.lookDY);
      this.controller.update(dt);
      this.camera.update(dt, this.controller, this.player.position);
      this.updateWorld();
      this.hud.setTime(this.state.runTime);
      this.audio.setWind(this.windLevel());
    } else if (this.state.phase === 'menu') {
      this.menuTime += dt;
      const r = 70;
      const a = this.menuTime * 0.05;
      this.camera.camera.position.set(60 + Math.cos(a) * r, 26, Math.sin(a) * r);
      this.camera.camera.lookAt(90, 2, 0);
      this.audio.setWind(0);
    } else {
      this.audio.setWind(0);
    }

    this.renderer.render(this.scene, this.camera.camera);
    this.input.endFrame();
  };
}
