// Hot-spot probe: hides each scene object in turn at a staged view and reports the frame-time saving.
// Usage: node tools/mystery-preview-hot.mjs [baseUrl] [case] [view JS] [low=0|1]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const CASE = process.argv[3] ?? 'poisoned_archive';
const VIEW = process.argv[4] ?? "m.place(3,-12,0,'idle'); m.hydeAt(10,0.3,'PATROL');";
const LOW = process.argv[5] === '1';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage(process.env.BIG === '1' ? { viewport: { width: 2048, height: 1152 }, deviceScaleFactor: 1.5 } : { viewport: { width: 1366, height: 768 } });
await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${CASE}${LOW ? '&low=1' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mReady, null, { timeout: 90000 });
const res = await page.evaluate(`(async () => {
  const m = window.__m;
  const gl = m.scene.canvas.getContext('webgl2') || m.scene.canvas.getContext('webgl');
  new Function('m', ${JSON.stringify(VIEW)})(m);
  m.render(8, 1/60); gl.finish();
  const time = (n = 40) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { m.render(1, 1/60); gl.finish(); } return (performance.now() - t0) / n; };
  const base = time();
  const kids = m.scene.scene.children;
  const out = [];
  kids.forEach((k, i) => {
    const vis = k.visible; k.visible = false;
    const t = time(20);
    k.visible = vis;
    let tris = 0; k.traverse((o) => { const g = o.geometry; if (g && o.visible !== false) tris += (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3 * (o.isInstancedMesh ? o.count : 1); });
    const kinds = []; k.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine) kinds.push(o.type + (o.material && o.material.transparent ? '(t)' : '')); });
    out.push({ i, type: k.type, name: k.name, n: k.children.length, saved: +(base - t).toFixed(2), tris: Math.round(tris), kinds: kinds.slice(0, 4).join(',') });
  });
  // toggles that are not objects
  return { base: +base.toFixed(2), top: out.sort((a, b) => b.saved - a.saved).slice(0, 12) };
})()`);
console.log(JSON.stringify(res, null, 1));
await browser.close();
