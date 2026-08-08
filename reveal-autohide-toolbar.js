/*!
 * reveal.js-autohide-toolbar — presenter toolkit for reveal.js
 * --------------------------------------------------
 * Everything you need at the podium, in one dependency-free file:
 *   • ink annotation over slides (pen, eraser, undo, palette)
 *   • board slides: insert a blank whiteboard (or blackboard — toggle the
 *     surface) as a REAL slide after the current one; the board keeps the
 *     deck's slide format (surface and writable area = the slide box, like
 *     every other slide) and shows in the overview, the speaker view and the
 *     PDF export while staying uncounted, so the audience-visible slide
 *     numbers don't shift
 *   • a Slidev-style auto-hiding toolbar (prev/next, overview, speaker view,
 *     fullscreen, annotate, download/print, slide counter) in the bottom-left
 *     corner
 *   • touch support: toolbar stays visible on no-hover devices, tap left/right
 *     half to navigate (reveal handles swipe natively)
 *   • the annotation toolbar is draggable (grip handle) and minimizable, and
 *     remembers its position
 *   • ink syncs across same-origin windows via the storage event — draw in the
 *     speaker view and it shows on the audience screen, and vice versa
 *     (needs persist: true; concurrent drawing in two windows: last write wins)
 *   • saving & sharing, via the toolbar's download/print menu: save a
 *     self-contained HTML copy of the deck — clean, or with the ink embedded
 *     and the plugin source inlined so the file opens anywhere; a deck can
 *     ship baseline ink in a
 *     <script type="application/json" data-aht-annotations> block
 *   • PDF export, from the same menu (with ink or clean): opens reveal's
 *     ?print-pdf view in a new tab and pops the browser's print dialog —
 *     ink is rendered as crisp SVG overlays, board slides print as real pages
 *
 * Usage — the plugin injects its own CSS and cursors, nothing else to include:
 *
 *   <script src="reveal-autohide-toolbar.js"></script>
 *   Reveal.initialize({ plugins: [ RevealAutohideToolbar ] });
 *
 * Why the ink layer exists: the classic chalkboard plugin misplaces ink under
 * reveal's letterboxing, hides the slide while writing, and only clears
 * everything. This plugin draws over the slide, lands ink exactly under the cursor
 * at any scale, has a true per-stroke eraser and undo, and persists ink.
 *
 * Robustness by construction:
 *   • strokes are stored as ratios of the slide box → survive window resize,
 *     rescale, and letterboxing
 *   • ink is keyed to slides by CONTENT, not by slide number: an explicit
 *     section id (or data-aht-id) wins, else a fingerprint of the slide's
 *     text — inserting, removing or reordering slides later keeps every
 *     annotation on the slide it was drawn on. Old index-keyed storage is
 *     migrated automatically; ink of slides that no longer exist is kept,
 *     not deleted (revert the edit and it comes back)
 *   • each stroke also records the slide aspect ratio at draw time → if the
 *     deck's format later changes (16:9 → 4:3), ink is aspect-fit centred
 *     instead of stretched
 *   • re-placed on reveal resize, window resize, and monitor/zoom DPI changes
 *   • destructive actions (deleting a board slide, clearing the whole deck,
 *     overwriting ink by import) ask for confirmation first
 *   • disabled automatically in reveal's scroll view
 *
 * Options (Reveal.initialize({ autohideToolbar: { … } })):
 *   colors        string[]  swatch palette              (default: 3 neutrals + 5 hues,
 *                           each as an ink (Tailwind 700) / chalk (Tailwind 300) pair)
 *   defaultColor  string    initial pen colour          (default: '#B91C1C')
 *   widths        {name:px} pen widths                  (default: {thin:3,med:6,thick:11})
 *   defaultWidth  number    initial pen width           (default: 6)
 *   eraserRadius  number    eraser hit radius (px)       (default: 16)
 *   persist       boolean   save ink to localStorage     (default: true)
 *   storageKey    string    localStorage key             (default: 'aht:'+pathname)
 *   annotations   boolean   false = present clean: ignore stored/embedded ink
 *                           and draw session-only, nothing is deleted (also
 *                           via URL param ?aht-ink=0)    (default: true)
 *   tapToAdvance  boolean   touch tap-to-navigate        (default: true)
 *   tapIgnore     string    selector for tap targets that must NOT navigate
 *   tools         string[]  toolbar items, in order      (default below); items:
 *                           'prev','updown','next','overview','speaker',
 *                           'fullscreen','annotate','export','slideno','sep' —
 *                           'updown' is the vertical up/down arrow cluster,
 *                           shown only on slides with a vertical route;
 *                           'export' opens the download/print menu
 *   position      string    'bottom-left' (default) or 'bottom-right' — move the
 *                           toolbar when another plugin (e.g. reveal.js-menu)
 *                           owns the bottom-left corner
 *   toggleKey     string    annotation toggle key        (default 'a'; change it
 *                           on autoSlide decks — reveal core uses A for pause)
 *   palmRejection boolean   once a stylus (pointerType 'pen') is used, bare
 *                           touches no longer draw — rest your palm freely
 *                           (default true; finger drawing works until then)
 *   boardSurface  string    surface of NEW board slides: 'white' (default)
 *                           or 'dark' (blackboard, colour via --aht-board-bg)
 *
 * Theming (CSS custom properties, set them on :root in the host deck):
 *   --aht-accent    active-tool highlight            (default #E31937)
 *   --aht-font      toolbar font                     (default 'Open Sans', system-ui)
 *   --aht-panel-bg  navigation toolbar background    (default rgba(10,18,34,.82))
 *   --aht-bar-bg    annotation toolbar background    (default rgba(6,18,42,.92))
 *   --aht-board-bg  blackboard colour                (default #000000)
 *   --aht-edge      dashed writable-area outline     (default rgba(125,135,155,.55))
 *   --aht-z         base z-index                     (default 30)
 *
 * Keys: A annotate · E eraser · Ctrl+Z undo · Ctrl+Shift+Z redo ·
 *       X clear slide · Shift+X clear all · Esc exit
 *
 * Assumes a single, full-viewport deck (the common case). Not yet multi-deck /
 * embedded-safe: UI is appended to <body> and listeners are document-level.
 *
 * Licence: MIT. Toolbar icons are lucide (https://lucide.dev, ISC).
 */
