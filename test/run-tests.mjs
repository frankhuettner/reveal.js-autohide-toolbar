/*
 * Comprehensive Playwright test suite for reveal.js-autohide-toolbar.
 * Runs the full suite as a MATRIX: {Chromium, WebKit} × {reveal 5.x, 6.x}.
 *
 * Run OUTSIDE the sandbox (a normal terminal), from anywhere:
 *   node reveal.js-autohide-toolbar/test/run-tests.mjs
 *
 * - Spawns its own static server (port 8036, plugin dir) — fully self-contained.
 *   The server rewrites the pinned reveal.js CDN version in every served HTML
 *   page to the matrix target, including reveal 6's moved plugin paths
 *   (plugin/<name>/<name>.js ↔ dist/plugin/<name>.js), so ONE set of fixtures
 *   tests every reveal version.
 * - Browsers come from this package's devDependencies (npm install first).
 * - Writes everything to test/artifacts/: results.log, results.json, *.png
 *   (screenshots are prefixed with engine@version; failures get fail-*.png).
 * - G9 smoke-tests real-world decks vendored from hakimel/reveal.js@5.2.1
 *   (MIT) in test/decks/ — stacks, fragments, markdown, MathJax, auto-animate.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(__dirname, '..');
const ART = path.join(__dirname, 'artifacts');
fs.rmSync(ART, { recursive: true, force: true });
fs.mkdirSync(ART, { recursive: true });

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright-chromium');
const { webkit } = require('playwright-webkit');

// The reveal.js versions of the test matrix: last 5.x (the pin the fixtures
// carry) and current 6.x. The server rewrites served HTML to each target.
const VERSIONS = ['5.2.1', '6.0.1'];

const PORT = 8036;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO = `${BASE}/demo/`;
const FIXTURE = `${BASE}/test/fixture-options.html`;
const KEYS_A = `${BASE}/test/fixture-keys-a.html`;
const KEYS_B = `${BASE}/test/fixture-keys-b.html`;
const EMBED = `${BASE}/test/fixture-embed.html`;

// Real-world decks vendored from hakimel/reveal.js@5.2.1 (MIT) in test/decks/,
// with the plugin injected — smoke coverage for feature-heavy decks the
// fixtures don't model (vertical stacks, fragments, markdown, highlight,
// MathJax, auto-animate). `noisy` filters expected third-party network chatter.
const DECKS = [
  { file: 'demo.html', name: 'official demo (stacks, fragments, markdown, highlight)', noisy: /slid\.es/i },
  { file: 'math.html', name: 'math example (MathJax)', noisy: /mathjax|cdnjs/i },
  { file: 'auto-animate.html', name: 'auto-animate example', noisy: null },
];

// ---------- tiny harness ----------
const results = [];
const logLines = [];
let CUR = '';          // current engine label
let CURPAGE = null;    // page for failure screenshots
let failNo = 0;
function log(s) { console.log(s); logLines.push(s); }
async function test(name, fn) {
  const full = `[${CUR}] ${name}`;
  try {
    await fn();
    results.push({ name: full, ok: true });
    log(`  PASS  ${full}`);
  } catch (e) {
    const err = String(e && e.message || e);
    results.push({ name: full, ok: false, error: err });
    log(`  FAIL  ${full}\n        ${err.split('\n')[0]}`);
    if (CURPAGE) await CURPAGE.screenshot({ path: path.join(ART, `fail-${CUR}-${++failNo}.png`) }).catch(() => {});
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function approx(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error(`${msg} (${a} vs ${b}, tol ${tol})`); }
const halfWidth = (page) => page.viewportSize().width / 2;

// ---------- page helpers ----------
function trackErrors(page, store) {
  page.on('pageerror', (e) => store.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') store.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) store.push('reqfail: ' + r.url()); });
}
async function waitReady(page) {
  await page.waitForFunction(() => window.Reveal && window.Reveal.isReady && window.Reveal.isReady(), null, { timeout: 45000 });
  await page.waitForTimeout(400);
}
async function canvasBox(page) {
  const b = await page.locator('#aht-canvas').boundingBox();
  assert(b, 'canvas has no bounding box');
  return b;
}
async function draw(page, pts) {
  const b = await canvasBox(page);
  await page.mouse.move(b.x + pts[0][0], b.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x, b.y + y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}
async function pixel(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById('aht-canvas');
    const dpr = window.devicePixelRatio || 1;
    const d = c.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, [x, y]);
}
// count inked pixels across the whole canvas (sampled) — distinguishes GONE vs DISPLACED
async function inkCount(page) {
  return page.evaluate(() => {
    const c = document.getElementById('aht-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 120) n++;
    return n;
  });
}
const colored = (px) => px[3] > 120;
const chromeOn = (page) => page.evaluate(() => document.body.classList.contains('aht-chrome'));
const indices = (page) => page.evaluate(() => window.Reveal.getIndices());

// ---------- the full suite, parameterized by engine ----------
async function runSuite(browserType, label) {
  CUR = label;
  const shot = (page, name) => page.screenshot({ path: path.join(ART, `${label}-${name}.png`) });
  log(`\n########  ENGINE: ${label}  ########`);
  const browser = await browserType.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = [];
    const page = await ctx.newPage();
    CURPAGE = page;
    trackErrors(page, errors);

    log(`=== ${label} · G1 loading & structure (demo) ===`);
    await page.goto(DEMO, { waitUntil: 'networkidle' });
    await waitReady(page);
    // wipe ink from any previous run, then reload so in-memory state is clean too
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await waitReady(page);

    await test('plugin global is a factory function with id/init/destroy', async () => {
      const t = await page.evaluate(() => [
        typeof window.RevealAutohideToolbar,
        window.RevealAutohideToolbar.id,
        typeof window.RevealAutohideToolbar().init,
        typeof window.RevealAutohideToolbar().destroy,
      ]);
      assert(t[0] === 'function' && t[1] === 'autohide-toolbar' && t[2] === 'function' && t[3] === 'function', JSON.stringify(t));
    });
    await test('canvas, toolbar, style, runtime API present', async () => {
      const t = await page.evaluate(() => [
        !!document.getElementById('aht-canvas'),
        !!document.getElementById('aht-toolbar'),
        !!document.getElementById('aht-styles'),
        typeof window.AutohideToolbar,
      ]);
      assert(t[0] && t[1] && t[2] && t[3] === 'object', JSON.stringify(t));
    });
    await test('toolbar has default buttons + slide counter "1 / 4"', async () => {
      const t = await page.evaluate(() => ({
        btns: document.querySelectorAll('#aht-toolbar .aht-btn').length,
        no: document.getElementById('aht-slideno').textContent,
      }));
      assert(t.btns === 6, 'expected 6 buttons, got ' + t.btns);
      assert(t.no === '1 / 4', 'counter: ' + t.no);
    });
    await test('canvas overlays the slides box (geometry)', async () => {
      const d = await page.evaluate(() => {
        const c = document.getElementById('aht-canvas').getBoundingClientRect();
        const s = window.Reveal.getSlidesElement().getBoundingClientRect();
        return Math.abs(c.left - s.left) + Math.abs(c.top - s.top) + Math.abs(c.width - s.width) + Math.abs(c.height - s.height);
      });
      approx(d, 0, 3, 'canvas/slides rect mismatch');
    });

    log(`=== ${label} · G2 toolbar hover + navigation ===`);
    await test('chrome auto-hides after load', async () => {
      await page.waitForTimeout(2600);
      assert(!(await chromeOn(page)), 'chrome still visible after idle');
    });
    await test('hover bottom-left corner shows toolbar; leaving hides it', async () => {
      const vp = page.viewportSize();
      await page.mouse.move(60, vp.height - 30);
      await page.waitForTimeout(200);
      assert(await chromeOn(page), 'not shown in corner');
      await shot(page, 'g2-toolbar-visible');
      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(700);
      assert(!(await chromeOn(page)), 'not hidden after leaving');
    });
    await test('next/prev buttons navigate and update counter', async () => {
      const vp = page.viewportSize();
      await page.mouse.move(60, vp.height - 30);
      await page.waitForTimeout(200);
      await page.locator('#aht-toolbar .aht-btn').nth(1).click();
      await page.waitForTimeout(600);
      assert((await indices(page)).h === 1, 'next did not advance');
      const no = await page.locator('#aht-slideno').textContent();
      assert(no === '2 / 4', 'counter after next: ' + no);
      await page.locator('#aht-toolbar .aht-btn').nth(0).click();
      await page.waitForTimeout(600);
      assert((await indices(page)).h === 0, 'prev did not go back');
    });
    await test('overview button toggles overview and hides canvas', async () => {
      await page.locator('#aht-toolbar .aht-btn').nth(2).click();
      await page.waitForTimeout(500);
      assert(await page.evaluate(() => window.Reveal.isOverview()), 'overview not on');
      assert(await page.evaluate(() => document.getElementById('aht-canvas').style.display === 'none'), 'canvas not hidden in overview');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      assert(!(await page.evaluate(() => window.Reveal.isOverview())), 'overview not off');
    });
    await test('speaker-view button opens the notes window', async () => {
      const vp = page.viewportSize();
      await page.mouse.move(60, vp.height - 30);
      await page.waitForTimeout(200);
      const [popup] = await Promise.all([
        ctx.waitForEvent('page', { timeout: 8000 }),
        page.locator('#aht-toolbar .aht-btn').nth(3).click(),
      ]);
      await popup.close();
    });

    log(`=== ${label} · G3 annotation core ===`);
    await test('A toggles annotation: canvas active, bar shown, chrome hidden', async () => {
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      const t = await page.evaluate(() => [
        document.getElementById('aht-canvas').classList.contains('active'),
        !document.getElementById('aht-bar').hidden,
        !document.body.classList.contains('aht-chrome'),
      ]);
      assert(t.every(Boolean), JSON.stringify(t));
      await shot(page, 'g3-annotation-bar');
    });
    await test('ink lands under the cursor (pixel probe, default red)', async () => {
      await draw(page, [[300, 300], [500, 300]]);
      const px = await pixel(page, 400, 300);
      assert(colored(px), 'no ink at stroke midpoint: ' + px);
      assert(px[0] > 180 && px[1] < 90 && px[2] < 90, 'not red: ' + px);
      await shot(page, 'g3-ink');
    });
    await test('eraser removes only touched strokes; second stroke survives', async () => {
      await draw(page, [[300, 400], [500, 400]]);
      await page.keyboard.press('e');
      await draw(page, [[250, 300], [550, 300]]);
      const gone = await pixel(page, 400, 300);
      const kept = await pixel(page, 400, 400);
      assert(!colored(gone), 'first stroke not erased: ' + gone);
      assert(colored(kept), 'second stroke was wrongly erased: ' + kept);
      await page.keyboard.press('e');
    });
    await test('Ctrl+Z undoes the last action', async () => {
      await draw(page, [[300, 500], [500, 500]]);
      assert(colored(await pixel(page, 400, 500)), 'stroke missing before undo');
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
      assert(!colored(await pixel(page, 400, 500)), 'undo did not remove stroke');
    });
    await test('color swatch changes pen color', async () => {
      await page.locator('#aht-bar .aht-swatch[data-color="#0070C0"]').click();
      await draw(page, [[300, 520], [500, 520]]);
      const px = await pixel(page, 400, 520);
      assert(px[2] > 120 && px[0] < 90, 'not blue: ' + px);
    });
    await test('X clears this slide; Esc exits annotation', async () => {
      await page.locator('#aht-bar .aht-swatch[data-color="#FF0000"]').click();
      await draw(page, [[300, 350], [500, 350]]);
      await page.keyboard.press('x');
      await page.waitForTimeout(200);
      assert(!colored(await pixel(page, 400, 350)), 'X did not clear');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      assert(!(await page.evaluate(() => document.getElementById('aht-canvas').classList.contains('active'))), 'Esc did not exit');
    });
    await test('palm rejection: after a pen stroke, bare touch stops drawing', async () => {
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      const synth = (type, pt, x, y, id) => page.evaluate(([type, pt, x, y, id]) => {
        const c = document.getElementById('aht-canvas');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent(type, {
          pointerType: pt, pointerId: id, isPrimary: true,
          clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true,
        }));
      }, [type, pt, x, y, id]);
      // stylus stroke draws
      await synth('pointerdown', 'pen', 200, 450, 71);
      await synth('pointermove', 'pen', 280, 450, 71);
      await synth('pointerup', 'pen', 280, 450, 71);
      await page.waitForTimeout(200);
      assert(colored(await pixel(page, 240, 450)), 'pen stroke did not draw');
      // a bare touch afterwards (the palm) must NOT draw
      await synth('pointerdown', 'touch', 200, 490, 72);
      await synth('pointermove', 'touch', 280, 490, 72);
      await synth('pointerup', 'touch', 280, 490, 72);
      await page.waitForTimeout(200);
      assert(!colored(await pixel(page, 240, 490)), 'palm touch drew despite stylus use');
      await page.keyboard.press('x');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    });
    await test('annotation bar is one row at desktop width and drags by its grip', async () => {
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      const r1 = await page.locator('#aht-bar').boundingBox();
      const g = await page.locator('#aht-bar .aht-grip').boundingBox();
      // regression: a positioned element shrink-to-fits into the space right of
      // 'left' — without width:max-content the centred bar wrapped to two rows
      assert(r1.height < 60, 'bar wrapped to multiple rows at 1280px: ' + JSON.stringify(r1));
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2 + 150, g.y + g.height / 2 - 80, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const r2 = await page.locator('#aht-bar').boundingBox();
      assert(Math.abs(r2.x - r1.x - 150) < 25 && Math.abs(r2.y - r1.y + 80) < 25,
        `bar did not follow drag: ${JSON.stringify({ from: r1, to: r2 })}`);
    });
    await test('annotation bar fits narrow viewports (wraps, close stays reachable)', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(500);
      const barBox = await page.locator('#aht-bar').boundingBox();
      assert(barBox.x >= 0 && barBox.x + barBox.width <= 360 + 1, 'bar overflows narrow viewport: ' + JSON.stringify(barBox));
      const closeBox = await page.locator('#aht-bar button[title*="Exit"]').boundingBox();
      assert(closeBox && closeBox.x >= 0 && closeBox.x + closeBox.width <= 360 + 1, 'close button not reachable: ' + JSON.stringify(closeBox));
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(500);
    });
    await test('annotation bar minimizes to grip + restore button', async () => {
      const wide = (await page.locator('#aht-bar').boundingBox()).width;
      await page.locator('#aht-minbtn').click();
      await page.waitForTimeout(200);
      const slim = (await page.locator('#aht-bar').boundingBox()).width;
      assert(slim < 120 && slim < wide / 3, `not minimized: ${wide} -> ${slim}`);
      await page.locator('#aht-minbtn').click();
      await page.waitForTimeout(200);
      const back = (await page.locator('#aht-bar').boundingBox()).width;
      assert(back > wide - 20, `not restored: ${back} vs ${wide}`);
      await page.keyboard.press('Escape');
    });

    log(`=== ${label} · G4 persistence & vanish-glitch regression ===`);
    await test('ink survives slide change and return (regression: vanish glitch)', async () => {
      // enter/leave annotation via the API: deterministic even if an earlier
      // test failed mid-way and left the toggle in an unexpected state
      await page.evaluate(() => window.AutohideToolbar.enable(true));
      await draw(page, [[350, 250], [450, 250]]);
      await page.evaluate(() => window.AutohideToolbar.enable(false));
      await page.evaluate(() => window.Reveal.next());
      await page.waitForTimeout(800);
      assert(!colored(await pixel(page, 400, 250)), 'ink leaked onto next slide');
      await page.evaluate(() => window.Reveal.prev());
      await page.waitForTimeout(800);
      assert(colored(await pixel(page, 400, 250)), 'ink vanished after returning (the old glitch!)');
    });
    await test('ink survives a full page reload (localStorage)', async () => {
      const before = await page.evaluate(() => localStorage.getItem('aht:' + location.pathname));
      assert(before && before.includes('points'), 'nothing persisted before reload: ' + String(before).slice(0, 100));
      await page.reload({ waitUntil: 'networkidle' });
      await waitReady(page);
      // reveal's debounced hash write can leave '#/1' in the URL at reload time,
      // landing us on slide 2 — return to slide 1, where the ink lives
      await page.evaluate(() => window.Reveal.slide(0));
      await page.waitForTimeout(700);
      const px = await pixel(page, 400, 250);
      if (!colored(px)) {
        const count = await inkCount(page);
        const after = await page.evaluate(() => localStorage.getItem('aht:' + location.pathname));
        await shot(page, 'g4-reload-diagnosis');
        throw new Error(`ink not at expected spot after reload — canvas ink samples: ${count} (${count > 0 ? 'DISPLACED' : 'GONE'}); stored after reload: ${String(after).slice(0, 120)}`);
      }
    });
    await test('ink syncs to a second window (speaker-view mechanism)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => window.Reveal.slide(0));
      await p2.waitForTimeout(400);
      // draw in the FIRST window; the second must adopt it via the storage event
      await page.evaluate(() => window.AutohideToolbar.enable(true));
      await draw(page, [[600, 300], [700, 300]]);
      await page.evaluate(() => window.AutohideToolbar.enable(false));
      await p2.waitForTimeout(600);
      assert(colored(await pixel(p2, 650, 300)), 'second window did not sync the new stroke');
      await p2.close();
      CURPAGE = page;
    });
    await test('Shift+X asks for confirmation; Esc cancels, confirm clears + tombstones', async () => {
      await page.evaluate(() => window.AutohideToolbar.enable(true));
      await page.keyboard.press('Shift+X');
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => !!document.getElementById('aht-confirm-wrap')), 'no confirmation dialog on Shift+X');
      await page.keyboard.press('Escape');   // cancels the dialog, not the annotation mode
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => !document.getElementById('aht-confirm-wrap')), 'Esc did not close the dialog');
      assert(colored(await pixel(page, 400, 250)), 'cancelling still cleared the ink');
      await page.keyboard.press('Shift+X');
      await page.waitForTimeout(200);
      await page.locator('#aht-confirm .aht-ok').click();
      await page.evaluate(() => window.AutohideToolbar.enable(false));
      await page.waitForTimeout(200);
      assert(!colored(await pixel(page, 400, 250)), 'ink survived confirmed Shift+X');
      // clear-all writes an EMPTY envelope (tombstone), not removeItem — that is
      // what keeps a deck-embedded baseline from resurrecting
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aht:' + location.pathname)));
      assert(stored && stored.v === 1 && Object.keys(stored.strokes).length === 0 && stored.boards.length === 0,
        'tombstone not written: ' + JSON.stringify(stored));
    });

    log(`=== ${label} · G5 geometry robustness ===`);
    await test('ink sticks to slide content across window resize', async () => {
      await page.evaluate(() => {
        if (window.Reveal.isOverview()) window.Reveal.toggleOverview();   // stray-state guard
        window.AutohideToolbar.enable(true);
      });
      await page.waitForTimeout(300);
      const b1 = await canvasBox(page);
      await draw(page, [[b1.width / 2 - 50, b1.height / 2], [b1.width / 2 + 50, b1.height / 2]]);
      await page.setViewportSize({ width: 900, height: 760 });
      await page.waitForTimeout(600);
      const b2 = await canvasBox(page);
      assert(colored(await pixel(page, b2.width / 2, b2.height / 2)), 'ink not at slide centre after resize');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(600);
    });
    await test('format change 16:9 → 4:3 keeps ink centred (aspect-fit)', async () => {
      const b1 = await canvasBox(page);
      assert(colored(await pixel(page, b1.width / 2, b1.height / 2)), 'precondition: centre ink missing');
      await page.evaluate(() => window.Reveal.configure({ width: 960, height: 720 }));
      await page.waitForTimeout(700);
      const b2 = await canvasBox(page);
      assert(colored(await pixel(page, b2.width / 2, b2.height / 2)), 'centre ink lost after format change');
      await shot(page, 'g5-format-4x3');
      await page.evaluate(() => window.Reveal.configure({ width: 960, height: 540 }));
      await page.waitForTimeout(700);
    });
    await test('keyboard:false disables the toggle key; re-enabling restores it', async () => {
      await page.evaluate(() => window.AutohideToolbar.enable(false));
      await page.evaluate(() => window.Reveal.configure({ keyboard: false }));
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      assert(!(await page.evaluate(() => document.getElementById('aht-canvas').classList.contains('active'))), 'A worked despite keyboard:false');
      await page.evaluate(() => window.Reveal.configure({ keyboard: true }));
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => document.getElementById('aht-canvas').classList.contains('active')), 'A dead after re-enable');
      await page.keyboard.press('Escape');
    });
    await test('destroy() removes all plugin DOM and the runtime API', async () => {
      await page.evaluate(() => window.Reveal.getPlugin('autohide-toolbar').destroy());
      const t = await page.evaluate(() => [
        !!document.getElementById('aht-canvas'),
        !!document.getElementById('aht-toolbar'),
        !!document.getElementById('aht-styles'),
        typeof window.AutohideToolbar,
        document.body.classList.contains('aht-chrome'),
      ]);
      assert(!t[0] && !t[1] && !t[2] && t[3] === 'undefined' && !t[4], JSON.stringify(t));
    });
    await test('no page errors on the demo page', async () => {
      assert(errors.length === 0, errors.join(' | '));
    });

    log(`=== ${label} · G6 print & scroll-view modes ===`);
    await test('?print-pdf: no plugin chrome, saved ink rendered as SVG', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO + '?print-pdf', { waitUntil: 'networkidle' });
      await p2.waitForTimeout(1500);
      const t = await p2.evaluate(() => [
        !!document.getElementById('aht-canvas'),
        !!document.getElementById('aht-toolbar'),
        document.querySelectorAll('.aht-print-ink').length,
      ]);
      assert(!t[0] && !t[1], JSON.stringify(t));
      // G5 left a saved stroke on slide 1 — it must print
      assert(t[2] >= 1, 'no SVG ink in print view: ' + JSON.stringify(t));
      await p2.close();
      CURPAGE = page;
    });
    await test('?view=scroll: plugin stays inactive, no errors', async () => {
      const errs = [];
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      trackErrors(p2, errs);
      await p2.goto(DEMO + '?view=scroll', { waitUntil: 'networkidle' });
      await p2.waitForTimeout(1500);
      const t = await p2.evaluate(() => [!!document.getElementById('aht-canvas'), !!document.getElementById('aht-toolbar')]);
      assert(!t[0] && !t[1], 'plugin active in scroll view: ' + JSON.stringify(t));
      assert(errs.length === 0, errs.join(' | '));
      await p2.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G7 options fixture ===`);
    await test('fixture: toolbar bottom-right, subset tools, q toggles, a does not', async () => {
      const errs = [];
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      trackErrors(p2, errs);
      await p2.goto(FIXTURE, { waitUntil: 'networkidle' });
      await waitReady(p2);
      const pos = await p2.evaluate(() => {
        const r = document.getElementById('aht-toolbar').getBoundingClientRect();
        return { rightGap: window.innerWidth - r.right, left: r.left };
      });
      assert(pos.rightGap < 40 && pos.left > halfWidth(p2), 'toolbar not bottom-right: ' + JSON.stringify(pos));
      const kids = await p2.evaluate(() => document.getElementById('aht-toolbar').children.length);
      assert(kids === 2, 'tools subset wrong, children=' + kids);
      await p2.keyboard.press('a');
      await p2.waitForTimeout(200);
      assert(!(await p2.evaluate(() => document.getElementById('aht-canvas').classList.contains('active'))), "'a' toggled despite toggleKey q");
      await p2.keyboard.press('q');
      await p2.waitForTimeout(200);
      assert(await p2.evaluate(() => document.getElementById('aht-canvas').classList.contains('active')), "'q' did not toggle");
      const sw = await p2.evaluate(() => document.querySelectorAll('#aht-bar .aht-swatch').length);
      assert(sw === 3, 'swatches=' + sw);
      const b = await p2.locator('#aht-canvas').boundingBox();
      await p2.mouse.move(b.x + 200, b.y + 200); await p2.mouse.down();
      await p2.mouse.move(b.x + 300, b.y + 200, { steps: 3 }); await p2.mouse.up();
      await p2.waitForTimeout(250);
      const stored = await p2.evaluate(() => localStorage.getItem('aht:' + location.pathname));
      assert(stored === null, 'persist:false still wrote storage');
      assert(errs.length === 0, errs.join(' | '));
      await shot(p2, 'g7-fixture-bottom-right');
      await p2.close();
      CURPAGE = page;
    });
    await test('fixture: hover zone follows the bottom-RIGHT corner', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(FIXTURE, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.waitForTimeout(2600);
      const vp = p2.viewportSize();
      await p2.mouse.move(vp.width - 40, vp.height - 30);
      await p2.waitForTimeout(250);
      assert(await p2.evaluate(() => document.body.classList.contains('aht-chrome')), 'zone did not follow toolbar to the right');
      await p2.mouse.move(60, vp.height - 30);
      await p2.waitForTimeout(700);
      assert(!(await p2.evaluate(() => document.body.classList.contains('aht-chrome'))), 'left corner still wakes chrome');
      await p2.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G8 touch device (emulated iPhone) ===`);
    await test('touch: toolbar persistent, tap-halves navigate, buttons exempt', async () => {
      const mob = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
      const p2 = await mob.newPage();
      CURPAGE = p2;
      const errs = [];
      trackErrors(p2, errs);
      // fresh mobile context = cold CDN cache; don't gate on networkidle
      await p2.goto(DEMO, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p2);
      await p2.waitForTimeout(3000);
      assert(await p2.evaluate(() => document.body.classList.contains('aht-chrome')), 'toolbar not persistent on touch');
      await shot(p2, 'g8-touch-toolbar');
      const vp = p2.viewportSize();
      await p2.touchscreen.tap(vp.width * 0.8, vp.height * 0.4);
      await p2.waitForTimeout(700);
      assert((await indices(p2)).h === 1, 'right-half tap did not advance');
      await p2.touchscreen.tap(vp.width * 0.2, vp.height * 0.4);
      await p2.waitForTimeout(700);
      assert((await indices(p2)).h === 0, 'left-half tap did not go back');
      await p2.evaluate(() => window.Reveal.slide(2));
      await p2.waitForTimeout(700);
      const btn = await p2.locator('section.present button').first().boundingBox();
      assert(btn, 'fixture button not found on slide 3');
      await p2.touchscreen.tap(btn.x + btn.width / 2, btn.y + btn.height / 2);
      await p2.waitForTimeout(700);
      assert((await indices(p2)).h === 2, 'tap on <button> wrongly navigated');
      assert(errs.length === 0, errs.join(' | '));
      await mob.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G10 board slides ===`);
    await test('board button inserts an uncounted board slide and auto-enables the pen', async () => {
      await page.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(page);
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'networkidle' });
      await waitReady(page);
      await page.evaluate(() => window.Reveal.slide(0));
      await page.waitForTimeout(400);
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      await page.locator('#aht-bar .aht-swatch[data-color="#000000"]').click();  // must auto-brighten on the dark board
      await page.locator('#aht-board').click();
      await page.waitForTimeout(600);
      const t = await page.evaluate(() => ({
        boards: document.querySelectorAll('[data-aht-board]').length,
        onBoard: !!window.Reveal.getCurrentSlide().getAttribute('data-aht-board'),
        uncounted: window.Reveal.getCurrentSlide().getAttribute('data-visibility') === 'uncounted',
        active: document.getElementById('aht-canvas').classList.contains('active'),
        counter: document.getElementById('aht-slideno').textContent,
        swatch: document.querySelector('#aht-bar .aht-swatch.active').getAttribute('data-color'),
        surfaceShown: !document.getElementById('aht-surface').hidden,
      }));
      assert(t.boards === 1, 'boards=' + t.boards);
      assert(t.onBoard && t.uncounted && t.active, JSON.stringify(t));
      assert(t.counter === '1 / 4', 'board must not shift the count: ' + t.counter);
      assert(t.swatch === '#FFFFFF', 'dark pen not auto-brightened: ' + t.swatch);
      assert(t.surfaceShown, 'surface toggle not shown on a board');
      await shot(page, 'g10-board');
    });
    await test('surface toggle flips dark/white; pen contrast follows', async () => {
      await page.locator('#aht-surface').click();
      await page.waitForTimeout(400);
      const t = await page.evaluate(() => ({
        bg: window.Reveal.getCurrentSlide().getAttribute('data-background-color'),
        swatch: document.querySelector('#aht-bar .aht-swatch.active').getAttribute('data-color'),
      }));
      assert(t.bg === '#FFFFFF', 'board not white: ' + t.bg);
      assert(t.swatch === '#000000', 'light pen not auto-darkened: ' + t.swatch);
      await shot(page, 'g10-whiteboard');
      await page.locator('#aht-surface').click();   // back to dark
      await page.waitForTimeout(400);
      const sw = await page.evaluate(() => document.querySelector('#aht-bar .aht-swatch.active').getAttribute('data-color'));
      assert(sw === '#FFFFFF', 'flip back to dark did not re-brighten the pen: ' + sw);
    });
    await test('board ink persists: reload restores the board slide and its ink', async () => {
      await draw(page, [[300, 300], [500, 300]]);
      assert(colored(await pixel(page, 400, 300)), 'no ink on the board');
      await page.reload({ waitUntil: 'networkidle' });
      await waitReady(page);
      await page.evaluate(() => window.Reveal.slide(1));   // the board lives at index 1
      await page.waitForTimeout(600);
      const t = await page.evaluate(() => ({
        boards: document.querySelectorAll('[data-aht-board]').length,
        onBoard: !!window.Reveal.getCurrentSlide().getAttribute('data-aht-board'),
      }));
      assert(t.boards === 1 && t.onBoard, JSON.stringify(t));
      assert(colored(await pixel(page, 400, 300)), 'board ink lost after reload');
    });
    await test('board removal asks for confirmation; cancel keeps, confirm deletes', async () => {
      await page.locator('#aht-board').click();   // on a board, the button means "remove"
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => !!document.getElementById('aht-confirm-wrap')), 'no confirmation dialog');
      await page.locator('#aht-confirm .aht-cancel').click();
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => document.querySelectorAll('[data-aht-board]').length === 1), 'cancel removed the board');
      await page.locator('#aht-board').click();
      await page.waitForTimeout(200);
      await page.locator('#aht-confirm .aht-ok').click();
      await page.waitForTimeout(600);
      const t = await page.evaluate(() => ({
        boards: document.querySelectorAll('[data-aht-board]').length,
        h: window.Reveal.getIndices().h,
        stored: JSON.parse(localStorage.getItem('aht:' + location.pathname)),
      }));
      assert(t.boards === 0, 'board not removed');
      assert(t.h === 0, 'not back on the anchor slide: h=' + t.h);
      assert(t.stored.boards.length === 0
        && Object.keys(t.stored.strokes).every((k) => k.indexOf('b:') !== 0), 'board data still stored');
    });
    await test('live board insert/remove syncs to a second window', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await page.evaluate(() => window.AutohideToolbar.addBoard());
      await p2.waitForTimeout(900);
      assert(await p2.evaluate(() => document.querySelectorAll('[data-aht-board]').length === 1), 'second window did not gain the board');
      await page.evaluate(() => window.AutohideToolbar.removeBoard());
      await p2.waitForTimeout(900);
      assert(await p2.evaluate(() => document.querySelectorAll('[data-aht-board]').length === 0), 'second window kept the removed board');
      await p2.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G11 stable slide keys & migration ===`);
    await test('ink follows its slide when the deck is edited (slide inserted before it)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(KEYS_A, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.removeItem('aht:test-keys'));
      await p2.evaluate(() => window.Reveal.slide(1));   // "Beta"
      await p2.waitForTimeout(400);
      await p2.keyboard.press('a');
      await p2.waitForTimeout(200);
      const b = await p2.locator('#aht-canvas').boundingBox();
      await draw(p2, [[b.width / 2 - 80, b.height / 2], [b.width / 2 + 80, b.height / 2]]);
      // open the EDITED deck (extra slide at the front), same storage key
      await p2.goto(KEYS_B, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => window.Reveal.slide(2));   // "Beta" is now index 2
      await p2.waitForTimeout(500);
      const b2 = await p2.locator('#aht-canvas').boundingBox();
      assert(colored(await pixel(p2, b2.width / 2, b2.height / 2)), 'ink did not follow its slide into the edited deck');
      await p2.evaluate(() => window.Reveal.slide(1));   // "Alpha" — index-keyed storage would put the ink here
      await p2.waitForTimeout(500);
      assert(!colored(await pixel(p2, b2.width / 2, b2.height / 2)), 'ink leaked onto the wrong slide');
      await p2.evaluate(() => localStorage.removeItem('aht:test-keys'));
      await p2.close();
      CURPAGE = page;
    });
    await test('legacy index-keyed storage (pre-v0.3) is migrated to stable keys', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(KEYS_A, { waitUntil: 'networkidle' });
      await waitReady(p2);
      // seed the OLD format: a bare strokes map keyed by slide index 'h-v'
      await p2.evaluate(() => localStorage.setItem('aht:test-keys', JSON.stringify({
        '1-0': [{ color: '#FF0000', width: 6, a: 1.7778, points: [{ xr: 0.4, yr: 0.5 }, { xr: 0.5, yr: 0.5 }, { xr: 0.6, yr: 0.5 }] }],
      })));
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => window.Reveal.slide(1));
      await p2.waitForTimeout(500);
      const b = await p2.locator('#aht-canvas').boundingBox();
      assert(colored(await pixel(p2, b.width / 2, b.height / 2)), 'migrated ink not shown on its slide');
      // the next edit upgrades the stored format to the v1 envelope with content keys
      await p2.keyboard.press('a');
      await p2.waitForTimeout(200);
      await draw(p2, [[100, 100], [140, 140]]);
      const up = await p2.evaluate(() => JSON.parse(localStorage.getItem('aht:test-keys')));
      assert(up && up.v === 1 && Object.keys(up.strokes).some((k) => k.indexOf('c:') === 0),
        'storage not upgraded: ' + JSON.stringify(up).slice(0, 100));
      await p2.evaluate(() => localStorage.removeItem('aht:test-keys'));
      await p2.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G12 embedded baseline, save & PDF ink ===`);
    await test('deck-embedded baseline: ink + board slide appear on a cold load', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(EMBED, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      const t = await p2.evaluate(() => ({
        boards: document.querySelectorAll('[data-aht-board]').length,
        counter: document.getElementById('aht-slideno').textContent,
      }));
      assert(t.boards === 1, 'embedded board not materialized');
      assert(t.counter === '1 / 2', 'board wrongly counted: ' + t.counter);
      const b = await p2.locator('#aht-canvas').boundingBox();
      assert(colored(await pixel(p2, b.width / 2, b.height / 2)), 'embedded ink not rendered');
      await shot(p2, 'g12-embed-baseline');
      await p2.close();
      CURPAGE = page;
    });
    await test('?aht-ink=0 presents clean without deleting anything', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(EMBED + '?aht-ink=0', { waitUntil: 'networkidle' });
      await waitReady(p2);
      assert(await p2.evaluate(() => document.querySelectorAll('[data-aht-board]').length === 0), 'clean mode still shows boards');
      const b = await p2.locator('#aht-canvas').boundingBox();
      assert(!colored(await pixel(p2, b.width / 2, b.height / 2)), 'clean mode still shows ink');
      await p2.close();
      CURPAGE = page;
    });
    await test('confirmed clear-all suppresses the embedded baseline across reloads', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(EMBED, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.keyboard.press('a');
      await p2.keyboard.press('Shift+X');
      await p2.waitForTimeout(200);
      await p2.locator('#aht-confirm .aht-ok').click();
      await p2.waitForTimeout(400);
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      assert(await p2.evaluate(() => document.querySelectorAll('[data-aht-board]').length === 0), 'baseline board resurrected after clear-all');
      const b = await p2.locator('#aht-canvas').boundingBox();
      assert(!colored(await pixel(p2, b.width / 2, b.height / 2)), 'baseline ink resurrected after clear-all');
      await p2.close();
      CURPAGE = page;
    });
    await test('export JSON / import JSON round-trip (import confirms before overwrite)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(EMBED, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());   // lift the tombstone → baseline is back
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.keyboard.press('a');
      await p2.waitForTimeout(300);
      const [dl] = await Promise.all([
        p2.waitForEvent('download', { timeout: 10000 }),
        p2.locator('#aht-export').click(),
      ]);
      const file = path.join(ART, `${label}-export.json`);
      await dl.saveAs(file);
      const env = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert(env.v === 1 && env.strokes['id:one'] && env.boards.length === 1, 'export content wrong: ' + JSON.stringify(env).slice(0, 100));
      await p2.evaluate(() => window.AutohideToolbar.clearAll());   // API path clears without dialog
      await p2.waitForTimeout(400);
      assert(await p2.evaluate(() => document.querySelectorAll('[data-aht-board]').length === 0), 'clearAll left the board');
      await p2.locator('#aht-bar input[type=file]').setInputFiles(file);
      await p2.waitForTimeout(700);
      // nothing to overwrite → no dialog; board + ink restored
      assert(await p2.evaluate(() => document.querySelectorAll('[data-aht-board]').length === 1), 'import did not restore the board');
      const b = await p2.locator('#aht-canvas').boundingBox();
      assert(colored(await pixel(p2, b.width / 2, b.height / 2)), 'import did not restore the ink');
      // importing over EXISTING ink must ask first
      await p2.locator('#aht-bar input[type=file]').setInputFiles(file);
      await p2.waitForTimeout(400);
      assert(await p2.evaluate(() => !!document.getElementById('aht-confirm-wrap')), 'no confirmation on overwriting import');
      await p2.locator('#aht-confirm .aht-cancel').click();
      await p2.close();
      CURPAGE = page;
    });
    await test('save annotated copy: downloaded HTML embeds the ink, source intact', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.keyboard.press('a');
      await p2.waitForTimeout(200);
      await draw(p2, [[300, 300], [500, 300]]);
      const [dl] = await Promise.all([
        p2.waitForEvent('download', { timeout: 10000 }),
        p2.locator('#aht-savecopy').click(),
      ]);
      const file = path.join(ART, `${label}-annotated.html`);
      await dl.saveAs(file);
      const html = fs.readFileSync(file, 'utf8');
      assert(/data-aht-annotations/.test(html), 'no embedded annotations block');
      assert(html.includes('"v":1') && html.includes('points'), 'ink missing from the saved copy');
      assert(html.includes('Format-change test'), 'deck source content missing from the copy');
      assert(!html.includes('id="aht-toolbar"'), 'live plugin DOM leaked into the copy');
      await p2.close();
      CURPAGE = page;
    });
    await test('?print-pdf renders embedded ink as SVG and the board as a page', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(EMBED, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());   // baseline again
      await p2.goto(EMBED + '?print-pdf', { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.waitForTimeout(1500);
      const t = await p2.evaluate(() => ({
        ui: !!document.getElementById('aht-canvas') || !!document.getElementById('aht-toolbar'),
        boards: document.querySelectorAll('[data-aht-board]').length,
        svgs: document.querySelectorAll('.aht-print-ink').length,
        strokes: document.querySelectorAll('.aht-print-ink path, .aht-print-ink circle').length,
        pages: document.querySelectorAll('.pdf-page').length,
      }));
      assert(!t.ui, 'plugin UI present in print view');
      assert(t.boards === 1, 'board slide missing in print: ' + JSON.stringify(t));
      assert(t.svgs === 2 && t.strokes === 2, 'SVG ink wrong: ' + JSON.stringify(t));
      assert(t.pages >= 3, 'expected 3+ pdf pages, got ' + t.pages);
      await shot(p2, 'g12-print-ink');
      await p2.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G9 real-world decks (vendored from hakimel/reveal.js) ===`);
    for (const deck of DECKS) {
      await test(`deck "${deck.name}": plugin alive, counter, nav, ink, no errors`, async () => {
        const errs = [];
        const p2 = await ctx.newPage();
        CURPAGE = p2;
        trackErrors(p2, errs);
        await p2.goto(`${BASE}/test/decks/${deck.file}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitReady(p2);
        await p2.waitForTimeout(1000);
        const t = await p2.evaluate(() => ({
          toolbar: !!document.getElementById('aht-toolbar'),
          canvas: !!document.getElementById('aht-canvas'),
          counter: (document.getElementById('aht-slideno') || {}).textContent || '',
          total: window.Reveal.getTotalSlides(),
        }));
        assert(t.toolbar && t.canvas, 'plugin UI missing: ' + JSON.stringify(t));
        assert(t.counter === `1 / ${t.total}`, `counter=${t.counter}, reveal total=${t.total}`);
        await p2.keyboard.press('ArrowRight');
        await p2.waitForTimeout(700);
        const i = await p2.evaluate(() => window.Reveal.getIndices());
        assert(i.h > 0 || i.v > 0 || i.f >= 0, 'ArrowRight did not navigate: ' + JSON.stringify(i));
        await p2.evaluate(() => window.AutohideToolbar.enable(true));
        await p2.waitForTimeout(300);
        const b = await canvasBox(p2);
        await draw(p2, [[b.width * 0.4, b.height * 0.5], [b.width * 0.6, b.height * 0.5]]);
        assert(colored(await pixel(p2, b.width * 0.5, b.height * 0.5)), 'ink did not draw on this deck');
        await p2.evaluate(() => window.AutohideToolbar.enable(false));
        await shot(p2, `g9-${deck.file.replace('.html', '')}`);
        // third-party network failures (logos, embeds, MathJax CDN) are not our
        // bugs — only errors from our own origin or the page itself are fatal
        const fatal = errs.filter((e) => !(deck.noisy && deck.noisy.test(e))
          && !/^reqfail: https?:\/\/(?!127\.0\.0\.1)/.test(e));
        assert(fatal.length === 0, fatal.join(' | ').slice(0, 300));
        await p2.close();
        CURPAGE = page;
      });
    }
    await test('official demo ?print-pdf: fragment-cloned pages get SVG ink, no UI', async () => {
      // the ink drawn in the previous test is in storage — the demo deck has
      // fragments, so this exercises the clone-key re-derivation in print view
      const errs = [];
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      trackErrors(p2, errs);
      await p2.goto(`${BASE}/test/decks/demo.html?print-pdf`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p2);
      await p2.waitForTimeout(2000);
      const t = await p2.evaluate(() => ({
        ui: !!document.getElementById('aht-canvas') || !!document.getElementById('aht-toolbar'),
        pages: document.querySelectorAll('.pdf-page').length,
        svgs: document.querySelectorAll('.aht-print-ink').length,
      }));
      assert(!t.ui, 'plugin UI present in print view');
      assert(t.pages > 10, 'suspiciously few pdf pages: ' + t.pages);
      assert(t.svgs >= 1, 'no SVG ink in print view: ' + JSON.stringify(t));
      await shot(p2, 'g9-demo-print');
      // print view loads EVERY slide's lazy content incl. third-party iframes
      const fatal = errs.filter((e) => !/slid\.es/i.test(e)
        && !/^reqfail: https?:\/\/(?!127\.0\.0\.1)/.test(e));
      assert(fatal.length === 0, fatal.join(' | ').slice(0, 300));
      await p2.close();
      CURPAGE = page;
    });
  } finally {
    CURPAGE = null;
    await browser.close().catch(() => {});
  }
}

// ---------- static server with reveal-version rewriting ----------
// Serves the plugin dir; every HTML page gets its pinned reveal.js CDN version
// replaced with the current matrix target. reveal 6 moved the plugin files
// (plugin/<name>/<name>.js → dist/plugin/<name>.js), so paths are normalized
// per target — fixtures may pin either style.
let serveVersion = VERSIONS[0];
function rewriteReveal(html, version) {
  let out = html.replace(/reveal\.js@\d+\.\d+\.\d+/g, 'reveal.js@' + version);
  if (/^[6-9]\./.test(version)) {
    out = out
      .replace(/(reveal\.js@[^"']+\/)plugin\/([a-z]+)\/\2\.js/g, '$1dist/plugin/$2.js')
      .replace(/(reveal\.js@[^"']+\/)plugin\/(highlight\/[a-z-]+\.css)/g, '$1dist/plugin/$2');
  } else {
    out = out
      .replace(/(reveal\.js@[^"']+\/)dist\/plugin\/([a-z]+)\.js/g, '$1plugin/$2/$2.js')
      .replace(/(reveal\.js@[^"']+\/)dist\/plugin\/(highlight\/[a-z-]+\.css)/g, '$1plugin/$2');
  }
  return out;
}
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(PLUGIN, path.normalize(p));
    if (!file.startsWith(PLUGIN) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');   // rewritten HTML must never leak across matrix runs
    if (ext === '.html') res.end(rewriteReveal(fs.readFileSync(file, 'utf8'), serveVersion));
    else res.end(fs.readFileSync(file));
  } catch (e) {
    res.writeHead(500); res.end();
  }
});

// ---------- main ----------
try {
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  for (const version of VERSIONS) {
    serveVersion = version;
    await runSuite(chromium, `chromium@${version}`);
    await runSuite(webkit, `webkit@${version}`);
  }
} catch (e) {
  results.push({ name: `[${CUR}] FATAL (suite aborted)`, ok: false, error: String(e && e.message || e).split('\n')[0] });
  log('FATAL: ' + String(e && e.message || e).split('\n')[0]);
} finally {
  server.close();
}

// ---------- summary ----------
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
log('');
log(`==== SUMMARY: ${pass}/${results.length} passed, ${fail} failed ====`);
for (const r of results.filter((r) => !r.ok)) log(`  ✗ ${r.name}\n    ${r.error}`);
fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(ART, 'results.log'), logLines.join('\n') + '\n');
log(`Artifacts: ${ART}`);
process.exitCode = fail ? 1 : 0;
