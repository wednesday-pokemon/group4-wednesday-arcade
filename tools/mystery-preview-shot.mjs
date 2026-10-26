// Quick screenshot helper for the Mystery preview harness. Usage:
//   node tools/mystery-preview-shot.mjs <out.png> "<query>" "<js to run in page (async ok)>" [baseUrl]
import { chromium } from 'playwright';
const [out, query = '', js = '', base = 'http://localhost:5173'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto(`${base}/tools/mystery-preview.html?manual=1&shot=1&${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mReady, null, { timeout: 60000 });
const res = js ? await page.evaluate(`(async () => { const m = window.__m; ${js} })()`) : null;
if (res !== null && res !== undefined) console.log(JSON.stringify(res));
await page.screenshot({ path: out });
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