(function () {
  'use strict';

  const DEFAULTS = {
    // Curated stage palette (user-tuned): three neutrals, then every hue as an
    // INK/CHALK pair from the Tailwind ramps — ink = the 700 shade (reads on
    // white slides, survives washed-out projectors), chalk = the 300 shade
    // (reads on dark boards even when a projector lifts their black to gray).
    // Verified against a projector simulation (contrast/saturation compression
    // + 40% room light): darker calm shades gain little on white but the 300s
    // beat brighter "stage" colours on the gray-washed board by a wide margin.
    colors: [
      '#FFFFFF', '#8E8E93', '#000000',   // neutrals: white, gray, black
      '#B91C1C', '#FCA5A5',              // red:    ink | chalk
      '#B45309', '#FCD34D',              // amber:  ink | chalk
      '#15803D', '#86EFAC',              // green:  ink | chalk
      '#1D4ED8', '#93C5FD',              // blue:   ink | chalk
      '#7E22CE', '#D8B4FE',              // purple: ink | chalk
    ],
    defaultColor: '#B91C1C',
    widths: { thin: 3, med: 6, thick: 11 },
    defaultWidth: 6,
    eraserRadius: 16,
    persist: true,
    storageKey: 'aht:' + location.pathname,
    annotations: true,
    tapToAdvance: true,
    tapIgnore: 'a, button, input, textarea, select, video, audio, iframe, summary, [contenteditable], [data-aht-no-tap]',
    tools: ['prev', 'updown', 'next', 'sep', 'overview', 'speaker', 'fullscreen', 'sep', 'annotate', 'export', 'slideno'],
    position: 'bottom-left',
    toggleKey: 'a',
    palmRejection: true,   // once a stylus is used, bare-touch input no longer draws
    boardSurface: 'white', // new board slides start white; 'dark' for blackboards
  };

  // ---------- shared icon path data (lucide) ----------
  // The pen/eraser shapes are used twice: as toolbar icons and as mouse cursors.
  const PEN_D = [
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    'm15 5 4 4',
  ];
  const ERASER_D = [
    'M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21',
    'm5.082 11.09 8.828 8.828',
  ];
  const paths = (ds) => ds.map((d) => `<path d="${d}"/>`).join('');
  // cursor: a white halo pass under an outlined, colour-filled pass (first path filled)
  const cursorSvg = (ds, fill) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">'
    + ds.map((d) => `<path fill="none" stroke="#ffffff" stroke-width="4.5" d="${d}"/>`).join('')
    + ds.map((d, i) => `<path fill="${i === 0 ? fill : 'none'}" stroke="#111111" stroke-width="1.6" d="${d}"/>`).join('')
    + '</svg>';
  const cur = (svg) => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';

  const CSS = `
#aht-canvas { position: fixed; z-index: var(--aht-z, 30); pointer-events: none; touch-action: none; background: transparent; }
#aht-canvas.active { pointer-events: auto; cursor: ${cur(cursorSvg(PEN_D, '#FCD34D'))} 2 22, crosshair; }
/* while annotating, a subtle dashed outline shows WHERE ink can go (the slide
   box) — the deck's letterbox margins are otherwise invisible on a plain
   background. Boards share the same box, so the outline applies there too. */
#aht-canvas.active { outline: 2px dashed var(--aht-edge, rgba(125, 135, 155, .55)); outline-offset: -2px; }
#aht-canvas.active.erasing { cursor: ${cur(cursorSvg(ERASER_D, '#F4A3A3'))} 6 20, cell; }

/* board slides keep the deck's slide format: the SECTION is the surface,
   filling the slide box exactly (reveal makes sections width:100% already) */
.reveal .slides section[data-aht-board] { height: 100%; }
.reveal .slides section[data-aht-surface="white"] { background-color: #FFFFFF; }
.reveal .slides section[data-aht-surface="dark"] { background-color: var(--aht-board-bg, #000000); }

#aht-toolbar {
  position: fixed; left: 14px; bottom: 12px; z-index: calc(var(--aht-z, 30) + 30);
  display: flex; align-items: center; gap: 3px; padding: 4px 6px;
  background: var(--aht-panel-bg, rgba(10, 18, 34, .82));
  border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.4);
  -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  opacity: 0; pointer-events: none; transform: translateY(6px);
  transition: opacity .22s ease, transform .22s ease;
}
body.aht-chrome #aht-toolbar { opacity: 1; pointer-events: auto; transform: none; }
.aht-btn {
  width: 32px; height: 32px; border: none; border-radius: 7px;
  background: transparent; color: #e7ecf5;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .12s, color .12s;
}
.aht-btn:hover { background: rgba(255,255,255,.14); }
.aht-btn svg { width: 18px; height: 18px; display: block; }
.aht-btn[hidden] { display: none; }
/* the download/print button is double width: two symbols, one action (menu) */
#aht-export { width: 56px; gap: 3px; }
.aht-btn.dim { opacity: .3; pointer-events: none; }
/* vertical up/down cluster: two half-height arrows stacked between prev/next,
   like the arrow keys on a laptop keyboard — only shown for decks that
   actually use vertical slides */
.aht-updown { display: flex; flex-direction: column; gap: 2px; }
.aht-updown[hidden] { display: none; }
.aht-updown .aht-btn { width: 24px; height: 15px; border-radius: 5px; }
.aht-updown .aht-btn svg { width: 12px; height: 12px; }
#aht-slideno { color: #aeb8cc; font: 600 12px/1 var(--aht-font, 'Open Sans', system-ui, sans-serif); padding: 0 6px 0 4px; white-space: nowrap; user-select: none; }

#aht-bar {
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: calc(var(--aht-z, 30) + 30);
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  flex-wrap: wrap; justify-content: center;
  /* size to CONTENT: a positioned element otherwise shrink-to-fits into the
     space right of 'left' and wraps far too early (left:50% → half the
     viewport); max-width still wraps it on genuinely narrow screens */
  width: -webkit-max-content; width: max-content;
  max-width: calc(100vw - 16px); box-sizing: border-box;
  background: var(--aht-bar-bg, rgba(6,18,42,.92));
  border-radius: 12px; box-shadow: 0 4px 18px rgba(0,0,0,.4);
  font-family: var(--aht-font, 'Open Sans', system-ui, sans-serif);
}
#aht-bar[hidden] { display: none; }
#aht-bar button {
  border: none; background: transparent; color: #e7ecf5;
  width: 30px; height: 30px; border-radius: 8px; font-size: 15px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; transition: background .12s, color .12s;
}
#aht-bar button svg { width: 18px; height: 18px; display: block; }
#aht-bar button:hover { background: rgba(255,255,255,.14); }
#aht-bar button.active { background: var(--aht-accent, #E31937); color: #fff; }
#aht-bar button[hidden] { display: none; }
#aht-bar .aht-sep { width: 1px; height: 22px; background: rgba(255,255,255,.18); margin: 0 3px; }
#aht-bar .aht-grip { color: #8fa0bb; cursor: grab; touch-action: none; display: inline-flex; align-items: center; padding: 0 2px; }
#aht-bar .aht-grip:active { cursor: grabbing; }
#aht-bar .aht-grip svg { width: 16px; height: 16px; }
#aht-bar.min > :not(.aht-grip):not(#aht-minbtn) { display: none; }
#aht-bar .aht-swatches, #aht-bar .aht-widths { display: inline-flex; align-items: center; gap: 4px; }
#aht-bar .aht-swatch { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); }
#aht-bar .aht-swatch.light { border-color: rgba(0,0,0,.25); }
#aht-bar .aht-swatch.active { border-color: #fff; box-shadow: 0 0 0 2px var(--aht-accent, #E31937); }
#aht-bar .aht-w { width: 26px; height: 26px; }
#aht-bar .aht-w span { display: inline-block; background: #e7ecf5; border-radius: 50%; }
#aht-bar .aht-w.active { background: rgba(255,255,255,.2); }
#aht-bar .aht-w.active span { background: #fff; }

#aht-confirm-wrap {
  position: fixed; inset: 0; z-index: calc(var(--aht-z, 30) + 40);
  background: rgba(0,0,0,.25);
  display: flex; align-items: center; justify-content: center;
}
#aht-confirm {
  background: var(--aht-bar-bg, rgba(6,18,42,.92)); color: #e7ecf5;
  border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.5);
  padding: 14px 16px; max-width: 340px;
  font: 14px/1.45 var(--aht-font, 'Open Sans', system-ui, sans-serif);
}
#aht-confirm .aht-confirm-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
#aht-confirm button {
  border: none; border-radius: 8px; padding: 6px 14px; cursor: pointer;
  font: 600 13px var(--aht-font, 'Open Sans', system-ui, sans-serif);
}
#aht-confirm .aht-ok { background: var(--aht-accent, #E31937); color: #fff; }
#aht-confirm .aht-cancel { background: rgba(255,255,255,.14); color: #e7ecf5; }

#aht-export-wrap { position: fixed; inset: 0; z-index: calc(var(--aht-z, 30) + 40); }
#aht-export-menu {
  position: absolute; display: flex; flex-direction: column; gap: 2px;
  background: var(--aht-bar-bg, rgba(6,18,42,.92)); color: #e7ecf5;
  border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.5);
  padding: 8px; width: -webkit-max-content; width: max-content;
  max-width: calc(100vw - 16px); box-sizing: border-box;
}
#aht-export-menu .aht-export-item {
  display: flex; align-items: center; gap: 10px; text-align: left;
  border: none; background: transparent; color: #e7ecf5; cursor: pointer;
  border-radius: 8px; padding: 7px 10px;
  font: 600 13px/1.3 var(--aht-font, 'Open Sans', system-ui, sans-serif);
}
#aht-export-menu .aht-export-item:hover { background: rgba(255,255,255,.14); }
#aht-export-menu .aht-export-item svg { width: 18px; height: 18px; flex: none; }
#aht-export-menu .aht-export-item small {
  display: block; color: #aeb8cc;
  font: 400 11px/1.3 var(--aht-font, 'Open Sans', system-ui, sans-serif);
}
#aht-export-menu .aht-export-hint {
  color: #8fa0bb; max-width: 230px; padding: 4px 10px 2px;
  font: 400 11px/1.4 var(--aht-font, 'Open Sans', system-ui, sans-serif);
}

/* while annotating, nothing on the page may be text-selected — prevents iOS
   long-press selection callouts (Copy | Find Selection) under the palm */
body.aht-noselect, body.aht-noselect * {
  -webkit-user-select: none !important; user-select: none !important;
  -webkit-touch-callout: none !important;
}

@media print { #aht-canvas, #aht-toolbar, #aht-bar, #aht-export-wrap { display: none !important; } }
`;

  // ---------- state ----------
  let cfg;
  const state = {
    Reveal: null, on: false, overview: false, tool: 'pen', color: null, width: 0,
    strokes: {}, boards: [], undo: {}, redo: {}, drawing: false, cur: null, pid: null,
  };
  let canvas, ctx, bar, launch, slideNoEl, toolsEl, slidesEl;
  let rect = null;            // slide box in CSS px — updated in place() / on pen-down
  let zone = null;            // toolbar hover-wake zone, derived from the toolbar's rect
  let chromeTimer = null, layoutTimer = null, noHover = false, tap = null;
  let confirmEl = null;       // the open confirmation dialog, if any
  let exportEl = null;        // the open download/print menu, if any
  let boardAuto = false;      // annotation was auto-enabled by entering a board slide

  // ---------- stable slide keys ----------
  // Ink is keyed to slides by CONTENT, not position, so editing the deck later
  // (inserting, removing, reordering slides) keeps every annotation on the
  // slide it was drawn on. Key priority per section:
  //   'id:<id>'    explicit section id (survives any edit — author-controlled)
  //   's:<id>'     a data-aht-id attribute
  //   'b:<id>'     a board slide inserted by this plugin
  //   'c:<hash>:n' fingerprint of the slide's text (nth identical twin)
  let keyCache = new WeakMap();
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function leafSections() {
    return Array.prototype.filter.call(
      slidesEl.querySelectorAll('section'),
      (s) => !s.querySelector('section'));
  }
  function computeKeys() {
    keyCache = new WeakMap();
    const counts = {};
    leafSections().forEach((s) => {
      if (s.hasAttribute('data-aht-board')) { keyCache.set(s, 'b:' + s.getAttribute('data-aht-board')); return; }
      let k;
      if (s.id) k = 'id:' + s.id;
      else if (s.getAttribute('data-aht-id')) k = 's:' + s.getAttribute('data-aht-id');
      else {
        const basis = (s.textContent || '').replace(/\s+/g, ' ').trim()
          || (s.innerHTML || '').replace(/\s+/g, ' ').trim();
        const h = fnv1a(basis);
        const n = counts[h] || 0; counts[h] = n + 1;
        k = 'c:' + h + ':' + n;
      }
      keyCache.set(s, k);
    });
  }
  function curKey() {
    const s = state.Reveal.getCurrentSlide && state.Reveal.getCurrentSlide();
    if (!s) return '?';
    let k = keyCache.get(s);
    if (!k) { computeKeys(); k = keyCache.get(s) || '?'; }
    return k;
  }
  const boardIdOf = (s) => (s && s.getAttribute ? s.getAttribute('data-aht-board') : null);
  const boardById = (id) => state.boards.find((b) => b.id === id);
  const onBoard = () => !!boardIdOf(state.Reveal.getCurrentSlide && state.Reveal.getCurrentSlide());

  // every listener registers an undo so destroy() can fully clean up
  let cleanups = [];
  const listen = (target, ev, fn, opts) => {
    target.addEventListener(ev, fn, opts);
    cleanups.push(() => target.removeEventListener(ev, fn, opts));
  };
  const revealOn = (ev, fn) => {
    state.Reveal.on(ev, fn);
    cleanups.push(() => state.Reveal.off && state.Reveal.off(ev, fn));
  };

  // ---------- geometry ----------
  const aspect = () => Math.round(rect.width / rect.height * 1e4) / 1e4;
  // Aspect-fit box for a stroke: if the deck's format changed since the stroke
  // was drawn (st.a ≠ current aspect), fit the original-aspect box centred into
  // the current slide box so ink keeps its shape instead of stretching.
  function strokeBox(st) {
    const a0 = st.a, curA = rect.width / rect.height;
    if (!a0 || Math.abs(curA - a0) < 0.002) return { ox: 0, oy: 0, w: rect.width, h: rect.height };
    let w, h;
    if (curA >= a0) { h = rect.height; w = h * a0; } else { w = rect.width; h = w / a0; }
    return { ox: (rect.width - w) / 2, oy: (rect.height - h) / 2, w, h };
  }
  const toPx = (pt, box) => ({ x: box.ox + pt.xr * box.w, y: box.oy + pt.yr * box.h });
  // ratio point, rounded to 4 decimals (sub-pixel at 8K, ~60% smaller when serialized)
  const toRatio = (p) => ({ xr: Math.round(p.x / rect.width * 1e4) / 1e4, yr: Math.round(p.y / rect.height * 1e4) / 1e4 });
  const luminance = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  };

  function place() {
    // ink overlays the slide box — on normal slides AND boards alike: boards
    // keep the deck's slide format, so the writable area never changes shape
    rect = slidesEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.left = rect.left + 'px'; canvas.style.top = rect.top + 'px';
    canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function redraw() {
    // pre-'ready' adoption (late embed read, storage event) may land before
    // the first place(): nothing to paint yet — 'ready' → place() → redraw()
    if (!rect) return;
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const st of (state.strokes[curKey()] || [])) drawStroke(st);
  }
  // strokes remember the slide-box width at draw time (bw) so line width scales
  // with the content instead of staying constant px (pre-bw strokes: as-is)
  const strokeWidth = (st, boxW) => (st.bw ? st.width * (boxW / st.bw) : st.width);
  function drawStroke(st) {
    const pts = st.points;
    if (!pts.length) return;
    const box = strokeBox(st);
    const w = strokeWidth(st, box.w);
    ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = w;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const p0 = toPx(pts[0], box);
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(p0.x, p0.y, w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = toPx(pts[i], box), b = toPx(pts[i + 1], box);
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    const last = toPx(pts[pts.length - 1], box);
    ctx.lineTo(last.x, last.y); ctx.stroke();
  }

  // ---------- undo + persistence ----------
  // Shallow snapshot is enough: stroke objects are never mutated once another
  // stroke begins (the pen appends to a NEW object; erase/clear replace arrays).
  function pushUndo() {
    const id = curKey();
    (state.undo[id] = state.undo[id] || []).push((state.strokes[id] || []).slice());
    if (state.undo[id].length > 100) state.undo[id].shift();
    state.redo[id] = [];   // a new action invalidates the redo branch
  }
  // undo and redo are the same move with the two stacks swapped
  function shiftStack(from, to) {
    const id = curKey(), stack = from[id];
    if (!stack || !stack.length) return;
    (to[id] = to[id] || []).push((state.strokes[id] || []).slice());
    state.strokes[id] = stack.pop(); redraw(); save();
  }
  const undo = () => shiftStack(state.undo, state.redo);
  const redo = () => shiftStack(state.redo, state.undo);
  const envelope = () => ({ v: 1, strokes: state.strokes, boards: state.boards });
  function save() { if (!cfg.persist) return; try { localStorage.setItem(cfg.storageKey, JSON.stringify(envelope())); } catch (e) {} }
  // Accepts the v1 envelope or the legacy bare strokes map ('h-v' index keys,
  // pre-v0.3) — legacy keys are remapped to the current slides' stable keys.
  function parseEnvelope(raw) {
    try {
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return null;
      if (d.v === 1) {
        // boards may come from a hand-edited envelope: drop junk entries (a
        // throw here would discard the WHOLE envelope, strokes included) and
        // pin bg so everything downstream (boardSection, toggleSurface) can
        // trust it
        const boards = (Array.isArray(d.boards) ? d.boards : []).filter((b) => b && typeof b === 'object');
        boards.forEach((b) => { b.bg = b.bg === 'white' ? 'white' : 'dark'; });
        return { strokes: d.strokes || {}, boards: boards };
      }
      return { strokes: migrateIndexKeys(d), boards: [] };
    } catch (e) { return null; }
  }
  function migrateIndexKeys(old) {
    const out = {};
    for (const k in old) {
      const m = /^(\d+)-(\d+)$/.exec(k);
      let nk = k;
      if (m && state.Reveal.getSlide) {
        const s = state.Reveal.getSlide(+m[1], +m[2]);
        if (s) nk = keyCache.get(s) || k;
      }
      out[nk] = old[k];
    }
    return out;
  }
  // the one name every encoding of the embedded block shares: the DOM reader
  // below, and the source matcher + builder in saveCopy
  const EMBED_ATTR = 'data-aht-annotations';
  function readEmbedded() {
    const n = document.querySelector('script[type="application/json"][' + EMBED_ATTR + ']');
    if (!n) return null;
    return parseEnvelope(n.textContent);
  }
  function load(onLate) {
    if (!cfg.annotations) return;   // present clean: start empty, touch nothing
    let env = null;
    if (cfg.persist) { try { const s = localStorage.getItem(cfg.storageKey); if (s) env = parseEnvelope(s); } catch (e) {} }
    // no local state (not even a cleared-empty one) → adopt the deck's baseline
    if (!env) env = readEmbedded();
    if (env) { state.strokes = env.strokes || {}; state.boards = env.boards || []; }
    else if (onLate && document.readyState === 'loading') {
      // a saved copy appends its annotations block just before </body> —
      // BEHIND the script that runs Reveal.initialize(), and plugin init
      // happens in its microtasks, before the parser reaches the block.
      // Re-read once the document is complete; the caller adopts it late.
      listen(document, 'DOMContentLoaded', () => {
        const late = readEmbedded();
        if (late) onLate(late);
      }, { once: true });
    }
  }

  // ---------- pointer drawing ----------
  const xy = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  let penSeen = false;   // once a stylus is used, bare-touch input stops drawing (palm rejection)
  let eraseSnapped = false;   // one undo snapshot per erase gesture, taken at the first hit
  function onDown(e) {
    if (!state.on) return;
    e.preventDefault();
    if (e.pointerType === 'pen') penSeen = true;
    // palm rejection: with a stylus in play, finger/palm touches neither draw
    // nor reach the page (no iOS text-selection callouts on the slide)
    if (e.pointerType === 'touch' && cfg.palmRejection && penSeen) return;
    if (state.drawing) return;               // one stroke at a time
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    state.pid = e.pointerId;
    rect = canvas.getBoundingClientRect();   // refresh once per gesture (zoom-safe)
    const p = xy(e);
    if (state.tool === 'eraser') { state.drawing = 'erase'; eraseSnapped = false; eraseAt(p); return; }
    pushUndo();   // the pen always commits at least a dot — snapshot up front
    state.drawing = 'pen';
    state.cur = { color: state.color, width: state.width, a: aspect(), bw: Math.round(rect.width), points: [toRatio(p)] };
    const id = curKey();
    (state.strokes[id] = state.strokes[id] || []).push(state.cur);
    ctx.fillStyle = state.color; ctx.beginPath(); ctx.arc(p.x, p.y, state.width / 2, 0, Math.PI * 2); ctx.fill();
  }
  function onMove(e) {
    if (!state.on || !state.drawing || e.pointerId !== state.pid) return;
    e.preventDefault();
    const p = xy(e);
    if (state.drawing === 'erase') { eraseAt(p); return; }
    const pts = state.cur.points;
    // the live stroke's aspect equals the current one, so its box is the identity
    const prev = { x: pts[pts.length - 1].xr * rect.width, y: pts[pts.length - 1].yr * rect.height };
    if (Math.abs(p.x - prev.x) < 1.5 && Math.abs(p.y - prev.y) < 1.5) return;  // thin out jitter
    pts.push(toRatio(p));
    ctx.strokeStyle = state.color; ctx.lineWidth = state.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function onUp(e) {
    if (!state.drawing || (e && e.pointerId !== state.pid)) return;
    state.drawing = false; state.cur = null; state.pid = null;
    redraw(); save();
  }
  function eraseAt(p) {
    const id = curKey(), list = state.strokes[id] || [], keep = [];
    let changed = false;
    for (const st of list) {
      let hit = false;
      const box = strokeBox(st);
      const tol = cfg.eraserRadius + st.width / 2;
      for (const pt of st.points) {
        const dx = box.ox + pt.xr * box.w - p.x, dy = box.oy + pt.yr * box.h - p.y;
        if (dx * dx + dy * dy <= tol * tol) { hit = true; break; }
      }
      if (hit) changed = true; else keep.push(st);
    }
    if (changed) {
      // snapshot only when something is actually erased — a miss gesture must
      // not wipe the redo branch (pushUndo clears it)
      if (!eraseSnapped) { pushUndo(); eraseSnapped = true; }
      state.strokes[id] = keep; redraw();   // saved once, on gesture end (onUp)
    }
  }

  // ---------- DOM + icons ----------
  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }
  const sep = () => el('span', { class: 'aht-sep' });
  const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    pen: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}>${paths(PEN_D)}</svg>`,
    eraser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}>${paths(ERASER_D)}</svg>`,
    undo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,
    redo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>`,
    // lucide brush-cleaning: sweep this slide clean; with a sparkle on top it
    // means "sweep the whole deck"
    clean: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="m16 22-1-4"/><path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1"/><path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z"/><path d="m8 22 1-4"/></svg>`,
    cleanAll: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="m16 22-1-4"/><path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1"/><path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z"/><path d="m8 22 1-4"/><path d="M20 2v4"/><path d="M22 4h-4"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    maximize: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
    minimize: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`,
    grid: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
    notes: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>`,
    prev: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="m15 18-6-6 6-6"/></svg>`,
    next: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="m9 18 6-6-6-6"/></svg>`,
    grip: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,
    chevDown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="m6 9 6 6 6-6"/></svg>`,
    chevUp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="m18 15-6-6-6 6"/></svg>`,
    // board icons follow lucide conventions: a plus to insert, the diagonal
    // "-off" slash to remove (shown while ON a board slide)
    board: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M12 8v6"/><path d="M9 11h6"/></svg>`,
    boardOff: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m3 3 18 16"/></svg>`,
    contrast: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z" fill="currentColor"/></svg>`,
    // save with ink (lucide save-pen) vs a plain clean copy (lucide save)
    save: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.2a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4v.3"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/><path d="M13.33 13H8a1 1 0 0 0-1 1v7"/><path d="M14.363 17.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 1 0-3.004-3.004z"/></svg>`,
    saveClean: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>`,
    // lucide printer, and two composites after the printer-check pattern:
    // printer + pen (print WITH ink) and printer + down arrow (the toolbar's
    // download/print button)
    print: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>`,
    printInk: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><path d="M11 22H7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6"/><path d="M14.363 17.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 1 0-3.004-3.004z"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>`,
  };
  function btn(attrs, icon, onclick) {
    const b = el('button', attrs, icon);
    b.onclick = onclick;
    return b;
  }
  const deckBtn = (title, icon, onclick) => btn({ class: 'aht-btn', title: title }, icon, onclick);

  function buildUI() {
    const R = state.Reveal;
    toolsEl = el('div', { id: 'aht-toolbar' });

    // the annotate (pen) button is always created so keyboard/API can drive it,
    // even if it's not placed in the toolbar
    launch = deckBtn('Annotate (A)', ICONS.pen, () => enable(true));
    launch.id = 'aht-annotate';

    let fsBtn = null;
    const mk = {
      // ◀/▶ behave like the cursor keys: fragments, then horizontal — vertical
      // stacks are entered deliberately via the ▲/▼ cluster, never implicitly
      prev: () => deckBtn('Previous (←)', ICONS.prev, () => (R.left ? R.left() : R.prev())),
      next: () => deckBtn('Next (→)', ICONS.next, () => (R.right ? R.right() : R.next())),
      updown: () => {
        const wrap = el('span', { id: 'aht-updown', class: 'aht-updown', hidden: '' });
        wrap.appendChild(btn({ id: 'aht-up', class: 'aht-btn', title: 'Up (↑)' }, ICONS.chevUp, () => R.up()));
        wrap.appendChild(btn({ id: 'aht-down', class: 'aht-btn', title: 'Down (↓)' }, ICONS.chevDown, () => R.down()));
        return wrap;
      },
      overview: () => deckBtn('Slide overview (O / Esc)', ICONS.grid, () => R.toggleOverview()),
      speaker: () => deckBtn('Speaker view (S)', ICONS.notes, openNotes),
      fullscreen: () => (fsBtn = deckBtn('Fullscreen (F)', ICONS.maximize, toggleFullscreen)),
      annotate: () => launch,
      // one place for everything that leaves the browser: HTML copies and
      // PDF/print — opens its own menu, like the pen opens the annotation bar.
      // One double-width button showing both symbols: printer | download.
      export: () => btn({ id: 'aht-export', class: 'aht-btn', title: 'Download or print this deck' }, ICONS.print + ICONS.download, exportMenu),
    };
    cfg.tools.forEach((name) => {
      if (name === 'sep') toolsEl.appendChild(sep());
      else if (name === 'slideno') toolsEl.appendChild(slideNoEl = el('span', { id: 'aht-slideno' }));
      else if (mk[name]) toolsEl.appendChild(mk[name]());
    });
    if (cfg.position === 'bottom-right') { toolsEl.style.left = 'auto'; toolsEl.style.right = '14px'; }
    document.body.appendChild(toolsEl);

    if (fsBtn) {
      const syncFs = () => { fsBtn.innerHTML = (document.fullscreenElement || document.webkitFullscreenElement) ? ICONS.minimize : ICONS.maximize; };
      listen(document, 'fullscreenchange', syncFs);
      listen(document, 'webkitfullscreenchange', syncFs);
    }

    // annotation toolbar (bottom-centre, shown while drawing)
    bar = el('div', { id: 'aht-bar', hidden: '' });
    const penBtn = btn({ 'data-tool': 'pen', title: 'Pen (A)' }, ICONS.pen, () => setTool('pen'));
    const eraBtn = btn({ 'data-tool': 'eraser', title: 'Eraser (E)' }, ICONS.eraser, () => setTool('eraser'));

    const swatches = el('span', { class: 'aht-swatches' });
    cfg.colors.forEach((c) => {
      const cls = 'aht-swatch' + (luminance(c) > 0.8 ? ' light' : '');
      const b = btn({ class: cls, 'data-color': c, title: c }, null, () => setColor(c));
      b.style.background = c;
      swatches.appendChild(b);
    });

    const widths = el('span', { class: 'aht-widths' });
    Object.entries(cfg.widths).forEach(([name, w]) => {
      widths.appendChild(btn({ class: 'aht-w', 'data-w': w, title: name + ' pen' },
        '<span style="width:' + (w + 4) + 'px;height:' + (w + 4) + 'px"></span>', () => setWidth(w)));
    });

    const grip = el('span', { class: 'aht-grip', title: 'Drag to move this toolbar' }, ICONS.grip);
    initBarDrag(grip);
    const minBtn = btn({ id: 'aht-minbtn', title: 'Minimize toolbar' }, ICONS.chevDown, () => {
      barPos = Object.assign({}, barPos, { min: !(barPos && barPos.min) });
      applyBarPos(); saveUI();
    });

    [grip, penBtn, eraBtn,
      btn({ title: 'Undo (Ctrl+Z)' }, ICONS.undo, undo),
      btn({ id: 'aht-redo', title: 'Redo (Ctrl+Shift+Z)' }, ICONS.redo, redo),
      btn({ id: 'aht-clear', title: 'Clear all ink on this slide (X)' }, ICONS.clean, clearSlide),
      sep(), swatches, sep(), widths, sep(),
      btn({ id: 'aht-board', title: 'Insert board slide' }, ICONS.board, () => (onBoard() ? removeBoardConfirmed() : addBoard())),
      btn({ id: 'aht-surface', title: 'Board surface: dark / white', hidden: '' }, ICONS.contrast, toggleSurface),
      sep(),
      btn({ id: 'aht-clearall', title: 'Delete all ink and board slides (Shift+X)' }, ICONS.cleanAll, clearAllConfirmed),
      sep(),
      minBtn,
      btn({ title: 'Exit annotation (A / Esc)' }, ICONS.x, () => enable(false)),
    ].forEach((n) => bar.appendChild(n));
    document.body.appendChild(bar);
    applyBarPos();
    syncUI();
    syncBoardUI();
  }

  // ---------- confirmation dialog (destructive actions only) ----------
  // Deliberately not window.confirm(): native dialogs can drop fullscreen and
  // don't match the deck. Esc or a click outside cancels.
  function confirmBox(msg, okLabel, onOk) {
    closeConfirm();
    const wrap = el('div', { id: 'aht-confirm-wrap' });
    const box = el('div', { id: 'aht-confirm' });
    box.appendChild(el('div', null, msg));
    const btns = el('div', { class: 'aht-confirm-btns' });
    btns.appendChild(btn({ class: 'aht-cancel' }, 'Cancel', closeConfirm));
    btns.appendChild(btn({ class: 'aht-ok' }, okLabel, () => { closeConfirm(); onOk(); }));
    box.appendChild(btns);
    wrap.appendChild(box);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeConfirm(); });
    document.body.appendChild(wrap);
    confirmEl = wrap;
  }
  function closeConfirm() { if (confirmEl) { confirmEl.remove(); confirmEl = null; } }

  // the print handshake: openPrint() writes these URL params, readCfg() and
  // initPrint() match them via these shared regexes — one contract, one place
  const RE_PRINT = /[?&]aht-print=1/, RE_NOINK = /[?&]aht-ink=0/;

  // ---------- download / print menu ----------
  // Anchored above the toolbar's export button. Esc or a click anywhere
  // outside (including the button itself) closes it.
  function exportMenu() {
    if (exportEl) return closeExport();
    const wrap = el('div', { id: 'aht-export-wrap' });
    const box = el('div', { id: 'aht-export-menu' });
    const item = (icon, label, hint, fn) => btn({ class: 'aht-export-item' },
      icon + '<span>' + label + '<small>' + hint + '</small></span>',
      () => { closeExport(); fn(); });
    box.appendChild(item(ICONS.saveClean, 'Save a copy', 'single HTML file, no ink', () => saveCopy(false)));
    if (cfg.annotations) {
      box.appendChild(item(ICONS.save, 'Save annotated copy', 'ink &amp; boards embedded', () => saveCopy(true)));
      box.appendChild(item(ICONS.printInk, 'PDF / print with ink', 'opens the browser’s print dialog', () => openPrint(true)));
    }
    box.appendChild(item(ICONS.print, 'PDF / print clean', 'slides only', () => openPrint(false)));
    box.appendChild(el('div', { class: 'aht-export-hint' },
      'PDF: choose “Save as PDF” in the dialog and enable background graphics.'));
    wrap.appendChild(box);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeExport(); });
    document.body.appendChild(wrap);
    const r = toolsEl.querySelector('#aht-export').getBoundingClientRect();
    box.style.left = Math.min(Math.max(8, r.left - 8), window.innerWidth - box.offsetWidth - 8) + 'px';
    box.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    exportEl = wrap;
  }
  function closeExport() { if (exportEl) { exportEl.remove(); exportEl = null; } }
  // Open reveal's print view in a NEW tab (the live talk keeps running
  // untouched) with aht-print=1: there the plugin pops the browser's print
  // dialog once the layout is ready — "Save as PDF" is all that's left to do.
  function openPrint(withInk) {
    const u = new URL(location.href);
    u.searchParams.set('print-pdf', '');
    u.searchParams.set('aht-print', '1');
    if (withInk === false) u.searchParams.set('aht-ink', '0');
    else u.searchParams.delete('aht-ink');
    u.hash = '';
    window.open(u.href, '_blank');
  }

  // ---------- annotation-bar position: draggable + minimizable ----------
  let barPos = null;   // { x, y, min } — persisted per deck under storageKey + ':ui'
  function saveUI() { if (!cfg.persist) return; try { localStorage.setItem(cfg.storageKey + ':ui', JSON.stringify(barPos || {})); } catch (e) {} }
  function loadUI() { if (!cfg.persist) return; try { const s = localStorage.getItem(cfg.storageKey + ':ui'); if (s) barPos = JSON.parse(s); } catch (e) {} }
  function applyBarPos() {
    if (!bar) return;
    const min = !!(barPos && barPos.min);
    bar.classList.toggle('min', min);
    const mb = bar.querySelector('#aht-minbtn');
    if (mb) { mb.innerHTML = min ? ICONS.chevUp : ICONS.chevDown; mb.title = min ? 'Restore toolbar' : 'Minimize toolbar'; }
    if (barPos && typeof barPos.x === 'number') {
      const x = Math.min(Math.max(barPos.x, 4), window.innerWidth - bar.offsetWidth - 4);
      const y = Math.min(Math.max(barPos.y, 4), window.innerHeight - bar.offsetHeight - 4);
      bar.style.left = x + 'px'; bar.style.top = y + 'px';
      bar.style.bottom = 'auto'; bar.style.transform = 'none';
    }
  }
  function initBarDrag(grip) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const r = bar.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => { barPos = Object.assign({}, barPos, { x: ev.clientX - dx, y: ev.clientY - dy }); applyBarPos(); };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); saveUI(); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  function syncUI() {
    if (!bar) return;
    bar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tool') === state.tool));
    bar.querySelectorAll('.aht-swatch').forEach((b) => b.classList.toggle('active', b.getAttribute('data-color') === state.color));
    bar.querySelectorAll('.aht-w').forEach((b) => b.classList.toggle('active', +b.getAttribute('data-w') === state.width));
  }
  // board-context controls: the board button flips to "remove" on a board
  // slide, and the surface (dark/white) toggle only shows there
  function syncBoardUI() {
    if (!bar) return;
    const isB = onBoard();
    const bb = bar.querySelector('#aht-board');
    const mode = isB ? 'remove' : 'add';
    if (bb && bb.dataset.mode !== mode) {   // mode doubles as the no-rework memo
      bb.dataset.mode = mode;
      bb.classList.toggle('active', isB);
      bb.innerHTML = isB ? ICONS.boardOff : ICONS.board;
      bb.title = isB ? 'Remove this board slide' : 'Insert board slide';
    }
    const sb = bar.querySelector('#aht-surface');
    if (sb) sb.hidden = !isB;
  }

  // ---------- visibility: one render derived from state ----------
  function render() {
    const ov = state.overview;
    canvas.style.display = ov ? 'none' : '';
    canvas.classList.toggle('active', state.on);
    document.body.classList.toggle('aht-noselect', state.on);
    bar.hidden = !state.on || ov;
    launch.hidden = state.on || ov;
    if (!bar.hidden) applyBarPos();   // re-clamp the (possibly dragged) bar
  }

  // ---------- actions ----------
  function enable(v) {
    state.on = v;
    if (v) place();
    render();
    setChrome(v ? false : noHover);   // hide toolbar while drawing; on touch, restore it after
  }
  function setTool(t) { state.tool = t; canvas.classList.toggle('erasing', t === 'eraser'); syncUI(); }
  function setColor(c) { state.color = c; setTool('pen'); }
  function setWidth(w) { state.width = w; syncUI(); }
  function clearSlide() {
    if (!(state.strokes[curKey()] || []).length) return;   // a no-op must not wipe the redo branch
    pushUndo(); state.strokes[curKey()] = []; redraw(); save();
  }
  // clearAll wipes ink AND board slides and writes an EMPTY envelope (not
  // removeItem): the empty local state doubles as the tombstone that keeps a
  // deck-embedded baseline from resurrecting on the next load.
  function clearAll() {
    const cur = state.Reveal.getCurrentSlide();
    if (boardIdOf(cur)) state.Reveal.slide(Math.max(0, state.Reveal.getIndices().h - 1));
    state.strokes = {}; state.undo = {}; state.redo = {};
    const had = state.boards.length;
    state.boards = [];
    slidesEl.querySelectorAll('[data-aht-board]').forEach((s) => s.remove());
    if (had) state.Reveal.sync();
    save(); redraw(); updateSlideNo(); syncBoardUI();
  }
  const clearAllConfirmed = () => confirmBox('Delete all ink and board slides in this deck?', 'Delete', clearAll);

  // ---------- board slides ----------
  // A board is a REAL <section> inserted after the current slide — it shows in
  // the overview, speaker view and PDF export. data-visibility="uncounted"
  // keeps reveal's slide numbers stable for the audience. Boards are persisted
  // (id, anchor slide's stable key, surface) and re-inserted on load.
  const genId = () => Math.random().toString(36).slice(2, 8);
  // the surface is painted on the SECTION via the [data-aht-surface] CSS above
  // (not data-background-color: reveal paints those across the whole viewport,
  // but a board keeps the deck's slide format)
  function boardSection(b) {
    const s = el('section', {
      'data-aht-board': b.id,
      'data-visibility': 'uncounted',
      'data-aht-surface': b.bg,
    });
    keyCache.set(s, 'b:' + b.id);
    return s;
  }
  function topLevelOf(s) {
    let n = s;
    while (n.parentElement && n.parentElement !== slidesEl) n = n.parentElement;
    return n;
  }
  // Re-insert persisted boards into the DOM (load, import, storage sync, print).
  // Anchor slides are found by stable key; a board whose anchor was deleted
  // from the deck goes to the end rather than being lost.
  function materializeBoards() {
    state.boards.forEach((b) => {
      if (slidesEl.querySelector('[data-aht-board="' + b.id + '"]')) return;
      const sec = boardSection(b);
      const anchor = leafSections().find((s) => keyCache.get(s) === b.after);
      if (anchor) {
        let ref = topLevelOf(anchor);
        // boards of the same anchor keep their array order in the deck
        while (ref.nextElementSibling && ref.nextElementSibling.hasAttribute('data-aht-board')) ref = ref.nextElementSibling;
        ref.after(sec);
      } else {
        slidesEl.appendChild(sec);
      }
    });
  }
  function addBoard() {
    const cur = state.Reveal.getCurrentSlide();
    if (!cur) return;
    const curBoard = boardIdOf(cur);
    const b = { id: genId(), after: curBoard ? boardById(curBoard).after : curKey(), bg: cfg.boardSurface === 'dark' ? 'dark' : 'white' };
    let at;
    if (curBoard) at = state.boards.findIndex((x) => x.id === curBoard) + 1;
    else { at = state.boards.findIndex((x) => x.after === b.after); if (at < 0) at = state.boards.length; }
    state.boards.splice(at, 0, b);
    const sec = boardSection(b);
    topLevelOf(cur).after(sec);
    state.Reveal.sync();
    const i = state.Reveal.getIndices(sec);
    state.Reveal.slide(i.h, i.v);
    save();
    if (!state.on) enable(true);
  }
  function removeBoard() {
    const cur = state.Reveal.getCurrentSlide();
    const id = boardIdOf(cur);
    if (!id) return;
    const i = state.boards.findIndex((b) => b.id === id);
    if (i >= 0) state.boards.splice(i, 1);
    delete state.strokes['b:' + id];
    delete state.undo['b:' + id];
    delete state.redo['b:' + id];
    state.Reveal.slide(Math.max(0, state.Reveal.getIndices().h - 1));
    cur.remove();
    state.Reveal.sync();
    save(); redraw(); updateSlideNo(); syncBoardUI();
  }
  const removeBoardConfirmed = () => confirmBox('Delete this board slide and its ink?', 'Delete', removeBoard);
  function toggleSurface() {
    const b = boardById(boardIdOf(state.Reveal.getCurrentSlide()));
    if (!b) return;
    b.bg = b.bg === 'white' ? 'dark' : 'white';
    const sec = slidesEl.querySelector('[data-aht-board="' + b.id + '"]');
    sec.setAttribute('data-aht-surface', b.bg);
    ensureContrast();
    save();
  }
  // a pen that would be invisible on the board's surface switches to the
  // palette's brightest (dark board) or darkest (white board) colour
  function ensureContrast() {
    const b = boardById(boardIdOf(state.Reveal.getCurrentSlide && state.Reveal.getCurrentSlide()));
    if (!b) return;
    if (b.bg === 'white') {
      if (luminance(state.color) > 0.8) setColor(cfg.colors.reduce((a, c) => (luminance(a) <= luminance(c) ? a : c), state.color));
    } else if (luminance(state.color) < 0.13) {
      setColor(cfg.colors.reduce((a, c) => (luminance(a) >= luminance(c) ? a : c), state.color));
    }
  }

  // ---------- saving & sharing ----------
  function download(name, text, type) {
    const a = el('a', { download: name });
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function deckName() {
    return (location.pathname.split('/').pop() || '').replace(/\.[^.]*$/, '') || 'deck';
  }
  // JSON download is not a user-facing feature (the annotated HTML copy is the
  // shareable form) — it only remains as saveCopy's fallback on file://
  function exportJSON() { download(deckName() + '-annotations.json', JSON.stringify(envelope(), null, 1), 'application/json'); }
  // Adopt a full annotation state (another window via the storage event):
  // swap strokes, reconcile board sections, redraw.
  function adoptEnvelope(env, persistIt) {
    if (state.drawing) return;   // never swap strokes out from under an in-flight stroke
    const sameBoards = JSON.stringify(state.boards) === JSON.stringify(env.boards || []);
    state.strokes = env.strokes || {};
    state.undo = {}; state.redo = {};
    if (!sameBoards) {
      const curId = boardIdOf(state.Reveal.getCurrentSlide());
      if (curId && !(env.boards || []).some((b) => b.id === curId)) {
        state.Reveal.slide(Math.max(0, state.Reveal.getIndices().h - 1));
      }
      slidesEl.querySelectorAll('[data-aht-board]').forEach((s) => s.remove());
      state.boards = (env.boards || []).slice();
      materializeBoards();
      state.Reveal.sync();
    }
    redraw(); updateSlideNo(); syncBoardUI(); ensureContrast();
    if (persistIt) save();
  }
  // "Save a copy": fetch this deck's own HTML source and download it as a
  // single self-contained file — with the ink spliced in as an embedded block
  // (withInk, the default), or with any embedded block stripped (a clean,
  // shareable deck). The SOURCE is modified, not the live DOM, so no plugin UI
  // (and no runtime board section) leaks into it.
  // The plugin's own <script src> is replaced by an INLINE copy of its source:
  // a deck that loaded the plugin via a relative path would otherwise open as
  // a blank page when the downloaded file is opened from another directory.
  // (reveal itself should be loaded from absolute/CDN URLs to make the copy
  // portable — relative reveal assets can't travel with a single file.)
  function saveCopy(withInk) {
    const ink = withInk !== false;
    // module builds keep their tag untouched: inlining an ES module into a
    // classic <script> would throw on its import/export statements
    const tag = document.querySelector('script[src*="reveal-autohide-toolbar"]:not([type="module"])');
    Promise.all([
      fetch(location.href, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }),
      tag ? fetch(tag.src, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null) : null,
    ])
      .then(([src, pluginJs]) => {
        // the embedded annotations block as it appears in HTML source (the DOM
        // twin of this concept lives in readEmbedded, sharing EMBED_ATTR)
        const blockRe = new RegExp('\\s*<script[^>]*' + EMBED_ATTR + '[^>]*>[\\s\\S]*?<\\/script>', 'i');
        let out;
        if (ink) {
          const json = JSON.stringify(envelope()).replace(/<\//g, '<\\/');
          // split tags so this source, when inlined into a copy, never contains
          // a literal annotations-block tag itself
          const block = '<' + 'script type="application/json" ' + EMBED_ATTR + '>' + json + '<' + '/script>';
          // function replacement: stroke keys ('id:' + section id) and colors
          // are author data — a string replacement would expand $-patterns
          // ($&, $', …) in them and corrupt the copy
          // replace-vs-append is decided by an explicit test — comparing the
          // replace output to the input would misread a byte-identical re-save
          // as "no block found" and append a duplicate
          if (blockRe.test(src)) {
            out = src.replace(blockRe, () => '\n' + block);
          } else {
            const i = src.toLowerCase().lastIndexOf('</body>');
            out = i >= 0 ? src.slice(0, i) + block + '\n' + src.slice(i) : src + '\n' + block;
          }
        } else {
          // the clean copy also sheds any block a previous save embedded
          out = src.replace(blockRe, '');
        }
        if (pluginJs) {
          // shed the long doc header (it also contains an example plugin
          // <script src> tag, which must not survive into a self-contained
          // copy); a one-line banner keeps the licence notice
          const banner = '/* reveal.js-autohide-toolbar (inlined by "Save a copy") · MIT · '
            + 'https://github.com/frankhuettner/reveal.js-autohide-toolbar */\n';
          const compact = pluginJs.replace(/^\/\*[\s\S]*?\*\/\s*/, banner);
          // '</script' may only occur in comments/strings of the source; escape
          // it so the HTML parser can't end the inline block early
          const inlined = '<script>' + compact
            .replace(/<\/script/gi, '<\\/script')
            // …and no literal openers either, so blockRe on a future re-save
            // can never match INTO the inlined source ('\x73' is 's' in JS
            // strings and regexes — values are preserved, only the HTML changes)
            .replace(/<script/gi, '<\\x73cript') + '<' + '/script>';
          out = out.replace(/<script[^>]*src=["'][^"']*reveal-autohide-toolbar[^"']*["'][^>]*>\s*<\/script>/i, () => inlined);
        }
        download(deckName() + (ink ? '-annotated.html' : '-copy.html'), out, 'text/html');
      })
      .catch(() => {
        if (ink) exportJSON();   // file:// etc. — at least save the ink itself
        else console.warn('autohide-toolbar: cannot fetch the deck source here (file://?) — "Save a copy" needs http(s).');
      });
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if ((confirmEl || exportEl) && e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeConfirm(); closeExport();   // both null-safe; at most one is open
      return;
    }
    if (state.Reveal.getConfig().keyboard === false) return;   // respect the deck's keyboard setting
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (state.on) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === cfg.toggleKey) { e.preventDefault(); enable(!state.on); }
    else if (!state.on) return;
    else if (k === 'e') { e.preventDefault(); setTool(state.tool === 'eraser' ? 'pen' : 'eraser'); }
    else if (k === 'x') { e.preventDefault(); e.shiftKey ? clearAllConfirmed() : clearSlide(); }
    else if (k === 'escape') { e.preventDefault(); e.stopPropagation(); enable(false); }
  }

  // ---------- toolbar visibility + touch ----------
  function setChrome(v) { document.body.classList.toggle('aht-chrome', v); }
  function updateZone() {
    if (!toolsEl) return;
    const r = toolsEl.getBoundingClientRect();   // valid while hidden too (opacity only)
    zone = { left: r.left - 40, right: r.right + 40, top: r.top - 40 };   // corner-agnostic
  }
  function onMoveChrome(e) {
    if (state.on || !zone) return;
    if (e.clientX > zone.left && e.clientX < zone.right && e.clientY > zone.top) {
      clearTimeout(chromeTimer); chromeTimer = null;
      setChrome(true);
    } else if (!chromeTimer && document.body.classList.contains('aht-chrome')) {
      chromeTimer = setTimeout(() => { chromeTimer = null; setChrome(false); }, 400);
    }
  }
  function onTapDown(e) {
    // while a dialog or the export menu is up, a tap serves only that layer —
    // it must never navigate the deck behind it. This handler runs in CAPTURE
    // phase, i.e. BEFORE the overlay's own outside-tap close removes the layer.
    if (confirmEl || exportEl) { tap = null; return; }
    tap = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
  }
  function onTapUp(e) {
    if (!tap || e.pointerType !== 'touch') return;
    const dx = Math.abs(e.clientX - tap.x), dy = Math.abs(e.clientY - tap.y), dt = e.timeStamp - tap.t;
    tap = null;
    if (dx > 10 || dy > 10 || dt > 500) return;   // a swipe / long-press, not a tap
    if (state.on) return;
    const R = state.Reveal;
    if (R.isOverview()) return;
    if (toolsEl.contains(e.target) || bar.contains(e.target) || e.target === canvas) return;
    if (e.target.closest && e.target.closest(cfg.tapIgnore)) return;
    if (e.clientX > window.innerWidth / 2) R.next(); else R.prev();
  }
  function initChrome() {
    noHover = window.matchMedia('(hover: none)').matches;
    if (cfg.tapToAdvance) {
      listen(document, 'pointerdown', onTapDown, { passive: true, capture: true });
      listen(document, 'pointerup', onTapUp, { passive: true });
    }
    if (noHover) { setChrome(true); return; }        // touch: keep the toolbar visible
    listen(document, 'mousemove', onMoveChrome, { passive: true });
    setChrome(true);                                  // brief reveal on load for discoverability
    chromeTimer = setTimeout(() => { chromeTimer = null; setChrome(false); }, 2200);
  }

  // the ▲/▼ cluster only appears where it means something: on slides that
  // actually have a vertical route. Elsewhere it is gone, not greyed out.
  function syncNav() {
    const ud = toolsEl && toolsEl.querySelector('#aht-updown');
    if (!ud) return;
    const r = state.Reveal.availableRoutes ? state.Reveal.availableRoutes() : null;
    const show = !!(r && (r.up || r.down));
    ud.hidden = !show;
    if (!show) return;
    ud.querySelector('#aht-up').classList.toggle('dim', !r.up);
    ud.querySelector('#aht-down').classList.toggle('dim', !r.down);
  }

  // counted position/total, computed over the deck's own slides — board slides
  // are uncounted, so on a board the counter simply holds its anchor's number
  function updateSlideNo() {
    if (!slideNoEl) return;
    const cur = state.Reveal.getCurrentSlide && state.Reveal.getCurrentSlide();
    const all = leafSections().filter((s) =>
      !s.hasAttribute('data-aht-board') && s.getAttribute('data-visibility') !== 'hidden');
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      if (all[i] === cur) { n = i + 1; break; }
      if (cur && (all[i].compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING)) n = i + 1;
      else break;
    }
    slideNoEl.textContent = Math.max(1, n) + ' / ' + all.length;
  }

  // ---------- deck utilities ----------
  function toggleFullscreen() {
    const d = document, e = d.documentElement;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) (e.requestFullscreen || e.webkitRequestFullscreen || function () {}).call(e);
    else (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
  }
  function openNotes() {
    const p = state.Reveal.getPlugin && state.Reveal.getPlugin('notes');
    if (p && p.open) p.open();
  }

  function injectCSS() {
    if (document.getElementById('aht-styles')) return;
    const s = el('style', { id: 'aht-styles' });
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------- init ----------
  function readCfg(reveal) {
    cfg = Object.assign({}, DEFAULTS, reveal.getConfig().autohideToolbar || {});
    if (RE_NOINK.test(location.search)) cfg.annotations = false;
    if (!cfg.annotations) cfg.persist = false;   // clean mode never touches stored ink
  }
  function init(reveal) {
    state.Reveal = reveal;
    // in print/PDF export, render saved ink as SVG but build no UI; stay out of
    // reveal's scroll view entirely (whose stacked-slides layout the fixed
    // canvas can't track). Check the URL and the config as well as the API —
    // at plugin-init time reveal may not have merged ?view=… query params yet,
    // so isScrollView()/isPrintView() can still be false.
    const view = reveal.getConfig().view;
    if ((reveal.isPrintView && reveal.isPrintView()) || view === 'print'
        || /[?&](print-pdf|view=print)/.test(location.search)) return initPrint(reveal);
    if ((reveal.isScrollView && reveal.isScrollView()) || view === 'scroll'
        || /[?&]view=scroll/.test(location.search)) return;
    readCfg(reveal);
    state.color = cfg.defaultColor;
    // a custom colors array may not contain the stock default — fall back to
    // the palette's darkest so the bar always highlights a real swatch
    if (cfg.colors.indexOf(state.color) < 0)
      state.color = cfg.colors.reduce((a, c) => (luminance(a) <= luminance(c) ? a : c), cfg.colors[0] || '#000000');
    state.width = cfg.defaultWidth;

    injectCSS();
    canvas = el('canvas', { id: 'aht-canvas' });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    slidesEl = reveal.getSlidesElement ? reveal.getSlidesElement() : document.querySelector('.reveal .slides');
    computeKeys();          // before load(): key migration needs them
    load((env) => {
      // async plugin deps (e.g. KaTeX off a CDN) can hold reveal's start()
      // past DOMContentLoaded — and adopting boards needs Reveal.sync().
      // Adopt now only if reveal is up; otherwise the moment it is.
      if (state.Reveal.isReady && !state.Reveal.isReady()) revealOn('ready', () => adoptEnvelope(env, false));
      else adoptEnvelope(env, false);
    });
    materializeBoards();    // before reveal's first layout
    loadUI();
    buildUI();

    // cross-window sync: another same-origin window (e.g. the SPEAKER VIEW's
    // slide iframe) saving ink fires 'storage' here — adopt strokes AND board
    // slides, so both windows stay identical. Last write wins.
    if (cfg.persist) {
      listen(window, 'storage', (e) => {
        // drawing is re-checked here only to skip the (possibly large) parse
        // mid-stroke — adoptEnvelope owns the actual invariant
        if (e.key !== cfg.storageKey || state.drawing) return;
        const env = e.newValue ? parseEnvelope(e.newValue) : { strokes: {}, boards: [] };
        if (env) adoptEnvelope(env, false);
      });
    }

    const onLayout = () => { place(); updateSlideNo(); syncNav(); updateZone(); applyBarPos(); };
    const scheduleLayout = () => { clearTimeout(layoutTimer); layoutTimer = setTimeout(onLayout, 0); };
    revealOn('ready', onLayout);           // plugins init before 'ready', so this covers startup
    // late layout shifts (web fonts settling after 'ready') can move the slides box
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleLayout).catch(() => {});
    revealOn('slidechanged', (ev) => {
      place(); updateSlideNo(); syncNav();
      // a board slide is for writing: entering one auto-enables the pen (and
      // leaving undoes exactly that), with pen/surface contrast kept sane
      const isB = !!boardIdOf(ev && ev.currentSlide);
      if (isB && !state.on) { enable(true); boardAuto = true; }
      else if (!isB && boardAuto && state.on) enable(false);
      if (!isB) boardAuto = false;
      ensureContrast();
      syncBoardUI();
    });
    revealOn('resize', scheduleLayout);
    listen(window, 'resize', scheduleLayout);
    // re-place when the device pixel ratio changes without a resize
    // (window dragged to a different-DPI monitor, browser zoom)
    try {
      (function watchDPR() {
        const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        const onChange = () => { mq.removeEventListener('change', onChange); scheduleLayout(); watchDPR(); };
        mq.addEventListener('change', onChange);
        cleanups.push(() => mq.removeEventListener('change', onChange));
      })();
    } catch (e) {}
    revealOn('overviewshown', () => { state.overview = true; render(); });
    revealOn('overviewhidden', () => { state.overview = false; render(); });

    listen(canvas, 'pointerdown', onDown);
    listen(canvas, 'pointermove', onMove);
    listen(canvas, 'pointerup', onUp);
    listen(canvas, 'pointercancel', onUp);
    // swallow raw touch on the canvas while annotating — kills iOS long-press
    // selection/magnifier that pointer events alone don't suppress
    listen(canvas, 'touchstart', (e) => { if (state.on) e.preventDefault(); }, { passive: false });
    listen(document, 'keydown', onKey, true);
    if (reveal.registerKeyboardShortcut) {           // feed reveal's ? help overlay
      reveal.registerKeyboardShortcut(cfg.toggleKey.toUpperCase(), 'Toggle annotation');
      reveal.registerKeyboardShortcut('E', 'Eraser (while annotating)');
      reveal.registerKeyboardShortcut('X', 'Clear ink on slide (Shift: whole deck)');
    }
    initChrome();

    // small runtime API (drive from your own buttons / the console) — the
    // destructive calls act directly; confirmation lives in the UI paths only
    window.AutohideToolbar = {
      enable, setTool, setColor, undo, redo, clearSlide, clearAll,
      addBoard, removeBoard, toggleSurface,
      saveCopy,                 // saveCopy(false) = clean copy, no ink
      printPdf: openPrint,      // printPdf(false) = without ink
      toggle: () => enable(!state.on),
    };
  }

  // ---------- print / PDF export ----------
  // No UI in reveal's ?print-pdf view — instead the saved ink (localStorage
  // over embedded baseline, same precedence as live) is rendered as one SVG
  // overlay per inked slide: vectors stay crisp at any print DPI. Board
  // sections are re-inserted BEFORE reveal builds the print layout, so they
  // print as real pages, their dark/white surface filling the slide box.
  function initPrint(reveal) {
    state.Reveal = reveal;
    readCfg(reveal);
    // opened from the export menu (aht-print=1): once reveal's print layout is
    // done and web fonts have settled, pop the browser's print dialog — the
    // user only picks "Save as PDF" there. The settle delay gives async
    // typesetting (MathJax) a chance; if a preview still looks unfinished,
    // cancelling and pressing Cmd/Ctrl+P again is always possible.
    if (RE_PRINT.test(location.search)) {
      reveal.on('pdf-ready', () => {
        Promise.resolve(document.fonts && document.fonts.ready)
          .catch(() => {})
          .then(() => setTimeout(() => window.print(), 500));
      });
    }
    if (!cfg.annotations) return;
    slidesEl = reveal.getSlidesElement ? reveal.getSlidesElement() : document.querySelector('.reveal .slides');
    if (!slidesEl) return;
    injectCSS();   // board sections get their dark/white surface from the
                   // injected [data-aht-surface] rules — print pages need them too
    computeKeys();
    // A late-read block always lands in time: reveal defers print activation
    // (pagination + pdf-ready) to window 'load' while the document is still
    // parsing, and activation re-scans the DOM — so the late boards paginate
    // without reveal.sync(), which would only re-arm the input listeners
    // reveal's print mode deliberately removed.
    load((env) => {
      state.strokes = env.strokes || {}; state.boards = env.boards || [];
      materializeBoards();
    });
    materializeBoards();
    reveal.on('pdf-ready', renderPrintInk);
  }
  function renderPrintInk() {
    // Ink ratios are relative to the SLIDE BOX. In reveal's print layout that
    // box sits inside each .pdf-page at the margin gutter (page − slide)/2 —
    // but the SECTION does not share its top: with center:true reveal centres
    // the section by its CONTENT height, so short slides sit lower than the
    // box. Anchoring the overlay to the section displaced ink downwards and
    // clipped it at the page edge — so anchor it to the .pdf-page instead.
    const size = state.Reveal.getComputedSlideSize
      ? state.Reveal.getComputedSlideSize(window.innerWidth, window.innerHeight) : null;
    const margin = state.Reveal.getConfig().margin || 0;
    // Fragment steps are page CLONES reveal creates after init, so they're not
    // in the key cache — re-derive their key the same way the original was
    // keyed, so ink shows on every step's page. (Identical twin slides with
    // fragments: clone ink lands on the first twin's key — accepted edge case.)
    const printKey = (sec) => {
      const cached = keyCache.get(sec);
      if (cached) return cached;
      if (sec.hasAttribute('data-aht-board')) return 'b:' + sec.getAttribute('data-aht-board');
      if (sec.id) return 'id:' + sec.id;
      if (sec.getAttribute('data-aht-id')) return 's:' + sec.getAttribute('data-aht-id');
      const basis = (sec.textContent || '').replace(/\s+/g, ' ').trim()
        || (sec.innerHTML || '').replace(/\s+/g, ' ').trim();
      return 'c:' + fnv1a(basis) + ':0';
    };
    leafSections().forEach((sec) => {
      const W = (size && size.width) || sec.offsetWidth || 960;
      const H = (size && size.height) || state.Reveal.getConfig().height || 700;
      // slide-box origin within the page (reveal: page = slide × (1 + margin))
      const gx = (Math.floor(W * (1 + margin)) - W) / 2;
      const gy = (Math.floor(H * (1 + margin)) - H) / 2;
      const page = sec.closest && sec.closest('.pdf-page');
      // boards keep the slide format in print too: reveal's print layout sets
      // a section's left/width but not its height (it centres by content
      // height) — pin board sections to the slide box explicitly
      if (page && sec.hasAttribute('data-aht-board')) {
        sec.style.left = gx + 'px'; sec.style.top = gy + 'px';
        sec.style.width = W + 'px'; sec.style.height = H + 'px';
      }
      const list = state.strokes[printKey(sec)];
      if (!list || !list.length) return;
      const host = page || sec, ox = page ? gx : 0, oy = page ? gy : 0;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'aht-print-ink');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('style', 'position:absolute;left:' + ox + 'px;top:' + oy
        + 'px;width:' + W + 'px;height:' + H + 'px;pointer-events:none;overflow:visible;');
      list.forEach((st) => { if (st.points.length) svg.appendChild(printStroke(st, W, H)); });
      host.appendChild(svg);
    });
  }
  // SVG twin of drawStroke: same ratio→box mapping, aspect-fit and quadratic
  // smoothing, so the PDF matches the screen
  function printStroke(st, W, H) {
    const NS = 'http://www.w3.org/2000/svg';
    const a0 = st.a, curA = W / H;
    let bw = W, bh = H, ox = 0, oy = 0;
    if (a0 && Math.abs(curA - a0) >= 0.002) {
      if (curA >= a0) { bh = H; bw = bh * a0; } else { bw = W; bh = bw / a0; }
      ox = (W - bw) / 2; oy = (H - bh) / 2;
    }
    const P = (pt) => [Math.round((ox + pt.xr * bw) * 100) / 100, Math.round((oy + pt.yr * bh) * 100) / 100];
    const w = strokeWidth(st, bw);
    const pts = st.points;
    if (pts.length === 1) {
      const c = document.createElementNS(NS, 'circle');
      const p = P(pts[0]);
      c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
      c.setAttribute('r', w / 2); c.setAttribute('fill', st.color);
      return c;
    }
    let d = 'M' + P(pts[0]).join(' ');
    for (let i = 1; i < pts.length - 1; i++) {
      const a = P(pts[i]), b = P(pts[i + 1]);
      d += 'Q' + a.join(' ') + ' ' + ((a[0] + b[0]) / 2) + ' ' + ((a[1] + b[1]) / 2);
    }
    d += 'L' + P(pts[pts.length - 1]).join(' ');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', st.color);
    path.setAttribute('stroke-width', w);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    return path;
  }

  // full teardown, per the official plugin API — called when the deck is destroyed
  function destroy() {
    cleanups.forEach((fn) => { try { fn(); } catch (e) {} });
    cleanups = [];
    clearTimeout(chromeTimer); clearTimeout(layoutTimer);
    closeConfirm();
    closeExport();
    if (slidesEl) slidesEl.querySelectorAll('[data-aht-board]').forEach((s) => s.remove());
    [canvas, toolsEl, bar, document.getElementById('aht-styles')].forEach((n) => n && n.remove());
    canvas = toolsEl = bar = launch = slideNoEl = null;
    document.body.classList.remove('aht-chrome');
    document.body.classList.remove('aht-noselect');
    state.on = false; state.overview = false; state.drawing = false; boardAuto = false;
    delete window.AutohideToolbar;
  }

  // Factory form per the official plugin docs (reveal calls the function).
  // id/init/destroy are also attached so the bare-object style keeps working.
  const factory = () => ({ id: 'autohide-toolbar', init: init, destroy: destroy });
  factory.id = 'autohide-toolbar';
  factory.init = init;
  factory.destroy = destroy;
  window.RevealAutohideToolbar = factory;
})();
