/*!
 * reveal.js-autohide-toolbar — presenter toolkit for reveal.js
 * --------------------------------------------------
 * Everything you need at the podium, in one dependency-free file:
 *   • ink annotation over slides (pen, eraser, undo, palette)
 *   • typed-text annotation (a Text tool alongside the pen): click to type,
 *     click a box to re-edit, drag its grip to move, × to delete; shares the
 *     palette colour, has S/M/L sizes, and scales with the slide
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
 *     self-contained HTML copy of the deck — clean, or PORTABLE, with the
 *     annotations baked into the slides as regular content (ink as static inline
 *     <svg> paths, text as editable HTML) and the plugin source inlined. A
 *     portable copy DISPLAYS anywhere reveal runs — even without this plugin —
 *     and, wherever the plugin does load, auto-REVIVES back into the fully
 *     editable model (no separate import step). Legacy decks that ship baseline
 *     ink in a <script type="application/json" data-aht-annotations> block are
 *     still read.
 *   • PDF export, from the same menu (with ink or clean): opens reveal's
 *     ?print-pdf view in a new tab and pops the browser's print dialog —
 *     ink is rendered as crisp SVG overlays, text as HTML, board slides as
 *     real pages
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
 *   widths        {name:px} pen widths                  (default: {thin:2,med:4,thick:8})
 *   defaultWidth  number    initial pen width           (default: 4)
 *   highlighterWidth number highlighter band width (px)  (default: 20)
 *   highlighterAlpha number highlighter opacity, 0–1     (default: 0.4)
 *   textSizes     {name:{size,bold?,cond?}} typed-text presets; size is a
 *                           fraction of slide-box height (scales with the slide),
 *                           bold/cond add weight/condensed. A bare number = size
 *                           only.  (default S:16px cond, M:20px, L:28px bold @540)
 *   defaultTextSize number  initial text size (a preset's size) (default: 0.037)
 *   eraserRadius  number    eraser hit radius (px)       (default: 16)
 *   persist       boolean   save ink to localStorage     (default: true)
 *   storageKey    string    localStorage key             (default: 'aht:'+pathname)
 *   annotations   boolean   false = present clean: ignore stored/embedded ink
 *                           and draw session-only, nothing is deleted; baked
 *                           (portable) annotations are actively stripped from
 *                           the DOM so the slides show clean (also via URL
 *                           param ?aht-ink=0)            (default: true)
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
 *   --aht-z         base z-index                     (default 30)
 *
 * Keys: A annotate · E eraser · H highlighter · T text · Ctrl+Z undo ·
 *       Ctrl+Shift+Z redo · X clear slide · Shift+X clear all ·
 *       Esc exit (Esc commits an open text box)
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
    widths: { thin: 2, med: 4, thick: 8 },
    defaultWidth: 4,
    // the highlighter is a broad, translucent marker: one fixed width (px at the
    // draw-time slide-box width, so it scales with the slide like the pen) and a
    // low opacity so slide content and pen ink read through it
    highlighterWidth: 20,
    highlighterAlpha: 0.4,
    // typed-text presets, keyed S/M/L. size is a fraction of the slide-box
    // HEIGHT so text scales with the slide; each preset also carries its own
    // style. On a 540-tall, 1pt→1px (PowerPoint-sized) deck these are
    // 16 px condensed / 20 px / 28 px bold. Override cfg.textSizes for another
    // scale; a bare number also works (size only, regular weight).
    textSizes: {
      S: { size: 0.0296, cond: true },   //  16 px @540 — condensed
      M: { size: 0.0370 },               //  20 px
      L: { size: 0.0519, bold: true },   //  28 px — bold
    },
    defaultTextSize: 0.0370,             // = M
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
  // lucide "highlighter" — the marker body (first path) is filled in the cursor
  const HL_D = [
    'm9 11-6 6v3h9l3-3',
    'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
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
#aht-canvas.active.erasing { cursor: ${cur(cursorSvg(ERASER_D, '#F4A3A3'))} 6 20, cell; }
#aht-canvas.active.highlighting { cursor: ${cur(cursorSvg(HL_D, '#FCD34D'))} 3 20, crosshair; }

/* typed-text overlay: sits just above the ink canvas over the same slide box.
   Inert (pointer-events:none) unless the Text tool is active, so taps still
   navigate and pen/eraser draw straight through it. */
#aht-text-layer { position: fixed; z-index: calc(var(--aht-z, 30) + 1); pointer-events: none; touch-action: none; overflow: visible; }
#aht-text-layer.active { pointer-events: auto; cursor: text; }
.aht-text-item { position: absolute; }
.aht-text-edit {
  position: relative; display: inline-block; white-space: pre; line-height: 1.15;
  outline: none; min-width: 6px; min-height: 1em; cursor: text;
  font-family: var(--aht-font, 'Open Sans', system-ui, sans-serif);
}
#aht-text-layer.active .aht-text-item:hover .aht-text-edit,
.aht-text-item.editing .aht-text-edit { box-shadow: 0 0 0 1px rgba(120,160,255,.75); border-radius: 2px; }
/* drag grip + delete, spaced well apart so a mis-aimed drag never deletes */
.aht-text-tools { position: absolute; left: 0; top: -28px; display: none; gap: 10px; align-items: center;
  background: var(--aht-bar-bg, rgba(6,18,42,.92)); border-radius: 8px; padding: 3px 6px; box-shadow: 0 3px 12px rgba(0,0,0,.4); }
.aht-text-item.editing .aht-text-tools,
#aht-text-layer.active .aht-text-item:hover .aht-text-tools { display: inline-flex; }
.aht-text-tools .aht-text-grip { cursor: grab; touch-action: none; color: #8fa0bb; display: inline-flex; }
.aht-text-tools .aht-text-grip:active { cursor: grabbing; }
.aht-text-tools .aht-text-grip svg { width: 15px; height: 15px; display: block; }
.aht-text-tools .aht-text-del {
  border: none; background: transparent; color: #e7ecf5; cursor: pointer; margin-left: 8px;
  width: 22px; height: 22px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center;
}
/* the trash bin turns red on hover — an unmistakable "this deletes" cue */
.aht-text-tools .aht-text-del:hover { background: rgba(227,25,55,.85); color: #fff; }
.aht-text-tools .aht-text-del svg { width: 15px; height: 15px; display: block; }
/* text-size picker in the annotation bar */
#aht-bar .aht-sizes { display: inline-flex; align-items: center; gap: 4px; }
#aht-bar .aht-size { width: 34px; height: 34px; font-weight: 400; line-height: 1; }
#aht-bar .aht-size span { display: inline-block; line-height: 1; }
#aht-bar .aht-size.s span { font-size: 16px; font-stretch: 75%; letter-spacing: -.03em; }
#aht-bar .aht-size.m span { font-size: 20px; }
#aht-bar .aht-size.l span { font-size: 28px; font-weight: 700; }
#aht-bar .aht-size.active { background: rgba(255,255,255,.2); }

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
/* contextual controls float in a small panel just above their tool button:
   the stroke widths over the pen, the S/M/L sizes over the text tool. The panel
   is absolutely positioned, so it never adds to the bar's own (single) row. */
#aht-bar .aht-toolrow {
  position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%);
  display: none; align-items: center; gap: 5px; padding: 5px 8px; border-radius: 10px;
  background: var(--aht-bar-bg, rgba(6,18,42,.92)); box-shadow: 0 4px 18px rgba(0,0,0,.4);
}
#aht-bar.tool-pen .aht-toolrow, #aht-bar.tool-text .aht-toolrow { display: inline-flex; }
#aht-bar.tool-pen .aht-sizes { display: none; }
#aht-bar.tool-text .aht-widths { display: none; }

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
/* …but the text box being edited must allow caret + selection */
body.aht-noselect .aht-text-edit, body.aht-noselect .aht-text-edit * {
  -webkit-user-select: text !important; user-select: text !important;
  -webkit-touch-callout: default !important;
}

