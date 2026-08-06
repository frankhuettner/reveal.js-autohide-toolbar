/*
 * Diagnoses speaker-view sync (navigation + ink) against any deck URL.
 *   node test/check-speaker-sync.mjs                       # local demo (spawns server)
 *   node test/check-speaker-sync.mjs https://example.com/demo/   # live page
 * Prints + writes test/artifacts/speaker-sync.json with full error capture.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-chromium');

const argUrl = process.argv[2] || null;
const out = { url: argUrl || 'local', errors: { main: [], popup: [] }, steps: {} };

let server = null;
let url = argUrl;
if (!url) {
  const PORT = 8038;
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: PLUGIN, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  url = `http://127.0.0.1:${PORT}/demo/`;
  out.url = url;
}

const track = (page, store) => {
  page.on('pageerror', (e) => store.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') store.push(m.type() + ': ' + m.text()); });
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) store.push('reqfail: ' + r.url()); });
};
const poll = async (fn, ms = 8000, step = 300) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) {}
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, step));
  }
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  track(page, out.errors.main);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.Reveal && window.Reveal.isReady && window.Reveal.isReady(), null, { timeout: 45000 });
  await page.waitForTimeout(500);
  out.steps.mainLoaded = true;

  // open the speaker view
  const [popup] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null),
    page.evaluate(() => window.Reveal.getPlugin('notes').open()),
  ]);
  out.steps.popupOpened = !!popup;
  if (!popup) throw new Error('speaker popup did not open');
  track(popup, out.errors.popup);
  await popup.waitForTimeout(2500);
  out.steps.popupUrl = popup.url();

  // find the receiver iframes inside the popup
  const receivers = () => popup.frames().filter((f) => /receiver/.test(f.url()));
  await poll(() => receivers().length >= 1, 12000);
  out.steps.receiverFrames = receivers().map((f) => f.url().slice(0, 120));
  if (!receivers().length) throw new Error('no receiver iframes appeared in the speaker window');

  // --- navigation sync: main next() must reach a receiver frame ---
  await page.evaluate(() => window.Reveal.next());
  const navOk = await poll(async () => {
    for (const f of receivers()) {
      const h = await f.evaluate(() => window.Reveal && window.Reveal.isReady() && window.Reveal.getIndices().h).catch(() => null);
      if (h === 1) return true;
    }
    return false;
  }, 8000);
  out.steps.navigationSync = !!navOk;
  await page.evaluate(() => window.Reveal.prev());
  await page.waitForTimeout(800);

  // --- ink sync: draw in main, expect pixels in a receiver frame ---
  await page.keyboard.press('a');
  await page.waitForTimeout(300);
  const b = await page.locator('#aht-canvas').boundingBox();
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');

  const inkOk = await poll(async () => {
    for (const f of receivers()) {
      const hit = await f.evaluate(() => {
        const c = document.getElementById('aht-canvas');
        if (!c || !c.width) return false;
        const d = c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data;
        return d[3] > 120;
      }).catch(() => false);
      if (hit) return true;
    }
    return false;
  }, 8000);
  out.steps.inkSync = !!inkOk;

  // extra context: does the plugin even run inside the receiver frames?
  out.steps.pluginInReceivers = [];
  for (const f of receivers()) {
    out.steps.pluginInReceivers.push(await f.evaluate(() => ({
      hasCanvas: !!document.getElementById('aht-canvas'),
      storageKey: 'aht:' + location.pathname,
      storedLen: (localStorage.getItem('aht:' + location.pathname) || '').length,
    })).catch((e) => 'evaluate failed: ' + e.message));
  }
} catch (e) {
  out.fatal = String(e && e.message || e).split('\n')[0];
} finally {
  await browser.close().catch(() => {});
  if (server) server.kill();
}

const file = path.join(__dirname, 'artifacts', 'speaker-sync.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
