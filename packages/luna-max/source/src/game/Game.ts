import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { Level } from "../world/Level";
import { PlayerController } from "../player/PlayerController";
import { AudioManager } from "../audio/AudioManager";
import { HUD } from "../ui/HUD";
import { GameState } from "./GameState";

const FIXED_STEP = 1 / 120;
const BEST_TIME_KEY = "rooftop-flow-best-time";

export class Game {
  private readonly canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.1, 1450);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly level: Level;
  private readonly audio = new AudioManager();
  private readonly state = new GameState();
  private readonly player: PlayerController;
  private readonly hud: HUD;
  private lastFrame = 0;
  private accumulator = 0;
  private checkpointLabel = "CHECKPOINT 01 / START";

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.setupScene();
    this.level = new Level(this.scene);
    this.scene.add(this.camera);
    this.player = new PlayerController(this.camera, this.canvas, this.level, this.audio);
    this.state.start(this.level.startPosition);
    this.player.onRestart = () => this.restartAtCheckpoint();
    this.player.onAction = (message) => this.hud.showAction(message);
    this.hud = new HUD({
      start: () => this.startNewRun(),
      resume: () => this.resume(),
      restart: () => this.restartAtCheckpoint(),
      playAgain: () => this.startNewRun(),
      backToMenu: () => this.backToMenu(),
      settingsChanged: (sensitivity, reducedMotion) => {
        this.player.sensitivity = sensitivity;
        this.player.reducedMotion = reducedMotion;
      }
    });
    this.hud.setMenuBest(this.readBest());
    this.player.updateCamera(1 / 60);
    this.bindEvents();
    requestAnimationFrame(this.frame);
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0x83c7f1);
    this.scene.fog = new THREE.Fog(0xbfe3f6, 300, 1180);

    const sky = new Sky();
    sky.scale.setScalar(450000);
    const uniforms = sky.material.uniforms;
    uniforms["turbidity"].value = 2.2;
    uniforms["rayleigh"].value = 2.5;
    uniforms["mieCoefficient"].value = 0.0012;
    uniforms["mieDirectionalG"].value = 0.82;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(66),
      THREE.MathUtils.degToRad(255)
    );
    uniforms["sunPosition"].value.copy(sunPosition);
    this.scene.add(sky);

    const hemisphere = new THREE.HemisphereLight(0xd9f1ff, 0x66737b, 1.9);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff5e7, 3.15);
    sun.position.set(-90, 210, 80);
    sun.target.position.set(0, 0, -170);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -105;
    sun.shadow.camera.right = 105;
    sun.shadow.camera.top = 225;
    sun.shadow.camera.bottom = -225;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 640;
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun, sun.target);

    const fill = new THREE.DirectionalLight(0xb8dfff, 0.78);
    fill.position.set(110, 80, -250);
    this.scene.add(fill);
  }

  private bindEvents(): void {
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === this.canvas;
      this.hud.setPointerUnlocked(!locked);
      if (!locked && this.state.phase === "running") this.pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state.phase === "running") this.pause();
    });
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.code === "Escape" && this.state.phase === "running" && document.pointerLockElement !== this.canvas) {
        this.pause();
      }
    });
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.setSize(width, height, false);
  }

  private startNewRun(): void {
    this.audio.unlock();
    this.state.start(this.level.startPosition);
    this.checkpointLabel = "CHECKPOINT 01 / START";
    this.player.reset(this.level.startPosition, 0);
    this.player.setActive(true);
    this.hud.showRunning();
    this.requestPointerLock();
  }

  private resume(): void {
    if (this.state.phase !== "paused") return;
    this.audio.unlock();
    this.state.resume();
    this.player.setActive(true);
    this.hud.showRunning();
    this.requestPointerLock();
  }

  private restartAtCheckpoint(): void {
    this.audio.unlock();
    if (this.state.phase === "menu" || this.state.phase === "complete") {
      this.startNewRun();
      return;
    }
    this.state.phase = "running";
    this.player.reset(this.state.checkpointPosition, 0);
    this.player.setActive(true);
    this.hud.showRunning();
    this.requestPointerLock();
  }

  private backToMenu(): void {
    this.state.toMenu();
    this.player.setActive(false);
    this.player.reset(this.level.startPosition, 0);
    this.hud.showMenu(this.readBest());
    this.releasePointerLock();
  }

  private requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      try {
        this.canvas.requestPointerLock();
      } catch {
        // The click-to-capture hint remains visible if the browser denies this request.
      }
    }
  }

  private releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private pause(): void {
    if (this.state.phase !== "running") return;
    this.state.pause();
    this.player.setActive(false);
    this.hud.showPause();
    this.releasePointerLock();
  }

  private updateWorld(dt: number): void {
    this.state.tick(dt);
    this.player.step(dt);

    if (this.player.position.y < -22) {
      this.player.reset(this.state.checkpointPosition, 0);
      this.player.setActive(true);
      this.hud.showAction("BACK TO CHECKPOINT");
      return;
    }

    const nextCheckpointIndex = this.state.checkpointIndex + 1;
    const checkpoint = this.level.checkpointAt(this.player.position, nextCheckpointIndex);
    if (checkpoint) {
      this.state.setCheckpoint(nextCheckpointIndex, checkpoint.name, checkpoint.position);
      this.checkpointLabel = "CHECKPOINT " + String(nextCheckpointIndex + 1).padStart(2, "0") + " / " + checkpoint.name;
      this.audio.checkpoint();
      this.hud.showCheckpoint(checkpoint.name, nextCheckpointIndex + 1);
    }

    const finishPlatform = this.level.platforms[this.level.platforms.length - 1];
    if (this.player.position.z <= this.level.finishZ &&
        Math.abs(this.player.position.x - finishPlatform.x) < 6.4 &&
        Math.abs(this.player.position.y - finishPlatform.top) < 1.4) {
      this.finishRun();
      return;
    }
  }

  private finishRun(): void {
    this.state.complete();
    this.player.setActive(false);
    this.audio.setWind(0);
    this.audio.finish();
    const previousBest = this.readBest();
    const best = previousBest === undefined ? this.state.elapsed : Math.min(previousBest, this.state.elapsed);
    try {
      localStorage.setItem(BEST_TIME_KEY, String(best));
    } catch {
      // The finish screen still displays this run if storage is unavailable.
    }
    this.hud.showComplete(this.state.elapsed, best);
    this.releasePointerLock();
  }

  private readBest(): number | undefined {
    try {
      const value = Number(localStorage.getItem(BEST_TIME_KEY));
      return Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private frame = (now: number): void => {
    if (!this.lastFrame) this.lastFrame = now;
    const elapsed = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.state.phase === "running") {
      this.accumulator = Math.min(this.accumulator + elapsed, 0.24);
      while (this.accumulator >= FIXED_STEP && this.state.phase === "running") {
        this.updateWorld(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      const forwardX = -Math.sin(this.player.yaw);
      const forwardZ = -Math.cos(this.player.yaw);
      const nearVault = Boolean(this.level.findVaultTarget(
        this.player.position.x, this.player.position.z, forwardX, forwardZ, 0.34
      ));
      this.hud.update({
        elapsed: this.state.elapsed,
        section: this.level.getSection(this.player.position.z),
        progress: this.level.getProgress(this.player.position.z),
        checkpoint: this.checkpointLabel,
        action: this.player.currentAction,
        speed: this.player.speed,
        grounded: this.player.grounded,
        nearVault
      });
    }
    this.player.updateCamera(elapsed);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };
}



