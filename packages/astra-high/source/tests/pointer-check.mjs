import {chromium} from '@playwright/test';
const c=await chromium.launchPersistentContext(`${process.cwd()}/.browser-pointer`,{channel:'chromium',headless:true,viewport:{width:1440,height:900},args:process.platform === 'darwin' ? ['--use-angle=metal'] : []});
try{
 const p=c.pages()[0];p.on('console',m=>console.log(m.type(),m.text()));
 await p.goto(process.env.GAME_URL || 'http://localhost:5173',{waitUntil:'networkidle'}); await p.bringToFront();
 await p.evaluate(()=>{
 const canvas=document.querySelector('canvas');const lock=canvas.requestPointerLock.bind(canvas);
 canvas.requestPointerLock=()=>{console.log('request activation',navigator.userActivation.isActive,document.hasFocus());const result=lock();result.then(()=>console.log('locked')).catch(e=>console.log('lock rejected',e.name,e.message));return result;};
 window.addEventListener('blur',()=>console.log('blur'));
 document.addEventListener('pointerlockchange',()=>console.log('lockchange',!!document.pointerLockElement));
 });
 await p.locator('#start').click();await p.waitForTimeout(500);
 console.log(await p.evaluate(()=>({state:window.__upshift.state,focus:document.hasFocus(),lock:!!document.pointerLockElement})));
 await p.screenshot({path:'artifacts/pointer.png'});
}finally{await c.close();}
