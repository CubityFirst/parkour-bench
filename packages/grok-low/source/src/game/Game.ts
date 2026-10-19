import * as THREE from "three";
import { AudioManager } from "../audio/AudioManager";
import { FIXED_DT, KILL_Y, LOOK_YAW } from "../core/constants";
import { freshBot, botInput, type BotMemory } from "../player/bot";
import { FirstPersonCamera } from "../player/FirstPersonCamera";
import { PlayerController } from "../player/PlayerController";
import { spawnPlayer, stepPlayer } from "../player/PlayerPhysics";
import type { ActionPrompt, PlayerState, StepEvents } from "../player/types";
import { sampleTriggers } from "../world/Checkpoints";
import { buildCity, buildSky } from "../world/CityGenerator";
import { colliderHelpers, buildLevelMeshes } from "../world/Level";
import { createMaterials, type MaterialSet } from "../world/Materials";
import { buildCollisionWorld, buildLevelSpec, type LevelSpec } from "../world/levelSpec";
import type { CollisionWorld } from "../world/CollisionWorld";
import { HUD } from "../ui/HUD";
import { Menu } from "../ui/Menu";
import {
  formatTime,
  loadBest,
  loadSettings,
  saveBest,
  saveSettings,
  type GameMode,
  type Settings,
} from "./GameState";

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cine: THREE.PerspectiveCamera;
  private readonly view: FirstPersonCamera;
  private readonly controller: PlayerController;
  private readonly audio = new AudioManager();
  private readonly hud: HUD;
  private readonly menu: Menu;
  private readonly spec: LevelSpec;
  private readonly world: CollisionWorld;
  private readonly mats: MaterialSet;
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Object3D;
  private readonly flags: { cloth: THREE.Object3D; phase: number }[];
  private readonly red: THREE.MeshStandardMaterial;
  private readonly settings: Settings;
  private readonly useBot: boolean;

  private player: PlayerState;
  private botMem: BotMemory;
  private mode: GameMode = "menu";
  private checkpoint = 0;
  private runTime = 0;
  private acc = 0;
  private hint = "";
  private toast = "";
  private toastT = 0;
  private time = 0;
  private cineTime = 0;
  private last = 0;

  constructor(private readonly canvas: HTMLCanvasElement, ui: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.useBot = params.has("bot");
    this.settings = loadSettings();
    this.spec = buildLevelSpec();
    this.world = buildCollisionWorld(this.spec);
    this.botMem = freshBot();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

    this.scene.background = new THREE.Color(0xc5e4f6);
    this.scene.fog = new THREE.Fog(0xc5e4f6, 48, 220);

    this.mats = createMaterials(this.renderer);
    const level = buildLevelMeshes(this.spec, this.mats);
    this.flags = level.flags;
    this.red = level.red;
    this.scene.add(level.root);
    this.scene.add(buildCity(this.mats));
    this.sky = buildSky(this.mats);
    this.scene.add(this.sky);
    if (params.has("colliders")) this.scene.add(colliderHelpers(this.world));

    this.sun = new THREE.DirectionalLight(0xfff6e8, 3.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    const shadow = this.sun.shadow.camera as THREE.OrthographicCamera;
    shadow.left = -28;
    shadow.right = 28;
    shadow.top = 28;
    shadow.bottom = -28;
    shadow.near = 0.5;
    shadow.far = 96;
    shadow.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xe7f4ff, 0xb7b2aa, 0.95));
    const fill = new THREE.DirectionalLight(0xc5e4ff, 0.45);
    fill.position.set(-30, 24, -18);
    this.scene.add(fill);

    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.view = new FirstPersonCamera(aspect, this.spec.start.yaw || LOOK_YAW);
    this.scene.add(this.view.yaw);
    this.scene.add(this.view.feet);
    this.cine = new THREE.PerspectiveCamera(58, aspect, 0.1, 800);

    this.player = spawnPlayer(this.spec.start.x, this.spec.start.y, this.spec.start.z);
    this.view.snap(this.player, this.spec.start.yaw);

    this.controller = new PlayerController(this.view);
    this.controller.sensitivity = this.settings.sensitivity;

    this.hud = new HUD(ui);
    this.menu = new Menu(ui, this.settings, loadBest(), {
      onStart: () => this.begin(true),
      onResume: () => this.resume(),
      onRestart: () => this.begin(true),
      onMenu: () => this.toMenu(),
      onSettings: () => {
        this.controller.sensitivity = this.settings.sensitivity;
        saveSettings(this.settings);
      },
    });

    this.resize();
    window.addEventListener("resize", this.resize);
    this.canvas.addEventListener("click", () => {
      this.audio.unlock();
      if (this.mode === "playing" && !this.useBot && document.pointerLockElement !== this.canvas) {
        void this.canvas.requestPointerLock();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement !== this.canvas && this.mode === "playing" && !this.useBot) this.pause();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR" && this.mode === "playing") {
        e.preventDefault();
        this.respawn();
        this.toast = "Checkpoint";
        this.toastT = 1.3;
      }
      // Pointer lock consumes Esc while the mouse is captured. This covers the bot and a failed lock.
      if (e.code === "Escape" && this.mode === "playing" && document.pointerLockElement !== this.canvas) this.pause();
    });

    if (this.useBot) this.begin(true);
    requestAnimationFrame(this.frame);
  }

  private begin(reset: boolean): void {
    this.audio.unlock();
    if (reset) {
      this.runTime = 0;
      this.checkpoint = 0;
      this.botMem = freshBot();
      this.hint = "";
      this.toast = "";
      this.toastT = 0;
      this.respawn();
    }
    this.acc = 0;
    this.mode = "playing";
    this.menu.show("none");
    if (!this.useBot) void this.canvas.requestPointerLock();
  }

  private pause(): void {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.acc = 0;
    this.menu.show("pause");
  }

  private resume(): void {
    if (this.mode !== "paused") return;
    this.audio.unlock();
    this.mode = "playing";
    this.menu.show("none");
    if (!this.useBot) void this.canvas.requestPointerLock();
  }

  private toMenu(): void {
    this.mode = "menu";
    this.acc = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.show("main");
  }

  /** Latest checkpoint. The run timer is not reset. */
  private respawn(): void {
    const cp = this.spec.checkpoints.find((c) => c.index === this.checkpoint) ?? this.spec.checkpoints[0];
    this.player = spawnPlayer(cp.x, cp.y, cp.z);
    this.view.snap(this.player, cp.yaw);
    this.controller.clearEdges();
    this.botMem = freshBot();
  }

  private finish(): void {
    if (this.mode !== "playing") return;
    this.mode = "finished";
    this.acc = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    const best = saveBest(this.runTime);
    this.menu.setBest(best);
    this.menu.showFinish(this.runTime, best);
    this.audio.finish();
  }

  private frame = (now: number): void => {
    try {
      this.drawFrame(now);
    } catch (err) {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(msg);
      const host = document.querySelector("#ui");
      if (host && !host.querySelector(".crash")) {
        const note = document.createElement("pre");
        note.className = "crash";
        note.textContent = msg;
        host.append(note);
      }
      requestAnimationFrame(this.frame);
    }
  };

  private drawFrame(now: number): void {
    const elapsed = this.last === 0 ? 0 : now - this.last;
    const dt = Math.min(0.05, Math.max(0, elapsed / 1000));
    this.last = now;
    this.time += dt;

    if (this.mode === "playing") this.simulate(dt);

    if (this.useBot && this.mode === "playing") this.aimBot();
    this.view.update(this.player, dt, this.settings.reduceMotion, this.controller.strafe);
    this.animateWorld();

    const menuView = this.mode === "menu";
    if (menuView) this.updateCine(dt);
    const camera = menuView ? this.cine : this.view.camera;
    this.sky.position.copy(camera.position);
    this.renderer.render(this.scene, camera);

    if (this.toastT > 0) this.toastT -= dt;
    this.hud.set({
      time: formatTime(this.runTime),
      hint: this.mode === "playing" ? this.hint : "",
      toast: this.toastT > 0 ? this.toast : "",
      showPlay: this.mode === "playing" || this.mode === "paused",
      bot: this.useBot && this.mode === "playing",
    });

    requestAnimationFrame(this.frame);
  };

  private simulate(dt: number): void {
    this.acc += dt;
    let steps = 0;
    let first = true;
    while (this.acc >= FIXED_DT && steps < 6) {
      const input = this.useBot
        ? botInput(this.player, this.spec, this.world, this.botMem, FIXED_DT)
        : this.controller.sample(first);
      const ev = stepPlayer(this.player, input, this.world, FIXED_DT);
      this.playEvents(ev);
      this.runTime += FIXED_DT;
      this.acc -= FIXED_DT;
      steps += 1;
      first = false;
    }
    if (steps === 6) this.acc = 0;

    const hit = sampleTriggers(this.spec, this.player.x, this.player.y, this.player.z, this.checkpoint);
    if (hit.checkpoint) {
      this.checkpoint = hit.checkpoint.index;
      this.toast = "Checkpoint";
      this.toastT = 2.2;
      this.audio.checkpoint();
    }
    if (hit.finish) {
      this.finish();
      return;
    }
    if (this.player.y < KILL_Y) {
      this.respawn();
      this.toast = "Fell — back to the checkpoint";
      this.toastT = 1.6;
      this.audio.land(8);
      this.hint = "";
      return;
    }
    this.hint = promptText(this.player.prompt) ?? hit.hint ?? "";
  }

  private playEvents(ev: StepEvents): void {
    if (ev.jump) this.audio.jump();
    if (ev.land) this.audio.land(ev.landImpact);
    if (ev.footstep) this.audio.footstep(this.player.speed);
    if (ev.slideOn) this.audio.slide(true);
    if (ev.slideOff) this.audio.slide(false);
    if (ev.vault || ev.mantle) this.audio.vault();
    if (ev.wallOn) this.audio.vault();
  }

  private aimBot(): void {
    const speed = this.player.speed;
    if (speed > 0.8) {
      this.view.mouseYaw = Math.atan2(-this.player.vx / speed, -this.player.vz / speed);
      this.view.mousePitch = -0.1;
    }
  }

  private animateWorld(): void {
    for (const flag of this.flags) {
      flag.cloth.rotation.z = Math.sin(this.time * 2.2 + flag.phase) * 0.18;
    }
    this.red.emissiveIntensity = 0.23 + Math.sin(this.time * 2.2) * 0.05;
    const skyTime = this.mats.sky.uniforms.time;
    if (skyTime) skyTime.value = this.time;

    const x = Math.round(this.player.x / 2) * 2;
    const z = Math.round(this.player.z / 2) * 2;
    this.sun.position.set(x + 24, this.player.y + 38, z + 16);
    this.sun.target.position.set(x, this.player.y + 1, z);
    this.audio.wind(this.mode === "playing" ? this.player.speed : 0);
    this.audio.slide(this.mode === "playing" && this.player.mode === "slide");
  }

  private updateCine(dt: number): void {
    this.cineTime += dt;
    const t = this.cineTime;
    this.cine.position.set(-7 + Math.sin(t * 0.17) * 3.2, 6.6, 17 + Math.cos(t * 0.13) * 2.2);
    this.cine.lookAt(22, 1.35, 0);
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.view.resize(aspect);
    this.cine.aspect = aspect;
    this.cine.updateProjectionMatrix();
  };
}

function promptText(prompt: ActionPrompt): string | null {
  if (prompt === "vault") return "E  ·  Vault";
  if (prompt === "wall") return "Space  ·  Jump off the wall";
  if (prompt === "slide") return "Ctrl  ·  Slide";
  return null;
}
