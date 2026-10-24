// Staged gameplay-level screenshots of the three cases from the preview harness (mock world unless the real data landed).
// Usage: node tools/mystery-preview-shots.mjs [outDir] [baseUrl] [cases=all|id,id] [low=0|1] [only=prefix]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? 'output/overhaul/3d';
const BASE = process.argv[3] ?? 'http://localhost:5173';
const CASES = (process.argv[4] ?? 'all') === 'all' ? ['poisoned_archive', 'crypt_last_witness', 'midnight_signal'] : process.argv[4].split(',');
const LOW = process.argv[5] === '1';
const ONLY = process.argv[6] ?? '';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [];
const helpers = `
  const dist = (ax,az,bx,bz,cx,cz)=>{const dx=cx-bx-(ax-bx),dz=cz-bz-(az-bz);return 0};
  const segd=(px,pz,ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1e-9;const t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l2));return Math.hypot(px-(ax+dx*t),pz-(az+dz*t));};
  const clear=(x0,z0,x1,z1)=>{const n=24;for(let i=1;i<n;i++){const x=x0+(x1-x0)*i/n,z=z0+(z1-z0)*i/n;for(const w of m.map.walls){if(segd(x,z,w.a.x,w.a.z,w.b.x,w.b.z)<w.thickness/2+0.5)return false;}for(const c of m.map.cover){if(Math.hypot(x-c.x,z-c.z)<c.radius+0.4)return false;}}return true;};
  const approach=(x,z,d=4.2,pref=null)=>{const angs=[];for(let k=0;k<16;k++)angs.push((k/16)*Math.PI*2);if(pref!==null)angs.sort((a,b)=>Math.abs(Math.atan2(Math.sin(a-pref),Math.cos(a-pref)))-Math.abs(Math.atan2(Math.sin(b-pref),Math.cos(b-pref))));for(const a of angs){const px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d;const bx=x+Math.cos(a)*(d+3.6),bz=z+Math.sin(a)*(d+3.6);if(clear(px,pz,x,z)&&clear(bx,bz,px,pz))return {px,pz,yaw:Math.atan2(-(x-px),-(z-pz))};}return {px:x,pz:z+d,yaw:Math.PI};};
  const stand=(x,z,d=4.2,stance='idle',pref=null)=>{m.cam(null);const a=approach(x,z,d,pref);m.place(a.px,a.pz,a.yaw,stance,0.12);return a;};
  const sites=()=>m.map.world.clueSites.flatMap(g=>g.sites.map(s=>({clueId:g.clueId,...s})));
`;
async function shot(page, name, js, frames = 40) {
  if (ONLY && !name.includes(ONLY)) return;
  const res = await page.evaluate(`(async () => { const m = window.__m; ${helpers} ${js}; m.render(${frames}, 1/30); return m.debug(); })()`);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'calls', res.drawCalls, 'tris', res.triangles, 'vis', JSON.stringify(res.world.evidenceVisible), 'outl', res.world.outlines, 'egg', res.world.eggVisible);
}
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => errors.push(`${c}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${c}: ${m.text()}`); });
  await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${c}${LOW ? '&low=1' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mReady, null, { timeout: 60000 });
  const tag = `${c}${LOW ? '-low' : ''}`;
  await shot(page, `${tag}-0-start`, `m.place(0,54,0,'idle');`);
  // site props, nothing known: the furniture at EVERY candidate site, 4 m away, whichever one really holds the item
  await shot(page, `${tag}-1-site0`, `const s=sites()[0]; stand(s.x,s.z,4.6);`);
  await shot(page, `${tag}-2-site1`, `const s=sites()[1]; stand(s.x,s.z,4.6);`);
  await shot(page, `${tag}-3-site2`, `const s=sites()[2]; stand(s.x,s.z,4.6);`);
  // standing near the true site (first site of each group in the mock layout): the item appears
  await shot(page, `${tag}-4-near-item`, `const cl=m.map.clues[0]; stand(cl.x,cl.z,3.2);`);
  // in reach: bright outline
  await shot(page, `${tag}-5-reach`, `const cl=m.map.clues[1]; stand(cl.x,cl.z,1.7); m.setInteract({kind:'clue',id:cl.clueId,label:'Search',progress:0.4});`);
  // egg
  await shot(page, `${tag}-6-egg-near`, `m.setInteract(null); const e=m.map.eggSpawn; stand(e.x,e.z,3.4);`);
  await shot(page, `${tag}-7-examine`, `m.setInteract(null); const x=m.map.world.examines[0]; stand(x.x,x.z,3.0);`);
  await shot(page, `${tag}-8-lever`, `const p=m.map.world.passage; stand(p.leverX,p.leverZ,3.0);`);
  const w = await page.evaluate(`(async () => { const m = window.__m; return m.debug().world; })()`);
  console.log(tag, JSON.stringify(w));
  await page.close();
}
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
