import * as THREE from 'three';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<canvas></canvas><div id="hud" class="hidden"><div class="brand">ROOFTOP <b>FLOW</b></div><div id="timer">00:00.000</div><div id="checkpoint">CHECKPOINT 01 — WARM UP</div><div id="hint">SPRINT <b>SHIFT</b> · JUMP <b>SPACE</b></div><div class="crosshair">+</div></div>
<div id="menu"><div class="eyebrow">URBAN ATHLETICS // 01</div><h1>ROOFTOP<br/><span>FLOW</span></h1><p>Find the line. Keep your momentum.<br/>A rooftop run above the city.</p><button id="start">START RUN <i>↗</i></button><button class="secondary" id="controls">CONTROLS</button><div class="setting">MOUSE SENSITIVITY <input id="sens" type="range" min=".001" max=".006" step=".001" value=".002"/></div><div class="keys">WASD MOVE &nbsp; · &nbsp; SHIFT SPRINT &nbsp; · &nbsp; SPACE JUMP<br/>CTRL / C SLIDE &nbsp; · &nbsp; E VAULT &nbsp; · &nbsp; R RESTART</div></div>
<div id="paused" class="overlay hidden"><div><div class="eyebrow">RUN PAUSED</div><h2>TAKE A BREATH</h2><button id="resume">RESUME RUN</button><p>Press ESC to release the cursor.</p></div></div>
<div id="finish" class="overlay hidden"><div><div class="eyebrow">FINISH LINE</div><h2>LEVEL COMPLETE</h2><div id="finishTime"></div><div id="best"></div><button id="again">RUN AGAIN</button></div></div>`;

const canvas = app.querySelector('canvas')!;
const renderer = new THREE.WebGLRenderer({canvas, antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
const scene = new THREE.Scene(); scene.background=new THREE.Color(0x79cbed); scene.fog=new THREE.Fog(0x79cbed,70,250);
const camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,.1,500); const yaw=new THREE.Object3D(), pitch=new THREE.Object3D(); yaw.add(pitch); pitch.add(camera); scene.add(yaw);
scene.add(new THREE.HemisphereLight(0xdff6ff,0x536577,2.2)); const sun=new THREE.DirectionalLight(0xfff2d6,3.2); sun.position.set(-55,75,35); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-90;sun.shadow.camera.right=90;sun.shadow.camera.top=90;sun.shadow.camera.bottom=-90;scene.add(sun);

const white=new THREE.MeshStandardMaterial({color:0xf4f5f1,roughness:.73,metalness:.04}); const edge=new THREE.MeshStandardMaterial({color:0xaeb9bf,roughness:.6}); const red=new THREE.MeshStandardMaterial({color:0xe9302b,roughness:.38,metalness:.1}); const dark=new THREE.MeshStandardMaterial({color:0x18334e,roughness:.28,metalness:.55}); const glass=new THREE.MeshStandardMaterial({color:0x53a7cf,roughness:.15,metalness:.65,transparent:true,opacity:.74});
type Box={min:THREE.Vector3,max:THREE.Vector3,kind?:string}; const colliders:Box[]=[]; const platforms:Box[]=[]; const boxes:THREE.Mesh[]=[];
function box(x:number,y:number,z:number,w:number,h:number,d:number,mat=white,solid=true){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;scene.add(m); if(solid){const b={min:new THREE.Vector3(x-w/2,y-h/2,z-d/2),max:new THREE.Vector3(x+w/2,y+h/2,z+d/2)};colliders.push(b);platforms.push(b)} return m}
function roof(x:number,z:number,w:number,d:number,y=0){box(x,y-1,z,w,2,d,white); box(x,y+.07,z,w+.12,.14,d+.12,edge,false); // perimeter parapet with deliberate open route
 box(x-w/2+.18,y+.58,z,.34,1.15,d,edge);box(x+w/2-.18,y+.58,z,.34,1.15,d,edge); box(x,y+.58,z-d/2+.18,w,.34,1.15,edge);}
// Route: x progresses from 0 to 150. Easy broad jumps and checkpoint roofs
roof(0,0,26,24); roof(31,0,20,18,1.2); roof(59,0,20,18,2.6); roof(90,0,26,18,2.6); roof(125,0,34,24,3.5);
// direct route openings / red choreography
box(9,.7,0,2.4,1.4,6,red); box(15,1.2,0,1.4,2.4,7,white); // vault obstacle
box(23,1.6,-5,2.4,.18,5,red,false); box(23,1.9,-5,2.7,.35,5,red,false);
box(31,2.45,-5.6,14,.45,.4,red,false); box(31,2.2,5.6,14,.25,.4,red,false);
// tunnel slide structure before second jump
box(49,3.05,0,6,.7,8,dark); box(49,3.85,0,6,.22,8,red); // low ceiling
box(68,4.15,0,3.4,.25,13,red,false); // balance bridge
// wall-running visual wall by required transition; can jump normally but wall run boosts aid
box(75,5.4,-5.8,18,5,.45,red); box(76,5.5,6,17,5,.5,white);
// final rhythm obstacles
box(98,4.6,0,1.25,2.1,7,red); box(105,4.35,-4,4,.45,4,white); box(111,4.35,4,4,.45,4,white);
// finish gate
for(const z of [-6,6]) box(139,7,z,.45,7,.45,red,false); box(139,10.45,0,.55,.55,12.5,red,false); box(139,7,0,.18,.18,12.2,red,false);
const sign=box(139,8.7,0,.3,1.4,8,red,false); sign.rotation.y=Math.PI/2;
// vents
for(const [x,z] of [[-7,7],[-2,-7],[36,5],[57,-5],[87,5],[119,-7]] as number[][]){box(x,1,z,2.8,1.8,2.8,dark);box(x,2,z,3.1,.18,3.1,edge,false)}
// distant glass city
for(let i=0;i<110;i++){const a=i*2.399, r=70+(i%7)*13, h=20+(i*17%55), w=6+(i%5)*3; const x=Math.cos(a)*r+65,z=Math.sin(a)*r; const m=box(x,h/2-5,z,w,h,w, i%3?glass:dark,false);m.castShadow=false}
// guide arrows
function arrow(x:number,z:number,y:number){const g=new THREE.Group();const a=new THREE.Mesh(new THREE.ConeGeometry(1.1,2.5,4),red);a.rotation.z=-Math.PI/2;a.position.y=y;g.add(a);g.position.set(x,y,z);scene.add(g)} [ [19,0,1.1],[38,0,2.4],[64,0,3.6],[85,0,3.6],[132,0,4.6] ].forEach(v=>arrow(v[0],v[1],v[2]));

const keys=new Set<string>(); let locked=false, started=false, ended=false; let sensitivity=.002;
let vaultQueued=false; document.addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='KeyE')vaultQueued=true;if(e.code==='KeyR')respawn();if(e.code==='Escape'&&locked)document.exitPointerLock()});document.addEventListener('keyup',e=>keys.delete(e.code));
document.addEventListener('mousemove',e=>{if(!locked)return; yaw.rotation.y-=e.movementX*sensitivity;pitch.rotation.x=THREE.MathUtils.clamp(pitch.rotation.x-e.movementY*sensitivity,-1.45,1.45)});
canvas.addEventListener('click',()=>{if(started&&!ended)canvas.requestPointerLock()});document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===canvas; document.querySelector('#paused')!.classList.toggle('hidden',locked||!started||ended)});
const pos=new THREE.Vector3(0,2,0), vel=new THREE.Vector3(), spawn=new THREE.Vector3(0,2,0); let grounded=false, coyote=0, jumpQueued=0, sliding=0, wallRun=0, vaulting=0, checkpoint=0, elapsed=0; const clock=new THREE.Clock();
const hud=document.querySelector('#hud')!,timer=document.querySelector('#timer')!,check=document.querySelector('#checkpoint')!;
function respawn(){pos.copy(spawn);vel.set(0,0,0);sliding=0;wallRun=0;vaulting=0}
function fmt(t:number){const m=Math.floor(t/60).toString().padStart(2,'0'),s=(t%60).toFixed(3).padStart(6,'0');return `${m}:${s}`}
function finish(){if(ended)return;ended=true;document.exitPointerLock();const time=fmt(elapsed), old=Number(localStorage.rooftopBest||999999);if(elapsed<old)localStorage.rooftopBest=String(elapsed);(document.querySelector('#finishTime')!).textContent=`RUN TIME  ${time}`;(document.querySelector('#best')!).textContent=`BEST TIME  ${fmt(Number(localStorage.rooftopBest))}`;document.querySelector('#finish')!.classList.remove('hidden')}
function move(dt:number){
 if(!started||!locked||ended)return;elapsed+=dt; timer.textContent=fmt(elapsed); if(keys.has('Space'))jumpQueued=.12;else jumpQueued=Math.max(0,jumpQueued-dt); if(grounded)coyote=.12;else coyote=Math.max(0,coyote-dt);
 const forward=new THREE.Vector3(-Math.sin(yaw.rotation.y),0,-Math.cos(yaw.rotation.y)), right=new THREE.Vector3(Math.cos(yaw.rotation.y),0,-Math.sin(yaw.rotation.y));let wish=new THREE.Vector3();if(keys.has('KeyW'))wish.add(forward);if(keys.has('KeyS'))wish.sub(forward);if(keys.has('KeyD'))wish.add(right);if(keys.has('KeyA'))wish.sub(right); if(wish.lengthSq())wish.normalize();
 const sprint=keys.has('ShiftLeft')||keys.has('ShiftRight'), wantsSlide=(keys.has('ControlLeft')||keys.has('KeyC'))&&grounded&&vel.length()>7; if(wantsSlide)sliding=.65;else sliding=Math.max(0,sliding-dt);const max=sliding?12:(sprint?11:7), accel=grounded?(sliding?6:44):12;vel.x=THREE.MathUtils.damp(vel.x,wish.x*max,accel,dt);vel.z=THREE.MathUtils.damp(vel.z,wish.z*max,accel,dt);
 if(vaultQueued&&grounded&&wish.lengthSq()){vaulting=.42;vel.y=7;vel.x=forward.x*10;vel.z=forward.z*10;} vaultQueued=false; vaulting=Math.max(0,vaulting-dt);
 if(jumpQueued&&coyote){vel.y=11.2;jumpQueued=0;coyote=0;grounded=false;if(wallRun)vel.x+=right.x*6,vel.z+=right.z*6;}
 // friendly wall run detection around red wall zone
 const nearWall=pos.x>66&&pos.x<84&&pos.z<-3.8&&pos.z>-7&&vel.length()>6&&!grounded; if(nearWall&&keys.has('KeyW')){wallRun=Math.min(.85,wallRun+dt);vel.y=Math.max(vel.y,-2.2);pitch.rotation.z=THREE.MathUtils.damp(pitch.rotation.z,.15,8,dt)}else{wallRun=0;pitch.rotation.z=THREE.MathUtils.damp(pitch.rotation.z,0,6,dt)}
 vel.y-= (wallRun?7:27)*dt; if(!keys.has('Space')&&vel.y>3)vel.y-=18*dt;const next=pos.clone().addScaledVector(vel,dt);grounded=false;
 // surface landing + very simple side block guards
 for(const b of platforms){if(pos.x>=b.min.x-.35&&pos.x<=b.max.x+.35&&pos.z>=b.min.z-.35&&pos.z<=b.max.z+.35&&vel.y<=0&&pos.y>=b.max.y-.5&&next.y<=b.max.y+1.7){next.y=b.max.y+1.7;vel.y=0;grounded=true}}
 if(!vaulting)for(const b of colliders){if(next.y<b.max.y&&next.y+1.6>b.min.y&&next.z>b.min.z&&next.z<b.max.z&&pos.x<=b.min.x-.32&&next.x>b.min.x-.32){next.x=b.min.x-.32;vel.x=Math.min(0,vel.x)}}
 pos.copy(next);if(pos.y<-20)respawn(); if(pos.x>27&&checkpoint<1){checkpoint=1;spawn.set(31,4,0);check.textContent='CHECKPOINT 02 — KEEP THE FLOW';}if(pos.x>57&&checkpoint<2){checkpoint=2;spawn.set(59,5.3,0);check.textContent='CHECKPOINT 03 — HIGH LINE';}if(pos.x>89&&checkpoint<3){checkpoint=3;spawn.set(90,5.3,0);check.textContent='CHECKPOINT 04 — FINAL SPRINT';}if(pos.x>138&&Math.abs(pos.z)<6&&pos.y<12)finish();
 const speed=Math.hypot(vel.x,vel.z);camera.fov=THREE.MathUtils.damp(camera.fov,78+Math.min(speed,12)*1.05,5,dt);camera.updateProjectionMatrix();const bob=grounded?Math.sin(elapsed*(speed>8?15:10))*Math.min(speed/18,.08):0;yaw.position.copy(pos);pitch.position.y=(sliding?.85:1.55)+bob;
}
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
function loop(){requestAnimationFrame(loop);move(Math.min(clock.getDelta(),.04));renderer.render(scene,camera)}loop();
document.querySelector('#start')!.addEventListener('click',()=>{started=true;elapsed=0;respawn();document.querySelector('#menu')!.classList.add('hidden');hud.classList.remove('hidden');canvas.requestPointerLock()});document.querySelector('#resume')!.addEventListener('click',()=>canvas.requestPointerLock());document.querySelector('#again')!.addEventListener('click',()=>location.reload());document.querySelector<HTMLInputElement>('#sens')!.addEventListener('input',e=>sensitivity=Number((e.target as HTMLInputElement).value));document.querySelector('#controls')!.addEventListener('click',()=>alert('WASD moves. Shift sprints. Space jumps. Ctrl/C slides under low vents. E is reserved for vaults. R restarts at the latest checkpoint.'));
