// Confirms no ground rings are drawn while walking: footstep noise events in every stance, plus the sources that keep ONE modest ring.
// Usage: node tools/mystery-preview-rings.mjs [baseUrl]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
await p.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=poisoned_archive`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__mReady);
const res = await p.evaluate(`(async()=>{
  const m = window.__m; const out = {};
  const count = () => ({ noise: m.debug().noiseRings, instances: m.scene.rings.mesh.count });
  m.place(2, 30, 0, 'idle'); m.render(10, 1/30);
  out.baseline = count();
  for (const stance of ['idle', 'walk', 'crouch', 'sprint']) {
    m.place(2, 30, 0, stance); m.setHydeEmerged(true);
    let maxN = 0, maxI = 0;
    for (let i = 0; i < 40; i++) {
      m.emit({ type: 'noise', source: 'footstep', x: 2, z: 30, loudness: stance === 'sprint' ? 0.95 : stance === 'walk' ? 0.35 : 0.1, radiusM: stance === 'sprint' ? 13 : stance === 'walk' ? 7 : 2 });
      m.render(1, 1/30); const c = count(); maxN = Math.max(maxN, c.noise); maxI = Math.max(maxI, c.instances);
    }
    out['footsteps_' + stance] = { maxNoiseRings: maxN, maxRingInstances: maxI };
  }
  m.render(40, 1/30);
  out.afterFootsteps = count();
  for (const source of ['interact', 'ability', 'egg_drop', 'impact', 'decoy', 'hazard']) {
    m.emit({ type: 'noise', source, x: 2, z: 30, loudness: source === 'interact' ? 0.15 : 0.9, radiusM: 12 }); m.render(1, 1/30);
    out['noise_' + source] = count().noise;
    m.render(60, 1/30);
  }
  return out;
})()`);
console.log(JSON.stringify(res, null, 1));
await b.close();
