import * as THREE from 'three';
import { AudioManager } from './game/AudioManager';
import { PlayerController } from './player/PlayerController';
import { createLevel } from './world/Level';
import './styles/main.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main id="game-shell">
    <div id="ui-grain"></div>
    <section id="hud" aria-live="polite">
      <div class="hud-top"><span class="brand">ROOFTOP <i>FLOW</i></span><span id="timer">00:00.000</span></div>
      <div id="objective">OBJECTIVE <b>BUILD MOMENTUM</b></div>
      <div id="checkpoint-toast"></div>
      <div id="crosshair"><span></span><span></span><span></span><span></span></div>
      <div id="speed"><span></span><small>FLOW</small></div>
      <div id="hint">SHIFT TO SPRINT · SPACE TO JUMP</div>
      <div class="hud-bottom"><span>WASD MOVE</span><span>R CHECKPOINT</span><span>ESC PAUSE</span></div>
    </section>
    <section class="screen menu-screen" id="menu">
      <div class="title-kicker">A FIRST-PERSON ROOFTOP COURSE</div>
      <h1>ROOFTOP<br><em>FLOW</em></h1>
      <p class="intro">Keep your line. Trust your momentum. Follow the red.</p>
      <button class="primary" id="start">START RUN <span>↗</span></button>
      <button class="text-button" id="controls">VIEW CONTROLS</button>
      <div class="settings">
        <label>LOOK SENSITIVITY <output id="sensitivity-out">100%</output><input id="sensitivity" type="range" min="40" max="180" value="100" /></label>
        <button class="toggle" id="motion"><span></span> CAMERA MOTION <b>FULL</b></button>
      </div>
    </section>
    <section class="screen panel hidden" id="controls-panel">
      <button class="close" id="close-controls">×</button>
      <div class="eyebrow">RUNNER MANUAL</div><h2>MOVE WITH<br>INTENTION.</h2>
      <div class="control-grid">
        <div><kbd>W A S D</kbd><span>MOVE</span></div><div><kbd>SHIFT</kbd><span>SPRINT</span></div>
        <div><kbd>SPACE</kbd><span>JUMP / WALL JUMP</span></div><div><kbd>CTRL / C</kbd><span>SLIDE</span></div>
        <div><kbd>E</kbd><span>VAULT / MANTLE</span></div><div><kbd>R</kbd><span>RESTART CHECKPOINT</span></div>
      </div>
      <p>Red marks the route. On the wall gap, jump beside the long red wall and keep your speed.</p>
    </section>
    <section class="screen panel hidden compact" id="pause-panel">
      <div class="eyebrow">RUN PAUSED</div><h2>TAKE A<br>BREATH.</h2>
      <button class="primary" id="resume">RESUME <span>↗</span></button>
      <button class="text-button" id="restart">RESTART FROM CHECKPOINT</button>
      <button class="text-button" id="quit">QUIT TO MENU</button>
    </section>
    <section class="screen panel hidden complete" id="complete-panel">
      <div class="eyebrow">COURSE COMPLETE</div><h2>KEEP<br><em>MOVING.</em></h2>
      <div class="finish-time" id="finish-time">00:00.000</div>
      <p id="best-time">NEW PERSONAL BEST</p>
      <button class="primary" id="run-again">RUN AGAIN <span>↗</span></button>
      <button class="text-button" id="finish-menu">RETURN TO MENU</button>
    </section>
    <div id="hands"><div class="hand left"></div><div class="hand right"></div></div>
  </main>`;

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector)! as T;
const hud = $('#hud');
const menu = $('#menu');
const controlsPanel = $('#controls-panel');
const pausePanel = $('#pause-panel');
const completePanel = $('#complete-panel');
const timerEl = $('#timer');
const objectiveEl = $('#objective');
const hintEl = $('#hint');
const toastEl = $('#checkpoint-toast');
const hands = $('#hands');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8bd3f3);
scene.fog = new THREE.FogExp2(0x9bdaf2, 0.0075);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 420);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.prepend(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xc9edff, 0x6f8390, 2.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff5d8, 3.3);
sun.position.set(-48, 74, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -65; sun.shadow.camera.right = 65; sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65;
sun.shadow.bias = -0.00012;
scene.add(sun);

const level = createLevel(scene);
const audio = new AudioManager();
const player = new PlayerController(camera, level.world, audio, {
  onJump: () => flashCrosshair(),
  onLand: () => flashCrosshair('land'),
  onVault: () => flashCrosshair('vault')
});
player.reset(level.spawn);
camera.position.set(level.spawn.x, level.spawn.y + 1.54, level.spawn.z);
camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
player.connectInput();

let runActive = false;
let completed = false;
let elapsed = 0;
let checkpoint = level.spawn.clone();
let lastTime = performance.now();
let accumulator = 0;
let toastTimer = 0;
const activated = new Set<string>();

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000).toString().padStart(2, '0');
  const seconds = Math.floor(ms / 1000 % 60).toString().padStart(2, '0');
  const millis = Math.floor(ms % 1000).toString().padStart(3, '0');
  return `${minutes}:${seconds}.${millis}`;
}

function showToast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  toastTimer = 2.5;
}

function flashCrosshair(className = ''): void {
  const crosshair = $('#crosshair');
  crosshair.className = className;
  void crosshair.offsetWidth;
  crosshair.className = `pulse ${className}`;
}

function setOverlay(open: HTMLElement | null): void {
  [menu, controlsPanel, pausePanel, completePanel].forEach((panel) => panel.classList.toggle('hidden', panel !== open));
  hud.classList.toggle('visible', open === null || open === pausePanel);
}

function beginRun(fullRestart = false): void {
  audio.enable();
  if (fullRestart) {
    elapsed = 0;
    checkpoint.copy(level.spawn);
    player.reset(checkpoint);
    activated.clear();
  }
  completed = false;
  runActive = true;
  setOverlay(null);
  renderer.domElement.requestPointerLock();
}

function restartCheckpoint(): void {
  player.reset(checkpoint);
  showToast('BACK ON LINE');
  if (!completed) beginRun(false);
}

function finishRun(): void {
  if (completed) return;
  completed = true;
  runActive = false;
  document.exitPointerLock();
  audio.complete();
  const key = 'rooftop-flow-best';
  const previous = Number(localStorage.getItem(key) || '0');
  const isBest = !previous || elapsed < previous;
  if (isBest) localStorage.setItem(key, String(Math.floor(elapsed)));
  $('#finish-time').textContent = formatTime(elapsed);
  $('#best-time').textContent = isBest ? 'NEW PERSONAL BEST' : `BEST ${formatTime(previous)}`;
  setOverlay(completePanel);
}

function updateObjective(): void {
  const z = player.position.z;
  let text = 'BUILD MOMENTUM';
  let hint = 'SHIFT TO SPRINT · SPACE TO JUMP';
  if (z < -75 && z > -112) { text = 'SLIDE THE LOW BEAMS'; hint = 'HOLD CTRL / C WHILE RUNNING'; }
  else if (z <= -112 && z > -140) { text = 'WALL RUN THE GAP'; hint = 'JUMP BESIDE RED WALL · KEEP FORWARD'; }
  else if (z <= -140 && z > -186) { text = 'VAULT THE OBSTACLE'; hint = 'PRESS E AT RED OBSTACLES'; }
  else if (z <= -186) { text = 'FINISH THE LINE'; hint = 'KEEP YOUR FLOW'; }
  objectiveEl.innerHTML = `OBJECTIVE <b>${text}</b>`;
  hintEl.textContent = hint;
}

function simulate(step: number): void {
  player.update(step);
  elapsed += step * 1000;
  if (player.position.y <= -31.9) restartCheckpoint();
  for (const trigger of level.world.getTriggers(player.position)) {
    if (trigger.kind === 'checkpoint' && !activated.has(trigger.id)) {
      activated.add(trigger.id);
      checkpoint.copy(trigger.spawn!);
      audio.checkpoint();
      showToast(`${trigger.label} // ROUTE SAVED`);
    } else if (trigger.kind === 'finish') finishRun();
  }
}

