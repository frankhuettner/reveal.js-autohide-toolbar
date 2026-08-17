#!/usr/bin/env node
/*!
 * build-standalone-demo — inline a deck's local assets into one self-contained file.
 *
 * Point it at any reveal.js deck (or run it with no arguments to rebuild this
 * repo's demo). Every LOCAL <link rel=stylesheet> and <script src> is replaced
 * by the file's contents inlined in place; remote resources (any scheme —
 * http/https/data/blob —, protocol-relative //, and root-absolute /paths) are
 * left untouched. The result is a single HTML file you can drop anywhere.
 *
 * This is the export step behind the two-shape demo: author in the SPLIT deck
 * (demo/index.html — links ../letterbox.css and the plugin), then generate the
 * ALL-IN-ONE demo/standalone.html from it. The same tool exports your own deck.
 *
 * Usage:
 *   node tools/build-standalone-demo.mjs                 rebuild demo/standalone.html
 *   npm run build:standalone
 *   node tools/build-standalone-demo.mjs <deck.html>     export your own deck →
 *                                                        <deck>.standalone.html
 *   node tools/build-standalone-demo.mjs <deck.html> --out <path>
 *   node tools/build-standalone-demo.mjs [<deck.html>] --check
 *                                                        verify the output is up
 *                                                        to date (exit 1 if
 *                                                        stale/missing); for CI
 *   -h, --help
 *
 * Guarantees: the output is self-contained or the tool exits non-zero — a
 * referenced local file that is missing, or a local <script src> that also has
 * inline content (ambiguous — refuse rather than guess), is a hard error.
 * Markup inside HTML comments is inert (never inlined, never an error).
 * Unquoted attributes and cache-busting hrefs (theme.css?v=3) are handled;
 * a `data-inlined-from` attribute records each asset's origin.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// A URL is remote (left as-is) if it has any scheme (https:, data:, blob:, …)
// or starts with '/' (root-absolute or protocol-relative — server-rooted
// either way, not something a file join can resolve).
const isRemote = url => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/');

// Extract one attribute value from a tag: quoted (single/double) or unquoted
// (valid HTML5). The lookbehind keeps `src=` from matching inside `data-src=`.
const attrOf = (tag, name) => {
  const m = tag.match(new RegExp(`(?<![-\\w])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};
// rel is a space-separated token list — match rel=stylesheet, rel="preload stylesheet", …
const relHasStylesheet = tag => {
  const rel = attrOf(tag, 'rel');
  return !!rel && rel.trim().toLowerCase().split(/\s+/).includes('stylesheet');
};

const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escStyle = css => css.replace(/<\/style/gi, '<\\/style');
// '</script' would end the inline block early. And if the body contains '<!--',
// the HTML parser can enter the script-data-double-escaped state where an
// unescaped '<script' makes the real closing tag a mere state transition, eating
// the rest of the page — so in that case also hex-escape '<script', the same
// defence as the plugin's own "Save a copy" inliner (inlinePlugin in
// reveal-autohide-toolbar.js). Only then: in a file without '<!--' the escape is
// unnecessary and could corrupt a bare `a<script` comparison in code.
const escScript = js => {
  js = js.replace(/<\/script/gi, '<\\/script');
  if (js.includes('<!--')) js = js.replace(/<script/gi, '<\\x73cript');
  return js;
};

// Inline every local <link rel=stylesheet> and <script src> found in `html`,
// resolving each href/src against `baseDir`. HTML comments are left inert.
// Returns the rewritten HTML plus what was inlined / missing / not inlinable.
function inlineDeps(html, baseDir) {
  const inlined = [], missing = [], notInlinable = [];
  const read = (ref) => {
    const p = join(baseDir, ref.split(/[?#]/)[0]);   // drop cache-buster query/fragment
    if (!existsSync(p)) { missing.push(ref); return null; }
    inlined.push(ref);
    return readFileSync(p, 'utf8');
  };

  const inlineSegment = (seg) => {
    seg = seg.replace(/<link\b[^>]*>/gi, (tag) => {
      if (!relHasStylesheet(tag)) return tag;
      const href = attrOf(tag, 'href');
      if (!href || isRemote(href)) return tag;
      const css = read(href);
      if (css == null) return tag;
      return `<style data-inlined-from="${escAttr(href)}">\n${escStyle(css.trimEnd())}\n</style>`;
    });
    seg = seg.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (el) => {
      const openTag = el.slice(0, el.indexOf('>') + 1);
      const body = el.slice(openTag.length, el.lastIndexOf('<'));
      const src = attrOf(openTag, 'src');
      if (!src || isRemote(src)) return el;
      if (body.trim()) { notInlinable.push(src); return el; }
      const js = read(src);
      if (js == null) return el;
      const attrs = openTag.slice('<script'.length, -1)   // keep type=module etc., drop src
        .replace(/(?<![-\w])src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
        .replace(/\s+/g, ' ').trim();
      return `<script${attrs ? ' ' + attrs : ''} data-inlined-from="${escAttr(src)}">\n${escScript(js)}\n</script>`;
    });
    return seg;
  };

  // split on comments; odd segments ARE the comments — pass them through untouched
  const out = html.split(/(<!--[\s\S]*?-->)/).map((part, i) => i % 2 ? part : inlineSegment(part)).join('');
  return { html: out, inlined, missing, notInlinable };
}

// --- args: [<deck.html>] [--out <path>] [--check] [-h|--help] — unknown flags are errors
function parseArgs(argv) {
  let deck = null, out = null, check = false, help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') help = true;
    else if (a === '--check') check = true;
    else if (a === '--out') {
      const v = argv[++i];
      if (v == null || v.startsWith('-')) die('--out needs a path');
      out = v;
    }
    else if (a.startsWith('-')) die(`unknown option: ${a} (see --help)`);
    else if (deck === null) deck = a;
    else die(`unexpected extra argument: ${a} — one deck at a time`);
  }
  return { deck, out, check, help };
}

const { deck, out, check, help } = parseArgs(process.argv.slice(2));

if (help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n').filter(l => l.startsWith(' *')).map(l => l.slice(3)).join('\n'));
  process.exit(0);
}

// No deck given → repo mode: rebuild demo/standalone.html (what
// `npm run build:standalone` and the CI --check target).
const repoMode = deck === null;
const SRC = repoMode ? join(repoRoot, 'demo', 'index.html') : resolve(deck);
const OUT = out ? resolve(out)
          : repoMode ? join(repoRoot, 'demo', 'standalone.html')
          : SRC.replace(/\.html?$/i, '') + '.standalone.html';

if (!existsSync(SRC)) die(`deck not found: ${SRC}`);
if (OUT === SRC) die(`--out points at the source deck itself — refusing to overwrite it`);

// The regenerate command, from the args as typed — echoed in the banner and the
// --check hint. No absolute or repo-relative paths baked in, so the output is
// byte-stable across machines and platforms (as long as relative paths are used).
const rebuildCmd = repoMode ? 'npm run build:standalone'
  : `node tools/build-standalone-demo.mjs ${deck}${out ? ` --out ${out}` : ''}`;

const banner = `<!--
  ⚠ GENERATED — do not edit by hand.
  Self-contained build: this deck's local stylesheets and scripts are inlined so
  the single file runs anywhere you drop it. Remote (CDN) resources load as usual.
  Source: ${repoMode ? 'demo/index.html' : basename(SRC)}
  Regenerate:  ${rebuildCmd}
-->`;

const { html: bodyOut, inlined, missing, notInlinable } = inlineDeps(readFileSync(SRC, 'utf8'), dirname(SRC));

if (missing.length) die(`${repoMode ? 'demo/index.html' : deck}: local asset(s) not found:\n  ${missing.join('\n  ')}`);
if (notInlinable.length) die(
  `${repoMode ? 'demo/index.html' : deck}: local <script src> with inline content — can't inline without discarding the content:\n  ${notInlinable.join('\n  ')}`);
// Repo mode inlines a KNOWN pair — if either slipped past the matcher (e.g. the
// demo was reformatted in a way the regexes miss), fail loudly rather than ship
// a half-inlined demo/standalone.html that CI's byte-compare could never catch.
if (repoMode) {
  for (const need of ['../letterbox.css', '../reveal-autohide-toolbar.js'])
    if (!inlined.includes(need))
      die(`demo/index.html's reference to ${need} was not recognised for inlining — update demo/index.html or this tool's matchers`);
}
if (!inlined.length) console.error(`⚠ no local assets inlined — nothing to bundle (all references are remote?)`);

const stamped = /<!doctype html>/i.test(bodyOut)
  ? bodyOut.replace(/<!doctype html>/i, m => `${m}\n${banner}`)
  : `${banner}\n${bodyOut}`;

const relOut = OUT.startsWith(process.cwd() + '/') ? OUT.slice(process.cwd().length + 1) : OUT;

if (check) {
  let current = null;
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
  if (current === stamped) { console.log(`✓ ${relOut} is up to date`); process.exit(0); }
  console.error(`✗ ${relOut} is stale or missing — run: ${rebuildCmd}`);
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, stamped);
console.log(`✓ wrote ${relOut} (${(stamped.length / 1024).toFixed(0)} KB) — inlined ${inlined.length}: ${inlined.join(', ')}`);
