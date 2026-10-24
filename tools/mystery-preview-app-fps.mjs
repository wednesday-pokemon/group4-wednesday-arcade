// Real-time frame pacing through the app: autopilot drives the real sim; samples requestAnimationFrame intervals per case/mode.
// Usage: node tools/mystery-preview-app-fps.mjs [baseUrl] [low=0|1] [seconds]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const LOW = process.argv[3] === '1';
const SEC = Number(process.argv[4] ?? 6);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
for (const c of (process.env.CASES ?? 'poisoned_archive,crypt_last_witness,midnight_signal').split(',')) {
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  await p.goto(`${BASE}/?mode=mystery&character=wednesday&pokemon=gengar&seed=fps-${c}&case=${c}&tutorial=0${LOW ? '&low=1' : ''}&scenedebug=1`);
  await p.waitForFunction(() => JSON.parse(window.render_game_to_text()).play?.phase === 'ready', null, { timeout: 90000 });
  await p.evaluate(() => window.mysteryAutopilot('stealthy'));
  await p.waitForTimeout(1500);
  const r = await p.evaluate(`new Promise((res) => { const d = []; let last = performance.now(); const t0 = last; const f = (now) => { d.push(now - last); last = now; if (now - t0 < ${SEC * 1000}) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ n: d.length, avg: d.reduce((s, x) => s + x, 0) / d.length, p50: d[Math.floor(d.length * 0.5)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] }); } }; requestAnimationFrame(f); })`);
  const st = JSON.parse(await p.evaluate(() => window.render_game_to_text()));
  const sc = st.run?.scene ?? st.scene ?? {};
  console.log(`${c}${LOW ? ' (low)' : ''}: fps ${(1000 / r.avg).toFixed(1)}  avg ${r.avg.toFixed(2)} ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  | calls ${sc.drawCalls} tris ${sc.triangles} renderScale ${sc.renderScale} theme ${sc.theme}`);
  await p.close();
}
await b.close();
