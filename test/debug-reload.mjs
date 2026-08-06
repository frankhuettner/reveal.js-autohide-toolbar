/*
 * Surgical repro for the one failing case: ink not redrawn after page reload.
 * Instruments localStorage access + redraw triggers. ~20s, chromium only.
 *   node reveal.js-autohide-toolbar/test/debug-reload.mjs
 * Writes test/artifacts/debug-reload.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-chromium');

const PORT = 8037;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO = `${BASE}/reveal.js-autohide-toolbar/demo/`;
const out = {};

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  // instrument BEFORE any page script runs (survives reloads too)
  await ctx.addInitScript(() => {
    window.__diag = { getItemCalls: [], setItemCalls: [], events: [] };
    const origGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      const v = origGet.call(this, k);
      window.__diag.getItemCalls.push({ k, len: v ? v.length : null });
      return v;
    };
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      window.__diag.setItemCalls.push({ k, len: v.length });
      return origSet.call(this, k, v);
    };
    document.addEventListener('DOMContentLoaded', () => {
      if (window.Reveal && window.Reveal.on) {
        window.Reveal.on('ready', () => window.__diag.events.push('reveal-ready'));
      }
    });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const waitReady = async () => {
    await page.waitForFunction(() => window.Reveal && window.Reveal.isReady && window.Reveal.isReady(), null, { timeout: 45000 });
    await page.waitForTimeout(400);
  };
  const inkCount = () => page.evaluate(() => {
    const c = document.getElementById('aht-canvas');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 120) n++;
    return n;
  });

  // --- step 1: clean load, draw one stroke, verify saved ---
  await page.goto(DEMO, { waitUntil: 'networkidle' });
  await waitReady();
  await page.evaluate(() => localStorage.clear());
  await page.keyboard.press('a');
  await page.waitForTimeout(200);
  const b = await page.locator('#aht-canvas').boundingBox();
  await page.mouse.move(b.x + 350, b.y + 250); await page.mouse.down();
  await page.mouse.move(b.x + 450, b.y + 250, { steps: 3 }); await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  out.beforeReload = await page.evaluate(() => ({
    stored: (localStorage.getItem('aht:' + location.pathname) || '').slice(0, 120),
    indices: window.Reveal.getIndices(),
    hash: location.hash,
  }));
  out.inkBeforeReload = await inkCount();

  // --- step 2: reload and observe, WITHOUT touching anything ---
  await page.evaluate(() => { window.__diag = { getItemCalls: [], setItemCalls: [], events: [] }; });
  await page.reload({ waitUntil: 'networkidle' });
  await waitReady();
  await page.waitForTimeout(800);
  out.afterReload = await page.evaluate(() => ({
    diagGetItem: window.__diag.getItemCalls.filter((c) => c.k.startsWith('aht:')),
    stored: (localStorage.getItem('aht:' + location.pathname) || '').slice(0, 120),
    indices: window.Reveal.getIndices(),
    hash: location.hash,
    ready: window.Reveal.isReady(),
    canvas: (() => {
      const c = document.getElementById('aht-canvas');
      return c ? { w: c.width, h: c.height, styleLeft: c.style.left, styleTop: c.style.top, styleW: c.style.width } : null;
    })(),
    slidesBox: (() => {
      const r = window.Reveal.getSlidesElement().getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    })(),
  }));
  out.inkAfterReload = await inkCount();

  // --- step 3: manual re-triggers, narrowing down which link is broken ---
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(400);
  out.inkAfterResizeEvent = await inkCount();

  await page.evaluate(() => { window.Reveal.next(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.Reveal.prev(); });
  await page.waitForTimeout(500);
  out.inkAfterSlideRoundtrip = await inkCount();

  await page.evaluate(() => { window.AutohideToolbar.enable(true); window.AutohideToolbar.enable(false); });
  await page.waitForTimeout(300);
  out.inkAfterEnableCycle = await inkCount();

  out.errors = errors;
} finally {
  await browser.close().catch(() => {});
  server.kill();
}

const file = path.join(__dirname, 'artifacts', 'debug-reload.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
