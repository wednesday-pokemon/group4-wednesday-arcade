// Per-phase CPU breakdown of the PRODUCTION app under CPU throttling (3d-artist, 2026-10-24).
// Wraps requestAnimationFrame callbacks, MysteryScene.update/draw and every sub-update, renderer.render and every WebGL call (counts +
// time per entry point), and logs shader-program creations (linkProgram) with the sim time they happened at.
// Usage: BASE=http://localhost:4174 RATE=4 CASE=midnight_signal LOW=0 SECONDS=8 node tools/mystery-preview-cpu.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4174';
const RATE = Number(process.env.RATE ?? 4);
const CASE = process.env.CASE ?? 'midnight_signal';
const LOW = process.env.LOW === '1';
const SEC = Number(process.env.SECONDS ?? 8);
const DUO = { poisoned_archive: ['wednesday', 'gengar'], crypt_last_witness: ['enid', 'dragapult'], midnight_signal: ['ajax', 'chandelure'] }[CASE];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await ctx.addInitScript(([low, nogl]) => {
  const k = 'raven-regatta:settings:v1';
  const cur = JSON.parse(localStorage.getItem(k) ?? '{}');
  localStorage.setItem(k, JSON.stringify({ ...cur, lowGraphics: low }));
  // ---- probes
  const P = (window.__probe = { raf: { n: 0, ms: 0 }, gl: {}, glMs: 0, links: [], phases: {}, on: false, frames: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { const t0 = performance.now(); cb(t); if (P.on) { P.raf.n++; P.raf.ms += performance.now() - t0; } });
  for (const Ctx of nogl ? [] : [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Ctx) continue;
    for (const name of Object.getOwnPropertyNames(Ctx.prototype)) {
      const desc = Object.getOwnPropertyDescriptor(Ctx.prototype, name);
      const fn = desc && typeof desc.value === 'function' ? desc.value : null;
      if (!fn || name === 'constructor') continue;
      Ctx.prototype[name] = function (...a) {
        if (!P.on) return fn.apply(this, a);
        const t0 = performance.now();
        const r = fn.apply(this, a);
        const dt = performance.now() - t0;
        const e = P.gl[name] ?? (P.gl[name] = { n: 0, ms: 0 });
        e.n++; e.ms += dt; P.glMs += dt;
        if (name === 'linkProgram') P.links.push({ at: Math.round(performance.now()), ms: +dt.toFixed(1) });
        return r;
      };
    }
  }
}, [LOW, process.env.NOGL === '1']);
const page = await ctx.newPage();
const errs = [];
const log = (m) => console.error('[cpu]', m);
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto(`${BASE}/?mode=mystery&character=${DUO[0]}&pokemon=${DUO[1]}&seed=cpu-${CASE}&case=${CASE}&tutorial=0&scenedebug=1`);
await page.waitForFunction(() => JSON.parse(window.render_game_to_text?.() ?? 'null')?.play?.phase === 'ready', null, { timeout: 120000 });
log('ready');
await page.mouse.click(683, 384);
await page.evaluate(() => {
  const sc = window.__mysteryScene;
  const P = window.__probe;
  const wrap = (obj, name, key) => {
    const fn = obj[name];
    if (typeof fn !== 'function') return;
    obj[name] = function (...a) { const t0 = performance.now(); const r = fn.apply(this, a); if (P.on) { const dt = performance.now() - t0; const e = P.phases[key] ?? (P.phases[key] = { n: 0, ms: 0, series: [] }); e.n++; e.ms += dt; e.series.push(dt); } return r; };
  };
  for (const n of ['update', 'draw', 'updatePlayer', 'updateWorld', 'updateHyde', 'updateCrackstone', 'updateThing', 'updateItems', 'updateCamera', 'updateVfx', 'updateOverlay', 'trackPerf']) wrap(sc, n, 'scene.' + n);
  wrap(sc.renderer, 'render', 'renderer.render');
  wrap(sc.particles, 'update', 'particles.update');
  wrap(sc.hyde, 'update', 'hyde.update');
  wrap(sc.world, 'update', 'world.update');
  wrap(sc.view, 'update', 'view.update');
  wrap(sc.thing, 'update', 'thing.update');
  wrap(sc.avatar, 'update', 'avatar.update');
  wrap(sc.companion, 'update', 'companion.update');
  wrap(sc.renderer, 'setSize', 'renderer.setSize');
  wrap(sc.renderer, 'setPixelRatio', 'renderer.setPixelRatio');
  wrap(sc.renderer, 'compile', 'renderer.compile');
  if (sc.crack) wrap(sc.crack, 'update', 'crack.update');
  window.__sc = sc;
});
log('wrapped');
await page.evaluate(() => window.advanceTime(22000));
log('advanced');
await page.keyboard.down('KeyW');
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
(async () => { for (;;) { await page.keyboard.down('ArrowLeft').catch(() => {}); await page.waitForTimeout(400).catch(() => {}); await page.keyboard.up('ArrowLeft').catch(() => {}); await page.waitForTimeout(1200).catch(() => {}); } })();
await page.waitForTimeout(3000);
log('measuring');
const progBefore = await page.evaluate(() => { const l = window.__sc.renderer.info.programs.map((p) => p.cacheKey + '|' + p.name); window.__progList = l; return l.length; });
const res = await page.evaluate((ms) => new Promise((resolve) => {
  const P = window.__probe; P.on = true;
  const sc = window.__sc;
  const t0 = performance.now();
  let frames = 0; const d = []; let last = t0;
  const f = (now) => { frames++; d.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else {
    P.on = false;
    const s = [...d].sort((a, b) => a - b);
    resolve({ frames, p50: s[Math.floor(s.length * 0.5)], avg: d.reduce((a, b) => a + b, 0) / d.length, raf: P.raf, glMs: P.glMs, gl: P.gl, links: P.links, phases: P.phases, programs: sc.renderer.info.programs.length, newPrograms: sc.renderer.info.programs.map((p) => p.name + ' ' + String(p.cacheKey).slice(-80)).filter((x, i) => !window.__progList.includes(sc.renderer.info.programs[i].cacheKey + '|' + sc.renderer.info.programs[i].name)), scale: sc.renderScale, calls: sc.renderer.info.render.calls, tris: sc.renderer.info.render.triangles });
  } };
  requestAnimationFrame(f);
}), SEC * 1000);
const n = res.frames;
const fmt = (e) => `${(e.ms / n).toFixed(2).padStart(7)} ms/frame  ${(e.n / n).toFixed(1).padStart(6)} calls/frame`;
console.log(`${CASE} ${LOW ? 'low' : 'normal'} ${RATE}x: ${n} frames in ${SEC}s  p50 ${res.p50.toFixed(1)} ms  avg ${res.avg.toFixed(1)} ms (${(1000 / res.avg).toFixed(1)} fps)  renderScale ${res.scale}  programs ${progBefore} -> ${res.programs}  GL calls ${res.calls} draw calls, ${res.tris} tris`);
console.log(`  rAF callbacks total: ${(res.raf.ms / n).toFixed(2)} ms/frame`);
console.log(`  all WebGL calls:     ${(res.glMs / n).toFixed(2)} ms/frame`);
console.log('  scene phases:');
for (const [k, e] of Object.entries(res.phases).sort((a, b) => b[1].ms - a[1].ms)) console.log(`    ${k.padEnd(22)} ${fmt(e)}`);
res.phasesRaw = null;
for (const k of ['renderer.render', 'scene.update', 'scene.draw']) {
  const e = res.phases[k]; if (!e) continue;
  const q = [...e.series].sort((a, b) => a - b);
  console.log(`  ${k} per-frame: p50 ${q[Math.floor(q.length * 0.5)].toFixed(1)}  p90 ${q[Math.floor(q.length * 0.9)].toFixed(1)}  max ${q[q.length - 1].toFixed(1)}  (>40 ms: ${q.filter((x) => x > 40).length})`);
}
console.log('  new programs during the window:', res.newPrograms);
console.log('  top GL entry points:');
for (const [k, e] of Object.entries(res.gl).sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)) console.log(`    ${k.padEnd(22)} ${fmt(e)}`);
console.log(`  linkProgram during the window: ${res.links.length}`, res.links.slice(0, 6));
if (errs.length) console.log('errors', errs);
await browser.close();
