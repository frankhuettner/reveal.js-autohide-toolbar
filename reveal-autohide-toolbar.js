/*!
 * reveal.js-autohide-toolbar — presenter toolkit for reveal.js
 * --------------------------------------------------
 * Everything you need at the podium, in one dependency-free file:
 *   • ink annotation over slides (pen, eraser, undo, blackboard, palette)
 *   • a Slidev-style auto-hiding toolbar (prev/next, overview, speaker view,
 *     fullscreen, annotate, slide counter) in the bottom-left corner
 *   • touch support: toolbar stays visible on no-hover devices, tap left/right
 *     half to navigate (reveal handles swipe natively)
 *   • the annotation toolbar is draggable (grip handle) and minimizable, and
 *     remembers its position
 *   • ink syncs across same-origin windows via the storage event — draw in the
 *     speaker view and it shows on the audience screen, and vice versa
 *     (needs persist: true; concurrent drawing in two windows: last write wins)
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
 *   • each stroke also records the slide aspect ratio at draw time → if the
 *     deck's format later changes (16:9 → 4:3), ink is aspect-fit centred
 *     instead of stretched
 *   • re-placed on reveal resize, window resize, and monitor/zoom DPI changes
 *   • disabled automatically in print/PDF export and reveal's scroll view
 *
 * Options (Reveal.initialize({ autohideToolbar: { … } })):
 *   colors        string[]  swatch palette              (default: Office Standard Colors)
 *   defaultColor  string    initial pen colour          (default: '#FF0000')
 *   widths        {name:px} pen widths                  (default: {thin:3,med:6,thick:11})
 *   defaultWidth  number    initial pen width           (default: 6)
 *   eraserRadius  number    eraser hit radius (px)       (default: 16)
 *   persist       boolean   save ink to localStorage     (default: true)
 *   storageKey    string    localStorage key             (default: 'aht:'+pathname)
 *   tapToAdvance  boolean   touch tap-to-navigate        (default: true)
 *   tapIgnore     string    selector for tap targets that must NOT navigate
 *   tools         string[]  toolbar items, in order      (default below); items:
 *                           'prev','next','overview','speaker','fullscreen',
 *                           'annotate','slideno','sep'
 *   position      string    'bottom-left' (default) or 'bottom-right' — move the
 *                           toolbar when another plugin (e.g. reveal.js-menu)
 *                           owns the bottom-left corner
 *   toggleKey     string    annotation toggle key        (default 'a'; change it
 *                           on autoSlide decks — reveal core uses A for pause)
 *
 * Theming (CSS custom properties, set them on :root in the host deck):
 *   --aht-accent    active-tool highlight            (default #E31937)
 *   --aht-font      toolbar font                     (default 'Open Sans', system-ui)
 *   --aht-panel-bg  navigation toolbar background    (default rgba(10,18,34,.82))
 *   --aht-bar-bg    annotation toolbar background    (default rgba(6,18,42,.92))
 *   --aht-board-bg  blackboard colour                (default #0d1b2a)
 *   --aht-z         base z-index                     (default 30)
 *
 * Keys: A annotate · E eraser · Ctrl+Z undo · X clear slide · Shift+X clear all · Esc exit
 *
 * Assumes a single, full-viewport deck (the common case). Not yet multi-deck /
 * embedded-safe: UI is appended to <body> and listeners are document-level.
 *
 * Licence: MIT. Toolbar icons are lucide (https://lucide.dev, ISC).
 */
