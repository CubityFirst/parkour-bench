import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const context = await chromium.launchPersistentContext(`${process.cwd()}/.browser-course`, { channel: 'chromium', headless: true, viewport: {width: 1280, height: 800}, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
try {
  const page = context.pages()[0];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:5173', {waitUntil:'networkidle'});
  const result = await page.evaluate(async () => {
    const {ROOFS} = await import('/src/world/Level.ts');
    const g = window.__upshift;
    const p = g.player;
    g.pause(); g.state = 'playing'; g.checkpoint = 0; g.elapsed = 0;
    p.reset(p.position.clone().set(0,32.01,-5));
    g.input.yaw = 0;
    const normal = {forward:1, strafe:0, sprint:true, jump:true, jumpPressed:false, slidePressed:false, vaultPressed:false};
    let input = normal;
    g.input.sample = () => input;
    let lastJump = -1;
    const slides = [44,209,233,257,426];
    const vaults = [25,391,480];
    const slideUsed = new Set();
    const vaultUsed = new Set();
    const events = new Set();
    let deaths = 0, lastProgress = 5, maxProgress = 5;
    const milestones = [];
    const originalEvent = p.onEvent;
    p.onEvent = (type, strength) => {events.add(type); originalEvent(type,strength)};
    for(let i=0;i<15000 && g.state !== 'finished';i++) {
      const s = -p.position.z;
      input = {...normal, strafe: p.grounded ? Math.max(-0.5, Math.min(0.5, -p.position.x * 0.9)) : 0};
      const roofIndex = ROOFS.findIndex(r=>s >= r.start && s <= r.end);
      const roof = ROOFS[roofIndex];
      if(roof && roofIndex !== lastJump && roofIndex < ROOFS.length-1 && roof.end-s < 0.9 && p.grounded) {input.jumpPressed=true;lastJump=roofIndex;}
      for(const slide of slides) if(!slideUsed.has(slide) && s > slide-4.3 && s < slide-3.1 && p.grounded){input.slidePressed=true;slideUsed.add(slide);}
      for(const vault of vaults) if(!vaultUsed.has(vault) && s > vault-1.8 && s < vault-0.8 && p.grounded){input.vaultPressed=true;vaultUsed.add(vault);}
      const oldCp = g.checkpoint;
      g.fixedUpdate(1/120);
      if(g.checkpoint !== oldCp) milestones.push({cp:g.checkpoint,s:-p.position.z,time:g.elapsed});
      if(-p.position.z < lastProgress - 10){deaths++;milestones.push({death: true,from:lastProgress,to:-p.position.z,mode:p.mode}); if(deaths>2)break;}
      lastProgress = -p.position.z; maxProgress = Math.max(maxProgress,lastProgress);
    }
    g.ui.update(g.elapsed,p.speed,p.mode,-p.position.z);
    g.firstPerson.update(1/60);
    if(g.state!=='finished'){g.state='paused';g.ui.showState('paused');}
    return {state:g.state,time:g.elapsed,checkpoint:g.checkpoint,maxProgress,deaths,events:[...events],milestones,position:p.position.toArray(),mode:p.mode, best:localStorage.getItem('upshift-best')};
  });
  console.log(JSON.stringify(result,null,2));
  await page.screenshot({path:'artifacts/course-result.png'});
  assert.equal(result.state,'finished'); assert.equal(result.deaths,0); assert.ok(result.events.includes('wallrun')); assert.ok(result.events.includes('vault')); assert.ok(result.events.includes('slide')); assert.deepEqual(errors,[]);
  assert.ok(await page.locator('#finish').isVisible());
  await page.locator('#finish-quit').click();
  assert.ok(await page.locator('#menu-best').textContent() !== '— — : — —');
  await page.reload({waitUntil:'networkidle'});
  assert.ok(await page.locator('#menu-best').textContent() !== '— — : — —');
  console.log('Finish screen and persistent best time verified.');
} finally { await context.close(); }
