#!/usr/bin/env node
/*!
 * add-aht-to-slides-export — bolt the autohide-toolbar (AHT) plugin onto a
 * slides.com offline export so a deck you authored visually on slides.com runs
 * locally with pen / highlighter / boards / export.
 *
 * slides.com's offline export ships stock reveal.js (6.x) with the real plugin
 * API and no annotation plugin of its own, so AHT is purely additive. This tool
 * makes the two edits that integration needs, idempotently:
 *
 *   1. loads the plugin  — <script src="reveal-autohide-toolbar.js"></script>
 *      (copied next to index.html, so the export stays offline-self-contained)
 *   2. registers it      — appends RevealAutohideToolbar to the plugins: [ … ]
 *      array of the real Reveal.initialize({ … }) call
 *
 * Usage:
 *   node tools/add-aht-to-slides-export.mjs <export-dir-or-index.html> [options]
 *   npm run add-aht -- <export-dir-or-index.html> [options]
 *
 * Options:
 *   --cdn            reference the plugin from jsDelivr instead of copying the
 *                    file locally (online use; smaller export)
 *   --src <path>     use a specific plugin .js instead of the repo copy
 *   --css            re-inject the repo's <style> theme (demo/index.html) into the
 *                    export so the deck gets its full look (black frame, fonts,
 *                    cards, footer) locally — keeps CSS versioned in the repo and
 *                    lets you skip slides.com's LESS editor entirely
 *   --css-src <file> take the <style> from this HTML instead of demo/index.html
 *   --dry            show what would change, write nothing
 *   -h, --help       this text
 *
 * Re-run it after every re-export from slides.com — it's safe to run repeatedly.
 *
 * Note: slides.com strips element ids, inline onclick, and form inputs on import,
 * so JS-interactive slides (sliders, click handlers) can't be revived from an
 * export — author those in the repo. --css restores the visual theme only.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PLUGIN_BASENAME = 'reveal-autohide-toolbar.js';
const DEFAULT_PLUGIN_SRC = join(REPO_ROOT, PLUGIN_BASENAME);
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const CDN_URL = `https://cdn.jsdelivr.net/gh/frankhuettner/reveal.js-autohide-toolbar@v${PKG.version}/${PLUGIN_BASENAME}`;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { cdn: false, dry: false, src: DEFAULT_PLUGIN_SRC, css: false, cssSrc: join(REPO_ROOT, 'demo', 'index.html'), target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else if (a === '--cdn') opts.cdn = true;
    else if (a === '--dry') opts.dry = true;
    else if (a === '--src') opts.src = resolve(argv[++i] ?? die('--src needs a path'));
    else if (a === '--css') opts.css = true;
    else if (a === '--css-src') { opts.cssSrc = resolve(argv[++i] ?? die('--css-src needs a path')); opts.css = true; }
    else if (a.startsWith('-')) die(`unknown option: ${a}`);
    else if (!opts.target) opts.target = a;
    else die(`unexpected extra argument: ${a}`);
  }
  return opts;
}

// Extract the FULL <style>…</style> block from a source HTML (the repo demo by
// default). This is the pristine theme — on a real reveal export it "just works"
// (reveal reads --r-main-font-size on .reveal, the black frame targets
// .reveal-viewport, etc.), so no slides.com-style transform is needed here.
function extractStyle(srcPath) {
  if (!existsSync(srcPath)) die(`--css source not found: ${srcPath}`);
  const m = readFileSync(srcPath, 'utf8').match(/<style\b[^>]*>[\s\S]*?<\/style>/i);
  if (!m) die(`no <style> block found in ${srcPath}`);
  return m[0];
}

// Inject (or refresh) the repo theme between idempotent markers, right before
// </head> so it overrides slides.com's own stylesheets. Re-running replaces it.
function ensureStyleInjected(html, styleBlock) {
  const START = '<!-- aht:style:start -->', END = '<!-- aht:style:end -->';
  const wrapped = `${START}\n${styleBlock}\n\t${END}`;
  const existing = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (existing.test(html)) {
    return { html: html.replace(existing, wrapped), changed: true, note: 'refreshed injected <style>' };
  }
  const headClose = html.search(/<\/head>/i);
  if (headClose >= 0) {
    return { html: `${html.slice(0, headClose)}\t${wrapped}\n${html.slice(headClose)}`, changed: true, note: 'injected repo <style> before </head>' };
  }
  return { html: `${wrapped}\n${html}`, changed: true, note: 'injected repo <style> at top (no </head>)' };
}

function printHelp() {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n').filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n'));
}

// Resolve the target to an actual index.html path. Accepts a directory (uses
// <dir>/index.html) or a direct path to an .html file.
function resolveHtmlPath(target) {
  if (!target) die('missing target — pass a slides.com export directory or its index.html');
  const p = resolve(target);
  if (!existsSync(p)) die(`no such path: ${p}`);
  if (statSync(p).isDirectory()) {
    const idx = join(p, 'index.html');
    if (!existsSync(idx)) die(`no index.html in ${p}`);
    return idx;
  }
  return p;
}

// Isolate the ONE <script>…</script> whose body actually invokes
// Reveal.initialize(. Two decoys must be avoided:
//   • the deck's own example snippets — those live in <pre><code> as text, not
//     <script> tags, so the <script> regex already skips them;
//   • slides.com's `var SLConfig = { … }` block, whose speaker notes can embed
//     the literal string "Reveal.initialize(" inside JSON — a <script> tag that
//     merely *mentions* the call, not one that makes it.
// So among <script> blocks that reference it, we keep those whose body *begins*
// with the call (the real init block does), and take the last such block.
function findInitScript(html) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/\bReveal\.initialize\s*\(/.test(m[1])) {
      candidates.push({ whole: m[0], body: m[1], start: m.index, end: m.index + m[0].length });
    }
  }
  if (!candidates.length) return null;
  const real = candidates.filter((c) => c.body.trimStart().startsWith('Reveal.initialize'));
  const pick = real.length ? real : candidates;
  return pick[pick.length - 1];
}

// Add RevealAutohideToolbar to the plugins: [ … ] array inside the init block.
// Returns { body, changed, note }.
function ensurePluginRegistered(initBody) {
  const arrRe = /(\bplugins\s*:\s*\[)([\s\S]*?)(\])/;
  const m = initBody.match(arrRe);
  if (m) {
    if (/\bRevealAutohideToolbar\b/.test(m[2])) {
      return { body: initBody, changed: false, note: 'already in plugins array' };
    }
    const inner = m[2].trim();
    const joined = inner ? `${inner}, RevealAutohideToolbar` : 'RevealAutohideToolbar';
    return { body: initBody.replace(arrRe, `$1 ${joined} $3`), changed: true, note: 'appended to plugins array' };
  }
  // No plugins key at all — insert one right after Reveal.initialize({.
  const initRe = /(Reveal\.initialize\s*\(\s*\{)/;
  if (initRe.test(initBody)) {
    return {
      body: initBody.replace(initRe, `$1\n\t\t\t\tplugins: [ RevealAutohideToolbar ],`),
      changed: true,
      note: 'inserted a new plugins array',
    };
  }
  return { body: initBody, changed: false, note: 'could not find where to register the plugin' };
}

// Insert the plugin <script> tag once, after the last local lib script if
// present (so it loads after reveal + offline.js, before the init call), else
// immediately before the init <script>.
function ensureScriptTag(html, initStart, srcAttr) {
  if (new RegExp(`<script\\b[^>]*src=["'][^"']*${PLUGIN_BASENAME.replace('.', '\\.')}["']`, 'i').test(html)) {
    return { html, changed: false, note: 'plugin <script> already present' };
  }
  const tag = `<script src="${srcAttr}"></script>`;
  // Prefer to sit right after the last <script src="lib/…"> before the init block.
  const libRe = /[ \t]*<script\b[^>]*src=["']lib\/[^"']*["'][^>]*><\/script>[ \t]*\n?/gi;
  let last = null, m;
  while ((m = libRe.exec(html)) !== null) {
    if (m.index >= initStart) break;
    last = m;
  }
  if (last) {
    const at = last.index + last[0].length;
    return { html: html.slice(0, at) + `\t\t${tag}\n` + html.slice(at), changed: true, note: 'inserted after lib scripts' };
  }
  // Fallback: just before the init <script>.
  return { html: html.slice(0, initStart) + `\t\t${tag}\n\t\t` + html.slice(initStart), changed: true, note: 'inserted before init script' };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const htmlPath = resolveHtmlPath(opts.target);
  const outDir = dirname(htmlPath);

  let html = readFileSync(htmlPath, 'utf8');
  const init = findInitScript(html);
  if (!init) die(`could not find a Reveal.initialize() call in ${htmlPath} — is this a reveal.js / slides.com export?`);

  const actions = [];

  // 1. register the plugin inside the init block
  const reg = ensurePluginRegistered(init.body);
  if (reg.changed) {
    const newWhole = init.whole.replace(init.body, reg.body);
    html = html.slice(0, init.start) + newWhole + html.slice(init.end);
  }
  actions.push(`plugins array: ${reg.note}`);

  // 2. load the plugin — re-find init start since length may have shifted
  const init2 = findInitScript(html);
  const srcAttr = opts.cdn ? CDN_URL : PLUGIN_BASENAME;
  const tag = ensureScriptTag(html, init2.start, srcAttr);
  html = tag.html;
  actions.push(`script tag: ${tag.note}${opts.cdn ? ' (CDN)' : ''}`);

  // 3. optionally re-inject the repo theme <style> (idempotent)
  if (opts.css) {
    const style = extractStyle(opts.cssSrc);
    const inj = ensureStyleInjected(html, style);
    html = inj.html;
    actions.push(`repo <style>: ${inj.note} (${style.length} bytes from ${basename(opts.cssSrc)})`);
  }

  // 4. copy the plugin file next to index.html (unless --cdn)
  let copyNote;
  const dest = join(outDir, PLUGIN_BASENAME);
  if (opts.cdn) {
    copyNote = `skipped copy (CDN mode → ${CDN_URL})`;
  } else if (!existsSync(opts.src)) {
    die(`plugin source not found: ${opts.src}`);
  } else if (resolve(opts.src) === resolve(dest)) {
    copyNote = 'plugin already in place';
  } else {
    copyNote = `copy ${basename(opts.src)} → ${dest}`;
  }
  actions.push(`plugin file: ${copyNote}`);

  console.log(`${opts.dry ? '[dry-run] ' : ''}${htmlPath}`);
  for (const a of actions) console.log(`  • ${a}`);

  if (opts.dry) { console.log('  (no files written)'); return; }

  writeFileSync(htmlPath, html);
  if (!opts.cdn && resolve(opts.src) !== resolve(dest)) copyFileSync(opts.src, dest);
  console.log('  ✓ done — open index.html (or `npm run demo`) and press A to draw.');
}

main();
