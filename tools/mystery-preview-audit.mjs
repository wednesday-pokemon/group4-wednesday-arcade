// "No giveaways" audit: the static world (every mesh, glow, decal, static light) must be byte-identical for two session layouts that
// hide the clues / egg at different candidate sites. Also checks that, far from every site, no clue item / egg is shown.
// Usage: node tools/mystery-preview-audit.mjs [baseUrl]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const c of ['poisoned_archive', 'crypt_last_witness', 'midnight_signal']) {
  const sums = [];
  const info = [];
  for (const layout of ['first', 'second']) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${c}&mock=${process.env.MOCK ?? '0'}&layout=${layout}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mReady);
    const r = await page.evaluate(`(async () => {
      const m = window.__m;
      m.place(0, 54, 0, 'idle'); m.render(3, 1/30);
      const root = m.scene.world.root;
      let h = 2166136261 >>> 0, n = 0;
      const mix = (v) => { h ^= (Math.round(v * 1000) | 0); h = Math.imul(h, 16777619) >>> 0; n++; };
      root.traverse((o) => {
        if (o.geometry) { const p = o.geometry.getAttribute('position'); if (p) for (let i = 0; i < p.array.length; i += 1) mix(p.array[i]); const c = o.geometry.getAttribute('color'); if (c) for (let i = 0; i < c.array.length; i += 7) mix(c.array[i]); }
        if (o.isInstancedMesh) for (let i = 0; i < o.count * 16; i++) mix(o.instanceMatrix.array[i]);
        if (o.visible === false) mix(7);
      });
      const d = m.debug();
      return { h, n, vis: d.world.evidenceVisible, egg: d.world.eggVisible, truth: m.map.clues.map(c => c.x + ',' + c.z).join('|') + ' egg ' + m.map.eggSpawn.x + ',' + m.map.eggSpawn.z };
    })()`);
    sums.push(r.h); info.push(r);
    await page.close();
  }
  const same = sums[0] === sums[1];
  const differentTruth = info[0].truth !== info[1].truth;
  const farOk = info.every((r) => r.vis.length === 0 && r.egg === false);
  console.log(c, 'static world checksum equal:', same, '| truth differs between layouts:', differentTruth, '| nothing shown at the pier:', farOk, '|', info[0].n, 'samples');
  if (!same || !differentTruth || !farOk) bad++;
}
await browser.close();
console.log(bad ? 'AUDIT FAILED' : 'AUDIT OK');
process.exit(bad ? 1 : 0);
