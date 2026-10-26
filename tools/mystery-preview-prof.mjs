// CDP sampling profile of the production app under CPU throttling (copy of output/deploy-profile.mjs with a longer function list).
// Usage: BASE=http://localhost:4175 RATE=4 DRIVER=keys CASE=midnight_signal SECONDS=8 node tools/mystery-preview-prof.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4174';
const RATE = Number(process.env.RATE ?? 4);
const DRIVER = process.env.DRIVER ?? 'keys';
const CASE = process.env.CASE ?? 'midnight_signal';
const SEC = Number(process.env.SECONDS ?? 6);

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/?mode=mystery&character=ajax&pokemon=chandelure&seed=prof-${CASE}&case=${CASE}&tutorial=0`);
await page.waitForFunction(() => JSON.parse(window.render_game_to_text?.() ?? 'null')?.play?.phase === 'ready', null, { timeout: 120000 });
await page.mouse.click(683, 384);
if (DRIVER === 'bot') await page.evaluate(() => window.mysteryAutopilot('stealthy'));
await page.evaluate(() => window.advanceTime(22000)); // Hyde out
if (DRIVER === 'keys') await page.keyboard.down('KeyW');
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await page.waitForTimeout(1500);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
let turning = true;
const turner = (async () => {
  while (turning && DRIVER === 'keys') {
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(1200);
  }
})();
await page.waitForTimeout(SEC * 1000);
turning = false;
await turner;
const { profile } = await cdp.send('Profiler.stop');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

// self time per node
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const chunk = (url) => (url ? url.replace(/^.*\/assets\//, '').replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js') || url : '(native)');
const byChunk = new Map();
const byFn = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const c = cf.url ? chunk(cf.url) : cf.functionName ? `(${cf.functionName})` : '(native)';
  byChunk.set(c, (byChunk.get(c) ?? 0) + us);
  const key = `${cf.functionName || '(anon)'} @ ${chunk(cf.url)}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
  byFn.set(key, (byFn.get(key) ?? 0) + us);
}
const pct = (us) => `${((us / total) * 100).toFixed(1)}%`;
const out = {
  rate: RATE, driver: DRIVER, caseId: CASE, seconds: SEC, totalMs: Math.round(total / 1000),
  chunks: [...byChunk].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => ({ chunk: k, ms: Math.round(v / 1000), pct: pct(v) })),
  functions: [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, v]) => ({ fn: k, ms: Math.round(v / 1000), pct: pct(v) })),
};
writeFileSync(`output/overhaul/3d/profile-${RATE}x-${DRIVER}-${CASE}.json`, JSON.stringify(out, null, 2));
console.log(`rate ${RATE}x driver ${DRIVER} case ${CASE}: sampled ${out.totalMs} ms`);
for (const c of out.chunks) console.log(`  ${c.pct.padStart(6)}  ${c.chunk}`);
console.log('  top functions:');
for (const f of out.functions.slice(0, 60)) console.log(`  ${f.pct.padStart(6)}  ${f.fn}`);
await browser.close();