@media print { #aht-canvas, #aht-text-layer, #aht-toolbar, #aht-bar, #aht-export-wrap { display: none !important; } }
`;

  // ---------- state ----------
  let cfg;
  const state = {
    Reveal: null, on: false, overview: false, tool: 'pen', color: null, width: 0,
    size: 0, bold: false, cond: false,   // current text preset (size fraction + style)
    strokes: {}, texts: {}, boards: [], undo: {}, redo: {}, drawing: false, cur: null, pid: null,
    editingText: null,   // the text box element currently being edited, if any
  };
  const NS = 'http://www.w3.org/2000/svg';
  let canvas, ctx, textLayer, bar, launch, slideNoEl, toolsEl, slidesEl;
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
  function leafSectionsIn(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('section'),
      (s) => !s.querySelector('section'));
  }
  const leafSections = () => leafSectionsIn(slidesEl);
  // The content fingerprint must be IDENTICAL whether or not the slide carries a
  // baked-annotation wrapper — otherwise flattening a deck would shift its own
  // keys. So exclude [data-aht-flat] subtrees from the basis.
  function contentBasis(s) {
    let node = s;
    if (s.querySelector('[data-aht-flat]')) {
      node = s.cloneNode(true);
      node.querySelectorAll('[data-aht-flat]').forEach((n) => n.remove());
    }
    return (node.textContent || '').replace(/\s+/g, ' ').trim()
      || (node.innerHTML || '').replace(/\s+/g, ' ').trim();
  }
  // Map every leaf section of `root` to its stable key (same rules as the live
  // deck), returned as a plain Map so flatten can key a parsed source document.
  function keysFor(root) {
    const map = new Map();
    const counts = {};
    leafSectionsIn(root).forEach((s) => {
      let k;
      if (s.hasAttribute('data-aht-board')) k = 'b:' + s.getAttribute('data-aht-board');
      else if (s.id) k = 'id:' + s.id;
      else if (s.getAttribute('data-aht-id')) k = 's:' + s.getAttribute('data-aht-id');
      else {
        const h = fnv1a(contentBasis(s));
        const n = counts[h] || 0; counts[h] = n + 1;
        k = 'c:' + h + ':' + n;
      }
      map.set(s, k);
    });
    return map;
  }
  function computeKeys() {
    keyCache = new WeakMap();
    keysFor(slidesEl).forEach((k, s) => keyCache.set(s, k));
  }
  // Key of ONE section by the same priority rules, twin counter pinned to 0 —
  // for sections the cache can't know (reveal's print-page clones, a revive
  // fallback). Identical twins collapse onto the first twin's key (accepted).
  function sectionKey(sec) {
    if (sec.hasAttribute('data-aht-board')) return 'b:' + sec.getAttribute('data-aht-board');
    if (sec.id) return 'id:' + sec.id;
    if (sec.getAttribute('data-aht-id')) return 's:' + sec.getAttribute('data-aht-id');
    return 'c:' + fnv1a(contentBasis(sec)) + ':0';
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
  const strokeBox = (st) => fitBox(rect.width, rect.height, st.a);
  const toPx = (pt, box) => ({ x: box.ox + pt.xr * box.w, y: box.oy + pt.yr * box.h });
  const pct = (r) => (Math.round(r * 1e4) / 1e2) + '%';   // ratio → CSS percent (2 decimals)
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  // ratio point, rounded to 4 decimals (sub-pixel at 8K, ~60% smaller when serialized)
  const toRatio = (p) => ({ xr: Math.round(p.x / rect.width * 1e4) / 1e4, yr: Math.round(p.y / rect.height * 1e4) / 1e4 });
  const luminance = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  };
  // normalize a computed CSS colour (rgb(...)) back to hex so revived text keeps
  // hex in the model (matches the swatch palette); pass through hex unchanged
  function toHex(c) {
    if (!c) return c;
    if (/^#[0-9a-f]{6}$/i.exec(c)) return c;
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
    if (!m) return c;
    const h = (n) => (+n).toString(16).padStart(2, '0');
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
  }
  // Aspect-fit box of an original-aspect (a0) stroke inside a W×H target box —
  // the ONE owner of the fit math: screen (via strokeBox), print, flatten and
  // revive all agree by construction.
  function fitBox(W, H, a0) {
    const curA = W / H;
    if (!a0 || Math.abs(curA - a0) < 0.002) return { ox: 0, oy: 0, w: W, h: H };
    let w, h;
    if (curA >= a0) { h = H; w = h * a0; } else { w = W; h = w / a0; }
    return { ox: (W - w) / 2, oy: (H - h) / 2, w, h };
  }
  // Ink → SVG geometry within a W×H box. Returns { w, d } for a path or
  // { w, circle:{cx,cy,r} } for a single-point dot. The quadratic control points
  // ARE the original stroke points, so revive recovers the stroke losslessly.
  function strokeGeom(st, W, H) {
    const box = fitBox(W, H, st.a);
    const P = (pt) => [Math.round((box.ox + pt.xr * box.w) * 100) / 100, Math.round((box.oy + pt.yr * box.h) * 100) / 100];
    const w = Math.round(strokeWidth(st, box.w) * 100) / 100;
    const pts = st.points;
    if (pts.length === 1) { const p = P(pts[0]); return { w, circle: { cx: p[0], cy: p[1], r: Math.round(w / 2 * 100) / 100 } }; }
    let d = 'M' + P(pts[0]).join(' ');
    for (let i = 1; i < pts.length - 1; i++) {
      const a = P(pts[i]), b = P(pts[i + 1]);
      d += 'Q' + a.join(' ') + ' ' + ((a[0] + b[0]) / 2) + ' ' + ((a[1] + b[1]) / 2);
    }
    d += 'L' + P(pts[pts.length - 1]).join(' ');
    return { w, d };
  }
  // Build one SVG node (path or circle) for a stroke, in `doc`, tagged with the
  // model (data-aht-*) so revive is lossless. Used by print and flatten alike.
  function strokeNode(doc, st, W, H) {
    const g = strokeGeom(st, W, H);
    let node;
    if (g.circle) {
      node = doc.createElementNS(NS, 'circle');
      node.setAttribute('cx', g.circle.cx); node.setAttribute('cy', g.circle.cy);
      node.setAttribute('r', g.circle.r); node.setAttribute('fill', st.color);
      if (st.hl) node.setAttribute('fill-opacity', cfg.highlighterAlpha);
    } else {
      node = doc.createElementNS(NS, 'path');
      node.setAttribute('d', g.d);
      node.setAttribute('fill', 'none'); node.setAttribute('stroke', st.color);
      node.setAttribute('stroke-width', g.w);
      node.setAttribute('stroke-linecap', 'round'); node.setAttribute('stroke-linejoin', 'round');
      if (st.hl) node.setAttribute('stroke-opacity', cfg.highlighterAlpha);
    }
    node.setAttribute('data-aht-w', st.width);
    if (st.hl) node.setAttribute('data-aht-hl', '1');
    // legacy pre-bw strokes render at constant px width — omit the attribute so
    // the round trip keeps them that way instead of converting to box-scaled
    if (st.bw) node.setAttribute('data-aht-bw', st.bw);
    node.setAttribute('data-aht-a', st.a || Math.round(W / H * 1e4) / 1e4);
    return node;
  }
  // One <svg viewBox="0 0 W H"> holding every stroke of a slide — the shared
  // assembly for baked (flatten) and print overlays; callers position/tag it.
  function strokesSvg(doc, strokes, W, H) {
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // highlighter first, then pen — mirror the screen's paint order (see redraw)
    const ordered = strokes.filter((s) => s.hl).concat(strokes.filter((s) => !s.hl));
    ordered.forEach((st) => { if (st.points.length) svg.appendChild(strokeNode(doc, st, W, H)); });
    return svg;
  }
  // Build one editable HTML text element for a text item, in `doc`. Plain HTML
  // (not vectorized): displays natively, stays editable anywhere, revives from
  // its own attributes + text content.
  function textNode(doc, t, W, H) {
    const d = doc.createElement('div');
    d.className = 'aht-text';
    d.setAttribute('data-aht-text', '');
    d.setAttribute('data-aht-size', t.size);
    d.setAttribute('data-aht-a', t.a || Math.round(W / H * 1e4) / 1e4);
    // weight/stretch ride along as data-* (deterministic revive of our own files)
    // AND as real CSS below (so plugin-less display + foreign editors honour them)
    if (t.bold) d.setAttribute('data-aht-bold', '1');
    if (t.cond) d.setAttribute('data-aht-cond', '1');
    d.setAttribute('style',
      'position:absolute; left:' + pct(t.xr) + '; top:' + pct(t.yr) + ';'
      + ' transform:translateY(-50%); color:' + t.color + '; font-size:' + fontPxIn(H, t.size) + 'px;'
      + ' font-weight:' + (t.bold ? '700' : '400') + ';'
      // font + alignment mirror the live edit box (.aht-text-edit), so baked and
      // printed text share the screen's metrics; reveal themes centre text and
      // set their own font, which would otherwise reflow multi-line annotations
      + (t.cond ? ' font-stretch:75%; letter-spacing:-.02em; font-family:' + CONDENSED_FF + ';'
                : " font-family:var(--aht-font, 'Open Sans', system-ui, sans-serif);")
      + ' line-height:1.15; white-space:pre; text-align:left;');
    d.textContent = t.text;
    return d;
  }

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
    textLayer.style.left = rect.left + 'px'; textLayer.style.top = rect.top + 'px';
    textLayer.style.width = rect.width + 'px'; textLayer.style.height = rect.height + 'px';
    redraw();
    // rebuild the text overlay only for a NEW slide; a same-slide layout pass
    // (resize burst, fonts settling) — or any pass during an edit — just
    // rescales the existing boxes in place, never out from under a caret
    if (state.editingText || textLayer._key === curKey()) repositionTexts();
    else renderTexts();
  }
  function redraw() {
    // pre-'ready' adoption (late embed read, storage event) may land before
    // the first place(): nothing to paint yet — 'ready' → place() → redraw()
    if (!rect) return;
    ctx.clearRect(0, 0, rect.width, rect.height);
    // highlighter strokes paint first, so pen ink lands on top of the marker
    // (typed text is a separate layer above the canvas, so it's always on top)
    const list = state.strokes[curKey()] || [];
    for (const st of list) if (st.hl) drawStroke(st);
    for (const st of list) if (!st.hl) drawStroke(st);
  }
  // strokes remember the slide-box width at draw time (bw) so line width scales
  // with the content instead of staying constant px (pre-bw strokes: as-is)
  const strokeWidth = (st, boxW) => (st.bw ? st.width * (boxW / st.bw) : st.width);
  function drawStroke(st) {
    const pts = st.points;
    if (!pts.length) return;
    const box = strokeBox(st);
    const w = strokeWidth(st, box.w);
    ctx.save();
    // the highlighter is a translucent marker; the pen is opaque
    if (st.hl) ctx.globalAlpha = cfg.highlighterAlpha;
    ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = w;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const p0 = toPx(pts[0], box);
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(p0.x, p0.y, w / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = toPx(pts[i], box), b = toPx(pts[i + 1], box);
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    const last = toPx(pts[pts.length - 1], box);
    ctx.lineTo(last.x, last.y); ctx.stroke();
    ctx.restore();
  }

  // ---------- undo + persistence ----------
  // Shallow snapshot is enough: stroke objects are never mutated once another
  // stroke begins (the pen appends to a NEW object; erase/clear replace arrays).
  // A snapshot captures BOTH ink and text for the slide (see snapshot() above),
  // so one undo stack reverts either kind — or a mix — in creation order.
  function pushUndo() { commitSnapshot(curKey(), snapshot(curKey())); }
  // undo and redo are the same move with the two stacks swapped
  function shiftStack(from, to) {
    // commit an open edit FIRST: its commitSnapshot may replace state.redo[id],
    // and a stack reference taken before that would pop from the orphaned array
    if (state.editingText) commitEditing();
    const id = curKey(), stack = from[id];
    if (!stack || !stack.length) return;
    (to[id] = to[id] || []).push(snapshot(id));
    const snap = stack.pop();
    state.strokes[id] = snap.strokes; state.texts[id] = snap.texts;
    redraw(); renderTexts(); save();
  }
  const undo = () => shiftStack(state.undo, state.redo);
  const redo = () => shiftStack(state.redo, state.undo);
  const envelope = () => ({ v: 1, strokes: state.strokes, texts: state.texts, boards: state.boards });
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
        return { strokes: d.strokes || {}, texts: (d.texts && typeof d.texts === 'object') ? d.texts : {}, boards: boards };
      }
      return { strokes: migrateIndexKeys(d), texts: {}, boards: [] };
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
  // the one name every reader of the legacy embedded block shares
  const EMBED_ATTR = 'data-aht-annotations';
  const embeddedIn = (doc) => doc.querySelector('script[type="application/json"][' + EMBED_ATTR + ']');
  function readEmbedded() {
    const n = embeddedIn(document);
    if (!n) return null;
    return parseEnvelope(n.textContent);
  }
  function load(onLate) {
    if (!cfg.annotations) return;   // present clean: start empty, touch nothing
    let env = null;
    if (cfg.persist) { try { const s = localStorage.getItem(cfg.storageKey); if (s) env = parseEnvelope(s); } catch (e) {} }
    // no local state (not even a cleared-empty one) → adopt the deck's baseline
    if (!env) env = readEmbedded();
    if (env) { state.strokes = env.strokes || {}; state.texts = env.texts || {}; state.boards = env.boards || []; }
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
    pushUndo();   // the pen/highlighter always commit at least a dot — snapshot up front
    state.drawing = 'pen';
    const hl = state.tool === 'highlighter';
    const width = hl ? cfg.highlighterWidth : state.width;
    state.cur = { color: state.color, width: width, a: aspect(), bw: Math.round(rect.width), points: [toRatio(p)] };
    if (hl) state.cur.hl = true;
    const id = curKey();
    (state.strokes[id] = state.strokes[id] || []).push(state.cur);
    // highlighter: repaint the whole stroke each frame (one translucent path, no
    // beaded overlaps at the joins); pen: draw the opening dot straight to canvas
    if (hl) redraw();
    else { ctx.fillStyle = state.color; ctx.beginPath(); ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2); ctx.fill(); }
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
    // highlighter needs a clean full repaint so its translucency doesn't stack
    // at the segment joins; the opaque pen draws just the new segment
    if (state.cur.hl) { redraw(); return; }
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

  // ---------- typed text ----------
  // Text is a first-class annotation type, HTML/DOM end-to-end: a live overlay
  // of contenteditable boxes (this section), the same shape baked into slides on
  // flatten, and revived from that same HTML. Model per item, keyed like ink:
  //   { xr, yr, size, color, a, text }  in state.texts[key]
  // xr = left-edge ratio, yr = vertical-CENTRE ratio, size = fraction of the
  // slide-box height (so text scales with the slide, like ink line width).
  const fontPxIn = (H, size) => Math.round(H * size * 100) / 100;   // size fraction → px in an H-tall box
  const fontPx = (size) => fontPxIn(rect ? rect.height : 700, size);
  // a size preset is {size, bold?, cond?}; a bare number means size-only
  const asPreset = (v) => (v && typeof v === 'object') ? v : { size: v };
  const CONDENSED_FF = "var(--aht-font-condensed, var(--aht-font, 'Open Sans', system-ui, sans-serif))";
  const isBold = (w) => /^(bold(er)?|[6-9]\d\d)$/.test(String(w || '').trim());
  const isCond = (s) => { s = String(s || '').trim(); if (!s) return false; if (/condensed|narrow/i.test(s)) return true; const n = parseFloat(s); return isFinite(n) && n < 100; };
  // apply a text item's size + style (weight/condensed) to its live edit box, so
  // the caret box is WYSIWYG with the baked/printed output
  function styleEdit(elm, t) {
    elm.style.fontSize = fontPx(t.size) + 'px';
    elm.style.fontWeight = t.bold ? '700' : '400';
    elm.style.fontStretch = t.cond ? '75%' : '';
    elm.style.letterSpacing = t.cond ? '-.02em' : '';
    elm.style.fontFamily = t.cond ? CONDENSED_FF : '';
  }
  const textList = (id) => (state.texts[id] = state.texts[id] || []);
  const liveTexts = (id) => (state.texts[id] || []).filter((t) => t.text && t.text.trim());
  // innerText (not textContent): it preserves the visual line breaks browsers
  // insert while typing; normalize their &nbsp; to spaces, drop the trailing \n
  const readText = (edit) => edit.innerText.replace(/\u00a0/g, ' ').replace(/\n$/, '');
  function snapshot(id) {
    return {
      strokes: (state.strokes[id] || []).slice(),
      texts: (state.texts[id] || []).map((o) => Object.assign({}, o)),
    };
  }
  function commitSnapshot(id, snap) {   // record one undoable action from a pre-captured snapshot
    (state.undo[id] = state.undo[id] || []).push(snap);
    if (state.undo[id].length > 100) state.undo[id].shift();
    state.redo[id] = [];
  }
  const positionItem = (item) => { item.style.left = pct(item._t.xr); item.style.top = pct(item._t.yr); };
  // The text layer and its children receive pointer events ONLY while the Text
  // tool is live — updateLayers() + the layer CSS own that invariant, so the
  // handlers below need no tool checks of their own.
  function buildTextItem(t) {
    const item = el('div', { class: 'aht-text-item' });
    item._t = t;
    item._key = curKey();   // items are only ever built for the current slide
    positionItem(item);
    item.style.transform = 'translateY(-50%)';
    // tools are SIBLINGS of the editable div, never inside it (would become content)
    const tools = el('div', { class: 'aht-text-tools' });
    const grip = el('span', { class: 'aht-text-grip', title: 'Drag to move' }, ICONS.grip);
    const del = btn({ class: 'aht-text-del', title: 'Delete text' }, ICONS.trash, (e) => { e.stopPropagation(); removeTextItem(item); });
    tools.appendChild(grip); tools.appendChild(del);
    const edit = item._edit = el('div', { class: 'aht-text-edit' });
    edit.textContent = t.text || '';
    edit.style.color = t.color;
    styleEdit(edit, t);
    // the model follows every keystroke, so anything reading it mid-edit
    // (print, JSON export, the pre-delete snapshot) sees the live text
    edit.addEventListener('input', () => { t.text = readText(edit); item._dirty = true; });
    edit.addEventListener('pointerdown', (e) => e.stopPropagation());
    edit.addEventListener('click', () => { if (state.editingText !== item) startEditing(item); });
    item.appendChild(tools); item.appendChild(edit);
    initTextDrag(grip, item);
    return item;
  }
  function renderTexts() {
    if (state.editingText) return;   // never rebuild out from under an active caret
    textLayer._key = curKey();       // memo for place(): which slide this layer shows
    textLayer.textContent = '';
    (state.texts[textLayer._key] || []).forEach((t) => textLayer.appendChild(buildTextItem(t)));
  }
  function repositionTexts() {   // layout pass: update font px in place, keep any caret
    Array.prototype.forEach.call(textLayer.children, (item) => {
      styleEdit(item._edit, item._t);
    });
  }
  function startEditing(item) {
    if (state.editingText && state.editingText !== item) commitEditing();
    if (!item._preSnap) { item._preSnap = snapshot(item._key); item._isNew = false; item._dirty = false; }
    item.classList.add('editing');
    item._edit.setAttribute('contenteditable', 'true');
    state.editingText = item;
    item._edit.focus();
    const r = document.createRange(); r.selectNodeContents(item._edit); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  // Commit updates the item IN PLACE (no full rebuild) so that clicking straight
  // from one box to another in the same gesture doesn't detach the target node.
  function commitEditing() {
    const item = state.editingText;
    if (!item) return;
    state.editingText = null;
    item._edit.setAttribute('contenteditable', 'false');
    item.classList.remove('editing');
    const id = item._key, t = item._t;
    t.text = readText(item._edit);
    const preSnap = item._preSnap; const isNew = item._isNew; const dirty = item._dirty;
    item._preSnap = null; item._isNew = false; item._dirty = false;
    if (!t.text.trim()) {
      // empty: discard the box. A brand-new empty box leaves no undo entry.
      if (!isNew) commitSnapshot(id, preSnap);
      removeFromModel(id, t); item.remove();
      if (!isNew) save();
      return;
    }
    if (isNew || dirty) { commitSnapshot(id, preSnap); save(); }
  }
  function removeFromModel(id, t) {
    const list = state.texts[id]; if (!list) return;
    const i = list.indexOf(t); if (i >= 0) list.splice(i, 1);
  }
  function removeTextItem(item) {
    if (state.editingText === item) state.editingText = null;
    const id = item._key;
    commitSnapshot(id, snapshot(id));   // model is input-synced: undo restores what the user saw
    removeFromModel(id, item._t); item.remove(); save();
  }
  function addTextAt(xr, yr) {
    const id = curKey();
    const pre = snapshot(id);
    const t = { xr: clamp01(xr), yr: clamp01(yr), size: state.size, color: state.color, a: aspect(), text: '', bold: state.bold, cond: state.cond };
    textList(id).push(t);
    const item = buildTextItem(t);
    item._isNew = true; item._preSnap = pre; item._dirty = false;
    textLayer.appendChild(item);
    startEditing(item);
  }
  function initTextDrag(grip, item) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      const id = item._key, t = item._t;
      const pre = snapshot(id);
      const start = { x: e.clientX, y: e.clientY, xr: t.xr, yr: t.yr };
      let moved = false;
      const move = (ev) => {
        if (!rect) return;
        t.xr = clamp01(start.xr + (ev.clientX - start.x) / rect.width);
        t.yr = clamp01(start.yr + (ev.clientY - start.y) / rect.height);
        positionItem(item);
        moved = true;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        if (!moved) return;
        // dragging the box being edited folds into that edit session: its
        // _preSnap predates the drag, so commit records ONE chronological entry
        if (state.editingText === item) item._dirty = true;
        else { commitSnapshot(id, pre); save(); }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }
  // click empty layer (Text tool) → drop a new box there and start typing
  function onTextLayerDown(e) {
    if (e.target !== textLayer) return;   // clicks on an item are handled by the item
    e.preventDefault();
    rect = textLayer.getBoundingClientRect();   // refresh once per gesture (zoom-safe, like onDown)
    addTextAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  }
  // clicking anywhere outside the editing box (except the annotation bar, whose
  // colour/size controls act ON the edit) commits it — capture phase, so it runs
  // before the layer's own empty-click handler creates the next box
  function onDocDownForText(e) {
    if (!state.editingText) return;
    const item = state.editingText;
    if (item.contains(e.target)) return;
    if (bar && bar.contains(e.target)) return;
    commitEditing();
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
    highlighter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}>${paths(HL_D)}</svg>`,
    eraser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}>${paths(ERASER_D)}</svg>`,
    // lucide "type": a capital T — the typed-text annotation tool
    type: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></svg>`,
    undo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,
    redo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>`,
    // lucide broom: sweep this slide clean; broom-sparkles (with the sparkle
    // marks) means "sweep the whole deck"
    clean: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M13.5 10.5 22 2"/><path d="M14.734 13.841a2 2 0 0 0-.314-2.42L12.58 9.58a2 2 0 0 0-2.421-.314l-7.657 4.461A1 1 0 0 0 2.3 15.3l6.403 6.403a1 1 0 0 0 1.571-.204z"/><path d="m5 18 2-2"/><path d="m7.699 10.7 5.602 5.601"/></svg>`,
    cleanAll: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M11 2v2"/><path d="M12 3h-2"/><path d="M13.5 10.5 22 2"/><path d="M14.734 13.841a2 2 0 0 0-.314-2.42L12.58 9.58a2 2 0 0 0-2.421-.314l-7.657 4.461A1 1 0 0 0 2.3 15.3l6.403 6.403a1 1 0 0 0 1.571-.204z"/><path d="M20 15v4"/><path d="M22 17h-4"/><path d="M4 4v4"/><path d="m5 18 2-2"/><path d="M6 6H2"/><path d="m7.699 10.7 5.602 5.601"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    // lucide trash-2: the delete affordance on a text box
    trash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
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
    // Chromium focuses a <button> on mousedown, which would blur the caret out
    // of a text box being edited (bar clicks deliberately don't commit — colour
    // and size act ON the edit). Suppress the focus steal; click still fires.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    const penBtn = btn({ 'data-tool': 'pen', title: 'Pen (A)' }, ICONS.pen, () => setTool('pen'));
    const hlBtn = btn({ 'data-tool': 'highlighter', title: 'Highlighter (H)' }, ICONS.highlighter, () => setTool('highlighter'));
    const eraBtn = btn({ 'data-tool': 'eraser', title: 'Eraser (E)' }, ICONS.eraser, () => setTool('eraser'));
    const txtBtn = btn({ 'data-tool': 'text', title: 'Text (T)' }, ICONS.type, () => setTool('text'));

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

    // text-size presets (S/M/L) — picking one switches to the Text tool and
    // carries that preset's style (size + optional bold / condensed)
    const sizes = el('span', { class: 'aht-sizes' });
    Object.entries(cfg.textSizes).forEach(([name, raw]) => {
      const p = asPreset(raw);
      sizes.appendChild(btn({ class: 'aht-size ' + name.toLowerCase(), 'data-size': p.size, title: name + ' text' },
        '<span>' + name + '</span>', () => setSize(p)));
    });

    const grip = el('span', { class: 'aht-grip', title: 'Drag to move this toolbar' }, ICONS.grip);
    initBarDrag(grip);
    const minBtn = btn({ id: 'aht-minbtn', title: 'Minimize toolbar' }, ICONS.chevDown, () => {
      barPos = Object.assign({}, barPos, { min: !(barPos && barPos.min) });
      applyBarPos(); saveUI();
    });

    [grip, penBtn, hlBtn, eraBtn, txtBtn,
      btn({ title: 'Undo (Ctrl+Z)' }, ICONS.undo, undo),
      btn({ id: 'aht-redo', title: 'Redo (Ctrl+Shift+Z)' }, ICONS.redo, redo),
      btn({ id: 'aht-clear', title: 'Clear ink and text on this slide (X)' }, ICONS.clean, clearSlide),
      sep(), swatches, sep(),
      btn({ id: 'aht-board', title: 'Insert board slide' }, ICONS.board, () => (onBoard() ? removeBoardConfirmed() : addBoard())),
      btn({ id: 'aht-surface', title: 'Board surface: dark / white', hidden: '' }, ICONS.contrast, toggleSurface),
      sep(),
      btn({ id: 'aht-clearall', title: 'Delete all ink and board slides (Shift+X)' }, ICONS.cleanAll, clearAllConfirmed),
      sep(),
      minBtn,
      btn({ title: 'Exit annotation (A / Esc)' }, ICONS.x, () => enable(false)),
    ].forEach((n) => bar.appendChild(n));
    // stroke widths / text sizes live in a panel that floats above the pen or
    // the text button (whichever tool is active) — positioned by syncToolRow()
    const toolRow = el('div', { class: 'aht-toolrow' });
    toolRow.appendChild(widths); toolRow.appendChild(sizes);
    bar.appendChild(toolRow);
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
    box.appendChild(item(ICONS.saveClean, 'Save a copy', 'single HTML file, no annotations', () => saveCopy(false)));
    if (cfg.annotations) {
      box.appendChild(item(ICONS.save, 'Save portable copy', 'annotations baked into the slides', () => savePortable()));
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
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        saveUI();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }

  function syncUI() {
    if (!bar) return;
    bar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tool') === state.tool));
    bar.querySelectorAll('.aht-swatch').forEach((b) => b.classList.toggle('active', b.getAttribute('data-color') === state.color));
    bar.querySelectorAll('.aht-w').forEach((b) => b.classList.toggle('active', +b.getAttribute('data-w') === state.width));
    bar.querySelectorAll('.aht-size').forEach((b) => b.classList.toggle('active', +b.getAttribute('data-size') === state.size));
    syncToolRow();
  }
  // the width/size panel follows the active tool: shown above the pen (widths)
  // or the text button (sizes), hidden for the eraser. Visibility is CSS-driven
  // off the tool-* class (so .min still hides it); JS only sets the left offset
  // that centres the panel over the button.
  function syncToolRow() {
    if (!bar) return;
    bar.classList.toggle('tool-pen', state.tool === 'pen');
    bar.classList.toggle('tool-text', state.tool === 'text');
    const toolRow = bar.querySelector('.aht-toolrow');
    const anchor = bar.querySelector(state.tool === 'text' ? '[data-tool="text"]' : '[data-tool="pen"]');
    if (toolRow && anchor) toolRow.style.left = (anchor.offsetLeft + anchor.offsetWidth / 2) + 'px';
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
    textLayer.style.display = ov ? 'none' : '';
    document.body.classList.toggle('aht-noselect', state.on);
    bar.hidden = !state.on || ov;
    launch.hidden = state.on || ov;
    updateLayers();
    if (!bar.hidden) { applyBarPos(); syncUI(); }   // re-clamp the (possibly dragged) bar
  }
  // exactly one overlay is pointer-interactive at a time: the ink canvas for
  // pen/eraser, the text overlay for the Text tool; neither in overview or when
  // annotation is off (so taps navigate and clicks reach the slide)
  function updateLayers() {
    const live = state.on && !state.overview;
    const textMode = live && state.tool === 'text';
    canvas.classList.toggle('active', live && !textMode);
    textLayer.classList.toggle('active', textMode);
  }

  // ---------- actions ----------
  function enable(v) {
    if (!v && state.editingText) commitEditing();
    state.on = v;
    if (v) place();
    render();
    setChrome(v ? false : noHover);   // hide toolbar while drawing; on touch, restore it after
  }
  function setTool(t) {
    if (state.tool !== t && state.editingText) commitEditing();
    state.tool = t;
    canvas.classList.toggle('erasing', t === 'eraser');
    canvas.classList.toggle('highlighting', t === 'highlighter');
    updateLayers(); syncUI();
  }
  // colour picking: from the eraser it drops to the pen; the pen and highlighter
  // keep their tool (just recolour); for text it recolours the box being edited
  // (and future text) without leaving the Text tool
  function setColor(c) {
    state.color = c;
    if (state.tool === 'eraser') { setTool('pen'); return; }   // a colour picks a drawing tool
    if (state.tool !== 'text') { syncUI(); return; }           // pen / highlighter keep their tool
    const item = state.editingText;
    if (item && item._t.color !== c) { item._t.color = c; item._dirty = true; item._edit.style.color = c; }
    syncUI();
  }
  function setWidth(w) { state.width = w; syncUI(); }
  // size picking: switches to the Text tool (like a colour switches to the pen);
  // resizes the box being edited if any
  function setSize(p) {
    const preset = asPreset(p);
    state.size = preset.size; state.bold = !!preset.bold; state.cond = !!preset.cond;
    const item = state.editingText;
    if (item) {
      const t = item._t;
      if (t.size !== state.size || !!t.bold !== state.bold || !!t.cond !== state.cond) {
        t.size = state.size; t.bold = state.bold; t.cond = state.cond; item._dirty = true;
        styleEdit(item._edit, t);
      }
    }
    if (state.tool !== 'text') setTool('text');
    else syncUI();
  }
  function clearSlide() {
    const id = curKey();
    if (!(state.strokes[id] || []).length && !(state.texts[id] || []).length) return;   // a no-op must not wipe the redo branch
    if (state.editingText) commitEditing();
    pushUndo(); state.strokes[id] = []; state.texts[id] = []; redraw(); renderTexts(); save();
  }
  // clearAll wipes ink AND board slides and writes an EMPTY envelope (not
  // removeItem): the empty local state doubles as the tombstone that keeps a
  // deck-embedded baseline from resurrecting on the next load.
  function clearAll() {
    state.editingText = null;   // the box is going away with everything else — no commit
    const cur = state.Reveal.getCurrentSlide();
    if (boardIdOf(cur)) state.Reveal.slide(Math.max(0, state.Reveal.getIndices().h - 1));
    state.strokes = {}; state.texts = {}; state.undo = {}; state.redo = {};
    const had = state.boards.length;
    state.boards = [];
    slidesEl.querySelectorAll('[data-aht-board]').forEach((s) => s.remove());
    if (had) state.Reveal.sync();
    save(); redraw(); renderTexts(); updateSlideNo(); syncBoardUI();
  }
  const clearAllConfirmed = () => confirmBox('Delete all annotations and board slides in this deck?', 'Delete', clearAll);

  // ---------- board slides ----------
  // A board is a REAL <section> inserted after the current slide — it shows in
  // the overview, speaker view and PDF export. data-visibility="uncounted"
  // keeps reveal's slide numbers stable for the audience. Boards are persisted
  // (id, anchor slide's stable key, surface) and re-inserted on load.
  const genId = () => Math.random().toString(36).slice(2, 8);
  // the surface is painted on the SECTION via the [data-aht-surface] CSS above
  // (not data-background-color: reveal paints those across the whole viewport,
  // but a board keeps the deck's slide format)
  function boardSection(b, doc) {
    const s = (doc || document).createElement('section');
    s.setAttribute('data-aht-board', b.id);
    s.setAttribute('data-visibility', 'uncounted');
    s.setAttribute('data-aht-surface', b.bg);
    keyCache.set(s, 'b:' + b.id);   // harmless for foreign docs (WeakMap, GC'd with them)
    return s;
  }
  function topLevelOf(s, root) {
    let n = s;
    root = root || slidesEl;
    while (n.parentElement && n.parentElement !== root) n = n.parentElement;
    return n;
  }
  // Re-insert persisted boards after their anchor slides, found by stable key —
  // into the LIVE deck (load, import, storage sync, print) or a parsed source
  // document (flatten). A board whose anchor was deleted from the deck goes to
  // the end rather than being lost. New sections are added to keyMap.
  function materializeBoardsIn(root, keyMap) {
    // reconcile, not just add: a board section whose board left the model — a
    // baked board deleted in an earlier session (localStorage tombstone), or
    // still present in a fetched source — is pruned, so it neither reappears in
    // the deck nor resurrects in the next portable copy
    root.querySelectorAll('section[data-aht-board]').forEach((s) => {
      if (!boardById(s.getAttribute('data-aht-board'))) s.remove();
    });
    const byKey = new Map();
    keyMap.forEach((k, s) => { if (!byKey.has(k)) byKey.set(k, s); });
    state.boards.forEach((b) => {
      if (root.querySelector('[data-aht-board="' + b.id + '"]')) return;
      const sec = boardSection(b, root.ownerDocument);
      const anchor = byKey.get(b.after);
      if (anchor) {
        let ref = topLevelOf(anchor, root);
        // boards of the same anchor keep their array order in the deck
        while (ref.nextElementSibling && ref.nextElementSibling.hasAttribute('data-aht-board')) ref = ref.nextElementSibling;
        ref.after(sec);
      } else {
        root.appendChild(sec);
      }
      keyMap.set(sec, 'b:' + b.id);
    });
  }
  function materializeBoards() {
    const keyMap = new Map();
    leafSections().forEach((s) => keyMap.set(s, keyCache.get(s)));
    materializeBoardsIn(slidesEl, keyMap);
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
    delete state.texts['b:' + id];
    delete state.undo['b:' + id];
    delete state.redo['b:' + id];
    state.Reveal.slide(Math.max(0, state.Reveal.getIndices().h - 1));
    cur.remove();
    state.Reveal.sync();
    save(); redraw(); renderTexts(); updateSlideNo(); syncBoardUI();
  }
  const removeBoardConfirmed = () => confirmBox('Delete this board slide and its annotations?', 'Delete', removeBoard);
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
    if (state.drawing || state.editingText) return;   // never swap out from under an in-flight stroke/edit
    const sameBoards = JSON.stringify(state.boards) === JSON.stringify(env.boards || []);
    state.strokes = env.strokes || {};
    state.texts = env.texts || {};
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
    redraw(); renderTexts(); updateSlideNo(); syncBoardUI(); ensureContrast();
    if (persistIt) save();
  }
  // Both "Save a copy" and "Save portable copy" fetch this deck's own HTML
  // source and download a single self-contained file. The SOURCE is modified,
  // not the live DOM, so no plugin UI (and no runtime board section) leaks in.
  function fetchForCopy() {
    // module builds keep their tag untouched: inlining an ES module into a
    // classic <script> would throw on its import/export statements
    const tag = document.querySelector('script[src*="reveal-autohide-toolbar"]:not([type="module"])');
    return Promise.all([
      fetch(location.href, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }),
      tag ? fetch(tag.src, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null) : null,
    ]);
  }
  const parseDoc = (src) => new DOMParser().parseFromString(src, 'text/html');
  const serializeDoc = (doc) => '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  // Replace the plugin's own <script src> with an INLINE copy of its source: a
  // deck that loaded the plugin via a relative path would otherwise open as a
  // blank page when the downloaded file is opened from another directory.
  // (reveal itself should be loaded from absolute/CDN URLs to make the copy
  // portable — relative reveal assets can't travel with a single file.)
  function inlinePlugin(out, pluginJs) {
    if (!pluginJs) return out;
    // shed the long doc header (it also contains an example plugin <script src>
    // tag, which must not survive into a self-contained copy); a one-line banner
    // keeps the licence notice
    const banner = '/* reveal.js-autohide-toolbar (inlined by "Save a copy") · MIT · '
      + 'https://github.com/frankhuettner/reveal.js-autohide-toolbar */\n';
    const compact = pluginJs.replace(/^\/\*[\s\S]*?\*\/\s*/, banner);
    // '</script' may only occur in comments/strings of the source; escape it so
    // the HTML parser can't end the inline block early
    const inlined = '<script>' + compact
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<script/gi, '<\\x73cript') + '<' + '/script>';
    return out.replace(/<script[^>]*src=["'][^"']*reveal-autohide-toolbar[^"']*["'][^>]*>\s*<\/script>/i, () => inlined);
  }
  // "Save a copy": a clean deck — strip every annotation artifact (baked
  // wrappers, board slides, and any legacy embedded JSON block).
  // shed baked-annotation artifacts from a parsed source: flat wrappers and any
  // legacy embedded JSON block (board sections are the callers' business)
  function stripBaked(doc) {
    doc.querySelectorAll('[data-aht-flat]').forEach((n) => n.remove());
    const legacy = embeddedIn(doc);
    if (legacy) legacy.remove();
  }
  // the deck's configured slide box, in reveal coordinates, with sane fallbacks —
  // flatten bakes in these units; revive needs them only as a fallback
  function deckSize() {
    const c = state.Reveal.getConfig();
    const size = state.Reveal.getComputedSlideSize ? state.Reveal.getComputedSlideSize() : null;
    return {
      W: (typeof c.width === 'number' && c.width) || (size && size.width) || 960,
      H: (typeof c.height === 'number' && c.height) || (size && size.height) || 700,
    };
  }
  function saveCopy(withInk) {
    // back-compat: the old default (no arg) and saveCopy(true) saved WITH ink —
    // both now bake; only an explicit false yields the clean copy
    if (withInk !== false) return savePortable();
    fetchForCopy().then(([src, pluginJs]) => {
      const doc = parseDoc(src);
      stripBaked(doc);
      doc.querySelectorAll('section[data-aht-board]').forEach((n) => n.remove());
      download(deckName() + '-copy.html', inlinePlugin(serializeDoc(doc), pluginJs), 'text/html');
    }).catch((err) => {
      console.warn('autohide-toolbar: "Save a copy" failed — it needs http(s) to fetch the deck source (file://?):', err);
    });
  }
  // "Save portable copy": bake annotations into the slides as REGULAR content —
  // ink as static SVG paths, text as editable HTML — so the file displays
  // anywhere reveal runs (even without this plugin) and revives to fully
  // editable wherever the plugin loads. The plugin is still inlined so a
  // normally-opened copy auto-revives.
  function savePortable() {
    if (state.editingText) commitEditing();
    fetchForCopy().then(([src, pluginJs]) => {
      const doc = parseDoc(src);
      flattenInto(doc);
      download(deckName() + '-portable.html', inlinePlugin(serializeDoc(doc), pluginJs), 'text/html');
    }).catch((err) => {
      // file:// etc. — at least save the annotations themselves (and surface
      // the reason, so a real flatten bug isn't silently masked as a fallback)
      console.warn('autohide-toolbar: portable save fell back to JSON:', err);
      exportJSON();
    });
  }
  // Bake the live annotation model into a parsed source document (§ flatten).
  function flattenInto(doc) {
    const slides = doc.querySelector('.reveal .slides');
    if (!slides) return;
    stripBaked(doc);   // idempotent: shed any prior baked wrappers / legacy block
    // geometry: the reveal-coordinate slide box + the centring mode, known once
    // from the deck config (the source shares it) — see § center:true
    const { W, H } = deckSize();
    const center = state.Reveal.getConfig().center !== false;
    // Key the SOURCE sections. Prefer INDEX alignment with the live deck:
    // runtime transforms (markdown, KaTeX) rewrite a section's text in place,
    // so content hashes of the raw source may not match the live keys — but the
    // section ORDER does. Fall back to content-hash keys only when the leaf
    // counts differ (e.g. slides generated from an external file).
    // (exclude boards and — unless showHiddenSlides — hidden slides, which
    // reveal removes from the live DOM at init but the source still contains)
    const showHidden = state.Reveal.getConfig().showHiddenSlides;
    const aligns = (s) => !s.hasAttribute('data-aht-board')
      && (showHidden || s.getAttribute('data-visibility') !== 'hidden');
    const srcLeaves = leafSectionsIn(slides).filter(aligns);
    const liveLeaves = leafSections().filter(aligns);
    let keyMap;
    if (srcLeaves.length === liveLeaves.length) {
      keyMap = new Map(srcLeaves.map((s, i) => [s, keyCache.get(liveLeaves[i]) || sectionKey(liveLeaves[i])]));
      leafSectionsIn(slides).forEach((s) => {
        if (s.hasAttribute('data-aht-board')) keyMap.set(s, 'b:' + s.getAttribute('data-aht-board'));
      });
    } else {
      keyMap = keysFor(slides);
    }
    // materialize board slides INTO the source so board ink bakes onto real
    // pages, and bake their surface inline — the plugin's injected CSS doesn't
    // travel to a plugin-less viewer (values mirror the [data-aht-surface] rules)
    materializeBoardsIn(slides, keyMap);
    slides.querySelectorAll('section[data-aht-board]').forEach((s) => {
      s.style.height = '100%';
      s.style.backgroundColor = s.getAttribute('data-aht-surface') === 'white' ? '#FFFFFF' : 'var(--aht-board-bg, #000000)';
    });
    keyMap.forEach((key, sec) => {
      const strokes = state.strokes[key] || [];
      const texts = liveTexts(key);
      if (!strokes.length && !texts.length) return;
      sec.appendChild(buildFlatWrapper(doc, strokes, texts, W, H, center));
    });
  }
  function buildFlatWrapper(doc, strokes, texts, W, H, center) {
    const wrap = doc.createElement('div');
    wrap.className = 'aht-flat';
    wrap.setAttribute('data-aht-flat', '1');
    wrap.setAttribute('style',
      'position:absolute; left:0; width:100%; height:' + H + 'px; '
      + (center ? 'top:50%; transform:translateY(-50%);' : 'top:0;')
      + ' pointer-events:none;');
    if (strokes.length) {
      const svg = strokesSvg(doc, strokes, W, H);
      svg.setAttribute('data-aht-ink', '');
      // a serialized root <svg> must carry xmlns + width/height to survive
      // foreign sanitizers (see § slides.com)
      svg.setAttribute('xmlns', NS);
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.setAttribute('style', 'position:absolute; inset:0; width:100%; height:100%; overflow:visible;');
      wrap.appendChild(svg);
    }
    texts.forEach((t) => wrap.appendChild(textNode(doc, t, W, H)));
    return wrap;
  }

  // ---------- revive: baked annotations → editable model ----------
  // The inverse of flatten: on load, parse any baked wrappers back into the
  // ratio model and strip them, so the plugin's live rendering is the single
  // source (no double display). Keys are computed with wrappers EXCLUDED
  // (contentBasis), so they match the deck's clean keys and localStorage.
  function reviveFlattened() {
    if (!slidesEl) return false;
    if (!cfg.annotations) {
      // present clean: baked wrappers and board slides are native content the
      // browser would otherwise paint — actively remove them, parse nothing
      slidesEl.querySelectorAll('[data-aht-flat]').forEach((n) => n.remove());
      slidesEl.querySelectorAll('section[data-aht-board]').forEach((s) => s.remove());
      return false;
    }
    const { W, H } = deckSize();
    let any = false;
    leafSections().forEach((sec) => {
      const wraps = sec.querySelectorAll('[data-aht-flat]');
      if (!wraps.length) return;
      const key = keyCache.get(sec) || sectionKey(sec);
      wraps.forEach((wrap) => {
        // ink: the SVG's own viewBox is the authoritative W×H it was baked at,
        // so revive is exact regardless of the current deck config
        wrap.querySelectorAll('svg[data-aht-ink]').forEach((svg) => {
          const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
          const sW = (vb.length === 4 && vb[2]) || W, sH = (vb.length === 4 && vb[3]) || H;
          svg.querySelectorAll('path, circle').forEach((node) => {
            const st = reviveStroke(node, sW, sH);
            if (st && st.points.length) (state.strokes[key] = state.strokes[key] || []).push(st);
          });
        });
        wrap.querySelectorAll('[data-aht-text]').forEach((node) => {
          const t = reviveText(node, W, H);
          // trim, matching flatten's filter — foreign edits can leave whitespace
          if (t && (t.text || '').trim()) (state.texts[key] = state.texts[key] || []).push(t);
        });
        any = true;
        wrap.remove();
      });
    });
    adoptBakedBoards();
    return any;
  }
  // parse an SVG path's `d` — the quadratic control points ARE the original
  // stroke points (see strokeGeom), so this recovers them exactly
  function pathToPoints(d) {
    const pts = [];
    const re = /([MQL])\s*([-\d.eE,\s]*)/g;
    let m;
    while ((m = re.exec(d))) {
      const nums = m[2].trim().split(/[\s,]+/).filter((s) => s !== '').map(Number);
      if (nums.length >= 2) pts.push({ x: nums[0], y: nums[1] });   // M/L point, or Q control point
    }
    return pts;
  }
  function reviveStroke(node, W, H) {
    const a0 = parseFloat(node.getAttribute('data-aht-a')) || (W / H);
    const bwModel = parseFloat(node.getAttribute('data-aht-bw'));
    const box = fitBox(W, H, a0);
    const toR = (x, y) => ({ xr: Math.round((x - box.ox) / box.w * 1e4) / 1e4, yr: Math.round((y - box.oy) / box.h * 1e4) / 1e4 });
    let points, color, width;
    if (node.tagName.toLowerCase() === 'circle') {
      points = [toR(parseFloat(node.getAttribute('cx')), parseFloat(node.getAttribute('cy')))];
      color = node.getAttribute('fill') || cfg.defaultColor;
      width = parseFloat(node.getAttribute('data-aht-w')) || (parseFloat(node.getAttribute('r')) * 2) || cfg.defaultWidth;
    } else {
      points = pathToPoints(node.getAttribute('d') || '').map((p) => toR(p.x, p.y));
      color = node.getAttribute('stroke') || cfg.defaultColor;
      width = parseFloat(node.getAttribute('data-aht-w')) || parseFloat(node.getAttribute('stroke-width')) || cfg.defaultWidth;
    }
    const st = { color: color, width: width, a: a0, points: points };
    // no data-aht-bw: OUR nodes (data-aht-w) baked a legacy constant-px stroke —
    // keep it legacy; FOREIGN ink is in box units, so scale it with the box
    if (bwModel) st.bw = bwModel;
    else if (!node.hasAttribute('data-aht-w')) st.bw = Math.round(box.w);
    // translucent stroke → highlighter: our data-aht-hl marker, or foreign ink
    // baked with a sub-1 stroke/fill opacity
    const op = parseFloat(node.getAttribute('circle' === node.tagName.toLowerCase() ? 'fill-opacity' : 'stroke-opacity'));
    if (node.hasAttribute('data-aht-hl') || (op > 0 && op < 1)) st.hl = true;
    return st;
  }
  function reviveText(node, W, H) {
    const size = parseFloat(node.getAttribute('data-aht-size'));
    const a0 = parseFloat(node.getAttribute('data-aht-a')) || (W / H);
    const left = parseFloat(node.style.left), top = parseFloat(node.style.top);
    const color = toHex(node.style.color) || cfg.defaultColor;
    // textContent (not innerText): revive parses hidden slides too, where
    // innerText would be empty. Our baked text keeps newlines in the text node;
    // convert any foreign-editor <br> to newlines as a best effort.
    let text;
    if (node.querySelector('br, div, p')) {
      const tmp = node.cloneNode(true);
      // Foreign contenteditable edits may encode line breaks as <br> or as
      // <div>/<p> per line (Chromium). A <br> that is a block's ONLY child is
      // that model's empty-line placeholder, not an extra break — drop it; then
      // each block contributes one break before itself and unwraps in place
      // (unwrapping keeps nested blocks attached for their own pass).
      tmp.querySelectorAll('br').forEach((br) => {
        const p = br.parentElement;
        const solo = p !== tmp && p.childNodes.length === 1 && /^(DIV|P)$/.test(p.tagName);
        br.replaceWith(solo ? '' : '\n');
      });
      tmp.querySelectorAll('div, p').forEach((d) => {
        if (d.previousSibling) d.before('\n');
        d.replaceWith.apply(d, Array.from(d.childNodes));
      });
      text = tmp.textContent;
    } else {
      text = node.textContent;
    }
    text = (text || '').replace(/\n$/, '');
    const finalSize = (isFinite(size) && size > 0) ? size : ((parseFloat(node.style.fontSize) / H) || cfg.defaultTextSize);
    // our own files carry data-aht-bold/-cond; foreign edits are read from CSS
    const bold = node.getAttribute('data-aht-bold') === '1' || isBold(node.style.fontWeight);
    const cond = node.getAttribute('data-aht-cond') === '1' || isCond(node.style.fontStretch);
    return {
      xr: Math.round((isFinite(left) ? left : 0) / 100 * 1e4) / 1e4,
      yr: Math.round((isFinite(top) ? top : 50) / 100 * 1e4) / 1e4,
      size: finalSize, color: color, a: a0, text: text, bold: bold, cond: cond,
    };
  }
  // reconstruct the board model from baked board sections so they stay
  // editable/removable; anchor = the preceding counted slide's key
  function adoptBakedBoards() {
    let lastKey = null;
    leafSections().forEach((s) => {
      if (s.hasAttribute('data-aht-board')) {
        const id = s.getAttribute('data-aht-board');
        // live surface comes from the injected CSS — shed the baked inline copy
        // so later customization (--aht-board-bg) isn't overridden
        s.style.removeProperty('height'); s.style.removeProperty('background-color');
        if (!state.boards.some((b) => b.id === id)) {
          state.boards.push({ id: id, after: lastKey, bg: s.getAttribute('data-aht-surface') === 'dark' ? 'dark' : 'white' });
        }
      } else {
        lastKey = keyCache.get(s) || lastKey;
      }
    });
  }

  // ---------- keyboard ----------
  function onKey(e) {
    // editing a text box: swallow every key from reveal (so letters type and
    // arrows move the caret instead of navigating), Escape commits the edit —
    // a contenteditable isn't caught by the INPUT|TEXTAREA|SELECT guard below
    if (state.editingText) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); commitEditing(); }
      return;
    }
    if ((confirmEl || exportEl) && e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeConfirm(); closeExport();   // both null-safe; at most one is open
      return;
    }
    if (state.Reveal.getConfig().keyboard === false) return;   // respect the deck's keyboard setting
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.target && e.target.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (state.on) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === cfg.toggleKey) { e.preventDefault(); enable(!state.on); }
    else if (!state.on) return;
    else if (k === 'e') { e.preventDefault(); setTool(state.tool === 'eraser' ? 'pen' : 'eraser'); }
    else if (k === 'h') { e.preventDefault(); setTool(state.tool === 'highlighter' ? 'pen' : 'highlighter'); }
    else if (k === 't') { e.preventDefault(); setTool(state.tool === 'text' ? 'pen' : 'text'); }
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
    // resolve the default to a full preset (size + style); fall back to the
    // middle preset if defaultTextSize matches none of them
    const presets = Object.values(cfg.textSizes).map(asPreset);
    const def = presets.filter((p) => p.size === cfg.defaultTextSize)[0]
             || presets[Math.floor(presets.length / 2)] || { size: 0.04 };
    state.size = def.size; state.bold = !!def.bold; state.cond = !!def.cond;

    injectCSS();
    canvas = el('canvas', { id: 'aht-canvas' });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    textLayer = el('div', { id: 'aht-text-layer' });
    document.body.appendChild(textLayer);
    slidesEl = reveal.getSlidesElement ? reveal.getSlidesElement() : document.querySelector('.reveal .slides');
    computeKeys();          // before load(): key migration needs them
    reviveFlattened();      // baked annotations → editable model, wrappers stripped (localStorage still wins below)
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
      if (state.editingText) commitEditing();   // leaving a slide commits its open text box (keyed to the old slide)
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
    revealOn('overviewshown', () => {
      // commit BEFORE the text layer is hidden: readText's innerText degrades
      // to textContent (no line breaks) on a non-rendered subtree
      if (state.editingText) commitEditing();
      state.overview = true; render();
    });
    revealOn('overviewhidden', () => { state.overview = false; render(); });

    listen(canvas, 'pointerdown', onDown);
    listen(canvas, 'pointermove', onMove);
    listen(canvas, 'pointerup', onUp);
    listen(canvas, 'pointercancel', onUp);
    // swallow raw touch on the canvas while annotating — kills iOS long-press
    // selection/magnifier that pointer events alone don't suppress
    listen(canvas, 'touchstart', (e) => { if (state.on) e.preventDefault(); }, { passive: false });
    // Text tool: click empty overlay creates a box; a document-level capture
    // listener commits an open edit when you click elsewhere
    listen(textLayer, 'pointerdown', onTextLayerDown);
    listen(document, 'pointerdown', onDocDownForText, true);
    listen(document, 'keydown', onKey, true);
    if (reveal.registerKeyboardShortcut) {           // feed reveal's ? help overlay
      reveal.registerKeyboardShortcut(cfg.toggleKey.toUpperCase(), 'Toggle annotation');
      reveal.registerKeyboardShortcut('E', 'Eraser (while annotating)');
      reveal.registerKeyboardShortcut('H', 'Highlighter (while annotating)');
      reveal.registerKeyboardShortcut('T', 'Text (while annotating)');
      reveal.registerKeyboardShortcut('X', 'Clear slide annotations (Shift: whole deck)');
    }
    initChrome();

    // small runtime API (drive from your own buttons / the console) — the
    // destructive calls act directly; confirmation lives in the UI paths only
    window.AutohideToolbar = {
      enable, setTool, setColor, setSize, undo, redo, clearSlide, clearAll,
      addBoard, removeBoard, toggleSurface,
      saveCopy,                 // saveCopy(false) = clean copy, no annotations
      savePortable, flatten: savePortable,   // bake annotations into the slides
      // re-parse baked annotations into the model (and repaint — init's own
      // call runs before the first place(), which paints anyway)
      revive: () => { const r = reviveFlattened(); redraw(); renderTexts(); return r; },
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
    slidesEl = reveal.getSlidesElement ? reveal.getSlidesElement() : document.querySelector('.reveal .slides');
    if (!slidesEl) return;
    injectCSS();   // board sections get their dark/white surface from the
                   // injected [data-aht-surface] rules — print pages need them too
    computeKeys();
    // baked annotations: parse them into the model and strip the wrappers so the
    // proven print path (SVG overlays anchored to .pdf-page) renders them — and
    // there's no double ink. In clean print this actively removes them instead.
    reviveFlattened();
    if (!cfg.annotations) return;
    // A late-read block always lands in time: reveal defers print activation
    // (pagination + pdf-ready) to window 'load' while the document is still
    // parsing, and activation re-scans the DOM — so the late boards paginate
    // without reveal.sync(), which would only re-arm the input listeners
    // reveal's print mode deliberately removed.
    load((env) => {
      state.strokes = env.strokes || {}; state.texts = env.texts || {}; state.boards = env.boards || [];
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
    // in the key cache — sectionKey re-derives their key the same way the
    // original was keyed, so ink shows on every step's page.
    const printKey = (sec) => keyCache.get(sec) || sectionKey(sec);
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
      const key = printKey(sec);
      const list = state.strokes[key] || [];
      const texts = liveTexts(key);
      if (!list.length && !texts.length) return;
      const host = page || sec, ox = page ? gx : 0, oy = page ? gy : 0;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      if (list.length) {
        const svg = strokesSvg(document, list, W, H);
        svg.setAttribute('class', 'aht-print-ink');
        svg.setAttribute('style', 'position:absolute;left:' + ox + 'px;top:' + oy
          + 'px;width:' + W + 'px;height:' + H + 'px;pointer-events:none;overflow:visible;');
        host.appendChild(svg);
      }
      // text prints as real HTML (crisp, selectable): the same textNode the
      // flatten path bakes, inside a slide-box-sized host so its % coordinates
      // resolve identically to the baked output
      if (texts.length) {
        const box = document.createElement('div');
        box.className = 'aht-print-text';
        box.setAttribute('style', 'position:absolute;left:' + ox + 'px;top:' + oy
          + 'px;width:' + W + 'px;height:' + H + 'px;pointer-events:none;');
        texts.forEach((t) => box.appendChild(textNode(document, t, W, H)));
        host.appendChild(box);
      }
    });
  }

  // full teardown, per the official plugin API — called when the deck is destroyed
  function destroy() {
    cleanups.forEach((fn) => { try { fn(); } catch (e) {} });
    cleanups = [];
    clearTimeout(chromeTimer); clearTimeout(layoutTimer);
    closeConfirm();
    closeExport();
    if (slidesEl) slidesEl.querySelectorAll('[data-aht-board]').forEach((s) => s.remove());
    [canvas, textLayer, toolsEl, bar, document.getElementById('aht-styles')].forEach((n) => n && n.remove());
    canvas = textLayer = toolsEl = bar = launch = slideNoEl = null;
    document.body.classList.remove('aht-chrome');
    document.body.classList.remove('aht-noselect');
    state.on = false; state.overview = false; state.drawing = false; state.editingText = null; boardAuto = false;
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
