import * as T from 'three';
export type Solid={min:T.Vector3,max:T.Vector3,kind:string};
export const solids:Solid[]=[];
export const sections=[{z:0,name:'FIRST STEPS',hint:'WASD move · SHIFT sprint · SPACE jump'},{z:-116,name:'OPEN AIR',hint:'Hold SHIFT + SPACE to clear the rooftop gaps'},{z:-242,name:'STAY LOW',hint:'Hold C or CTRL while running to slide under the ducts'},{z:-354,name:'SIDE EFFECT',hint:'Sprint and jump beside the red wall · SPACE to kick away'},{z:-462,name:'FIND YOUR FLOW',hint:'E to vault red barriers · chain your movements'},{z:-610,name:'THE HOME STRETCH',hint:'Keep your momentum. The finish is ahead.'}];
export function buildWorld(scene:T.Scene){
 const mats={white:new T.MeshStandardMaterial({color:0xe8eef0,roughness:.82}),red:new T.MeshStandardMaterial({color:0xf32636,roughness:.55}),dark:new T.MeshStandardMaterial({color:0x284554,roughness:.7}),glass:new T.MeshStandardMaterial({color:0x4a849b,metalness:.55,roughness:.23}),gray:new T.MeshStandardMaterial({color:0x9faeb3,roughness:.8})};
 const geo=new T.BoxGeometry(1,1,1);
 function box(x:number,y:number,z:number,w:number,h:number,d:number,mat:keyof typeof mats='white',kind=''){let m=new T.Mesh(geo,mats[mat]);m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=true;m.receiveShadow=true;scene.add(m);if(kind)solids.push({min:new T.Vector3(x-w/2,y-h/2,z-d/2),max:new T.Vector3(x+w/2,y+h/2,z+d/2),kind});return m;}
 function roof(a:number,b:number){box(0,-18,(a+b)/2,20,36,a-b,'white','roof');for(let z=a-3;z>b;z-=5){box(-10.04,-17,z,.12,31,3.8,'glass');box(10.04,-17,z,.12,31,3.8,'glass');}for(let side of [-1,1]){box(side*9.8,.28,(a+b)/2,.3,.56,a-b,'white','wall');}for(let z=a-8;z>b+4;z-=15){box(-7,.6,z,2.4,1.2,3,'gray','obstacle');box(-7,1.24,z,2.1,.08,2.6,'dark');for(let i=0;i<5;i++)box(-7,1.3,z-1+i*.45,1.8,.05,.09,'gray');}for(let z=a-7;z>b+2;z-=14){box(0,.012,z,.16,.024,4,'red');}box(0,.025,b+1,5,.05,1,'red');}
 [[12,-52],[-58,-88],[-94,-126],[-132,-168],[-175,-210],[-217,-257],[-257,-340],[-347,-372],[-398,-450],[-456,-495],[-502,-541],[-548,-585],[-592,-632],[-639,-680],[-687,-740]].forEach(([a,b])=>roof(a,b));
 // Training barrier and a generous practice slide gate.
 box(0,.55,-26,7,1.1,1,'red','vault');
 const gate=(z:number)=>{box(0,2.3,z,19,2.2,2.5,'red','ceiling');box(-8,1,z,1,2,2.5,'gray','wall');box(8,1,z,1,2,2.5,'gray','wall');};
 [-285,-309,-329,-564].forEach(gate);
 box(3.1,2,-385,1,7,30,'red','run');box(3.1,5.6,-385,1.2,.2,30,'white');
 [-479,-523].forEach(z=>box(0,.65,z,11,1.3,1.2,'red','vault'));
 // Architectural details and checkpoint pylons.
 sections.forEach((s,i)=>{const z=s.z===0?-3:s.z-3;box(-5,2.5,z,.15,5,.15,'dark');box(-3.8,4.5,z,2.4,1,.08,'red');const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#f32636';ctx.fillRect(0,0,512,128);ctx.fillStyle='white';ctx.font='bold 54px Arial';ctx.fillText(`0${i+1} / ${s.name}`,20,80);const m=new T.Mesh(new T.PlaneGeometry(2.4,.6),new T.MeshBasicMaterial({map:new T.CanvasTexture(c),side:T.DoubleSide}));m.position.set(-3.8,4.5,z+.05);scene.add(m);});
 box(-5,3,-729,.7,6,.7,'red');box(5,3,-729,.7,6,.7,'red');box(0,6,-729,10.7,.8,.7,'red');
 // Deterministic city, with shared geometry and materials.
 let seed=14;function rand(){seed=(seed*16807)%2147483647;return seed/2147483647;}
 for(let i=0;i<175;i++){const side=i%2?1:-1;const x=side*(27+rand()*160),z=70-rand()*920,w=10+rand()*19,d=12+rand()*22,h=25+rand()*85;box(x,h/2-45,z,w,h,d,i%3?'white':'glass');for(let y=-40;y<h-46;y+=4){box(x,y,z+d/2+.02,w,.95,.06,'glass');box(x-side*(w/2+.02),y,z,.06,.95,d,'glass');}box(x,h-44,z,w+.4,.5,d+.4);if(i%4===0)box(x,h-42,z,3,4,3,'gray');}
 // Near skyline gives the opening view a strong architectural frame.
 box(-32,8,-65,20,65,28,'glass');for(let y=-20;y<40;y+=4)box(-32,y,-50.9,20,.4,.2);for(let x=-41;x<-22;x+=3)box(x,8,-50.8,.2,65,.2);
 box(34,-1,-38,22,46,25,'white');for(let y=-20;y<21;y+=3)box(34,y,-25.4,21,1.5,.12,'glass');
 return {box};
}
