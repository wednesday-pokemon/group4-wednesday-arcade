// Triangle / draw-call breakdown of the Mystery preview scene. Usage: node tools/mystery-preview-probe.mjs [baseUrl] [caseId]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const CASE = process.argv[3] ?? 'poisoned_archive';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${CASE}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mReady);
const res = await page.evaluate(() => {
  const m = window.__m;
  m.place(0, 54, 0, 'idle');
  m.render(5, 1 / 60);
  const out = [];
  m.scene.scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const g = o.geometry;
    const tris = g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
    const inst = o.isInstancedMesh ? o.count : 1;
    out.push({ name: o.name || o.type, tris: Math.round(tris), inst, vis: o.visible, total: Math.round(tris * inst) });
  });
  out.sort((a, b) => b.total - a.total);
  return { top: out.slice(0, 25), count: out.length, debug: m.debug() };
});
console.log(JSON.stringify(res.top, null, 0));
console.log('meshes', res.count, 'calls', res.debug.drawCalls, 'tris', res.debug.triangles);
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
