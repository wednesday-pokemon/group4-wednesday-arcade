// Hyde emergence staging: hidden before emergence, mist + rise after. Usage: node tools/mystery-preview-hyde.mjs [outDir] [baseUrl]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? 'output/overhaul/3d';
const BASE = process.argv[3] ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=crypt_last_witness`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mReady, null, { timeout: 60000 });
const shots = [
  ['0-before', `m.setHydeEmerged(false); m.place(0,40,0,'idle',0.14); m.hydeAt(7,0,'PATROL'); m.render(20,1/30);`],
  ['1-emerge-0.3s', `m.setHydeEmerged(true); const h=m.run.hyde; m.emit({type:'hyde_emerged',spawnId:'sp',x:h.x,z:h.z}); m.render(9,1/30);`],
  ['2-emerge-1.0s', `m.render(21,1/30);`],
  ['3-emerge-2.2s', `m.render(36,1/30);`],
];
for (const [name, js] of shots) {
  const r = await page.evaluate(`(async () => { const m = window.__m; ${js}; const d = m.debug(); return { hyde: d.hyde.onScreen, shown: d.hydeEmerged, calls: d.drawCalls }; })()`);
  await page.screenshot({ path: `${OUT}/hyde-${name}.png` });
  console.log(name, JSON.stringify(r));
}
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
