import * as THREE from "three";
import { AudioManager } from "../audio/AudioManager";
import { Input } from "../player/Input";
import { PlayerPhysics } from "../player/PlayerPhysics";
import { FirstPersonCamera } from "../player/FirstPersonCamera";
import { CityGenerator } from "../world/CityGenerator";
import { Level, ROOFTOPS } from "../world/Level";
import { SceneBuilder } from "../world/SceneBuilder";
import { UI } from "../ui/UI";
import { BEST_TIME_STORAGE_KEY } from "./StorageKeys";

type GameState = "menu" | "playing" | "paused" | "finished";
const FIXED_STEP = 1 / 120;

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(
    68,
    innerWidth / innerHeight,
    0.08,
    1500,
  );
  readonly renderer: THREE.WebGLRenderer;
  readonly ui = new UI();
  readonly input: Input;
  readonly level: Level;
  readonly player: PlayerPhysics;
  readonly firstPerson: FirstPersonCamera;
  readonly audio = new AudioManager();
  state: GameState = "menu";
  elapsed = 0;
  checkpoint = 0;
  best: number | null = null;
  private accumulator = 0;
  private lastFrame = performance.now();
  private worldTime = 0;
  private sun: THREE.DirectionalLight;
  private hintCooldown = 0;
  private lastUnlock = -Infinity;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.23;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "game-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "First-person rooftop parkour game. Use the Start Run button to play.",
    );
    document.querySelector("#app")!.prepend(this.renderer.domElement);
    this.scene.fog = new THREE.Fog("#c1e3ed", 120, 620);
    const hemisphere = new THREE.HemisphereLight("#d7f1ff", "#637e87", 2.35);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight("#fff5df", 3.2);
    this.sun.position.set(-40, 115, 35);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, {
      left: -64,
      right: 64,
      top: 64,
      bottom: -64,
      near: 1,
      far: 210,
    });
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.bias = -0.0001;
    this.sun.shadow.radius = 2;
    this.sun.target.position.set(0, 42, -20);
    this.scene.add(this.sun, this.sun.target);
    const builder = new SceneBuilder(this.scene);
    const city = new CityGenerator(builder);
    city.sky(this.scene);
    const environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(
      this.scene,
      0.04,
      0.1,
      1800,
    ).texture;
    this.scene.environmentIntensity = 0.45;
    environment.dispose();
    city.create();
    this.level = new Level(builder);
    this.level.create();
    builder.flush();
    this.input = new Input(this.renderer.domElement);
    this.player = new PlayerPhysics(this.level.world);
    this.firstPerson = new FirstPersonCamera(
      this.camera,
      this.player,
      this.input,
    );
    this.scene.add(this.camera);
    this.player.onEvent = (event, intensity) =>
      this.audio.event(event, intensity);
    this.ui.onStart = () => this.start();
    this.ui.onRestart = () => this.start();
    this.ui.onResume = () => this.resume();
    this.ui.onMenu = () => this.menu();
    this.ui.onSound = () => this.audio.toggle();
    this.ui.onSensitivity = (value) => {
      this.input.sensitivity = value;
    };
    this.ui.onMotion = (reduced) => {
      this.firstPerson.reducedMotion = reduced;
    };
    this.ui.applySettings();
    this.ui.root.addEventListener("checkpoint-reset", () => this.respawn());
    this.ui.root.addEventListener("settings-open", () => {
      if (this.state === "playing") this.pause();
    });
    try {
      const saved = localStorage.getItem(BEST_TIME_STORAGE_KEY);
      if (saved && Number.isFinite(Number(saved))) this.best = Number(saved);
    } catch {
      /* Optional storage. */
    }
    this.ui.setBest(this.best);
    this.ui.setState("menu");
    this.ui.section(0);
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => this.keydown(event));
    window.addEventListener("blur", () => {
      if (this.state === "playing") this.pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pause();
    });
    document.addEventListener("pointerlockchange", () => {
      if (!document.pointerLockElement) {
        this.lastUnlock = performance.now();
        if (this.state === "playing") this.pause();
      }
    });
    this.renderer.domElement.addEventListener("click", () => {
      if (this.state === "playing" && !document.pointerLockElement)
        this.lockPointer();
    });
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.pause();
      this.ui.toast("GRAPHICS INTERRUPTED", "Reload to reconnect to the city");
    });
    this.resize();
    this.animate();
  }

  start(): void {
    this.elapsed = 0;
    this.checkpoint = 0;
    this.player.reset(this.level.checkpoints[0].position);
    this.input.yaw = 0;
    this.input.pitch = -0.025;
    this.firstPerson.reset();
    this.input.clear();
    this.ui.section(0);
    this.ui.toast("THE MERIDIAN RUN", "MAKE YOUR OWN MOMENTUM");
    this.state = "playing";
    this.input.enabled = true;
    this.ui.setState("playing");
    this.accumulator = 0;
    this.camera.fov = 78;
    void this.audio.start().catch(() => {});
    this.lockPointer();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.input.enabled = true;
    this.input.clear();
    this.ui.setState("playing");
    this.accumulator = 0;
    this.lockPointer();
    void this.audio.start().catch(() => {});
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.input.enabled = false;
    this.input.clear();
    this.ui.setState("paused");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  menu(): void {
    this.state = "menu";
    this.input.enabled = false;
    this.input.clear();
    this.ui.setState("menu");
    this.firstPerson.hideBody();
    if (document.pointerLockElement) document.exitPointerLock();
    this.sun.position.set(-40, 115, 35);
    this.sun.target.position.set(0, 42, -20);
  }

  respawn(): void {
    this.player.reset(this.level.checkpoints[this.checkpoint].position);
    this.input.yaw = 0;
    this.input.pitch = -0.025;
    this.firstPerson.reset();
    this.input.clear();
    this.ui.toast(
      "BACK ON YOUR FEET",
      this.level.checkpoints[this.checkpoint].label.toUpperCase(),
    );
    this.hintCooldown = 0;
  }

  private lockPointer(): void {
    try {
      const request = this.renderer.domElement.requestPointerLock();
      if (request)
        request.catch(() =>
          this.ui.hint("Click and drag to look around. WASD to move.", 5),
        );
    } catch {
      this.ui.hint("Click and drag to look around. WASD to move.", 5);
    }
  }

  private keydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement && event.code !== "Escape")
      return;
    const panelOpen =
      !this.ui.element("#controls-panel").hidden ||
      !this.ui.element("#settings-panel").hidden;
    if (event.code === "Escape") {
      if (panelOpen) {
        this.ui.closePanels();
        return;
      }
      if (this.state === "playing") this.pause();
      else if (
        this.state === "paused" &&
        performance.now() - this.lastUnlock > 180
      )
        this.resume();
    }
    if (
      event.code === "Enter" &&
      !panelOpen &&
      !(event.target instanceof HTMLButtonElement)
    ) {
      event.preventDefault();
      if (this.state === "menu" || this.state === "finished") this.start();
      else if (this.state === "paused") this.resume();
    }
    if (event.code === "KeyR" && this.state === "playing") this.respawn();
  }

  private physics(dt: number): void {
    this.player.update(dt, this.input.read(), this.input.yaw);
    this.elapsed += dt;
    const p = this.player.position;
    const next = this.level.checkpoints[this.checkpoint + 1];
    if (
      next &&
      p.z < next.position.z + 2 &&
      p.z > next.position.z - 26 &&
      Math.abs(p.x - next.position.x) < 9 &&
      Math.abs(p.y - next.position.y) < 2 &&
      this.player.grounded
    ) {
      this.checkpoint++;
      this.ui.section(this.checkpoint, true);
      this.audio.event("checkpoint");
    }
    if (
      p.y < this.level.checkpoints[this.checkpoint].position.y - 15 ||
      Math.abs(p.x) > 150
    )
      this.respawn();
    if (
      this.checkpoint === 5 &&
      p.z < this.level.finish.z &&
      p.z > this.level.finish.z - 9 &&
      Math.abs(p.x) < 4.8 &&
      Math.abs(p.y - this.level.finish.y) < 3
    )
      this.finish();
  }

  private finish(): void {
    const isBest = this.best === null || this.elapsed < this.best;
    if (isBest) {
      this.best = this.elapsed;
      try {
        localStorage.setItem(BEST_TIME_STORAGE_KEY, String(this.best));
      } catch {
        /* Completion still works without storage. */
      }
    }
    this.state = "finished";
    this.input.enabled = false;
    this.input.clear();
    this.ui.finish(this.elapsed, this.best!, isBest);
    this.audio.event("finish");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  private updateWaypoint(): void {
    const p = this.player.position;
    const target = ROOFTOPS.find((r, i) => i > 0 && r.start < p.z - 1);
    const element = this.ui.element("#waypoint");
    const worldPoint = target
      ? new THREE.Vector3(
          Math.max(-1, Math.min(2, target.x)),
          target.y + 2.9,
          target.start - 4,
        )
      : this.level.finish.clone().add(new THREE.Vector3(0, 4, 0));
    const distance = worldPoint.distanceTo(p);
    const projected = worldPoint.clone().project(this.camera);
    const visible =
      projected.z > -1 &&
      projected.z < 1 &&
      Math.abs(projected.x) < 0.88 &&
      Math.abs(projected.y) < 0.75 &&
      distance > 12;
    element.hidden = !visible;
    if (visible) {
      element.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
      element.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
      element.querySelector("span")!.textContent = `${Math.round(distance)} M`;
    }
  }

  private contextualHint(dt: number): void {
    this.hintCooldown -= dt;
    if (this.hintCooldown > 0) return;
    const p = this.player.position;
    if (this.player.activeWall) {
      this.ui.hint("WALL RUN  /  Keep moving. SPACE to kick away.", 1);
      this.hintCooldown = 0.6;
      return;
    }
    const obstacles = this.level.world.nearby(p, 4);
    const ahead = obstacles.find(
      (c) =>
        c.bounds.max.z < p.z &&
        c.bounds.max.z > p.z - 4 &&
        p.x > c.bounds.min.x &&
        p.x < c.bounds.max.x &&
        c.bounds.max.y > p.y + 0.3,
    );
    if (ahead?.kind === "vault") {
      this.ui.hint("E  /  Vault the red barrier", 2);
      this.hintCooldown = 2;
    }
    if (ahead?.name === "Slide duct") {
      this.ui.hint("C or CTRL  /  Slide. Stay low until you’re through.", 2);
      this.hintCooldown = 2;
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.06);
    this.lastFrame = now;
    this.worldTime += dt;
    if (this.state === "playing") {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_STEP && this.state === "playing") {
        this.physics(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      this.firstPerson.update(dt, Math.max(0, this.accumulator / FIXED_STEP));
      this.ui.update(dt, this.elapsed, this.player.speed, this.player.moveName);
      this.contextualHint(dt);
      this.updateWaypoint();
      const p = this.player.position;
      this.sun.position.set(p.x - 40, p.y + 73, p.z + 19);
      this.sun.target.position.set(p.x, p.y, p.z - 20);
    } else if (this.state === "menu") {
      this.camera.position.set(
        8.2 + Math.sin(this.worldTime * 0.09) * 0.3,
        46.3,
        20.5,
      );
      this.camera.lookAt(-5.5, 44.2, -85);
      this.camera.fov = 67;
      this.camera.updateProjectionMatrix();
    }
    this.level.animate(this.worldTime);
    this.audio.update(
      dt,
      this.player.speed,
      this.player.grounded,
      this.player.sliding,
      this.state === "playing",
    );
    this.renderer.render(this.scene, this.camera);
  };
}
