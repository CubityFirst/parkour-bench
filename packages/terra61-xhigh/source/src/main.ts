import * as THREE from 'three';
import { World } from './world';
import { Player } from './player';
import './style.css';
import './compact.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="viewport"></div>
  <div class="grain"></div>
  <div class="hud" id="hud">
    <div class="hud-top"><div class="hud-brand"><span class="brand-icon">↗</span><span>SKYLINE<br><b>RELAY</b></span></div><div class="hud-timer"><small>RUN TIME</small><strong id="timer">00:00.00</strong></div><div class="hud-stage"><small>ROUTE PROGRESS</small><strong id="stage">01 <span>/ 06</span></strong></div></div>
    <div class="crosshair"><i></i><i></i></div>
    <div class="hud-bottom"><div class="location"><span class="red-rule"></span><div><small>CURRENT SECTOR</small><strong id="location">THE DEPARTURE</strong></div></div><div class="hint" id="hint">SHIFT TO SPRINT &nbsp;/&nbsp; SPACE TO JUMP</div><div class="reset-hint"><kbd>R</kbd> RESTART AT CHECKPOINT</div></div>
    <div id="notice" class="notice"><span>●</span> CHECKPOINT REACHED</div>
  </div>
  <div class="screen" id="menu">
    <div class="menu-left"><div class="eyebrow"><span class="brand-icon">↗</span> AN ORIGINAL ROOFTOP TIME TRIAL <span class="eyebrow-line"></span> 01 / 06</div>
      <div class="hero"><div class="hero-kicker"><span></span> THE CITY IS YOUR PLAYGROUND</div><h1>SKYLINE<br><em>RELAY</em><sup>™</sup></h1><p>Find your line. Keep your momentum.<br>Make the city yours.</p><div class="menu-actions"><button id="start" class="primary"><span>START RUN</span><b>↗</b></button><button id="controls-button" class="secondary">CONTROLS <span>+</span></button></div></div>
      <div class="menu-footer"><span>FREE RUN &nbsp; / &nbsp; SINGLE PLAYER</span><span>DESIGNED FOR MOTION <b>●</b></span></div>
    </div>
    <div class="menu-right"><div class="right-top"><span>THE ROUTE</span><b>01 — 06</b></div><div class="route-card"><div class="card-number">01 <span>/ 06</span></div><div class="route-graphic"><span></span><span></span><span></span><span></span><span></span><span></span></div><h2>ABOVE<br>THE NOISE<span>.</span></h2><p>Six sectors. One uninterrupted line.<br>Follow the red and don't look down.</p><div class="route-meta"><span>LOCATION <b>THE CITY</b></span><span>OBJECTIVE <b>REACH THE FINISH</b></span></div></div><div class="right-bottom"><span>EST. RUN TIME</span><strong>01:30 <small>MIN</small></strong><span class="vertical-label">KEEP MOVING ↗</span></div></div>
  </div>
  <div class="modal hidden" id="controls"><div class="modal-card"><div class="modal-top"><span>FIELD GUIDE / 01</span><button id="close-controls" aria-label="Close">×</button></div><h2>THE BASICS<span>.</span></h2><p>Movement is your only objective. Keep your eyes on the red.</p><div class="control-grid"><div><kbd>W A S D</kbd><span>MOVE</span></div><div><kbd>MOUSE</kbd><span>LOOK</span></div><div><kbd>SHIFT</kbd><span>SPRINT</span></div><div><kbd>SPACE</kbd><span>JUMP / WALL JUMP</span></div><div><kbd>CTRL / C</kbd><span>SLIDE</span></div><div><kbd>E</kbd><span>VAULT / MANTLE</span></div><div><kbd>R</kbd><span>RESTART CHECKPOINT</span></div><div><kbd>ESC</kbd><span>PAUSE</span></div></div><div class="settings"><label>MOUSE SENSITIVITY <input id="sensitivity" type="range" min="0.4" max="2" value="1" step="0.1"></label><label class="motion"><input id="motion" type="checkbox"> REDUCE CAMERA MOTION</label></div><button id="controls-done" class="primary"><span>GOT IT</span><b>↗</b></button></div></div>
  <div class="modal hidden" id="pause"><div class="modal-card compact"><div class="modal-top"><span>RUN ON HOLD</span><span>Ⅱ</span></div><h2>TAKE A<br>BREATH<span>.</span></h2><p>Your time is paused. The rooftops can wait.</p><button id="resume" class="primary"><span>RESUME RUN</span><b>↗</b></button><button id="pause-menu" class="text-button">BACK TO MAIN MENU</button></div></div>
  <div class="modal hidden" id="complete"><div class="modal-card compact"><div class="modal-top"><span>ROUTE COMPLETE</span><span>●</span></div><h2>LEVEL<br>COMPLETE<span>.</span></h2><p>Nice line. The city is yours.</p><div class="result"><div><small>YOUR TIME</small><strong id="final-time">00:00.00</strong></div><div><small>PERSONAL BEST</small><strong id="best-time">00:00.00</strong></div></div><button id="restart" class="primary"><span>RUN IT AGAIN</span><b>↗</b></button><button id="finish-menu" class="text-button">BACK TO MAIN MENU</button></div></div>`;

const element = (id: string) => document.getElementById(id)!;
const world = new World();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 1.6, 7);
world.scene.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
element('viewport').appendChild(renderer.domElement);
const player = new Player(camera, world.solids);

class Sound {
  private context: AudioContext | null = null;
  play(type: string) {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
      const settings: Record<string, [number, number, number]> = { step: [120, 0.045, 0.009], jump: [260, 0.08, 0.025], land: [100, 0.09, 0.04], slide: [85, 0.2, 0.018], vault: [330, 0.1, 0.02], wall: [180, 0.08, 0.02], checkpoint: [740, 0.18, 0.025], finish: [880, 0.35, 0.035] };
      const [frequency, duration, volume] = settings[type] ?? [200, 0.08, 0.02];
      const oscillator = this.context.createOscillator(), gain = this.context.createGain();
      oscillator.type = type === 'land' || type === 'slide' ? 'triangle' : 'sine'; oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (type === 'checkpoint' || type === 'finish' ? 1.5 : 0.65), this.context.currentTime + duration);
      gain.gain.setValueAtTime(volume, this.context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
      oscillator.connect(gain).connect(this.context.destination); oscillator.start(); oscillator.stop(this.context.currentTime + duration);
    } catch { /* Audio is optional. */ }
  }
}
const sound = new Sound(); player.onEvent = name => sound.play(name);
let state: 'menu' | 'playing' | 'paused' | 'complete' = 'menu';
let elapsed = 0, checkpoint = 0, accumulator = 0, noticeTime = 0, last = performance.now();
const fixedStep = 1 / 120;
const format = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;

function lock() { void renderer.domElement.requestPointerLock(); }
function newRun() {
  elapsed = 0; checkpoint = 0; accumulator = 0; noticeTime = 0;
  player.reset(0, 0, 7); player.yaw = 0; player.pitch = 0;
  element('menu').classList.add('hidden'); element('complete').classList.add('hidden'); element('pause').classList.add('hidden');
  element('hud').classList.add('visible'); state = 'playing'; updateHud(); lock();
}
function mainMenu() {
  state = 'menu'; document.exitPointerLock(); player.keys.clear();
  element('menu').classList.remove('hidden'); element('pause').classList.add('hidden'); element('complete').classList.add('hidden'); element('hud').classList.remove('visible');
}
function updateHud() {
  const section = world.checkpoints[checkpoint];
  element('timer').textContent = format(elapsed); element('stage').innerHTML = `${String(checkpoint + 1).padStart(2, '0')} <span>/ 06</span>`;
  element('location').textContent = section.name;
  element('hint').textContent = checkpoint === 2 && player.position.z < -90 ? 'JUMP BESIDE THE RED WALL TO WALL-RUN' : section.hint;
  element('notice').classList.toggle('show', noticeTime > 0);
}
function finish() {
  state = 'complete'; document.exitPointerLock(); sound.play('finish');
  let best = elapsed;
  try { const previous = Number(localStorage.getItem('skyline-relay-best')); if (previous > 0) best = Math.min(previous, elapsed); localStorage.setItem('skyline-relay-best', String(best)); } catch { /* Storage is optional. */ }
  element('final-time').textContent = format(elapsed); element('best-time').textContent = format(best);
  element('complete').classList.remove('hidden'); element('hud').classList.remove('visible');
}
element('start').onclick = newRun; element('restart').onclick = newRun;
element('controls-button').onclick = () => element('controls').classList.remove('hidden');
element('close-controls').onclick = element('controls-done').onclick = () => element('controls').classList.add('hidden');
element('pause-menu').onclick = element('finish-menu').onclick = mainMenu;
element('resume').onclick = () => { state = 'playing'; element('pause').classList.add('hidden'); lock(); };
(element('sensitivity') as HTMLInputElement).oninput = event => player.sensitivity = Number((event.target as HTMLInputElement).value);
(element('motion') as HTMLInputElement).onchange = event => player.reducedMotion = (event.target as HTMLInputElement).checked;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && state === 'playing') { state = 'paused'; player.keys.clear(); element('pause').classList.remove('hidden'); }
});
document.addEventListener('mousemove', event => { if (state === 'playing' && document.pointerLockElement === renderer.domElement) player.look(event.movementX, event.movementY); });
document.addEventListener('keydown', event => {
  if (state !== 'playing') return;
  if (['Space', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
  if (event.code === 'KeyR' && !event.repeat) { const point = world.checkpoints[checkpoint]; player.reset(point.x, point.y, point.z); }
  else player.keyDown(event.code);
});
document.addEventListener('keyup', event => player.keyUp(event.code));
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

function frame(now: number) {
  requestAnimationFrame(frame);
  const delta = Math.min((now - last) / 1000, 0.1); last = now;
  if (state === 'playing' && document.pointerLockElement === renderer.domElement) {
    accumulator += delta;
    while (accumulator >= fixedStep) {
      player.update(fixedStep); elapsed += fixedStep; noticeTime = Math.max(0, noticeTime - fixedStep); accumulator -= fixedStep;
      if (player.position.y < -18) { const point = world.checkpoints[checkpoint]; player.reset(point.x, point.y, point.z); }
      const next = world.checkpoints[checkpoint + 1];
      if (next && player.position.z < next.z && player.grounded) { checkpoint++; noticeTime = 2.5; sound.play('checkpoint'); }
      if (checkpoint === world.checkpoints.length - 1 && player.position.z < -247 && player.grounded) { finish(); break; }
    }
    updateHud();
  }
  renderer.render(world.scene, camera);
}
requestAnimationFrame(frame);
