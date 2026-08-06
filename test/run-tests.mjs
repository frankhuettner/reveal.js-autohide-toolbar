/*
 * Comprehensive Playwright test suite for reveal.js-autohide-toolbar.
 * Runs the full suite on BOTH engines: Chromium and WebKit (Safari engine).
 *
 * Run OUTSIDE the sandbox (a normal terminal), from anywhere:
 *   node reveal.js-autohide-toolbar/test/run-tests.mjs
 *
 * - Spawns its own static server (port 8036, repo root).
 * - Browsers come from this package's devDependencies (npm install first).
 * - Writes everything to test/artifacts/: results.log, results.json, *.png
 *   (screenshots are prefixed with the engine; failures get fail-*.png).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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

// Works in two layouts: the standalone plugin repo (server root = plugin dir),
// and the original monorepo, where the sibling example-deck deck exists and is
// smoke-tested too (server root = one level up).
const MONO = path.resolve(PLUGIN, '..');
const HAS_SIBLING = fs.existsSync(path.join(MONO, 'example-deck', 'index.html'));
const ROOT = HAS_SIBLING ? MONO : PLUGIN;
const PREFIX = HAS_SIBLING ? '/' + path.basename(PLUGIN) : '';

const PORT = 8036;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO = `${BASE}${PREFIX}/demo/`;
const FIXTURE = `${BASE}${PREFIX}/test/fixture-options.html`;
const SIBLING = `${BASE}/example-deck/`;

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
    await test('blackboard toggle sets board background; dark pen auto-brightens', async () => {
      await page.locator('#aht-bar .aht-swatch[data-color="#000000"]').click();
      await page.locator('#aht-board').click();
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => document.getElementById('aht-canvas').classList.contains('board')), 'board class missing');
      const active = await page.evaluate(() => document.querySelector('#aht-bar .aht-swatch.active').getAttribute('data-color'));
      assert(active === '#FFFFFF', 'dark pen not auto-brightened, active=' + active);
      await shot(page, 'g3-board');
      await page.locator('#aht-board').click();
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
    await test('annotation bar can be dragged by its grip', async () => {
      await page.keyboard.press('a');
      await page.waitForTimeout(200);
      const r1 = await page.locator('#aht-bar').boundingBox();
      const g = await page.locator('#aht-bar .aht-grip').boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2 + 250, g.y + g.height / 2 - 80, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const r2 = await page.locator('#aht-bar').boundingBox();
      assert(Math.abs(r2.x - r1.x - 250) < 25 && Math.abs(r2.y - r1.y + 80) < 25,
        `bar did not follow drag: ${JSON.stringify({ from: r1, to: r2 })}`);
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
      await page.keyboard.press('a');
      await draw(page, [[350, 250], [450, 250]]);
      await page.keyboard.press('Escape');
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
      await page.keyboard.press('a');
      await draw(page, [[600, 300], [700, 300]]);
      await page.keyboard.press('Escape');
      await p2.waitForTimeout(600);
      assert(colored(await pixel(p2, 650, 300)), 'second window did not sync the new stroke');
      await p2.close();
      CURPAGE = page;
    });
    await test('Shift+X clears the whole deck and storage', async () => {
      await page.keyboard.press('a');
      await page.keyboard.press('Shift+X');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      assert(!colored(await pixel(page, 400, 250)), 'ink survived Shift+X');
      const stored = await page.evaluate(() => localStorage.getItem('aht:' + location.pathname));
      assert(stored === null, 'storage not cleared: ' + stored);
    });

    log(`=== ${label} · G5 geometry robustness ===`);
    await test('ink sticks to slide content across window resize', async () => {
      await page.keyboard.press('a');
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
    await test('?print-pdf: no plugin chrome at all', async () => {
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      await p2.goto(DEMO + '?print-pdf', { waitUntil: 'networkidle' });
      await p2.waitForTimeout(1500);
      const t = await p2.evaluate(() => [!!document.getElementById('aht-canvas'), !!document.getElementById('aht-toolbar')]);
      assert(!t[0] && !t[1], JSON.stringify(t));
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
      await p2.goto(DEMO, { waitUntil: 'networkidle' });
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

    log(`=== ${label} · G9 real deck smoke test (example-deck) ===`);
    if (!HAS_SIBLING) { log('  SKIP  [' + label + '] sibling smoke test (standalone repo — no sibling deck)'); return; }
    await test('sibling deck: 22 slides, plugin alive, fragments work, no errors', async () => {
      const errs = [];
      const p2 = await ctx.newPage();
      CURPAGE = p2;
      trackErrors(p2, errs);
      await p2.goto(SIBLING, { waitUntil: 'networkidle' });
      await waitReady(p2);
      await p2.waitForTimeout(1500);
      const t = await p2.evaluate(() => ({
        slides: document.querySelectorAll('.reveal .slides > section').length,
        toolbar: !!document.getElementById('aht-toolbar'),
        counter: document.getElementById('aht-slideno').textContent,
      }));
      assert(t.slides === 22, 'slides=' + t.slides);
      assert(t.toolbar, 'toolbar missing');
      assert(t.counter === '1 / 22', 'counter=' + t.counter);
      await p2.evaluate(() => window.Reveal.slide(2));
      await p2.waitForTimeout(600);
      await p2.keyboard.press('ArrowRight');
      await p2.waitForTimeout(300);
      const frag = await p2.evaluate(() => window.Reveal.getIndices().f);
      assert(frag === 0, 'fragment nav broken, f=' + frag);
      await shot(p2, 'g9-sibling');
      const fatal = errs.filter((e) => !/tailwind|cdn.tailwindcss/i.test(e));
      assert(fatal.length === 0, fatal.join(' | '));
      await p2.close();
      CURPAGE = page;
    });
  } finally {
    CURPAGE = null;
    await browser.close().catch(() => {});
  }
}

// ---------- main ----------
let server;
try {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  await runSuite(chromium, 'chromium');
  await runSuite(webkit, 'webkit');
} catch (e) {
  results.push({ name: `[${CUR}] FATAL (suite aborted)`, ok: false, error: String(e && e.message || e).split('\n')[0] });
  log('FATAL: ' + String(e && e.message || e).split('\n')[0]);
} finally {
  if (server) server.kill();
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
