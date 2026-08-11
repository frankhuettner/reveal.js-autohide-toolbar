/*
 * Comprehensive Playwright test suite for reveal.js-autohide-toolbar.
 * Runs the full suite as a MATRIX: {Chromium, WebKit} × {reveal 5.x, 6.x}.
 *
 * Run OUTSIDE the sandbox (a normal terminal), from anywhere:
 *   node reveal.js-autohide-toolbar/test/run-tests.mjs
 *
 * - The four matrix combos run as PARALLEL worker processes, one static server
 *   and port each (8036–8039) — wall clock ≈ the slowest combo. On a TTY the
 *   parent shows one sticky progress bar per combo and prints failures the
 *   moment they happen (AHT_BARS=1/0 forces bars on/off); without a TTY it
 *   streams every line, interleaved (each carries its [engine@version]).
 *   results.log always holds the FULL log, regrouped per combo in matrix
 *   order. AHT_SERIAL=1 restores the sequential single-process run (handy
 *   for headed debugging).
 * - Each worker spawns its own static server (plugin dir) — fully self-contained.
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
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(__dirname, '..');
const ART = path.join(__dirname, 'artifacts');
if (!process.env.AHT_COMBO) fs.rmSync(ART, { recursive: true, force: true });  // workers write into the parent's fresh dir
fs.mkdirSync(ART, { recursive: true });

const require = createRequire(import.meta.url);
// Each playwright-<engine> wrapper costs ~100 ms and ~90 MB RSS to require —
// load one only when THIS process launches browsers (worker/serial mode); the
// parent just spawns workers and draws bars. Both packages re-export the same
// devices registry, so it's picked up alongside whichever engine loads.
let devices;
function loadEngine(engine) {
  const pw = require('playwright-' + engine);
  devices = pw.devices;
  return pw[engine];
}

// The reveal.js versions of the test matrix: last 5.x (the pin the fixtures
// carry) and current 6.x. The server rewrites served HTML to each target.
const VERSIONS = ['5.2.1', '6.0.1'];

const PORT = Number(process.env.AHT_PORT || 8036);
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
// one line per result — the parent's progress bars parse EXACTLY these prefixes
const P_PASS = '  PASS  ', P_FAIL = '  FAIL  ', P_ERR = ' '.repeat(8), P_FATAL = 'FATAL: ';
async function test(name, fn) {
  const full = `[${CUR}] ${name}`;
  try {
    await fn();
    results.push({ name: full, ok: true });
    log(P_PASS + full);
  } catch (e) {
    const err = String(e && e.message || e);
    results.push({ name: full, ok: false, error: err });
    log(P_FAIL + full + '\n' + P_ERR + err.split('\n')[0]);
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
// hover the bottom-left corner so the auto-hidden toolbar chrome wakes
async function wake(page) {
  await page.mouse.move(60, page.viewportSize().height - 30);
  await page.waitForTimeout(250);
}
// index of the first top-level slide containing a match (structure-independent)
const slideIndexWith = (page, sel) => page.evaluate((q) => Array.prototype.findIndex.call(
  document.querySelectorAll('.reveal .slides > section'), (s) => s.querySelector(q)), sel);
// wake the toolbar, then open the download/print menu
async function openExportMenu(page) {
  await wake(page);
  await page.locator('#aht-export').click();
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => !!document.getElementById('aht-export-menu')), 'export menu did not open');
}
// open the export menu, click "Save portable copy", save the download as ART/<name>
async function downloadPortable(page, name) {
  await openExportMenu(page);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('#aht-export-menu .aht-export-item:has-text("Save portable copy")').click(),
  ]);
  const file = path.join(ART, name);
  await dl.saveAs(file);
  return { dl, file };
}
// turn on annotation + the Text tool, click the overlay at (x,y) to drop a box,
// type into it (does NOT commit — caller presses Escape or clicks away);
// the text layer is placed to the exact same rect as the canvas
async function typeAt(page, x, y, text) {
  await page.evaluate(() => { window.AutohideToolbar.enable(true); window.AutohideToolbar.setTool('text'); });
  await page.waitForTimeout(100);
  const b = await canvasBox(page);
  await page.mouse.click(b.x + x, b.y + y);
  await page.waitForTimeout(120);
  if (text) await page.keyboard.type(text);
  await page.waitForTimeout(120);
}
const textItems = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('#aht-text-layer .aht-text-item .aht-text-edit'), (e) => e.textContent));

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
    await test('toolbar has default buttons + slide counter matches reveal', async () => {
      const t = await page.evaluate(() => ({
        btns: document.querySelectorAll('#aht-toolbar .aht-btn').length,
        no: document.getElementById('aht-slideno').textContent,
        total: window.Reveal.getTotalSlides(),
      }));
      assert(t.btns === 9, 'expected 9 buttons (incl. up/down cluster + export), got ' + t.btns);
      assert(t.total > 1 && t.no === `1 / ${t.total}`, `counter: ${t.no} vs reveal total ${t.total}`);
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
      await wake(page);
      assert(await chromeOn(page), 'not shown in corner');
      await shot(page, 'g2-toolbar-visible');
      const vp = page.viewportSize();
      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(700);
      assert(!(await chromeOn(page)), 'not hidden after leaving');
    });
    await test('next/prev buttons navigate and update counter', async () => {
      await wake(page);
      await page.locator('#aht-toolbar .aht-btn[aria-label^="Next"]').click();
      await page.waitForTimeout(600);
      assert((await indices(page)).h === 1, 'next did not advance');
      const no = await page.locator('#aht-slideno').textContent();
      const total = await page.evaluate(() => window.Reveal.getTotalSlides());
      assert(no === `2 / ${total}`, 'counter after next: ' + no);
      await page.locator('#aht-toolbar .aht-btn[aria-label^="Previous"]').click();
      await page.waitForTimeout(600);
      assert((await indices(page)).h === 0, 'prev did not go back');
    });
    await test('vertical nav cluster: gone without routes, appears on stacks, navigates', async () => {
      // slide 0 has no vertical routes → the cluster is REMOVED, not greyed out
      assert(await page.evaluate(() => document.getElementById('aht-updown').hidden),
        'cluster shown on a slide without vertical routes');
      const stack = await slideIndexWith(page, 'section');
      assert(stack >= 0, 'no vertical stack found in the demo');
      await page.evaluate((i) => window.Reveal.slide(i), stack);
      await page.waitForTimeout(500);
      const t = await page.evaluate(() => ({
        hidden: document.getElementById('aht-updown').hidden,
        upDim: document.getElementById('aht-up').classList.contains('dim'),
        downDim: document.getElementById('aht-down').classList.contains('dim'),
      }));
      assert(!t.hidden, 'cluster not shown on top of a stack');
      assert(t.upDim && !t.downDim, 'wrong dim state on stack top: ' + JSON.stringify(t));
      await wake(page);
      await page.locator('#aht-down').click();
      await page.waitForTimeout(500);
      assert((await indices(page)).v === 1, 'down button did not descend');
      await page.locator('#aht-up').click();
      await page.waitForTimeout(500);
      assert((await indices(page)).v === 0, 'up button did not ascend');
      await page.evaluate(() => window.Reveal.slide(0));
      await page.waitForTimeout(400);
      assert(await page.evaluate(() => document.getElementById('aht-updown').hidden),
        'cluster did not disappear again after leaving the stack');
    });
    await test('overview button toggles overview and hides canvas', async () => {
      await page.locator('#aht-toolbar .aht-btn[aria-label^="Slide overview"]').click();
      await page.waitForTimeout(500);
      assert(await page.evaluate(() => window.Reveal.isOverview()), 'overview not on');
      assert(await page.evaluate(() => document.getElementById('aht-canvas').style.display === 'none'), 'canvas not hidden in overview');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      assert(!(await page.evaluate(() => window.Reveal.isOverview())), 'overview not off');
    });
    await test('speaker-view button opens the notes window', async () => {
      await wake(page);
      const [popup] = await Promise.all([
        ctx.waitForEvent('page', { timeout: 8000 }),
        page.locator('#aht-toolbar .aht-btn[aria-label^="Speaker view"]').click(),
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
    await test('Ctrl+Shift+Z redoes the undone stroke', async () => {
      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(200);
      assert(colored(await pixel(page, 400, 500)), 'redo did not restore the stroke');
      await page.keyboard.press('Control+z');   // back to the undone state for the next tests
      await page.waitForTimeout(200);
      assert(!colored(await pixel(page, 400, 500)), 'second undo failed after redo');
    });
    await test('color swatch changes pen color', async () => {
      await page.locator('#aht-bar .aht-swatch[data-color="#1D4ED8"]').click();
      await draw(page, [[300, 520], [500, 520]]);
      const px = await pixel(page, 400, 520);
      assert(px[2] > 120 && px[0] < 90, 'not blue: ' + px);
    });
    await test('X clears this slide; Esc exits annotation', async () => {
      await page.locator('#aht-bar .aht-swatch[data-color="#B91C1C"]').click();
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
      const closeBox = await page.locator('#aht-bar button[aria-label*="Exit"]').boundingBox();
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
      // A third-party CDN asset that fails to load (e.g. the Caveat web font from
      // Google Fonts) is not the plugin's bug — the deck tests below apply the same
      // policy. Every sub-resource of this demo is a CDN URL, so such a failure and
      // its generic "Failed to load resource" console line are always external;
      // real plugin/page errors surface as a pageerror or a console line with content.
      const fatal = errs.filter((e) =>
        !/^reqfail: https?:\/\/(?!127\.0\.0\.1)/.test(e) &&
        !/^console: Failed to load resource/i.test(e));
      assert(fatal.length === 0, fatal.join(' | '));
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
      const btnSlide = await slideIndexWith(p2, 'button');
      assert(btnSlide >= 0, 'no slide with a <button> found');
      await p2.evaluate((i) => window.Reveal.slide(i), btnSlide);
      await p2.waitForTimeout(700);
      const btn = await p2.locator('section.present button').first().boundingBox();
      assert(btn, 'button not found on its slide');
      await p2.touchscreen.tap(btn.x + btn.width / 2, btn.y + btn.height / 2);
      await p2.waitForTimeout(700);
      assert((await indices(p2)).h === btnSlide, 'tap on <button> wrongly navigated');
      assert(errs.length === 0, errs.join(' | '));
      await mob.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G10 board slides ===`);
    await test('board button inserts an uncounted WHITE board, slide-box canvas, auto-pen', async () => {
      await page.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(page);
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'networkidle' });
      await waitReady(page);
      await page.evaluate(() => window.Reveal.slide(0));
      await page.waitForTimeout(400);
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      await page.locator('#aht-bar .aht-swatch[data-color="#FFFFFF"]').click();  // must auto-darken on the white board
      await page.locator('#aht-board').click();
      await page.waitForTimeout(600);
      const t = await page.evaluate(() => {
        const sec = window.Reveal.getCurrentSlide();
        // DOMRects serialize as {} across the evaluate boundary — copy fields
        const R = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
        const slides = R(document.querySelector('.reveal .slides').getBoundingClientRect());
        const cv = R(document.getElementById('aht-canvas').getBoundingClientRect());
        const sr = R(sec.getBoundingClientRect());
        return {
          boards: document.querySelectorAll('[data-aht-board]').length,
          onBoard: !!sec.getAttribute('data-aht-board'),
          uncounted: sec.getAttribute('data-visibility') === 'uncounted',
          surface: sec.getAttribute('data-aht-surface'),
          surfaceColor: getComputedStyle(sec).backgroundColor,
          active: document.getElementById('aht-canvas').classList.contains('active'),
          counter: document.getElementById('aht-slideno').textContent,
          total: window.Reveal.getTotalSlides(),
          swatch: document.querySelector('#aht-bar .aht-swatch.active').getAttribute('data-color'),
          surfaceShown: !document.getElementById('aht-surface').hidden,
          mode: document.getElementById('aht-board').dataset.mode,
          slides, cv, sr,
          vpH: window.innerHeight,
        };
      });
      assert(t.boards === 1, 'boards=' + t.boards);
      assert(t.onBoard && t.uncounted && t.active, JSON.stringify(t));
      assert(t.surface === 'white', 'new board not white by default: ' + t.surface);
      assert(t.surfaceColor === 'rgb(255, 255, 255)', 'board surface not painted white: ' + t.surfaceColor);
      assert(t.counter === `1 / ${t.total}`, `board must not shift the count: ${t.counter} vs ${t.total}`);
      assert(t.swatch === '#000000', 'light pen not auto-darkened on white board: ' + t.swatch);
      assert(t.surfaceShown, 'surface toggle not shown on a board');
      assert(t.mode === 'remove', 'board button not in remove mode on a board');
      // boards keep the deck's slide format: canvas AND surface = the slide
      // box, NOT the viewport (at 1280×800 the 16:9 box is 1280×720, so the
      // heights genuinely differ)
      assert(t.slides.height < t.vpH - 10, 'fixture cannot distinguish box from viewport');
      for (const k of ['left', 'top', 'width', 'height']) {
        approx(t.cv[k], t.slides[k], 2, `board canvas ${k} off the slide box`);
        approx(t.sr[k], t.slides[k], 2, `board surface ${k} off the slide box`);
      }
      await shot(page, 'g10-board');
    });
    await test('surface toggle flips white/dark; pen contrast follows', async () => {
      await page.locator('#aht-surface').click();   // white → dark
      await page.waitForTimeout(400);
      const t = await page.evaluate(() => ({
        surface: window.Reveal.getCurrentSlide().getAttribute('data-aht-surface'),
        bg: getComputedStyle(window.Reveal.getCurrentSlide()).backgroundColor,
        swatch: document.querySelector('#aht-bar .aht-swatch.active').getAttribute('data-color'),
      }));
      assert(t.surface === 'dark' && t.bg === 'rgb(0, 0, 0)', 'board not dark after toggle: ' + t.surface + ' / ' + t.bg);
      assert(t.swatch === '#FFFFFF', 'dark pen not auto-brightened: ' + t.swatch);
      await shot(page, 'g10-blackboard');
      await page.locator('#aht-surface').click();   // back to white
      await page.waitForTimeout(400);
      const sw = await page.evaluate(() => document.querySelector('#aht-bar .aht-swatch.active').getAttribute('data-color'));
      assert(sw === '#000000', 'flip back to white did not re-darken the pen: ' + sw);
    });
    await test('board ink persists: reload restores the board slide and its ink', async () => {
      await draw(page, [[300, 300], [500, 300]]);
      assert(colored(await pixel(page, 400, 300)), 'no ink on the board');
      // the slide box is the board — drawing works right up to its left edge
      await draw(page, [[15, 400], [80, 400]]);
      assert(colored(await pixel(page, 45, 400)), 'no ink at the box edge (dead margin?)');
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
        updownHidden: document.getElementById('aht-updown').hidden,
      }));
      assert(t.boards === 1, 'embedded board not materialized');
      assert(t.counter === '1 / 2', 'board wrongly counted: ' + t.counter);
      assert(t.updownHidden, 'up/down cluster shown although the deck has no vertical slides');
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
      // the export menu shrinks to the two clean choices (no ink to embed/print)
      await openExportMenu(p2);
      const items = await p2.evaluate(() => document.querySelectorAll('#aht-export-menu .aht-export-item').length);
      assert(items === 2, 'clean-mode menu should offer 2 choices, got ' + items);
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
    await test('export menu: toolbar button opens 4 choices, Esc closes', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await openExportMenu(p2);
      const t = await p2.evaluate(() => ({
        items: Array.from(document.querySelectorAll('#aht-export-menu .aht-export-item'), (b) => b.textContent),
        hint: !!document.querySelector('#aht-export-menu .aht-export-hint'),
      }));
      assert(t.items.length === 4 && t.hint, 'menu content wrong: ' + JSON.stringify(t));
      await shot(p2, 'g12-export-menu');
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(150);
      assert(await p2.evaluate(() => !document.getElementById('aht-export-menu')), 'Esc did not close the menu');
      // Esc was swallowed by the menu — reveal must NOT be in overview now
      assert(await p2.evaluate(() => !window.Reveal.isOverview()), 'Esc leaked to reveal (overview opened)');
      await p2.close();
      CURPAGE = page;
    });
    await test('save portable copy: bakes ink as SVG (no JSON block), revives from file://', async () => {
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
      await p2.keyboard.press('Escape');   // leave annotation, then export via menu
      await p2.waitForTimeout(200);
      const { dl, file } = await downloadPortable(p2, `${label}-portable.html`);
      assert(/-portable\.html$/.test(dl.suggestedFilename()), 'unexpected filename: ' + dl.suggestedFilename());
      const html = fs.readFileSync(file, 'utf8');
      // ink is baked as a static inline SVG with a proper root, not a JSON block
      assert(/<svg[^>]+data-aht-ink/i.test(html), 'no baked ink SVG in the portable copy');
      assert(/<path[^>]+data-aht-a/i.test(html) || /<circle[^>]+data-aht-a/i.test(html), 'baked ink path/circle missing');
      assert(/viewBox=/.test(html) && /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(html), 'baked SVG missing root attrs');
      assert(!/<script[^>]+data-aht-annotations/i.test(html), 'portable copy should not carry a JSON annotations block');
      assert(html.includes('github.com/frankhuettner/reveal.js-autohide-toolbar'), 'deck source content missing from the copy');
      assert(!html.includes('id="aht-toolbar"'), 'live plugin DOM leaked into the copy');
      // self-contained: the plugin source is inlined, no relative script left
      assert(html.includes('window.RevealAutohideToolbar'), 'plugin source not inlined into the copy');
      assert(!/<script[^>]+src=["'][^"']*reveal-autohide-toolbar/i.test(html), 'copy still references the plugin by src');
      await p2.close();
      // the point of the copy: it must open ANYWHERE — from file:// included
      // (regression: a relative plugin src used to yield a blank white page)
      const p3 = await ctx.newPage();
      CURPAGE = p3;
      await p3.goto('file://' + file, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p3);
      await p3.evaluate(() => window.Reveal.slide(0));
      await p3.waitForTimeout(600);
      assert(await p3.evaluate(() => !!document.getElementById('aht-toolbar')), 'plugin not alive in the file:// copy');
      // auto-revive: the baked wrapper is parsed into the model and stripped, ink
      // ends up drawn on the canvas
      assert(await p3.evaluate(() => document.querySelectorAll('[data-aht-flat]').length === 0), 'flat wrapper not stripped on revive');
      assert(colored(await pixel(p3, 400, 300)), 'portable copy did not revive its ink onto the canvas');
      await p3.close();
      CURPAGE = page;
    });
    await test('highlighter round-trips: baked with opacity + data-aht-hl, revives translucent', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => { window.AutohideToolbar.enable(true); window.AutohideToolbar.setTool('highlighter'); });
      await p2.waitForTimeout(150);
      await draw(p2, [[300, 300], [500, 300]]);
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(200);
      const { file } = await downloadPortable(p2, `${label}-portable-hl.html`);
      const html = fs.readFileSync(file, 'utf8');
      // the marker bakes as an opacity-carrying, hl-tagged path inside the ink SVG
      assert(/<svg[^>]+data-aht-ink/i.test(html), 'no baked ink SVG in the highlighter copy');
      assert(/<path[^>]+data-aht-hl="1"/i.test(html) || /data-aht-hl="1"[^>]*\/?>/i.test(html), 'highlighter path not tagged data-aht-hl');
      assert(/stroke-opacity=/i.test(html), 'highlighter path baked without stroke-opacity');
      await p2.close();
      // reopen the copy: it revives as a translucent stroke (present but not opaque)
      const p3 = await ctx.newPage();
      CURPAGE = p3;
      await p3.goto('file://' + file, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p3);
      await p3.evaluate(() => window.Reveal.slide(0));
      await p3.waitForTimeout(600);
      // translucent on revive = it came back a highlighter, not a plain (opaque) pen stroke
      const band = await pixel(p3, 400, 300);
      assert(band[3] > 40 && band[3] < 170, 'revived highlighter is not translucent (alpha ' + band[3] + ')');
      await p3.close();
      CURPAGE = page;
    });
    await test('save clean copy: strips the embedded block, plugin still inlined', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      // the embed fixture SHIPS an annotations block in its source — the clean
      // copy must shed exactly that
      await p2.goto(EMBED, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await openExportMenu(p2);
      const [dl] = await Promise.all([
        p2.waitForEvent('download', { timeout: 10000 }),
        p2.locator('#aht-export-menu .aht-export-item:has-text("Save a copy")').click(),
      ]);
      assert(/-copy\.html$/.test(dl.suggestedFilename()), 'unexpected filename: ' + dl.suggestedFilename());
      const file = path.join(ART, `${label}-clean-copy.html`);
      await dl.saveAs(file);
      const html = fs.readFileSync(file, 'utf8');
      assert(!/<script[^>]+data-aht-annotations/i.test(html), 'clean copy still contains an annotations block');
      assert(html.includes('window.RevealAutohideToolbar'), 'plugin source not inlined into the clean copy');
      assert(!/<script[^>]+src=["'][^"']*reveal-autohide-toolbar/i.test(html), 'clean copy still references the plugin by src');
      await p2.close();
      CURPAGE = page;
    });
    await test('menu PDF items open the print view; aht-print pops the dialog', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await openExportMenu(p2);
      const [pop] = await Promise.all([
        p2.waitForEvent('popup', { timeout: 10000 }),
        p2.locator('#aht-export-menu .aht-export-item:has-text("PDF / print with ink")').click(),
      ]);
      // wait for the REAL document (not a transient about:blank), then stub the
      // dialog long before the plugin's pdf-ready + settle delay fires
      await pop.waitForURL(/print-pdf/, { waitUntil: 'domcontentloaded' });
      await pop.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
      const url = pop.url();
      assert(/print-pdf/.test(url) && /aht-print=1/.test(url) && !/aht-ink=0/.test(url), 'with-ink print URL wrong: ' + url);
      await pop.waitForFunction(() => window.__printed > 0, null, { timeout: 30000 });
      await pop.close();
      await openExportMenu(p2);
      const [pop2] = await Promise.all([
        p2.waitForEvent('popup', { timeout: 10000 }),
        p2.locator('#aht-export-menu .aht-export-item:has-text("PDF / print clean")').click(),
      ]);
      await pop2.waitForURL(/print-pdf/, { waitUntil: 'domcontentloaded' });
      const url2 = pop2.url();
      assert(/print-pdf/.test(url2) && /aht-ink=0/.test(url2), 'clean print URL wrong: ' + url2);
      await pop2.close();
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
      // regression: ink must be anchored to the .pdf-page at the slide box
      // (page − slide)/2 — anchored to the SECTION it sat too low on short
      // slides (reveal centres sections by content height) and got clipped
      const geo = await p2.evaluate(() => {
        const svg = document.querySelector('.aht-print-ink');
        const page = svg.closest('.pdf-page');
        const sr = svg.getBoundingClientRect(), pr = page.getBoundingClientRect();
        return { inPage: svg.parentElement === page,
          dx: sr.left - pr.left, dy: sr.top - pr.top,
          gx: (pr.width - sr.width) / 2, gy: (pr.height - sr.height) / 2 };
      });
      assert(geo.inPage, 'print ink not attached to its .pdf-page');
      approx(geo.dx, geo.gx, 3, 'print ink not centred horizontally in its page');
      approx(geo.dy, geo.gy, 3, 'print ink not centred vertically in its page');
      await shot(p2, 'g12-print-ink');
      await p2.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G13 typed text + flatten/revive ===`);
    await test('text tool: create, type, commit — a box persists across reload', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 260, 220, 'Hello world');
      await p2.keyboard.press('Escape');   // commit (leaves the box, still exits edit)
      await p2.waitForTimeout(150);
      let items = await textItems(p2);
      assert(items.length === 1 && items[0] === 'Hello world', 'text not created/committed: ' + JSON.stringify(items));
      // persists (localStorage) and re-renders on a cold load, no annotation needed
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      items = await textItems(p2);
      assert(items.length === 1 && items[0] === 'Hello world', 'text did not persist across reload: ' + JSON.stringify(items));
      await shot(p2, 'g13-text');
      await p2.close();
      CURPAGE = page;
    });
    await test('typing e/x/a into a box types literally (tool keys are swallowed)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 300, 260, 'exam');
      // still editing → the deck must not have toggled eraser/clear/etc.
      const t = await p2.evaluate(() => ({
        editing: !!window.getSelection && document.activeElement && document.activeElement.isContentEditable,
        boards: document.querySelectorAll('[data-aht-board]').length,
      }));
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(120);
      const items = await textItems(p2);
      assert(items.length === 1 && items[0] === 'exam', 'literal typing failed: ' + JSON.stringify(items));
      assert(t.boards === 0, 'a tool key leaked to the deck while typing');
      await p2.close();
      CURPAGE = page;
    });
    await test('empty box is discarded; × deletes; undo/redo restore text', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      // empty box, click away → discarded
      await typeAt(p2, 200, 200, '');
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(120);
      assert((await textItems(p2)).length === 0, 'empty box was not discarded');
      // create one, then delete via the × while editing (tools are visible)
      await typeAt(p2, 300, 300, 'Zap');
      await p2.locator('#aht-text-layer .aht-text-item.editing .aht-text-del').click();
      await p2.waitForTimeout(120);
      assert((await textItems(p2)).length === 0, '× did not delete the box');
      // undo brings it back, redo removes it again
      await p2.evaluate(() => window.AutohideToolbar.undo());
      await p2.waitForTimeout(120);
      assert(JSON.stringify(await textItems(p2)) === JSON.stringify(['Zap']), 'undo did not restore the text');
      await p2.evaluate(() => window.AutohideToolbar.redo());
      await p2.waitForTimeout(120);
      assert((await textItems(p2)).length === 0, 'redo did not re-delete the text');
      await p2.close();
      CURPAGE = page;
    });
    await test('clear-slide (X) removes text as well as ink', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 320, 300, 'Gone');
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(120);
      // draw some ink too, then clear the slide
      await p2.evaluate(() => window.AutohideToolbar.setTool('pen'));
      await draw(p2, [[300, 340], [520, 340]]);
      await p2.evaluate(() => window.AutohideToolbar.clearSlide());
      await p2.waitForTimeout(150);
      assert((await textItems(p2)).length === 0, 'clear-slide left text behind');
      assert(await inkCount(p2) < 20, 'clear-slide left ink behind');
      await p2.close();
      CURPAGE = page;
    });
    await test('portable copy bakes text as editable HTML (not vectorized) + revives', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 280, 240, 'Key takeaway');
      await p2.keyboard.press('Escape');
      // ink too, to prove both bake together
      await p2.evaluate(() => window.AutohideToolbar.setTool('pen'));
      await draw(p2, [[300, 360], [520, 360]]);
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(150);
      const { file } = await downloadPortable(p2, `${label}-portable-text.html`);
      const html = fs.readFileSync(file, 'utf8');
      // text is a real HTML element carrying the words as text content — NOT an
      // <svg><text> and NOT inside a <script>
      assert(/<div[^>]+class="aht-text"[^>]*>Key takeaway<\/div>/i.test(html)
        || /<div[^>]+data-aht-text[^>]*>Key takeaway<\/div>/i.test(html), 'text not baked as an editable HTML element: ' + (html.match(/aht-text[\s\S]{0,80}/) || [''])[0]);
      assert(!/<text[\s>]/i.test(html), 'text was vectorized to <text> (should stay HTML)');
      assert(/<svg[^>]+data-aht-ink/i.test(html), 'ink SVG missing from the copy');
      await p2.close();
      // reopen → text revived as an editable box on the right slide, wrapper gone
      const p3 = await ctx.newPage();
      CURPAGE = p3;
      await p3.goto('file://' + file, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p3);
      await p3.evaluate(() => window.Reveal.slide(0));
      await p3.waitForTimeout(500);
      const items = await textItems(p3);
      assert(items.length === 1 && items[0] === 'Key takeaway', 'text not revived: ' + JSON.stringify(items));
      assert(await p3.evaluate(() => document.querySelectorAll('[data-aht-flat]').length === 0), 'flat wrapper not stripped after revive');
      // and it's editable: switching to the text tool + clicking it enters an edit
      await p3.evaluate(() => { window.AutohideToolbar.enable(true); window.AutohideToolbar.setTool('text'); });
      await p3.locator('#aht-text-layer .aht-text-edit').click();
      await p3.waitForTimeout(150);
      assert(await p3.evaluate(() => !!(document.activeElement && document.activeElement.isContentEditable)), 'revived text is not editable');
      await p3.close();
      CURPAGE = page;
    });
    await test('portable copy displays WITHOUT the plugin (baked SVG + HTML are real content)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 300, 240, 'Standalone');
      await p2.keyboard.press('Escape');
      await p2.evaluate(() => window.AutohideToolbar.setTool('pen'));
      await draw(p2, [[300, 360], [520, 360]]);
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(150);
      const { file: src } = await downloadPortable(p2, `${label}-portable-src.html`);
      await p2.close();
      // neutralize the plugin: swap the inlined source for a no-op factory so
      // reveal still lays out the deck but nothing revives/strips the baked DOM
      let html = fs.readFileSync(src, 'utf8');
      const stub = '<script>window.RevealAutohideToolbar=function(){return{id:"autohide-toolbar",init:function(){},destroy:function(){}};};'
        + 'window.RevealAutohideToolbar.id="autohide-toolbar";window.RevealAutohideToolbar.init=function(){};window.RevealAutohideToolbar.destroy=function(){};</script>';
      html = html.replace(/<script>\/\* reveal\.js-autohide-toolbar \(inlined[\s\S]*?<\/script>/, stub);
      assert(html.includes(stub), 'could not neutralize the inlined plugin for the plugin-less test');
      const file = path.join(ART, `${label}-pluginless.html`);
      fs.writeFileSync(file, html);
      const p3 = await ctx.newPage();
      CURPAGE = p3;
      await p3.goto('file://' + file, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p3);
      await p3.evaluate(() => window.Reveal.slide(0));
      await p3.waitForTimeout(500);
      const t = await p3.evaluate(() => {
        const noPlugin = !document.getElementById('aht-canvas');
        const flat = document.querySelector('.reveal .slides section [data-aht-flat]');
        const txt = document.querySelector('.aht-text[data-aht-text]');
        const svg = document.querySelector('svg[data-aht-ink]');
        const tb = txt && txt.getBoundingClientRect();
        return {
          noPlugin, hasFlat: !!flat, txt: txt && txt.textContent, hasSvg: !!svg,
          visible: !!(tb && tb.width > 0 && tb.height > 0),
        };
      });
      assert(t.noPlugin, 'plugin stub failed — real plugin still ran');
      assert(t.hasFlat && t.hasSvg, 'baked annotation content missing without the plugin: ' + JSON.stringify(t));
      assert(t.txt === 'Standalone' && t.visible, 'baked text not rendered without the plugin: ' + JSON.stringify(t));
      await shot(p3, 'g13-pluginless');
      await p3.close();
      CURPAGE = page;
    });
    await test('flatten → revive → re-flatten keeps text identical and ink equivalent', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 280, 240, 'Round trip');
      await p2.keyboard.press('Escape');
      await p2.evaluate(() => window.AutohideToolbar.setTool('pen'));
      await draw(p2, [[300, 360], [420, 300], [520, 360]]);
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(150);
      const { file } = await downloadPortable(p2, `${label}-roundtrip.html`);
      await p2.close();
      const p3 = await ctx.newPage();
      CURPAGE = p3;
      await p3.goto('file://' + file, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p3);
      await p3.evaluate(() => window.Reveal.slide(0));
      await p3.waitForTimeout(500);
      const texts = await textItems(p3);
      assert(JSON.stringify(texts) === JSON.stringify(['Round trip']), 'text changed across round trip: ' + JSON.stringify(texts));
      await p3.close();
      CURPAGE = page;
    });
    await test('export menu still offers 4 choices; text tool present in the bar', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.keyboard.press('a');
      await p2.waitForTimeout(150);
      const hasText = await p2.evaluate(() => !!document.querySelector('#aht-bar [data-tool="text"]')
        && document.querySelectorAll('#aht-bar .aht-size').length >= 2);
      assert(hasText, 'text tool / size cluster missing from the bar');
      await p2.keyboard.press('Escape');
      await openExportMenu(p2);
      const items = await p2.evaluate(() => Array.from(document.querySelectorAll('#aht-export-menu .aht-export-item'), (b) => b.textContent.replace(/\s+/g, ' ').trim()));
      assert(items.length === 4, 'menu should have 4 items: ' + JSON.stringify(items));
      assert(items.some((s) => /portable/i.test(s)), 'no "Save portable copy" item: ' + JSON.stringify(items));
      await p2.close();
      CURPAGE = page;
    });

    log(`=== ${label} · G14 regression guards (confirmed code-review fixes) ===`);
    await test('undo while editing text reverts one step and redo restores it (no stale-stack wipe)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      // create and commit "A"
      await typeAt(p2, 300, 240, 'A');
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(120);
      assert(JSON.stringify(await textItems(p2)) === JSON.stringify(['A']), 'setup: "A" not committed');
      // re-open the SAME box and extend it to "A!" — leave it dirty & UNcommitted
      await p2.evaluate(() => window.AutohideToolbar.setTool('text'));
      await p2.locator('#aht-text-layer .aht-text-edit').click();
      await p2.waitForTimeout(120);
      await p2.keyboard.type('!');
      await p2.waitForTimeout(120);
      // undo mid-edit must commit the pending edit FIRST, then revert exactly one
      // step → "A". Regression: taking the stack reference before commitEditing()
      // reset state.redo left the pending "!" popped from an orphaned array, so
      // the text was wiped to empty and the edit became unrecoverable.
      await p2.evaluate(() => window.AutohideToolbar.undo());
      await p2.waitForTimeout(120);
      assert(JSON.stringify(await textItems(p2)) === JSON.stringify(['A']),
        'undo mid-edit did not revert to "A": ' + JSON.stringify(await textItems(p2)));
      // and the edit is recoverable — the redo stack was not orphaned
      await p2.evaluate(() => window.AutohideToolbar.redo());
      await p2.waitForTimeout(120);
      assert(JSON.stringify(await textItems(p2)) === JSON.stringify(['A!']),
        'redo did not restore "A!": ' + JSON.stringify(await textItems(p2)));
      await p2.close();
      CURPAGE = page;
    });
    await test('data-markdown slide: annotations survive export (live↔source key mapping)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(`${BASE}/test/decks/demo.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'domcontentloaded' });
      await waitReady(p2);
      // the rendered markdown slide: SOURCE holds raw "## …" in a <script>
      // template, the LIVE deck holds rendered HTML → their content hashes
      // differ. Content hashing alone can't bridge them; the index-alignment
      // key map does. Regression: the whole annotation was silently dropped.
      const h = await p2.evaluate(() => Array.prototype.findIndex.call(
        document.querySelectorAll('.reveal .slides > section'), (s) => /Markdown Support/.test(s.textContent)));
      assert(h >= 0, 'no rendered data-markdown slide found in the demo deck');
      await p2.evaluate((i) => window.Reveal.slide(i), h);
      await p2.waitForTimeout(400);
      await typeAt(p2, 260, 220, 'MarkdownAnno');
      // commit the edit AND leave annotation mode: the floating bar would
      // otherwise sit over the (chrome) export button and swallow the click
      await p2.evaluate(() => window.AutohideToolbar.enable(false));
      await p2.waitForTimeout(150);
      const { file } = await downloadPortable(p2, `${label}-md-portable.html`);
      const html = fs.readFileSync(file, 'utf8');
      const m = html.match(/<div\b[^>]*(?:class="aht-text"|data-aht-text)[^>]*>MarkdownAnno<\/div>/i);
      assert(m, 'markdown-slide annotation was dropped from the portable copy: '
        + (html.match(/aht-text[\s\S]{0,80}/) || ['(no aht-text baked at all)'])[0]);
      await p2.close();
      CURPAGE = page;
    });
    await test('color swatch mid-edit keeps the caret (Chromium focus-steal fix)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 300, 240, 'Color');   // leaves the box focused & editing
      // clicking a bar control must NOT blur the caret: the bar suppresses the
      // mousedown focus-steal, and colour/size act ON the open edit instead of
      // committing it. Regression (Chromium): the click stole focus, the edit
      // committed, and further typing opened a NEW box.
      await p2.locator('#aht-bar .aht-swatch[data-color="#1D4ED8"]').click();
      await p2.waitForTimeout(120);
      const t = await p2.evaluate(() => {
        const e = document.querySelector('#aht-text-layer .aht-text-edit');
        return {
          editing: !!(document.activeElement && document.activeElement.isContentEditable),
          color: e ? e.style.color : null,
          items: document.querySelectorAll('#aht-text-layer .aht-text-item').length,
        };
      });
      assert(t.editing, 'caret lost after clicking a swatch mid-edit (focus stolen)');
      assert(t.color === 'rgb(29, 78, 216)', 'swatch did not recolour the live edit box: ' + t.color);
      assert(t.items === 1, 'a stray text box appeared after the swatch click: ' + t.items);
      // caret retained → more typing extends the SAME box
      await p2.keyboard.type('ed');
      await p2.keyboard.press('Escape');
      await p2.waitForTimeout(120);
      const items = await textItems(p2);
      assert(JSON.stringify(items) === JSON.stringify(['Colored']),
        'typing after the swatch click did not extend the same box: ' + JSON.stringify(items));
      await p2.close();
      CURPAGE = page;
    });
    await test('baked text carries the live box font + left-align (theme-proof metrics)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 280, 240, 'Baked font');
      // commit + leave annotation so the floating bar isn't over the export button
      await p2.evaluate(() => window.AutohideToolbar.enable(false));
      await p2.waitForTimeout(150);
      const { file } = await downloadPortable(p2, `${label}-bakedfont.html`);
      const html = fs.readFileSync(file, 'utf8');
      const m = html.match(/<div\b[^>]*(?:class="aht-text"|data-aht-text)[^>]*>Baked font<\/div>/i);
      assert(m, 'baked text element not found in the portable copy');
      // regression: font-family:inherit + centred text made baked/printed text
      // reflow and mis-metric vs the live box (reveal themes centre and restyle);
      // the baked node must pin the plugin font and left-align like .aht-text-edit
      assert(/text-align:\s*left/i.test(m[0]), 'baked text is not left-aligned: ' + m[0]);
      assert(/font-family:\s*var\(--aht-font/i.test(m[0]), 'baked text does not pin the plugin font: ' + m[0]);
      await p2.close();
      CURPAGE = page;
    });

    await test('width/size panel floats above the active tool (pen→widths, text→sizes)', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => { localStorage.clear(); window.AutohideToolbar.enable(true); window.AutohideToolbar.setTool('pen'); });
      await p2.waitForTimeout(200);
      const centre = (b) => b.x + b.width / 2;
      // pen active → the stroke-width panel shows above the pen, sizes hidden
      let t = await p2.evaluate(() => {
        const bar = document.getElementById('aht-bar');
        return {
          penClass: bar.classList.contains('tool-pen'),
          rowShown: getComputedStyle(bar.querySelector('.aht-toolrow')).display !== 'none',
          widthsShown: getComputedStyle(bar.querySelector('.aht-widths')).display !== 'none',
          sizesShown: getComputedStyle(bar.querySelector('.aht-sizes')).display !== 'none',
        };
      });
      assert(t.penClass && t.rowShown && t.widthsShown && !t.sizesShown, 'pen: widths panel not shown correctly: ' + JSON.stringify(t));
      let row = await p2.locator('#aht-bar .aht-toolrow').boundingBox();
      const pen = await p2.locator('#aht-bar [data-tool="pen"]').boundingBox();
      const barBox = await p2.locator('#aht-bar').boundingBox();
      assert(Math.abs(centre(row) - centre(pen)) < 10, `widths panel not centred over the pen: ${centre(row)} vs ${centre(pen)}`);
      assert(row.y + row.height <= barBox.y + 2, 'widths panel is not above the bar');
      // switch to text → the S/M/L panel shows above the text button, widths hidden
      await p2.evaluate(() => window.AutohideToolbar.setTool('text'));
      await p2.waitForTimeout(150);
      t = await p2.evaluate(() => {
        const bar = document.getElementById('aht-bar');
        return {
          textClass: bar.classList.contains('tool-text'),
          widthsShown: getComputedStyle(bar.querySelector('.aht-widths')).display !== 'none',
          sizesShown: getComputedStyle(bar.querySelector('.aht-sizes')).display !== 'none',
        };
      });
      assert(t.textClass && t.sizesShown && !t.widthsShown, 'text: sizes panel not shown correctly: ' + JSON.stringify(t));
      row = await p2.locator('#aht-bar .aht-toolrow').boundingBox();
      const txt = await p2.locator('#aht-bar [data-tool="text"]').boundingBox();
      assert(Math.abs(centre(row) - centre(txt)) < 10, `sizes panel not centred over the text tool: ${centre(row)} vs ${centre(txt)}`);
      // eraser → no contextual panel at all
      await p2.evaluate(() => window.AutohideToolbar.setTool('eraser'));
      await p2.waitForTimeout(150);
      const rowHidden = await p2.evaluate(() => getComputedStyle(document.getElementById('aht-bar').querySelector('.aht-toolrow')).display === 'none');
      assert(rowHidden, 'eraser should hide the contextual panel');
      // highlighter → no panel either (one fixed band width), but its button is active
      await p2.evaluate(() => window.AutohideToolbar.setTool('highlighter'));
      await p2.waitForTimeout(150);
      const hl = await p2.evaluate(() => ({
        rowHidden: getComputedStyle(document.getElementById('aht-bar').querySelector('.aht-toolrow')).display === 'none',
        active: document.querySelector('#aht-bar [data-tool="highlighter"]').classList.contains('active'),
      }));
      assert(hl.rowHidden, 'highlighter should hide the contextual panel');
      assert(hl.active, 'highlighter button not marked active');
      await p2.close();
      CURPAGE = page;
    });
    await test('highlighter: H toggles it, lays translucent ink, sits under the pen', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => window.AutohideToolbar.enable(true));
      await p2.waitForTimeout(150);
      // H enters the highlighter and toggles back to the pen
      await p2.keyboard.press('h');
      await p2.waitForTimeout(120);
      assert(await p2.evaluate(() => document.querySelector('#aht-bar [data-tool="highlighter"]').classList.contains('active')), 'H did not select the highlighter');
      await p2.keyboard.press('h');
      await p2.waitForTimeout(120);
      assert(await p2.evaluate(() => document.querySelector('#aht-bar [data-tool="pen"]').classList.contains('active')), 'H did not toggle back to the pen');
      // draw an amber highlighter band; picking a swatch must KEEP the highlighter
      // (not fall back to the pen), and the band's centre is present but translucent
      await p2.evaluate(() => window.AutohideToolbar.setTool('highlighter'));
      await p2.locator('#aht-bar .aht-swatch[data-color="#FCD34D"]').click();
      assert(await p2.evaluate(() => document.querySelector('#aht-bar [data-tool="highlighter"]').classList.contains('active')), 'picking a colour dropped the highlighter');
      await draw(p2, [[250, 300], [550, 300]]);
      const band = await pixel(p2, 400, 300);
      assert(band[3] > 40 && band[3] < 170, 'highlighter band is not translucent (alpha ' + band[3] + ')');
      assert(band[0] > 150 && band[1] > 120 && band[2] < 160, 'highlighter band is not the amber hue: ' + band);
      // a blue pen stroke crossing the band lands ON TOP: the crossing goes opaque blue
      await p2.evaluate(() => window.AutohideToolbar.setTool('pen'));
      await p2.locator('#aht-bar .aht-swatch[data-color="#1D4ED8"]').click();
      await draw(p2, [[400, 250], [400, 350]]);
      const cross = await pixel(p2, 400, 300);
      assert(cross[3] > 220, 'pen did not paint opaque over the highlighter (alpha ' + cross[3] + ')');
      assert(cross[2] > 120 && cross[0] < 90, 'pen is not on top of the highlighter at the crossing: ' + cross);
      await p2.close();
      CURPAGE = page;
    });
    await test('text box delete control is a trash bin, spaced apart from the drag grip', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      await typeAt(p2, 320, 260, 'Trash me');
      await p2.waitForTimeout(120);
      const t = await p2.evaluate(() => {
        const item = document.querySelector('#aht-text-layer .aht-text-item.editing');
        const grip = item.querySelector('.aht-text-grip');
        const del = item.querySelector('.aht-text-del');
        const gr = grip.getBoundingClientRect(), dr = del.getBoundingClientRect();
        return {
          // trash-2 has 5 sub-paths; the old × had 2 — a cheap icon-identity check
          delPaths: del.querySelectorAll('svg path').length,
          gap: dr.left - gr.right,
        };
      });
      assert(t.delPaths >= 4, 'delete control is not the trash-bin icon (path count ' + t.delPaths + ')');
      assert(t.gap >= 10, 'drag grip and trash are too close (' + Math.round(t.gap) + 'px) — easy to mis-tap');
      await p2.close();
      CURPAGE = page;
    });

    await test('S/M/L presets carry style: L is bold, S is condensed — baked + revived', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.evaluate(() => localStorage.clear());
      await p2.reload({ waitUntil: 'networkidle' });
      await waitReady(p2);
      const box = await canvasBox(p2);
      await p2.evaluate(() => { window.AutohideToolbar.enable(true); window.AutohideToolbar.setTool('text'); });
      await p2.waitForTimeout(100);
      // L preset → a bold box
      await p2.locator('#aht-bar .aht-size.l').click();
      await p2.mouse.click(box.x + 260, box.y + 170);
      await p2.keyboard.type('Head');
      await p2.waitForTimeout(80);
      let live = await p2.evaluate(() => document.querySelector('#aht-text-layer .aht-text-item.editing .aht-text-edit').style.fontWeight);
      assert(live === '700', 'L preset did not make the live box bold: ' + live);
      await p2.keyboard.press('Escape');   // commit "Head" before picking the next preset
      await p2.waitForTimeout(80);
      // S preset → a condensed, regular-weight box
      await p2.locator('#aht-bar .aht-size.s').click();
      await p2.mouse.click(box.x + 260, box.y + 320);
      await p2.keyboard.type('note');
      await p2.waitForTimeout(80);
      live = await p2.evaluate(() => {
        const e = document.querySelector('#aht-text-layer .aht-text-item.editing .aht-text-edit');
        return { stretch: e.style.fontStretch, weight: e.style.fontWeight };
      });
      assert(/75%|condensed/.test(live.stretch) && live.weight === '400', 'S preset not condensed/regular: ' + JSON.stringify(live));
      await p2.evaluate(() => window.AutohideToolbar.enable(false));   // commit + leave annotation
      await p2.waitForTimeout(150);
      // bake: the styles land in the portable HTML as real CSS + data-* markers
      const { file } = await downloadPortable(p2, `${label}-styled.html`);
      const html = fs.readFileSync(file, 'utf8');
      const lNode = html.match(/<div\b[^>]*>Head<\/div>/i);
      const sNode = html.match(/<div\b[^>]*>note<\/div>/i);
      assert(lNode && /font-weight:\s*700/.test(lNode[0]) && /data-aht-bold/.test(lNode[0]), 'L not baked bold: ' + (lNode && lNode[0]));
      assert(sNode && /font-stretch:\s*75%/.test(sNode[0]) && /data-aht-cond/.test(sNode[0]), 'S not baked condensed: ' + (sNode && sNode[0]));
      await p2.close();
      // revive: styles restored onto the editable boxes
      const p3 = await ctx.newPage();
      CURPAGE = p3;
      await p3.goto('file://' + file, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitReady(p3);
      await p3.evaluate(() => window.Reveal.slide(0));
      await p3.waitForTimeout(500);
      const revived = await p3.evaluate(() => {
        const edits = Array.from(document.querySelectorAll('#aht-text-layer .aht-text-edit'));
        const by = (t) => edits.find((e) => e.textContent === t);
        const h = by('Head'), n = by('note');
        return { headBold: !!h && h.style.fontWeight === '700', noteCond: !!n && /75%|condensed/.test(n.style.fontStretch) };
      });
      assert(revived.headBold, 'revived L text lost its bold');
      assert(revived.noteCond, 'revived S text lost its condensed');
      await p3.close();
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
      // (?<!dist\/): 6-style paths keep the highlight/ dir, so this rule must
      // not fire again on an already-6-style link (dist/dist/… would 404)
      .replace(/(reveal\.js@[^"']+\/)(?<!dist\/)plugin\/(highlight\/[a-z-]+\.css)/g, '$1dist/plugin/$2');
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
const COMBOS = VERSIONS.flatMap((v) => ['chromium', 'webkit'].map((e) => `${e}@${v}`));

// one engine × one reveal version on this process's server/port
async function runCombo(label) {
  const [engine, version] = label.split('@');
  serveVersion = version;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '127.0.0.1', resolve);
    });
    await runSuite(loadEngine(engine), label);
  } catch (e) {
    results.push({ name: `[${CUR}] FATAL (suite aborted)`, ok: false, error: String(e && e.message || e).split('\n')[0] });
    log(P_FATAL + String(e && e.message || e).split('\n')[0]);
  } finally {
    server.close();
  }
}

function summarize() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  log('');
  log(`==== SUMMARY: ${pass}/${results.length} passed, ${fail} failed ====`);
  for (const r of results.filter((r) => !r.ok)) log(`  ✗ ${r.name}\n    ${r.error}`);
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(ART, 'results.log'), logLines.join('\n') + '\n');
  log(`Artifacts: ${ART}`);
  process.exitCode = fail ? 1 : 0;
}

if (process.env.AHT_COMBO) {
  // ---------- worker: run one combo, hand results to the parent via file ----------
  await runCombo(process.env.AHT_COMBO);
  fs.writeFileSync(path.join(ART, `results-${process.env.AHT_COMBO}.json`), JSON.stringify(results, null, 2));
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
} else if (process.env.AHT_SERIAL && process.env.AHT_SERIAL !== '0') {
  // ---------- sequential fallback (single process, e.g. for headed debugging) ----------
  for (const label of COMBOS) await runCombo(label);
  summarize();
} else {
  // ---------- parent: one worker process per matrix combo, all in parallel ----------
  const self = fileURLToPath(import.meta.url);
  // sticky per-combo progress bars on a TTY (AHT_BARS=1/0 forces either way):
  // PASS lines feed the bars instead of scrolling by, FAIL/FATAL still print
  // the moment they happen — and results.log keeps every line regardless.
  const BARS = process.env.AHT_BARS ? process.env.AHT_BARS !== '0' : !!process.stdout.isTTY;
  // per-combo denominator: this file's own test() call sites. A couple run in
  // loops (the G9 decks), so the real count is a bit higher — the bar's total
  // simply grows with done and the close fills it, no drama.
  const PER_COMBO = (fs.readFileSync(self, 'utf8').match(/await test\(/g) || []).length;
  const prog = new Map(COMBOS.map((l) => [l, { done: 0, fail: 0, closed: false }]));
  let shown = 0;                 // bar lines currently on screen
  const barLine = (label) => {
    const p = prog.get(label);
    const total = Math.max(PER_COMBO, p.done);
    const fill = p.closed ? 24 : Math.round((24 * p.done) / total);
    const tail = p.closed ? (p.fail ? `✗ ${p.fail} failed` : '✓') : (p.fail ? `✗ ${p.fail}` : '');
    const line = `  ${'█'.repeat(fill)}${'░'.repeat(24 - fill)} ${String(p.done).padStart(3)}/${total}  ${label} ${tail}`;
    // a wrapped bar line would break the cursor-up redraw math — truncate
    const cols = process.stdout.columns;
    return cols && line.length >= cols ? line.slice(0, cols - 1) : line;
  };
  const clearBars = () => { if (shown) { process.stdout.write(`\x1b[${shown}A\x1b[J`); shown = 0; } };
  const render = () => {
    if (!BARS) return;
    clearBars();
    process.stdout.write(COMBOS.map(barLine).join('\n') + '\n');
    shown = COMBOS.length;
  };
  const emit = (line) => {       // print a full line ABOVE the sticky bars
    clearBars();
    console.log(line);
    render();
  };
  log(`Running ${COMBOS.length} matrix combos in parallel (ports ${PORT}–${PORT + COMBOS.length - 1}); AHT_SERIAL=1 for the sequential mode.`);
  log(BARS
    ? 'Progress bars below; failures print as they happen. Full log: test/artifacts/results.log'
    : 'Output streams live, interleaved by line — every test line carries its [engine@version].');
  render();
  const outs = {};
  await Promise.all(COMBOS.map((label, i) => new Promise((resolve) => {
    const child = spawn(process.execPath, [self], {
      env: { ...process.env, AHT_COMBO: label, AHT_PORT: String(PORT + i) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    outs[label] = '';
    let afterFail = false;       // a FAIL line is followed by its indented error line
    const p = prog.get(label);
    const handleLine = (line) => {
      if (!BARS) { console.log(line); return; }
      if (line.startsWith(P_PASS)) { p.done++; afterFail = false; render(); }
      else if (line.startsWith(P_FAIL)) { p.done++; p.fail++; afterFail = true; emit(line); }
      else if (afterFail && line.startsWith(P_ERR)) { afterFail = false; emit(line); }
      else if (line.startsWith(P_FATAL)) { p.fail++; afterFail = false; emit(`[${label}] ${line}`); }
      else afterFail = false;    // swallowed on screen — results.log keeps it
    };
    // one line buffer PER stream: a stderr chunk arriving mid-stdout-line must
    // not splice into it and hide a PASS/FAIL prefix from the parser
    const bufs = { out: '', err: '' };
    const onData = (key) => (d) => {
      outs[label] += d;
      bufs[key] += d;
      const lines = bufs[key].split('\n');
      bufs[key] = lines.pop();    // hold back the unterminated tail
      for (const line of lines) handleLine(line);
    };
    child.stdout.setEncoding('utf8');   // decode multibyte chars across chunk splits
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));
    child.on('close', (code) => {
      if (bufs.out) handleLine(bufs.out);
      if (bufs.err) handleLine(bufs.err);
      const file = path.join(ART, `results-${label}.json`);
      let combo = null;
      try { combo = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}   // missing or truncated
      fs.rmSync(file, { force: true });
      if (combo) {
        results.push(...combo);
        // an all-green file plus a nonzero exit = the worker crashed AFTER its
        // run (teardown) — the file alone would report a fully green matrix
        if (code !== 0 && combo.every((r) => r.ok)) {
          results.push({ name: `[${label}] FATAL (worker crashed after its run, exit ${code})`, ok: false, error: 'teardown crash — see results.log' });
          if (BARS) { p.fail++; emit(`  FATAL [${label}] worker crashed after its run (exit ${code})`); }
        }
      } else {
        results.push({ name: `[${label}] FATAL (worker died, exit ${code})`, ok: false, error: 'worker wrote no results' });
        if (BARS) { p.fail++; emit(`  FATAL [${label}] worker died (exit ${code}) — see results.log`); }
      }
      p.closed = true;
      render();
      resolve();
    });
  })));
  // results.log stays readable: one intact block per combo, in matrix order
  for (const label of COMBOS) logLines.push(outs[label].trimEnd());
  summarize();
}
