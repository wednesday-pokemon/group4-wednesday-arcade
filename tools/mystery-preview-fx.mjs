// Effect / state screenshots from the preview harness (real case worlds, or the mock world while the real one is a stub): hazards,
// searchlights, lightning, passage, Hyde emergence, rings, searched cues, extra-wall skins.
// Usage: node tools/mystery-preview-fx.mjs [outDir] [baseUrl] [only] [low=0|1]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? 'output/overhaul/3d';
const BASE = process.argv[3] ?? 'http://localhost:5173';
const ONLY = process.argv[4] ?? '';
const LOW = process.argv[5] === '1';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [];
const H = `
  const segd=(px,pz,ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1e-9;const t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l2));return Math.hypot(px-(ax+dx*t),pz-(az+dz*t));};
  const clear=(x0,z0,x1,z1)=>{const n=24;for(let i=1;i<n;i++){const x=x0+(x1-x0)*i/n,z=z0+(z1-z0)*i/n;for(const w of m.map.walls){if(segd(x,z,w.a.x,w.a.z,w.b.x,w.b.z)<w.thickness/2+0.5)return false;}for(const c of m.map.cover){if(Math.hypot(x-c.x,z-c.z)<c.radius+0.4)return false;}}return true;};
  const stand=(x,z,d=4.2,pref=null,stance='idle')=>{m.cam(null);const angs=[];for(let k=0;k<16;k++)angs.push((k/16)*Math.PI*2);if(pref!==null)angs.sort((a,b)=>Math.abs(Math.atan2(Math.sin(a-pref),Math.cos(a-pref)))-Math.abs(Math.atan2(Math.sin(b-pref),Math.cos(b-pref))));for(const a of angs){const px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d;const bx=x+Math.cos(a)*(d+3.6),bz=z+Math.sin(a)*(d+3.6);if(clear(px,pz,x,z)&&clear(bx,bz,px,pz)){const yaw=Math.atan2(-(x-px),-(z-pz));m.place(px,pz,yaw,stance,0.14);return {px,pz,yaw};}}m.place(x,z+d,Math.PI,stance,0.14);return null;};
  const view=(x,z,d=7,h=2.3,pref=null,ty=1.1)=>{const angs=[];for(let k=0;k<24;k++)angs.push((k/24)*Math.PI*2);if(pref!==null)angs.sort((a,b)=>Math.abs(Math.atan2(Math.sin(a-pref),Math.cos(a-pref)))-Math.abs(Math.atan2(Math.sin(b-pref),Math.cos(b-pref))));for(const dd of [d,d*0.8,d*0.6]){for(const a of angs){const cx=x+Math.cos(a)*dd,cz=z+Math.sin(a)*dd;let ok=clear(cx,cz,x,z);for(const w of m.map.walls){if(segd(cx,cz,w.a.x,w.a.z,w.b.x,w.b.z)<w.thickness/2+0.5)ok=false;}if(!ok)continue;const yaw=Math.atan2(-(x-cx),-(z-cz));const px=cx+(x-cx)/dd*2.8,pz=cz+(z-cz)/dd*2.8;m.place(px,pz,yaw,'idle',0.1);m.cam({pos:[cx,h,cz],look:[x,ty,z],fov:62});return {cx,cz};}}m.cam(null);m.place(x,z+d,Math.PI,'idle',0.1);return null;};
  const center=(poly)=>({x:poly.reduce((s,p)=>s+p.x,0)/poly.length,z:poly.reduce((s,p)=>s+p.z,0)/poly.length});
  const W=(pat)=>m.map.world.extraWalls.find(w=>new RegExp(pat).test(w.id));
  const mid=(w)=>({x:(w.a.x+w.b.x)/2,z:(w.a.z+w.b.z)/2});
  const HZ=(look)=>m.map.world.hazards.find(h=>h.kind==='noisy_floor'&&h.look===look);
  const SL=(i=0)=>m.map.world.hazards.filter(h=>h.kind==='searchlight')[i];
  const passWall=()=>m.map.walls.find(w=>w.id===m.map.world.passage.wallId);
  const wallShot=(w,d=6.5)=>{const c=mid(w);return view(c.x,c.z,d,2.3);};
`;
const SC = {
  poisoned_archive: [
    ['hazard-glass', `const h=HZ('glass'); const c=center(h.polygon); view(c.x,c.z,6.5,3.0,null,0.2);`],
    ['hazard-boards', `const h=HZ('boards'); const c=center(h.polygon); view(c.x,c.z,8,3.2,null,0.2);`],
    ['shelf-rows', `wallShot(W('shelf_1'),6);`],
    ['stacks', `wallShot(W('stack_1'),6);`],
    ['vines', `wallShot(W('vine_n'),6);`],
    ['records', `wallShot(W('rec_1'),6);`],
    ['lab-bench', `const c=m.map.cover.find(c=>c.id==='pa_lab_bench'); view(c.x,c.z,5.5,2.0);`],
    ['searched', `const g=m.map.world.clueSites[0]; m.setInv({checkedClueSites:[g.sites[1].id], checkedEggSites:[m.map.world.eggSites[1].id]}); view(g.sites[1].x,g.sites[1].z,5,2.0);`],
    ['known-clue', `const g=m.map.world.clueSites[1]; m.setInv({knownClueSites:{[g.clueId]:g.sites[0].id}}); const cl=m.map.clues[1]; view(cl.x,cl.z,9.5,2.2);`],
    ['pass-closed', `m.place(-36,-4.5,0,'idle',0.1); m.cam({pos:[-36,2.2,-0.5],look:[-36,1.3,-8],fov:62});`],
    ['pass-opening', `m.place(-36,-4.5,0,'idle',0.1); m.cam({pos:[-36,2.2,-0.5],look:[-36,1.3,-8],fov:62}); m.render(2,1/30); const p=m.map.world.passage; m.setOpen(p.wallId,true); m.emit({type:'passage_opened',passageId:p.id}); m.render(8,1/30);`, 0],
    ['pass-open', `m.place(-36,-4.5,0,'idle',0.1); m.cam({pos:[-36,2.2,-0.5],look:[-36,1.3,-8],fov:62}); const p=m.map.world.passage; m.setOpen(p.wallId,true); m.setInv({passageOpen:true}); m.render(2,1/30); m.advance(3,20);`, 0],
    ['lever-close', `const p=m.map.world.passage; m.place(p.leverX+0.5,p.leverZ+1.6,0,'idle',0.1); m.cam({pos:[p.leverX+1.5,1.7,p.leverZ+2.6],look:[p.leverX,0.8,p.leverZ],fov:62}); m.setInteract({kind:'lever',id:p.id,label:p.label,progress:0.3});`],
    ['passage-closed', `const w=passWall(); wallShot(w,5.5);`],
    ['passage-open', `const w=passWall(); wallShot(w,5.5); m.setOpen(w.id,true); m.emit({type:'passage_opened',passageId:m.map.world.passage.id}); m.render(20,1/30);`],
    ['examine-vial', `const x=m.map.world.examines[0]; view(x.x,x.z,4,1.9,null,0.7);`],
    ['examine-vines', `const x=m.map.world.examines[2]; view(x.x,x.z,4,1.9,null,0.9);`],
    ['rings', `stand(20,10,6,null,'sprint'); for(let i=0;i<6;i++){m.emit({type:'noise',source:'footstep',x:20,z:10,loudness:0.95,radiusM:13}); m.render(3,1/30);} m.emit({type:'noise',source:'egg_drop',x:22,z:8,loudness:1,radiusM:17}); m.emit({type:'noise',source:'interact',x:20,z:10,loudness:0.15,radiusM:3}); m.render(7,1/30);`, 1],
  ],
  crypt_last_witness: [
    ['hazard-rubble', `const h=HZ('rubble'); const c=center(h.polygon); view(c.x,c.z,7,3.0,null,0.2);`],
    ['hazard-puddle', `const h=HZ('puddle'); const c=center(h.polygon); view(c.x,c.z,7,3.0,null,0.2);`],
    ['rubble-vault', `wallShot(W('rubble_vault'),6);`],
    ['tunnel-rock', `wallShot(W('tunnel_1'),6);`],
    ['rubble-door', `const w=passWall(); wallShot(w,6);`],
    ['cobweb', `const x=m.map.world.examines[2]; view(x.x,x.z,4.5,2.0,null,1.0);`],
    ['machine', `const x=m.map.world.examines[1]; view(x.x,x.z,4.5,2.0,null,0.8);`],
    ['lantern', `const x=m.map.world.examines[0]; view(x.x,x.z,4,1.8,null,0.3);`],
    ['coffin', `const c=m.map.cover.find(c=>c.id==='cw_coffin_2'); view(c.x,c.z,5,2.0);`],
    ['boiler', `const c=m.map.cover.find(c=>c.id==='cw_boiler'); view(c.x,c.z,6,2.2,null,1.2);`],
    ['passage-open', `const w=passWall(); wallShot(w,6.5); m.setOpen(w.id,true); m.emit({type:'passage_opened',passageId:m.map.world.passage.id}); m.render(14,1/30);`],
  ],
  midnight_signal: [
    ['searchlight', `m.setT(0); const h=SL(0); view(h.x,h.z,11,3.2,Math.PI*0.9,2.2); m.advance(0.5,30);`],
    ['searchlight-2', `m.setT(2.2); const h=SL(1); view(h.x,h.z,11,3.2,Math.PI/2,2.2); m.advance(0.3,30);`],
    ['searchlight-trig', `m.setT(1); const h=SL(0); view(h.x,h.z,11,3.2,Math.PI*0.9,2.2); m.render(5,1/30); m.emit({type:'hazard_triggered',hazardId:h.id}); m.render(2,1/30);`, 0],
    ['lightning', `m.scene.lightning.setEnabled(true); view(24,-30,7,2.2); m.render(4,1/30); m.scene.lightning.strike(m.scene.clock); m.render(1,0.03);`, 0],
    ['fence', `wallShot(W('fence_1'),6);`],
    ['hut', `wallShot(W('hut_n'),7);`],
    ['yard-hut', `wallShot(W('yhut_a'),7);`],
    ['gate', `const w=passWall(); wallShot(w,6); `],
    ['rack', `const c=m.map.cover.find(c=>c.id==='ms_rack_1'); view(c.x,c.z,5,2.2,null,1.2);`],
    ['crates', `const c=m.map.cover.find(c=>c.id==='ms_ycrate_1'); view(c.x,c.z,6,2.2);`],
    ['beacon', `const b=m.scene.world.dress.extras.beacons[0]; if(b) view(b.x,b.z,7,2.2,null,2.0); else view(30,-30,7,2.2);`],
  ],
};
for (const c of ['poisoned_archive', 'crypt_last_witness', 'midnight_signal']) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => errors.push(`${c}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${c}: ${m.text()}`); });
  await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${c}${LOW ? '&low=1' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mReady, null, { timeout: 60000 });
  for (const [name, js, extra = 24] of SC[c]) {
    await page.evaluate(`(() => { const m = window.__m; m.setInteract(null); m.cam(null); })()`);
    if (ONLY && !`${c}-${name}`.includes(ONLY)) continue;
    let r;
    try {
      r = await page.evaluate(`(async () => { const m = window.__m; ${H} ${js}; m.render(${extra}, 1/30); const d = m.debug(); return { calls: d.drawCalls, tris: d.triangles, w: d.world, rings: d.noiseRings, wx: d.weather }; })()`);
    } catch (e) { errors.push(`${c}-${name}: ${String(e).slice(0, 200)}`); continue; }
    await page.screenshot({ path: `${OUT}/${c}${LOW ? '-low' : ''}-fx-${name}.png` });
    console.log(`${c}-fx-${name}`, 'calls', r.calls, 'tris', r.tris, 'rings', r.rings, JSON.stringify(r.wx));
    await page.evaluate(`(() => { const m = window.__m; const pw = m.map.world.passage && m.map.world.passage.wallId; if (pw) m.setOpen(pw, false); m.setInv({checkedClueSites:[],checkedEggSites:[],knownClueSites:{},examined:[],passageOpen:false}); })()`);
  }
  await page.close();
}
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
