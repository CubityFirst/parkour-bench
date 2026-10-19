import * as THREE from "three";
import { CollisionWorld, type Solid } from "../world/CollisionWorld";
import { Input } from "./Input";

export type MovementEvent = "jump" | "land" | "slide" | "vault" | "wall";
interface Mantle {
  from: THREE.Vector3;
  to: THREE.Vector3;
  time: number;
  duration: number;
  arcHeight: number;
}

function traversalPosition(
  from: THREE.Vector3,
  to: THREE.Vector3,
  t: number,
  arcHeight: number,
) {
  // Lift before translating, so vaulting at contact never clips the barrier.
  const travel = THREE.MathUtils.clamp((t - 0.2) / 0.6, 0, 1);
  const ease = travel * travel * (3 - 2 * travel);
  const lift = Math.sin(
    (Math.max(0, Math.min(1, t / 0.22, (1 - t) / 0.22)) * Math.PI) / 2,
  );
  const point = from.clone().lerp(to, ease);
  point.y += lift * arcHeight;
  return point;
}

export class PlayerController {
  position = new THREE.Vector3(0, 42, 18);
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  sliding = false;
  wallSide = 0;
  height = 1.8;
  impact = 0;
  vaultMotion = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private slideTime = 0;
  private assistedSlide = false;
  private wallTime = 0;
  private wallCooldown = 0;
  private wallUsed = false;
  private jumpWasDown = false;
  private mantle: Mantle | null = null;
  onEvent: (event: MovementEvent) => void = () => {};
  constructor(
    public world: CollisionWorld,
    public input: Input,
  ) {}
  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
  get state() {
    return this.mantle
      ? "VAULT"
      : this.wallSide
        ? "WALL RUN"
        : this.sliding
          ? "SLIDING"
          : !this.grounded
            ? "AIRBORNE"
            : this.speed > 9
              ? "SPRINTING"
              : this.speed > 0.5
                ? "RUNNING"
                : "READY";
  }
  reset(
    position: THREE.Vector3,
    { preserveHeldInput = false }: { preserveHeldInput?: boolean } = {},
  ) {
    this.position.copy(position);
    this.position.y += 0.02;
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.sliding = false;
    this.height = 1.8;
    this.wallSide = 0;
    this.wallTime = 0;
    this.wallCooldown = 0;
    this.wallUsed = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.slideTime = 0;
    this.assistedSlide = false;
    this.jumpWasDown = false;
    this.mantle = null;
    this.impact = 0;
    this.vaultMotion = 0;
    if (preserveHeldInput) this.input.clearTransient();
    else this.input.clear();
  }
  look(sensitivity: number) {
    this.yaw -= this.input.mouseX * 0.0019 * sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - this.input.mouseY * 0.0019 * sensitivity,
      -1.42,
      1.42,
    );
    this.input.mouseX = this.input.mouseY = 0;
  }
  update(dt: number) {
    this.impact *= Math.exp(-dt * 12);
    this.vaultMotion *= Math.exp(-dt * 9);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    if (this.mantle) {
      const m = this.mantle;
      m.time += dt;
      const t = Math.min(1, m.time / m.duration);
      this.position.copy(traversalPosition(m.from, m.to, t, m.arcHeight));
      this.vaultMotion = Math.sin(t * Math.PI);
      if (t >= 1) {
        this.mantle = null;
        this.velocity.y = 0;
        this.grounded = true;
      }
      return;
    }
    const jumpDown = this.input.down("Space");
    if (this.input.take("Space")) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (!jumpDown && this.jumpWasDown && this.velocity.y > 3 && !this.wallSide)
      this.velocity.y *= 0.55;
    this.jumpWasDown = jumpDown;
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    if (this.grounded) {
      this.wallUsed = false;
      this.wallTime = 0;
    }
    let forward =
      (this.input.down("KeyW", "ArrowUp") ? 1 : 0) -
      (this.input.down("KeyS", "ArrowDown") ? 1 : 0);
    let strafe =
      (this.input.down("KeyD", "ArrowRight") ? 1 : 0) -
      (this.input.down("KeyA", "ArrowLeft") ? 1 : 0);
    const length = Math.hypot(forward, strafe);
    if (length > 1) {
      forward /= length;
      strafe /= length;
    }
    const wish = new THREE.Vector3(
      strafe * Math.cos(this.yaw) - forward * Math.sin(this.yaw),
      0,
      -forward * Math.cos(this.yaw) - strafe * Math.sin(this.yaw),
    );
    const sprinting = this.input.down("ShiftLeft", "ShiftRight");
    const crouch = this.input.down("KeyC", "ControlLeft", "ControlRight");
    // Only marked warm-up obstacles assist traversal. The rest of the course
    // still requires the player's vault and slide inputs.
    if (
      sprinting &&
      forward > 0 &&
      this.grounded &&
      !this.sliding &&
      this.speed > 7 &&
      this.nearAssistedDuct()
    )
      this.assistedSlide = true;
    if (
      (crouch || this.assistedSlide) &&
      this.grounded &&
      !this.sliding &&
      this.speed > 6
    ) {
      this.sliding = true;
      this.slideTime = 1.3;
      this.onEvent("slide");
    }
    if (this.sliding) {
      this.slideTime -= dt;
      this.height = 0.86;
      this.velocity.x *= Math.exp(-dt * 0.29);
      this.velocity.z *= Math.exp(-dt * 0.29);
      this.velocity.x += wish.x * dt * 1.8;
      this.velocity.z += wish.z * dt * 1.8;
      if (
        ((!crouch && (!this.assistedSlide || this.slideTime < 1)) ||
          this.slideTime <= 0) &&
        !this.world.overlaps(this.position, 1.8)
      ) {
        this.sliding = false;
        this.assistedSlide = false;
        this.height = 1.8;
      }
    } else {
      this.height = crouch ? 1.08 : 1.8;
      if (this.height === 1.8 && this.world.overlaps(this.position, 1.8))
        this.height = 0.86;
      const maxSpeed = crouch
        ? 4
        : this.input.down("ShiftLeft", "ShiftRight")
          ? 13.5
          : 7.2;
      if (this.grounded) {
        const acceleration = length ? 48 : 38;
        const target = wish.clone().multiplyScalar(maxSpeed);
        const change = new THREE.Vector3(
          target.x - this.velocity.x,
          0,
          target.z - this.velocity.z,
        );
        if (change.length() > acceleration * dt)
          change.setLength(acceleration * dt);
        this.velocity.add(change);
      } else if (length) {
        // Air steering redirects momentum without accelerating beyond sprint speed.
        this.velocity.x += wish.x * dt * 10;
        this.velocity.z += wish.z * dt * 10;
        if (this.speed > 13.5) {
          const scale = 13.5 / this.speed;
          this.velocity.x *= scale;
          this.velocity.z *= scale;
        }
      }
    }
    let activeWall: Solid | undefined;
    this.wallSide = 0;
    if (
      !this.grounded &&
      this.speed > 7 &&
      !this.wallUsed &&
      this.wallCooldown <= 0 &&
      forward > 0
    ) {
      activeWall = this.world
        .nearby(this.position, 1.65)
        .find(
          (s) =>
            s.runnable &&
            this.position.y + 1 > s.min.y &&
            this.position.y < s.max.y &&
            this.position.z > s.min.z - 0.1 &&
            this.position.z < s.max.z + 0.1 &&
            Math.min(
              Math.abs(this.position.x - s.min.x),
              Math.abs(this.position.x - s.max.x),
            ) < 1.5,
        );
      if (activeWall) {
        const side =
          this.position.x > (activeWall.min.x + activeWall.max.x) / 2 ? 1 : -1;
        this.wallSide = side;
        this.wallTime += dt;
        if (this.wallTime <= dt) {
          this.onEvent("wall");
          this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, 1.4, 2.5);
        }
        this.position.x =
          side > 0 ? activeWall.max.x + 0.34 : activeWall.min.x - 0.34;
        this.velocity.x = 0;
        this.velocity.z = -Math.max(12.8, Math.abs(this.velocity.z));
        this.velocity.y = Math.max(-1.2, this.velocity.y - 3 * dt);
        if (this.wallTime > 1.95) {
          this.wallUsed = true;
          this.wallSide = 0;
        }
      }
    }
    if (this.jumpBuffer > 0 && (this.coyote > 0 || this.wallSide)) {
      if (this.wallSide) {
        this.velocity.x = this.wallSide * 6;
        this.wallUsed = true;
        this.wallCooldown = 0.3;
      }
      if (this.sliding && !this.world.overlaps(this.position, 1.8)) {
        this.sliding = false;
        this.assistedSlide = false;
        this.height = 1.8;
      }
      this.velocity.y = 9.2;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.wallSide = 0;
      this.onEvent("jump");
    }
    if (!this.wallSide) this.velocity.y -= 25 * dt;
    const manualVault = this.input.take("KeyE");
    if (
      manualVault ||
      (sprinting &&
        forward > 0 &&
        this.grounded &&
        !this.sliding &&
        this.speed > 7)
    ) {
      if (this.tryVault(!manualVault)) return;
    }
    // A falling runner may recover an edge up to 1.25 m above their feet.
    if (
      !this.grounded &&
      this.velocity.y < 1 &&
      forward > 0 &&
      this.tryMantle()
    )
      return;
    const result = this.world.move(
      this.position,
      this.velocity,
      this.height,
      dt,
    );
    if (result.grounded && !this.grounded && result.impact > 3) {
      this.impact = Math.min(0.25, result.impact * 0.015);
      this.onEvent("land");
    }
    this.grounded = result.grounded;
  }
  private beginMantle(
    target: THREE.Vector3,
    duration: number,
    arcHeight = 0.55,
  ) {
    this.mantle = {
      from: this.position.clone(),
      to: target,
      time: 0,
      duration,
      arcHeight,
    };
    this.sliding = false;
    this.assistedSlide = false;
    this.height = 1.8;
    this.wallSide = 0;
    this.onEvent("vault");
  }
  private nearAssistedDuct() {
    const ahead = this.position
      .clone()
      .add(
        new THREE.Vector3(
          -Math.sin(this.yaw) * 1.35,
          0,
          -Math.cos(this.yaw) * 1.35,
        ),
      );
    return this.world
      .nearby(ahead, 0.35)
      .some(
        (s) =>
          s.tutorialAssist &&
          s.kind === "ceiling" &&
          ahead.x > s.min.x - 0.32 &&
          ahead.x < s.max.x + 0.32 &&
          ahead.z > s.min.z - 0.32 &&
          ahead.z < s.max.z + 0.32 &&
          s.min.y - this.position.y >= 0.9 &&
          s.min.y - this.position.y < 1.8 &&
          !this.world.overlaps(this.position, 0.86),
      );
  }
  private tryVault(assistedOnly = false) {
    const direction = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw),
    );
    const ahead = this.position.clone().addScaledVector(direction, 1.15);
    for (const s of this.world.nearby(ahead, 1)) {
      if (
        s.kind !== "obstacle" ||
        (assistedOnly && !s.tutorialAssist) ||
        s.max.y - this.position.y > 1.5 ||
        s.max.y < this.position.y + 0.3
      )
        continue;
      if (
        ahead.x < s.min.x - 0.3 ||
        ahead.x > s.max.x + 0.3 ||
        ahead.z < s.min.z - 0.3 ||
        ahead.z > s.max.z + 0.3
      )
        continue;
      const depth =
        Math.abs(direction.z) > 0.7 ? s.max.z - s.min.z : s.max.x - s.min.x;
      if (depth > 2.5) continue;
      const target = this.position
        .clone()
        .addScaledVector(direction, depth + 2.1);
      target.y = Math.max(this.position.y, s.min.y);
      const high = target.clone();
      high.y = s.max.y + 0.05;
      if (this.world.overlaps(target, 1.8) || this.world.overlaps(high, 1.8))
        continue;
      const arcHeight = s.max.y - this.position.y + 0.55;
      let obstructed = false;
      for (let n = 1; n < 12; n++) {
        const sample = traversalPosition(
          this.position,
          target,
          n / 12,
          arcHeight,
        );
        if (this.world.overlaps(sample, 1.8)) {
          obstructed = true;
          break;
        }
      }
      if (obstructed) continue;
      this.beginMantle(target, 0.4, arcHeight);
      return true;
    }
    return false;
  }
  private tryMantle() {
    const ahead = this.position
      .clone()
      .add(
        new THREE.Vector3(
          -Math.sin(this.yaw) * 0.75,
          0,
          -Math.cos(this.yaw) * 0.75,
        ),
      );
    for (const s of this.world.nearby(ahead, 0.5)) {
      if (
        s.kind !== "roof" ||
        s.max.y - this.position.y < 0.15 ||
        s.max.y - this.position.y > 1.25
      )
        continue;
      if (
        ahead.x < s.min.x + 0.35 ||
        ahead.x > s.max.x - 0.35 ||
        ahead.z < s.min.z + 0.35 ||
        ahead.z > s.max.z - 0.35
      )
        continue;
      ahead.y = s.max.y + 0.02;
      if (this.world.overlaps(ahead, 1.8)) continue;
      this.beginMantle(ahead.clone(), 0.28);
      return true;
    }
    return false;
  }
}
