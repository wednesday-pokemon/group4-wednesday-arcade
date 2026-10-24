// Frame-time probe for the Mystery renderer: node tools/mystery-preview-perf.mjs [baseUrl] [label] [frames]
//   GPU=swiftshader  -> software rasteriser (a slow, fill-rate-bound stand-in for an Intel UHD laptop; compare A/B only)
// Renders N frames per staged view (gl.finish after each) at 1366x768 in normal and low graphics for each case.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const LABEL = process.argv[3] ?? 'new';
const N = Number(process.argv[4] ?? (process.env.GPU === 'swiftshader' ? 10 : 60));
const args = process.env.GPU === 'swiftshader' ? ['--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({ args });
const errors = [];
const VIEWS = [
  ['pier', `m.place(0,54,0,'idle');`],
  ['lawn+chase', `m.place(6,44,0,'idle'); m.hydeAt(8,0,'CHASE');`],
  ['research', `m.place(26,9,1.2,'idle'); m.hydeAt(8,0.3,'SEARCH');`],
  ['crypt', `m.place(-24,18,0,'idle'); m.hydeAt(9,0,'PATROL');`],
  ['tower-court', `m.place(8,-40,0,'idle'); m.hydeAt(10,0.5,'PATROL');`],
  ['alley-yard', `m.place(31,-30,0.4,'idle'); m.hydeAt(10,0.5,'PATROL');`],
  ['greenhouse', `m.place(3,-12,0,'idle'); m.hydeAt(10,0.3,'PATROL');`],
];
// CRACK=1: Joseph Crackstone stands 12 m off in every view, plus a 'telegraphs' view with a scan ring AND a curse circle on screen
if (process.env.CRACK === '1') {
  for (const v of VIEWS) v[1] += ` m.crackAt(11, -0.45, 'PATROL', { speed: 1.5 }); m.setCrackFlags({ walk: false });`;
  VIEWS.push(['telegraphs', `m.place(6,44,0,'idle'); m.hydeAt(9,0.5,'SEARCH'); m.crackAt(7, -0.2, 'ATTACK'); m.crackScan(9, 60); m.castCurse(6, 43, 3.2, 600);`]);
}
const out = {};
for (const c of ['poisoned_archive', 'crypt_last_witness', 'midnight_signal']) {
  for (const [mode, q] of [['normal', ''], ['low', '&low=1']]) {
    const big = process.env.BIG === '1';
    const page = await browser.newPage(big ? { viewport: { width: 2048, height: 1152 }, deviceScaleFactor: 1.5 } : { viewport: { width: 1366, height: 768 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${c}${q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mReady, null, { timeout: 90000 });
    const res = await page.evaluate(`(async () => {
      const m = window.__m;
      const gl = m.scene.canvas.getContext('webgl2') || m.scene.canvas.getContext('webgl');
      const out = {};
      for (const [name, setup] of ${JSON.stringify(VIEWS)}) {
        (0, eval)('0');
        new Function('m', setup)(m);
        m.render(45, 1 / 30); gl.finish();
        // best of 5 bursts (GPU clock states make single bursts jumpy; the minimum is the repeatable number)
        let ms = Infinity;
        for (let rep = 0; rep < 5; rep++) {
          const t0 = performance.now();
          for (let i = 0; i < ${N}; i++) { m.render(1, 1 / 60); gl.finish(); }
          ms = Math.min(ms, (performance.now() - t0) / ${N});
        }
        const d = m.debug();
        out[name] = { ms: +ms.toFixed(2), calls: d.drawCalls, tris: d.triangles };
      }
      return out;
    })()`);
    out[`${c}/${mode}`] = res;
    const avg = (k) => (Object.values(res).reduce((s, v) => s + v[k], 0) / Object.keys(res).length).toFixed(k === 'ms' ? 2 : 0);
    console.log(`${LABEL} ${c}/${mode}: avg ${avg('ms')} ms  calls ${avg('calls')}  tris ${avg('tris')}  | ` + Object.entries(res).map(([k, v]) => `${k} ${v.ms}ms/${v.calls}c/${Math.round(v.tris / 1000)}k`).join('  '));
    await page.close();
  }
}
writeFileSync(`output/overhaul/3d/perf-${LABEL}${process.env.GPU === 'swiftshader' ? '-swift' : ''}${process.env.BIG === '1' ? '-big' : ''}.json`, JSON.stringify(out, null, 1));
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
