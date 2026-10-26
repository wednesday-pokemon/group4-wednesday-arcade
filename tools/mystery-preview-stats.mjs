// Draw calls / triangles / JS cost of the staged compact maps (normal + low graphics), with Slurp + cabinets in view.
//   node tools/mystery-preview-stats.mjs [baseUrl]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5261';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
for (const cs of ['poisoned_archive', 'crypt_last_witness', 'midnight_signal']) for (const low of [0, 1]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&compact=1&case=${cs}&low=${low}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mReady, null, { timeout: 90000 });
  const r = await page.evaluate(`(async()=>{ const m = window.__m; m.scene.setAdaptiveResolution(false); const s = m.map.playerStart; m.setHydeEmerged(true); m.setPresence({ hyde: true, crackstone: false, slurp: true }); m.place(s.x, s.z, 0, 'idle'); m.slurpAt(8, 0.2, 'CHASE'); m.hydeAt(14, -0.4, 'PATROL', { speed: 0 }); m.advance(1.0, 30); const xs = []; for (let i = 0; i < 8; i++) { m.advance(0.5, 30); xs.push(m.debug().cpuMs); } const d = m.debug(); return { calls: d.drawCalls, tris: d.triangles, programs: d.programs, cpu: xs.sort((a,b)=>a-b)[4], bounds: m.map.bounds }; })()`);
  console.log(cs.padEnd(20), low ? 'low   ' : 'normal', JSON.stringify(r));
  await page.close();
}
await browser.close();
