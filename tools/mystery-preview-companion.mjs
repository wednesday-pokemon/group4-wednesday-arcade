// Companion placement / size check: open ground, a wall at the player's back (lens pulled in), a corridor, with a few partners.
// Usage: node tools/mystery-preview-companion.mjs [outDir] [baseUrl]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? 'output/overhaul/3d';
const BASE = process.argv[3] ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errs = [];
for (const [pk, c] of [['gengar', 'poisoned_archive'], ['dusknoir', 'crypt_last_witness'], ['sableye', 'midnight_signal']]) {
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${c}&pokemon=${pk}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__mReady);
  const views = [
    ['open', `m.place(6,44,0,'idle',0.12);`],
    ['wall-at-back', `m.place(22.2,-2,-Math.PI/2,'idle',0.12);`],
    ['walking', `m.place(6,40,0.4,'walk',0.12);`],
  ];
  for (const [name, js] of views) {
    const d = await p.evaluate(`(async()=>{const m=window.__m; m.cam(null); ${js}; m.render(80,1/30); const dd=m.debug(); const c=m.scene.companion.position; const cam=m.scene.camera.position; return {cam:dd.camera.dist, lens:Math.hypot(c.x-cam.x,c.y-cam.y,c.z-cam.z).toFixed(2), vis:dd.companion.visual};})()`);
    await p.screenshot({ path: `${OUT}/companion-${pk}-${name}.png` });
    console.log(pk, name, JSON.stringify(d));
  }
  await p.close();
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
