// Drives the REAL MysteryRun (sim bot) through the renderer for N sim seconds and reports errors / enemy presence / shader programs.
//   node tools/mystery-preview-real.mjs [baseUrl] [case] [seconds]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5261';
const CASE = process.argv[3] ?? 'poisoned_archive';
const SECS = Number(process.argv[4] ?? 90);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&real=1&case=${CASE}&seed=final-1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mReady, null, { timeout: 90000 });
const out = [];
for (let t = 0; t < SECS; t += 10) {
  const r = await page.evaluate(`(async()=>{ const m = window.__m; const r = m.realStep(10, 10); const run = m.real; const st = run.enemyStatus ? run.enemyStatus() : null; const d = m.debug(); return JSON.stringify({ t: r.t.toFixed(1), status: r.status, enemies: st ? Object.fromEntries(Object.entries(st).map(([k,v]) => [k, v.active ? v.mode : v.phase])) : null, slurp: !!run.slurp, programs: d.programs, warm: d.programsAfterWarmUp, calls: d.drawCalls, tris: d.triangles }); })()`);
  out.push(r); console.log(r);
}
await page.screenshot({ path: `output/final/3d/real-${CASE}.png` });
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
