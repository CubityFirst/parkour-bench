import {
  AIR_ACCEL,
  COYOTE,
  CROUCH_SPEED,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  HW,
  JUMP_BUFFER,
  JUMP_CUT_WINDOW,
  JUMP_V,
  SLIDE_ENTER,
  SLIDE_FRICTION,
  SLIDE_H,
  SLIDE_MIN,
  SPRINT_SPEED,
  STAND_H,
  WALK_SPEED,
  clamp,
} from "../core/constants";
import { moveBody, type CollisionWorld } from "../world/CollisionWorld";
// moveBody(world, body, height, dt, canStep)
import {
  advanceScript,
  ceilingAhead,
  findHurdle,
  stepWallRun,
  tryMantle,
  tryStartVault,
  tryStartWall,
} from "./ParkourSystem";
import {
  createPlayerState,
  emptyEvents,
  type MoveMode,
  type PlayerInput,
  type PlayerState,
  type StepEvents,
} from "./types";

export function spawnPlayer(x: number, y: number, z: number): PlayerState {
  const s = createPlayerState(x, y + 0.05, z);
  s.mode = "ground";
  s.grounded = true;
  s.coyote = COYOTE;
  return s;
}

/** Fixed-timestep movement step. Wish direction is already in world space. */
export function stepPlayer(
  s: PlayerState,
  input: PlayerInput,
  world: CollisionWorld,
  dt: number,
): StepEvents {
  const ev = emptyEvents();
  s.prompt = null;
  s.vaultBlend = 0;

  if (input.jump) s.jumpBuffer = JUMP_BUFFER;
  else s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
  if (input.vault) s.vaultBuffer = 0.24;
  else s.vaultBuffer = Math.max(0, s.vaultBuffer - dt);
  if (!input.jump) s.jumpLatched = false;

  if (s.mode === "vault" || s.mode === "mantle") {
    advanceScript(s, world, dt, ev);
    s.speed = Math.hypot(s.vx, s.vz);
    return ev;
  }

  if (s.mode === "wallrun") {
    const before = s.mode;
    stepWallRun(s, input, world, dt, ev);
    if (s.mode === "wallrun") {
      const hit = moveBody(world, s, s.height, dt, false);
      s.grounded = false;
      if (hit.ceiling) s.vy = Math.min(s.vy, 0);
      s.speed = Math.hypot(s.vx, s.vz);
      s.prompt = "wall";
      decayKick(s, dt);
      return ev;
    }
    // Released into the air on this step: keep integrating as air below.
    if (before === "wallrun" && s.mode === "air") {
      s.vy -= GRAVITY * dt;
      integrate(s, world, dt, ev, false);
      s.speed = Math.hypot(s.vx, s.vz);
      decayKick(s, dt);
      return ev;
    }
  }

  updateLocomotion(s, input, world, dt, ev);

  const wantJump = s.jumpBuffer > 0;
  const groundedLike = s.grounded || s.coyote > 0;
  if (wantJump && groundedLike && !s.jumpLatched && s.mode !== ("wallrun" as MoveMode)) {
    if (s.mode === "slide") ev.slideOff = true;
    s.mode = "air";
    s.vy = JUMP_V;
    s.grounded = false;
    s.coyote = 0;
    s.jumpBuffer = 0;
    s.jumpLatched = true;
    s.jumpCut = false;
    s.jumpAir = 0;
    ev.jump = true;
  }

  if (!s.grounded) {
    if (s.mode === "air") {
      s.jumpAir += dt;
      if (!input.jumpHeld && !s.jumpCut && s.vy > 0 && s.jumpAir > 0 && s.jumpAir < JUMP_CUT_WINDOW) {
        s.vy *= 0.5;
        s.jumpCut = true;
      }
    }
    s.vy -= GRAVITY * dt;
  } else if (s.mode !== "slide") {
    s.vy = Math.min(s.vy, 0);
  }

  integrate(s, world, dt, ev, s.grounded || s.mode === "ground" || s.mode === "crouch" || s.mode === "slide");

  if (s.vaultBuffer > 0 && s.mode !== ("wallrun" as MoveMode)) {
    if (tryStartVault(s, input, world, ev)) s.vaultBuffer = 0;
  }

  s.speed = Math.hypot(s.vx, s.vz);
  if (s.prompt === null && s.mode !== "slide") {
    if (findHurdle(s, input, world)) s.prompt = "vault";
    else if (s.grounded && ceilingAhead(s, input, world)) s.prompt = "slide";
  }
  decayKick(s, dt);
  return ev;
}

