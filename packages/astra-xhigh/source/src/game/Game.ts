import * as THREE from "three";
import { Level } from "../world/Level";
import { Input } from "../player/Input";
import { PlayerController } from "../player/PlayerController";
import { FirstPersonCamera } from "../player/FirstPersonCamera";
import { AudioManager } from "../audio/AudioManager";
import { UI, type Screen } from "../ui/UI";

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(
    77,
    innerWidth / innerHeight,
    0.07,
    3000,
  );
  readonly renderer: THREE.WebGLRenderer;
  readonly level: Level;
  readonly input = new Input();
  readonly player: PlayerController;
  readonly view: FirstPersonCamera;
  readonly audio = new AudioManager();
  readonly ui = new UI();
  screen: Screen = "menu";
  checkpoint = 0;
  runTime = 0;
  bestTime: number | null = null;
  private accumulator = 0;
  private previousTime = 0;
  private hudTime = 0;
  private sun: THREE.DirectionalLight;
  private respawns = 0;
  private ending = false;
  private currentHint = "";
  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    document.getElementById("world")!.append(this.renderer.domElement);
    this.scene.fog = new THREE.FogExp2(0xb9d9e3, 0.0024);
    this.scene.add(new THREE.HemisphereLight(0xd9f2ff, 0x496575, 1.45));
    this.sun = new THREE.DirectionalLight(0xfff5dd, 3.5);
    this.sun.position.set(-65, 115, 35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -75;
    this.sun.shadow.camera.right = 75;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 280;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 3;
    this.sun.target.position.set(0, 40, -38);
    this.scene.add(this.sun, this.sun.target);
    this.level = new Level(this.scene);
    this.player = new PlayerController(this.level.collision, this.input);
    this.view = new FirstPersonCamera(this.camera);
    this.scene.add(this.camera);
    this.player.onEvent = (kind) => this.audio.event(kind);
    try {
      const saved = Number(localStorage.getItem("parkour-bench:astra-xhigh:rooftop-flow:best:v1"));
      if (saved > 0 && Number.isFinite(saved)) this.bestTime = saved;
    } catch {}
    this.audio.setEnabled(this.ui.sound);
    this.ui.best(this.bestTime);
    this.ui.screen("menu");
    this.ui.onStart = () => this.start();
    this.ui.onResume = () => this.resume();
    this.ui.onRestart = () => {
      this.respawn();
      void this.resume();
    };
    this.ui.onMenu = () => this.menu();
    this.ui.onAudio = (value) => {
      this.audio.setEnabled(value);
    };
    document
      .getElementById("pause-button")!
      .addEventListener("click", () => this.pause());
    document.addEventListener("pointerlockchange", () => {
      if (
        !document.pointerLockElement &&
        !this.input.dragLook &&
        this.screen === "playing" &&
        !this.ending
      )
        this.pause(false);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.screen === "playing") this.pause();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.screen === "playing") this.pause();
    });
    window.addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    // Runtime diagnostics are only exposed on Vite's development server.
    if (import.meta.env.DEV)
      (window as unknown as { __game: Game }).__game = this;
    requestAnimationFrame(this.frame);
  }
  private async lock() {
    try {
      await this.renderer.domElement.requestPointerLock();
      this.input.dragLook = false;
    } catch {
      // Some embedded browsers cannot capture the pointer. Keep the course playable.
      this.input.dragLook = true;
      this.ui.toast("Drag the scene to look around. Press Esc to pause.");
    }
  }
  async start() {
    this.audio.init();
    this.ending = false;
    this.checkpoint = 0;
    this.runTime = 0;
    this.respawns = 0;
    this.player.reset(this.level.checkpoints[0].position);
    this.setSector(false);
    this.screen = "playing";
    this.ui.screen("playing");
    this.ui.best(this.bestTime);
    await this.lock();
  }
  async resume() {
    this.audio.init();
    this.input.clear();
    this.screen = "playing";
    this.ui.screen("playing");
    await this.lock();
  }
  pause(unlock = true) {
    if (this.screen !== "playing") return;
    this.screen = "paused";
    this.input.clear();
    this.ui.screen("paused");
    if (unlock && document.pointerLockElement) document.exitPointerLock();
  }
  menu() {
    this.screen = "menu";
    this.input.clear();
    this.ui.screen("menu");
    if (document.pointerLockElement) document.exitPointerLock();
    this.view.hideBody();
  }
  respawn() {
    this.respawns++;
    this.player.reset(this.level.checkpoints[this.checkpoint].position, {
      preserveHeldInput: true,
    });
    this.ui.flash();
    this.ui.toast("Back on your feet. Keep going.");
  }
  private setSector(notify = true) {
    const cp = this.level.checkpoints[this.checkpoint];
    this.ui.sector(this.checkpoint, cp.title, cp.subtitle, cp.hint, notify);
  }
  private complete() {
    this.ending = true;
    this.screen = "finish";
    const record = this.bestTime === null || this.runTime < this.bestTime;
    if (record) {
      this.bestTime = this.runTime;
      try {
        localStorage.setItem("parkour-bench:astra-xhigh:rooftop-flow:best:v1", String(this.bestTime));
      } catch {}
    }
    this.ui.finish(this.runTime, this.bestTime!, record);
    this.audio.event("finish");
    if (document.pointerLockElement) document.exitPointerLock();
  }
  private contextualHint() {
    const z = this.player.position.z;
    const cp = this.level.checkpoints[this.checkpoint];
    let title = cp.subtitle,
      text = cp.hint;
    if (this.checkpoint === 0) {
      if (z < -5 && z > -16) {
        title = "UP AND OVER";
        text =
          "Keep sprinting for an assisted vault here. Press E to vault manually.";
      } else if (z < -19 && z > -34) {
        title = "KEEP A LOW PROFILE";
        text =
          "Keep sprinting for an assisted slide here. Hold C for manual slides.";
      } else if (z < -37) {
        title = "TAKE THE LEAP";
        text =
          "Sprint with SHIFT. Hold SPACE as you leave the red takeoff strip.";
      }
    }
    if (this.player.wallSide) {
      title = "TRUST THE WALL";
      text = "Keep W held to run along the wall. SPACE jumps away.";
    }
    if (this.currentHint !== title) {
      this.currentHint = title;
      this.ui.hint(title, text);
    }
  }
  step(step: number) {
    this.player.update(step);
    this.runTime += step;
    if (this.input.take("KeyR")) this.respawn();
    if (this.player.position.y < 23) this.respawn();
    if (this.checkpoint < 5) {
      const next = this.level.checkpoints[this.checkpoint + 1];
      if (
        this.player.position.z <= next.position.z &&
        this.player.grounded &&
        Math.abs(this.player.position.x) < 8
      ) {
        this.checkpoint++;
        this.setSector();
        this.audio.event("checkpoint");
      }
    }
    if (
      this.checkpoint === 5 &&
      this.player.position.z < -796 &&
      Math.abs(this.player.position.x) < 3 &&
      this.player.position.y >= 42 &&
      this.player.position.y < 49
    ) {
      this.complete();
    }
  }
  private frame = (time: number) => {
    const dt = Math.min((time - this.previousTime) / 1000 || 0, 0.1);
    this.previousTime = time;
    if (this.screen === "playing") {
      this.player.look(this.ui.sensitivity);
      this.accumulator += dt;
      const step = 1 / 120;
      while (this.accumulator >= step) {
        this.step(step);
        this.accumulator -= step;
        if (this.screen !== "playing") break;
      }
      this.view.update(this.player, dt, this.ui.reducedMotion);
      this.hudTime += dt;
      if (this.hudTime > 0.04) {
        this.hudTime = 0;
        this.ui.update(
          this.runTime,
          this.player.speed,
          this.player.state,
          THREE.MathUtils.clamp(
            (this.level.checkpoints[0].position.z - this.player.position.z) /
              (this.level.checkpoints[0].position.z + 796),
            0,
            1,
          ),
        );
        this.contextualHint();
      }
      this.sun.position.set(
        this.player.position.x - 65,
        115,
        this.player.position.z + 30,
      );
      this.sun.target.position.set(0, 40, this.player.position.z - 30);
    } else {
      this.accumulator = 0;
      if (this.screen === "menu") {
        this.view.hideBody();
        this.camera.fov = 66;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(
          12 + Math.sin(time * 0.00009) * 0.2,
          45.4,
          -20,
        );
        this.camera.lookAt(-14, 42.8, -65);
        this.sun.position.set(-65, 115, 35);
        this.sun.target.position.set(0, 40, -38);
      }
    }
    this.level.animate(time / 1000);
    this.audio.update(
      dt,
      this.player.speed,
      this.player.grounded,
      this.player.sliding,
      this.screen === "playing",
    );
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };
}
