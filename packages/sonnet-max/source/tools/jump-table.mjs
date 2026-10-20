// Prints how far the player travels in the air for a range of take-off speeds and landing heights.
// This is the data the level's gaps are designed against. Usage: node tools/jump-table.mjs
import { CollisionWorld } from '../src/world/CollisionWorld.ts';
import { PlayerController, createInput } from '../src/player/PlayerController.ts';
import { FIXED_DT, PLAYER, MOVE } from '../src/config.ts';

function jumpDistance(speed, dropHeight, hold = true) {
  const world = new CollisionWorld();
  // very long, very deep roof; no ground below the edge so nothing interferes
  world.addBox(-20, -100, 0, 20, 0, 60, 0, 'roof');
  const ctrl = new PlayerController(world);
  ctrl.reset(0, 0, 0);
  const input = createInput();
  input.moveY = 1;
  input.sprint = true;
  // Place on the roof edge moving at `speed`
  const b = ctrl.body;
  b.setPosition(0, 0, 0);
  b.vz = -speed;
  ctrl.flow = Math.max(0, Math.min(1, (speed - MOVE.sprintSpeed) / (MOVE.sprintSpeedMax - MOVE.sprintSpeed)));
  // run a few ticks to settle (grounded)
  for (let i = 0; i < 4; i++) ctrl.update(FIXED_DT, input);
  b.vz = -speed;
  input.jumpPressed = true;
  input.jumpHeld = hold;
  const z0 = b.z;
  let t = 0;
  let prevY = b.y;
  let result = null;
  for (let i = 0; i < 600; i++) {
    ctrl.update(FIXED_DT, input);
    input.jumpPressed = false;
    t += FIXED_DT;
    if (b.vy < 0 && prevY > -dropHeight && b.y <= -dropHeight) {
      result = { dist: z0 - b.z, time: t, speed: b.horizontalSpeed };
      break;
    }
    prevY = b.y;
    if (ctrl.state === 'wallrun' || ctrl.state === 'scripted') break;
  }
  return result;
}

const speeds = [6, 7.5, 9.0, 9.8, 10.6];
const drops = [-1.5, 0, 1.5, 3, 5];
console.log('Centre travel (m) from take-off at the roof edge until the feet cross the landing height.');
console.log('rows: take-off speed (m/s); columns: landing roof height relative to take-off roof (m)');
console.log('speed\\drop ' + drops.map((d) => String(-d).padStart(7)).join(''));
for (const s of speeds) {
  const row = drops.map((d) => {
    const r = jumpDistance(s, d);
    return (r ? r.dist.toFixed(2) : '  -  ').padStart(7);
  });
  console.log(String(s).padEnd(11) + row.join(''));
}
console.log(`\nPlayer half width: ${PLAYER.halfWidth} m. Edge-to-edge gap capacity ~= travel + up to ${PLAYER.halfWidth * 2} m (overhang at take-off + overlap on landing).`);