function integrate(
  s: PlayerState,
  world: CollisionWorld,
  dt: number,
  ev: StepEvents,
  canStep: boolean,
): void {
  const prevGround = s.grounded;
  const prevVy = s.vy;
  if (s.grounded && s.mode === "slide") s.vy = 0;
  const hit = moveBody(world, s, s.height, dt, canStep);
  s.grounded = hit.grounded;

  if (s.grounded) {
    s.coyote = COYOTE;
    s.airWall = 0;
    s.banWall = 0;
    s.wallCd = Math.min(s.wallCd, 0);
    if (!prevGround) {
      if (prevVy < -2.4) {
        ev.land = true;
        ev.landImpact = -prevVy;
        s.landKick = clamp(-prevVy / 16, 0.2, 1);
      }
      if (s.mode === "air") s.mode = headroom(world, s) ? "ground" : "crouch";
    }
    if ((s.mode === "ground" || s.mode === "crouch") && s.speed > 1.2) {
      s.stepAcc += s.speed * dt;
      const stride = s.speed > 8.5 ? 1.62 : 1.22;
      if (s.stepAcc >= stride) {
        s.stepAcc = 0;
        ev.footstep = true;
      }
    }
  } else {
    s.coyote = Math.max(0, s.coyote - dt);
    s.airWall += dt;
    if (s.mode === "slide") {
      s.mode = "air";
      ev.slideOff = true;
    } else if (s.mode === "ground" || s.mode === "crouch") {
      s.mode = "air";
    }
    if (s.mode === "air") {
      tryStartWall(s, { wishX: s.vx, wishZ: s.vz, sprint: true, jump: false, jumpHeld: false, slide: false, vault: false }, world, ev);
      if (s.mode === "air") tryMantle(s, blankWish(s), world, ev);
    }
  }
  s.wallCd = Math.max(0, s.wallCd - dt);
}

function updateLocomotion(
  s: PlayerState,
  input: PlayerInput,
  world: CollisionWorld,
  dt: number,
  ev: StepEvents,
): void {
  const canStand = headroom(world, s);

  if (s.mode === "slide") {
    s.slideT += dt;
    s.height = SLIDE_H;
    const sp = Math.hypot(s.vx, s.vz);
    const ns = Math.max(0, sp - SLIDE_FRICTION * dt);
    if (sp > 0.05) {
      let tx = s.vx / sp;
      let tz = s.vz / sp;
      const wish = Math.hypot(input.wishX, input.wishZ);
      if (wish > 0.25) {
        const a = clamp(1.6 * dt, 0, 0.35);
        tx = tx * (1 - a) + (input.wishX / wish) * a;
        tz = tz * (1 - a) + (input.wishZ / wish) * a;
        const m = Math.hypot(tx, tz) || 1;
        tx /= m;
        tz /= m;
      }
      s.vx = tx * ns;
      s.vz = tz * ns;
    } else {
      s.vx = 0;
      s.vz = 0;
    }
    const slow = ns < SLIDE_MIN;
    const release = !input.slide && s.slideT > 0.2;
    if (slow || release) {
      ev.slideOff = true;
      if (!canStand) s.mode = "crouch";
      else s.mode = input.slide && slow ? "crouch" : "ground";
      if (s.mode === "crouch") s.height = SLIDE_H;
    }
    return;
  }

  if (s.mode === "crouch") {
    s.height = SLIDE_H;
    if (input.slide && s.grounded && s.speed > SLIDE_ENTER) {
      beginSlide(s, ev);
      return;
    }
    if (!input.slide && canStand) {
      s.mode = "ground";
    }
  } else if (s.mode === "ground" && input.slide && s.grounded) {
    if (s.speed > SLIDE_ENTER) {
      beginSlide(s, ev);
      return;
    }
    s.mode = "crouch";
    s.height = SLIDE_H;
  }

  if (!canStand && (s.mode === "ground" || s.mode === "crouch")) {
    s.mode = "crouch";
    s.height = SLIDE_H;
  } else if (s.mode === "ground") {
    growHeight(s, world, dt);
  }

  if (s.mode === ("slide" as MoveMode)) return;
  accelerate(s, input, dt);
}

