import * as T from 'three';
import {solids,Solid} from './world';
export class Player{
 pos=new T.Vector3(0,0,5);vel=new T.Vector3();yaw=0;pitch=0;ground=false;keys=new Set<string>();height=1.75;slide=0;wall=0;wallSide=0;wallUsed=false;coyote=0;buffer=0;step=0;motion=true;sensitivity=1;action='';mantle:{from:T.Vector3,to:T.Vector3,t:number}|null=null;onSound=(s:string)=>{};
 constructor(public camera:T.PerspectiveCamera){document.addEventListener('mousemove',e=>{if(document.pointerLockElement){this.yaw-=e.movementX*.002*this.sensitivity;this.pitch=T.MathUtils.clamp(this.pitch-e.movementY*.002*this.sensitivity,-1.45,1.45);}});document.addEventListener('keydown',e=>{if(['Space','ControlLeft','KeyC'].includes(e.code))e.preventDefault();if(e.code==='Space'&&!e.repeat)this.buffer=.15;this.keys.add(e.code);});document.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>this.keys.clear());}
 reset(z:number){this.pos.set(0,0,z);this.vel.set(0,0,0);this.yaw=0;this.pitch=0;this.slide=0;this.wall=0;this.wallUsed=false;this.mantle=null;this.height=1.75;this.keys.clear();}
 overlaps(p:T.Vector3,s:Solid,h=this.height){return p.x+.32>s.min.x&&p.x-.32<s.max.x&&p.z+.32>s.min.z&&p.z-.32<s.max.z&&p.y+h>s.min.y+.001&&p.y<s.max.y-.001;}
 update(dt:number){
 const k=this.keys;this.action='';if(this.mantle){this.mantle.t+=dt*3.5;const t=Math.min(1,this.mantle.t);this.pos.lerpVectors(this.mantle.from,this.mantle.to,t*t*(3-2*t));this.pos.y+=Math.sin(t*Math.PI)*.5;this.action='VAULT';if(t===1)this.mantle=null;return;}
 const forward=new T.Vector3(-Math.sin(this.yaw),0,-Math.cos(this.yaw)),right=new T.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));const wish=forward.clone().multiplyScalar(Number(k.has('KeyW'))-Number(k.has('KeyS'))).addScaledVector(right,Number(k.has('KeyD'))-Number(k.has('KeyA'))).normalize();let speed=Math.hypot(this.vel.x,this.vel.z);
 const crouch=k.has('KeyC')||k.has('ControlLeft');if(crouch&&this.ground&&speed>5&&this.slide<=0){this.slide=1.15;this.onSound('slide');}if(this.slide>0){this.slide-=dt;this.height=.8;this.action='SLIDE';}else if(!solids.some(s=>this.overlaps(this.pos,s,1.75)))this.height=1.75;
 this.coyote=this.ground?.12:Math.max(0,this.coyote-dt);this.buffer-=dt;
 const near=solids.find(s=>s.kind==='run'&&this.pos.z>s.min.z-.2&&this.pos.z<s.max.z+.2&&Math.min(Math.abs(this.pos.x-(s.min.x-.32)),Math.abs(this.pos.x-(s.max.x+.32)))<.8);
 if(!this.ground&&near&&speed>6&&!this.wallUsed){this.wall+=dt;this.wallSide=this.pos.x<(near.min.x+near.max.x)/2?1:-1;this.action='WALL RUN';this.vel.y=T.MathUtils.clamp(this.vel.y,-.65,2);if(this.wall>2.5){this.wallUsed=true;this.wall=0;}}else{this.wall=0;this.wallSide=0;}
 if(this.buffer>0&&(this.coyote>0||this.wall>0)){this.vel.y=this.wall>0?8:9; if(this.wall>0){this.vel.x-=this.wallSide*5;this.wallUsed=true;this.wall=0;}this.buffer=0;this.coyote=0;this.ground=false;this.slide=0;this.onSound('jump');}
 let target=k.has('ShiftLeft')?13:7;const acceleration=this.ground?48:12;
 if(this.slide<=0){const factor=1-Math.exp(-acceleration/target*dt);this.vel.x+=(wish.x*target-this.vel.x)*factor;this.vel.z+=(wish.z*target-this.vel.z)*factor;}else{this.vel.x*=1-dt*.5;this.vel.z*=1-dt*.5;}
 this.vel.y-=(this.wall>0?2.5:24)*dt;if(!k.has('Space')&&this.vel.y>3)this.vel.y-=20*dt;
 const ahead=this.pos.clone().addScaledVector(forward,1.1);const vault=solids.find(s=>s.kind==='vault'&&this.overlaps(ahead,s)&&s.max.y-this.pos.y<1.6);
 if(k.has('KeyE')&&vault){const to=this.pos.clone().addScaledVector(forward,2.7);to.y=vault.max.y+.02;if(!solids.some(s=>this.overlaps(to,s))){this.mantle={from:this.pos.clone(),to,t:0};this.onSound('jump');return;}}
 this.ground=false;
 for(const axis of ['x','z','y'] as const){this.pos[axis]+=this.vel[axis]*dt;for(const s of solids){if(!this.overlaps(this.pos,s))continue;if(axis==='y'){if(this.vel.y<=0){this.pos.y=s.max.y;this.ground=true;this.wallUsed=false;if(this.vel.y<-5)this.onSound('land');}else this.pos.y=s.min.y-this.height;this.vel.y=0;}else{
 if(s.kind==='roof'&&this.pos.y>s.max.y-1.1&&this.vel.y<0&&k.has('KeyW')){const to=this.pos.clone().addScaledVector(forward,.8);to.y=s.max.y; if(!solids.some(o=>this.overlaps(to,o))){this.mantle={from:this.pos.clone(),to,t:0};return;}}
 this.pos[axis]=this.vel[axis]>0?s.min[axis]-.32:s.max[axis]+.32;this.vel[axis]=0;}}}
 this.step+=dt*speed;if(this.ground&&speed>3&&Math.floor(this.step/3)!==Math.floor((this.step-dt*speed)/3))this.onSound('step');
 }
 render(dt:number){const speed=Math.hypot(this.vel.x,this.vel.z);const bob=this.motion&&this.ground?Math.sin(this.step*2)*.025*Math.min(1,speed/7):0;this.camera.position.x=this.pos.x;this.camera.position.z=this.pos.z;this.camera.position.y=T.MathUtils.lerp(this.camera.position.y,this.pos.y+this.height-.12+bob,1-Math.exp(-20*dt));this.camera.rotation.set(this.pitch,this.yaw,this.motion?(-this.wallSide*.10+(this.keys.has('KeyA')?.015:0)-(this.keys.has('KeyD')?.015:0)):0,'YXZ');this.camera.fov=T.MathUtils.lerp(this.camera.fov,76+speed*.65,dt*4);this.camera.updateProjectionMatrix();}
}
