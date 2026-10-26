// Marginal cost per scene object at CPU throttle: hides each top-level scene child (and a few toggles) in turn and reports the change
// in renderer.render JS time and in frame interval. Production app. Usage: BASE=http://localhost:4174 RATE=4 CASE=midnight_signal node tools/mystery-preview-hot2.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:4174';
const RATE = Number(process.env.RATE ?? 4);
const CASE = process.env.CASE ?? 'midnight_signal';
const SEC = Number(process.env.SECONDS ?? 1.6);
const DUO = { poisoned_archive: ['wednesday', 'gengar'], crypt_last_witness: ['enid', 'dragapult'], midnight_signal: ['ajax', 'chandelure'] }[CASE];
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
const p = await ctx.newPage();
await p.goto(`${BASE}/?mode=mystery&character=${DUO[0]}&pokemon=${DUO[1]}&seed=hot2-${CASE}&case=${CASE}&tutorial=0&scenedebug=1`);
await p.waitForFunction(() => JSON.parse(window.render_game_to_text?.() ?? 'null')?.play?.phase === 'ready', null, { timeout: 120000 });
await p.mouse.click(683, 384);
await p.evaluate(() => {
  const sc = window.__mysteryScene; const P = (window.__P = { ms: 0, n: 0 });
  const r = sc.renderer.render.bind(sc.renderer);
  sc.renderer.render = (...a) => { const t0 = performance.now(); r(...a); P.ms += performance.now() - t0; P.n++; };
  sc.setAdaptiveResolution(false);
});
await p.evaluate(() => window.advanceTime(24000));
await p.keyboard.down('KeyW');
(async () => { for (;;) { await p.keyboard.down('ArrowLeft').catch(() => {}); await p.waitForTimeout(400).catch(() => {}); await p.keyboard.up('ArrowLeft').catch(() => {}); await p.waitForTimeout(1200).catch(() => {}); } })();
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await p.waitForTimeout(3000);
const measure = () => p.evaluate((ms) => new Promise((res) => { const P = window.__P; P.ms = 0; P.n = 0; const t0 = performance.now(); let frames = 0; const f = (now) => { frames++; if (now - t0 < ms) requestAnimationFrame(f); else res({ interval: (now - t0) / frames, render: P.ms / Math.max(1, P.n) }); }; requestAnimationFrame(f); }), SEC * 1000);
const names = await p.evaluate(() => { const sc = window.__mysteryScene; return sc.scene.children.map((c, i) => `${i}:${c.type}${c.isInstancedMesh ? '(inst)' : ''}${c.children.length ? '[' + c.children.length + ']' : ''}${c.material ? ':' + c.material.type : ''}`); });
await measure(); // warm-up (compiles, first-fade variants)
const rows = [];
const b0 = [];
for (let i = 0; i < names.length; i++) {
  const mb = await measure(); b0.push(mb);
  await p.evaluate((i) => { window.__mysteryScene.scene.children[i].visible = false; }, i);
  const m = await measure();
  await p.evaluate((i) => { window.__mysteryScene.scene.children[i].visible = true; }, i);
  rows.push({ i, name: names[i], dInterval: mb.interval - m.interval, dRender: mb.render - m.render });
}
const avg = (k) => b0.reduce((a, x) => a + x[k], 0) / b0.length;
console.log(`base (mean of ${b0.length}): interval ${avg('interval').toFixed(1)} ms  render ${avg('render').toFixed(2)} ms`);
for (const r of rows.sort((a, b) => b.dRender - a.dRender)) console.log(`${String(r.i).padStart(3)} ${r.name.padEnd(46)} render saved ${r.dRender.toFixed(2)} ms   interval saved ${r.dInterval.toFixed(1)} ms`);
await b.close();