function beginSlide(s: PlayerState, ev: StepEvents): void {
  const sp = Math.hypot(s.vx, s.vz);
  const boosted = Math.min(SPRINT_SPEED, Math.max(sp, Math.min(sp + 0.5, 9.4)));
  if (sp > 0.2) {
    s.vx = (s.vx / sp) * boosted;
    s.vz = (s.vz / sp) * boosted;
  }
  s.mode = "slide";
  s.slideT = 0;
  s.height = SLIDE_H;
  ev.slideOn = true;
}

function accelerate(s: PlayerState, input: PlayerInput, dt: number): void {
  const wish = Math.hypot(input.wishX, input.wishZ);
  let wx = 0;
  let wz = 0;
  if (wish > 0.01) {
    wx = input.wishX / wish;
    wz = input.wishZ / wish;
  }
  const sprinting = input.sprint && s.mode !== "crouch";
  const maxSpeed = s.mode === "crouch" ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;

  if (s.grounded && (s.mode === "ground" || s.mode === "crouch")) {
    if (wish < 0.12) {
      const sp = Math.hypot(s.vx, s.vz);
      const ns = Math.max(0, sp - GROUND_FRICTION * dt);
      if (sp > 0.001) {
        s.vx = (s.vx / sp) * ns;
        s.vz = (s.vz / sp) * ns;
      }
    } else {
      s.vx = approach(s.vx, wx * maxSpeed, GROUND_ACCEL * dt);
      s.vz = approach(s.vz, wz * maxSpeed, GROUND_ACCEL * dt);
    }
    return;
  }

  if (s.mode === "air" && wish > 0.12) {
    const sp = Math.hypot(s.vx, s.vz);
    s.vx += wx * AIR_ACCEL * dt;
    s.vz += wz * AIR_ACCEL * dt;
    const ns = Math.hypot(s.vx, s.vz);
    const cap = Math.max(sp, maxSpeed);
    if (ns > cap && ns > 0) {
      s.vx = (s.vx / ns) * cap;
      s.vz = (s.vz / ns) * cap;
    }
  }
}

function growHeight(s: PlayerState, world: CollisionWorld, dt: number): void {
  if (s.height >= STAND_H - 0.01) {
    s.height = STAND_H;
    return;
  }
  const next = Math.min(STAND_H, s.height + dt * 9);
  if (world.overlaps(s.x, s.y, s.z, HW, next)) return;
  s.height = next;
}

function headroom(world: CollisionWorld, s: PlayerState): boolean {
  return world.overlaps(s.x, s.y, s.z, HW, STAND_H) === null;
}

function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

function decayKick(s: PlayerState, dt: number): void {
  s.landKick = Math.max(0, s.landKick - dt * 2.8);
}

function blankWish(s: PlayerState): PlayerInput {
  const sp = Math.hypot(s.vx, s.vz);
  return {
    wishX: sp > 0.1 ? s.vx / sp : 0,
    wishZ: sp > 0.1 ? s.vz / sp : 0,
    sprint: true,
    jump: false,
    jumpHeld: false,
    slide: false,
    vault: false,
  };
}