(function () {
  'use strict';

  const DEFAULTS = {
    colors: [
      '#FFFFFF', '#000000', '#C00000', '#FF0000', '#FFC000', '#FFFF00',
      '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0',
    ],
    defaultColor: '#FF0000',
    widths: { thin: 3, med: 6, thick: 11 },
    defaultWidth: 6,
    eraserRadius: 16,
    persist: true,
    storageKey: 'aht:' + location.pathname,
    tapToAdvance: true,
    tapIgnore: 'a, button, input, textarea, select, video, audio, iframe, summary, [contenteditable], [data-aht-no-tap]',
    tools: ['prev', 'next', 'sep', 'overview', 'speaker', 'fullscreen', 'sep', 'annotate', 'slideno'],
    position: 'bottom-left',
    toggleKey: 'a',
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
#aht-canvas.active { pointer-events: auto; cursor: ${cur(cursorSvg(PEN_D, '#FFC000'))} 2 22, crosshair; }
#aht-canvas.active.erasing { cursor: ${cur(cursorSvg(ERASER_D, '#F4A3A3'))} 6 20, cell; }
#aht-canvas.active.board { background: var(--aht-board-bg, #0d1b2a); }

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
#aht-slideno { color: #aeb8cc; font: 600 12px/1 var(--aht-font, 'Open Sans', system-ui, sans-serif); padding: 0 6px 0 4px; white-space: nowrap; user-select: none; }

#aht-bar {
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: calc(var(--aht-z, 30) + 30);
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
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

@media print { #aht-canvas, #aht-toolbar, #aht-bar { display: none !important; } }
`;

  // ---------- state ----------
  let cfg;
  const state = {
    Reveal: null, on: false, overview: false, tool: 'pen', color: null, width: 0,
    board: false, strokes: {}, undo: {}, drawing: false, cur: null,
  };
  let canvas, ctx, bar, launch, slideNoEl, toolsEl, slidesEl;
  let rect = null;            // slide box in CSS px — updated in place() / on pen-down
  let zone = null;            // toolbar hover-wake zone, derived from the toolbar's rect
  let chromeTimer = null, layoutTimer = null, noHover = false, tap = null;

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
  const slideId = () => { const i = state.Reveal.getIndices(); return i.h + '-' + (i.v || 0); };
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
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const st of (state.strokes[slideId()] || [])) drawStroke(st);
  }
  function drawStroke(st) {
    const pts = st.points;
    if (!pts.length) return;
    const box = strokeBox(st);
    ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = st.width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const p0 = toPx(pts[0], box);
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(p0.x, p0.y, st.width / 2, 0, Math.PI * 2); ctx.fill(); return; }
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
    const id = slideId();
    (state.undo[id] = state.undo[id] || []).push((state.strokes[id] || []).slice());
    if (state.undo[id].length > 100) state.undo[id].shift();
  }
  function undo() {
    const id = slideId(), stack = state.undo[id];
    if (!stack || !stack.length) return;
    state.strokes[id] = stack.pop(); redraw(); save();
  }
  function save() { if (!cfg.persist) return; try { localStorage.setItem(cfg.storageKey, JSON.stringify(state.strokes)); } catch (e) {} }
  function load() { if (!cfg.persist) return; try { const s = localStorage.getItem(cfg.storageKey); if (s) state.strokes = JSON.parse(s) || {}; } catch (e) {} }

  // ---------- pointer drawing ----------
  const xy = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  function onDown(e) {
    if (!state.on) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    rect = canvas.getBoundingClientRect();   // refresh once per gesture (zoom-safe)
    const p = xy(e);
    pushUndo();
    if (state.tool === 'eraser') { state.drawing = 'erase'; eraseAt(p); return; }
    state.drawing = 'pen';
    state.cur = { color: state.color, width: state.width, a: aspect(), points: [toRatio(p)] };
    (state.strokes[slideId()] = state.strokes[slideId()] || []).push(state.cur);
    ctx.fillStyle = state.color; ctx.beginPath(); ctx.arc(p.x, p.y, state.width / 2, 0, Math.PI * 2); ctx.fill();
  }
  function onMove(e) {
    if (!state.on || !state.drawing) return;
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
  function onUp() { if (!state.drawing) return; state.drawing = false; state.cur = null; redraw(); save(); }
  function eraseAt(p) {
    const id = slideId(), list = state.strokes[id] || [], keep = [];
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
    if (changed) { state.strokes[id] = keep; redraw(); }   // saved once, on gesture end (onUp)
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
    trash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
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
    board: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="4" width="19" height="14.5" rx="2" fill="#C79A5B"/><rect x="4.3" y="5.8" width="15.4" height="10.9" rx="1" fill="#2E7D52"/><path d="M6.6 12.1c1.6-1.3 3.2-1.3 4.8 0" stroke="#EFF6EA" stroke-width="1.3" stroke-linecap="round"/></svg>`,
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
      prev: () => deckBtn('Previous (←)', ICONS.prev, () => R.prev()),
      next: () => deckBtn('Next (→)', ICONS.next, () => R.next()),
      overview: () => deckBtn('Slide overview (O / Esc)', ICONS.grid, () => R.toggleOverview()),
      speaker: () => deckBtn('Speaker view (S)', ICONS.notes, openNotes),
      fullscreen: () => (fsBtn = deckBtn('Fullscreen (F)', ICONS.maximize, toggleFullscreen)),
      annotate: () => launch,
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

    [grip, penBtn, eraBtn, sep(), swatches, sep(), widths, sep(),
      btn({ title: 'Undo (Ctrl+Z)' }, ICONS.undo, undo),
      btn({ id: 'aht-board', title: 'Blackboard on/off' }, ICONS.board, () => setBoard(!state.board)),
      btn({ title: 'Clear this slide (X) · Shift = all slides' }, ICONS.trash, (ev) => (ev.shiftKey ? clearAll() : clearSlide())),
      sep(),
      minBtn,
      btn({ title: 'Exit annotation (A / Esc)' }, ICONS.x, () => enable(false)),
    ].forEach((n) => bar.appendChild(n));
    document.body.appendChild(bar);
    applyBarPos();
    syncUI();
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
    const bb = bar.querySelector('#aht-board');
    if (bb) bb.classList.toggle('active', state.board);
  }

  // ---------- visibility: one render derived from state ----------
  function render() {
    const ov = state.overview;
    canvas.style.display = ov ? 'none' : '';
    canvas.classList.toggle('active', state.on);
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
  function setBoard(v) {
    state.board = v;
    canvas.classList.toggle('board', v);
    // a pen too dark for the board switches to the palette's brightest colour
    if (v && luminance(state.color) < 0.13) {
      setColor(cfg.colors.reduce((a, b) => (luminance(a) >= luminance(b) ? a : b), state.color));
    }
    syncUI();
  }
  function clearSlide() { pushUndo(); state.strokes[slideId()] = []; redraw(); save(); }
  function clearAll() {
    state.strokes = {}; state.undo = {};
    try { localStorage.removeItem(cfg.storageKey); } catch (e) {}
    redraw();
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (state.Reveal.getConfig().keyboard === false) return;   // respect the deck's keyboard setting
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (state.on) { e.preventDefault(); undo(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === cfg.toggleKey) { e.preventDefault(); enable(!state.on); }
    else if (!state.on) return;
    else if (k === 'e') { e.preventDefault(); setTool(state.tool === 'eraser' ? 'pen' : 'eraser'); }
    else if (k === 'x') { e.preventDefault(); e.shiftKey ? clearAll() : clearSlide(); }
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
  function onTapDown(e) { tap = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null; }
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
      listen(document, 'pointerdown', onTapDown, { passive: true });
      listen(document, 'pointerup', onTapUp, { passive: true });
    }
    if (noHover) { setChrome(true); return; }        // touch: keep the toolbar visible
    listen(document, 'mousemove', onMoveChrome, { passive: true });
    setChrome(true);                                  // brief reveal on load for discoverability
    chromeTimer = setTimeout(() => { chromeTimer = null; setChrome(false); }, 2200);
  }

  function updateSlideNo() {
    if (!slideNoEl) return;
    const R = state.Reveal;
    slideNoEl.textContent = (R.getSlidePastCount() + 1) + ' / ' + R.getTotalSlides();
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
  function init(reveal) {
    state.Reveal = reveal;
    // keep print/PDF export clean, and stay out of reveal's scroll view (whose
    // stacked-slides layout the fixed canvas can't track). Check the URL and the
    // config as well as the API — at plugin-init time reveal may not have merged
    // ?view=… query params yet, so isScrollView()/isPrintView() can still be false.
    const view = reveal.getConfig().view;
    if ((reveal.isPrintView && reveal.isPrintView()) || view === 'print'
        || /[?&](print-pdf|view=print)/.test(location.search)) return;
    if ((reveal.isScrollView && reveal.isScrollView()) || view === 'scroll'
        || /[?&]view=scroll/.test(location.search)) return;
    cfg = Object.assign({}, DEFAULTS, reveal.getConfig().autohideToolbar || {});
    state.color = cfg.defaultColor;
    state.width = cfg.defaultWidth;

    injectCSS();
    canvas = el('canvas', { id: 'aht-canvas' });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    slidesEl = reveal.getSlidesElement ? reveal.getSlidesElement() : document.querySelector('.reveal .slides');
    load();
    loadUI();
    buildUI();

    // cross-window sync: another same-origin window (e.g. the SPEAKER VIEW's
    // slide iframe) saving ink fires 'storage' here — adopt and redraw, so
    // annotations drawn in either window show up in both. Last write wins.
    if (cfg.persist) {
      listen(window, 'storage', (e) => {
        if (e.key !== cfg.storageKey || state.drawing) return;
        try { state.strokes = e.newValue ? (JSON.parse(e.newValue) || {}) : {}; } catch (err) { return; }
        state.undo = {};   // undo history refers to pre-sync state
        redraw();
      });
    }

    const onLayout = () => { place(); updateSlideNo(); updateZone(); applyBarPos(); };
    const scheduleLayout = () => { clearTimeout(layoutTimer); layoutTimer = setTimeout(onLayout, 0); };
    revealOn('ready', onLayout);           // plugins init before 'ready', so this covers startup
    // late layout shifts (web fonts settling after 'ready') can move the slides box
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleLayout).catch(() => {});
    revealOn('slidechanged', () => { place(); updateSlideNo(); });
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
    listen(document, 'keydown', onKey, true);
    if (reveal.registerKeyboardShortcut) {           // feed reveal's ? help overlay
      reveal.registerKeyboardShortcut(cfg.toggleKey.toUpperCase(), 'Toggle annotation');
      reveal.registerKeyboardShortcut('E', 'Eraser (while annotating)');
      reveal.registerKeyboardShortcut('X', 'Clear ink on slide (Shift: whole deck)');
    }
    initChrome();

    // small runtime API (drive from your own buttons / the console)
    window.AutohideToolbar = { enable, setTool, setColor, undo, clearSlide, clearAll, setBoard, toggle: () => enable(!state.on) };
  }

  // full teardown, per the official plugin API — called when the deck is destroyed
  function destroy() {
    cleanups.forEach((fn) => { try { fn(); } catch (e) {} });
    cleanups = [];
    clearTimeout(chromeTimer); clearTimeout(layoutTimer);
    [canvas, toolsEl, bar, document.getElementById('aht-styles')].forEach((n) => n && n.remove());
    canvas = toolsEl = bar = launch = slideNoEl = null;
    document.body.classList.remove('aht-chrome');
    state.on = false; state.overview = false; state.drawing = false;
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