function render(now: number): void {
  requestAnimationFrame(render);
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (runActive && document.pointerLockElement === renderer.domElement) {
    accumulator += delta;
    while (accumulator >= 1 / 120) { simulate(1 / 120); accumulator -= 1 / 120; }
  } else accumulator = 0;
  toastTimer -= delta;
  if (toastTimer <= 0) toastEl.classList.remove('show');
  const speed = player.speed;
  $('#speed').style.setProperty('--flow', `${Math.min(100, speed * 9)}%`);
  hands.classList.toggle('active', runActive && document.pointerLockElement === renderer.domElement);
  hands.classList.toggle('vaulting', player.isVaulting);
  hands.classList.toggle('sliding', player.sliding);
  timerEl.textContent = formatTime(elapsed);
  updateObjective();
  level.animate(now);
  renderer.render(scene, camera);
}
requestAnimationFrame(render);

$('#start').addEventListener('click', () => beginRun(true));
$('#resume').addEventListener('click', () => beginRun(false));
$('#restart').addEventListener('click', restartCheckpoint);
$('#run-again').addEventListener('click', () => beginRun(true));
$('#quit').addEventListener('click', () => { runActive = false; completed = false; document.exitPointerLock(); setOverlay(menu); });
$('#finish-menu').addEventListener('click', () => { completed = false; setOverlay(menu); });
$('#controls').addEventListener('click', () => setOverlay(controlsPanel));
$('#close-controls').addEventListener('click', () => setOverlay(menu));
$('#sensitivity').addEventListener('input', (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  player.sensitivity = value / 100;
  $('#sensitivity-out').textContent = `${value}%`;
});
$('#motion').addEventListener('click', () => {
  player.reducedMotion = !player.reducedMotion;
  $('#motion').classList.toggle('on', player.reducedMotion);
  $('#motion b').textContent = player.reducedMotion ? 'LOW' : 'FULL';
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (runActive && !locked && !completed) setOverlay(pausePanel);
  if (locked) setOverlay(null);
});
document.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR' && runActive) restartCheckpoint();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
