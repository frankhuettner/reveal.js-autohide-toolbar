# reveal.js-autohide-toolbar

**▶ [Try the live demo](https://huettner.io/reveal.js-autohide-toolbar/demo/)** —
draw on the slides, insert a board slide, save an annotated copy, switch the
deck format, all in your browser.

A presenter toolkit for [reveal.js](https://revealjs.com), in one dependency-free
file: **ink annotation** over your slides plus a **Slidev-style auto-hiding
toolbar** with everything you need at the podium.

- ✏️ **Annotate slides** — pen, true per-stroke eraser, undo, colour palette
  (three neutrals plus five hues, each as an **ink**/**chalk** pair from the
  Tailwind ramps: the dark 700 shade reads on white slides and survives
  washed-out projectors, the light 300 shade reads on dark boards even when
  a projector lifts their black to gray), three pen widths.
  Ink lands exactly under the cursor at any window size, zoom, or letterboxing.
  While annotating, a subtle dashed outline marks the writable area (the slide
  box — themable via `--aht-edge`), on boards too.
- 🖼️ **Board slides** — insert a blank whiteboard (or flip it to a dark
  blackboard) as a *real slide* after the current one. The board keeps the
  **deck's slide format**: surface and writable area are the slide box, just
  like any other slide — so boards look and print exactly like your slides.
  It shows in the overview, the speaker view and the PDF export, and it's
  uncounted, so the audience-visible slide numbers don't shift.
- 🧭 **Bottom-left toolbar** — prev/next, slide overview, speaker view,
  fullscreen, annotate, download/print, and a slide counter. Decks with **vertical slides**
  automatically get a small up/down arrow cluster between prev and next, laid
  out like laptop arrow keys — it only appears on slides that actually have a
  vertical route. The toolbar shows when the mouse nears the corner, hides
  when it leaves; slides get the whole screen. Prev/next behave like the
  cursor keys (fragments + horizontal); the cluster handles vertical moves.
- 📱 **Touch-ready** — toolbar stays visible on no-hover devices, tap the
  left/right half to navigate, swipe works (reveal built-in), draw with a
  finger or stylus. **Palm rejection**: once a stylus is used, bare touches no
  longer draw and can't trigger iOS text-selection callouts — rest your palm.
- 💾 **Persistent ink that survives deck edits** — strokes are keyed to slides
  by *content*, not slide number: insert, remove or reorder slides later and
  every annotation stays on the slide it was drawn on. Strokes survive refresh
  (localStorage, per deck) and window resizing, and keep their shape if you
  change the deck's aspect ratio (aspect-fit, not stretched).
- 📄 **Save, share & export to PDF** — the toolbar's download/print menu saves
  a self-contained HTML copy of the deck (clean, or **annotated** with ink and
  plugin embedded — the file opens anywhere) and exports to **PDF** with the
  ink as crisp SVG vectors, or without it: one click opens reveal's print view
  and the browser's print dialog.
- 🪟 **Speaker-view sync** — ink *and board slides* sync across same-origin
  windows (storage event): draw in the speaker view, the audience screen
  updates — and vice versa. (Requires `persist: true`; simultaneous drawing in
  two windows is last-write-wins.)
- 🧲 **Movable annotation toolbar** — drag it by its grip handle anywhere on
  screen, or minimize it to a tiny handle; position is remembered per deck.
- 🛡️ **Confirmation before anything destructive** — deleting a board slide
  or clearing the whole deck always asks first. Everything else has undo/redo.

## Install

Copy `reveal-autohide-toolbar.js` next to your deck (or use a CDN URL once released):

```html
<script src="reveal-autohide-toolbar.js"></script>
<script>
  Reveal.initialize({
    controls: false,       // recommended: the toolbar replaces the arrows
    slideNumber: false,    // ...and the slide number
    plugins: [ RevealAutohideToolbar ],
  });
</script>
```

That's it — the plugin injects its own CSS and cursors.

### Recommended deck setup — and who controls what

Three separate layers decide how PPT-like a reveal deck feels. Keeping them
apart avoids a lot of confusion:

| Layer       | Controls                                            | Where |
| ----------- | --------------------------------------------------- | ----- |
| **config**  | geometry: aspect ratio, margin, scaling             | `Reveal.initialize({ … })` |
| **theming** | colours & fonts — including the letterbox colour    | CSS |
| **plugin**  | behaviour: toolbar, ink, boards, download/print     | this file |

**Config.** reveal's defaults (`960×700`, ~4:3, 4% margin, growth capped at
2×) date from 2011; PowerPoint, Google Slides, Keynote and Slidev all default
to 16:9 with no margin. To match:

```js
Reveal.initialize({
  width: 960, height: 540,  // 16:9 — exactly PowerPoint's slide in points
                            // (13.333in × 7.5in at 72pt/in): PPT coordinates
                            // convert 1pt → 1px
  margin: 0,                // edge-to-edge, like PPT (reveal default: 0.04)
  maxScale: 4,              // default 2 stops growing at 1920×1080 and leaves
                            // fat letterbox bars on large/hi-dpi displays
});
```

`width×height` is a coordinate system, not a resolution: text is vector and
stays sharp at any scale — larger numbers would only shrink the theme's
px-based font sizes.

**Theming.** PowerPoint, Keynote and Google Slides paint black bars when the
screen's aspect ratio doesn't match the slide's. reveal never shows a
letterbox — it paints the theme / slide background across the whole viewport.
If your audience expects the PPT look, plain CSS restores it:

```css
@media screen {
  html:not(.print-pdf) .reveal-viewport { background: #000; }         /* the bars */
  html:not(.print-pdf) .reveal .slides {                              /* the slide */
    background: var(--r-background-color, #fff);
  }
  /* keep data-background slides (colour/gradient/image/video) inside the same
     box — reveal would paint them across the whole viewport. Assumes the
     16:9 + margin:0 config above; drop this rule if you prefer full-bleed. */
  html:not(.print-pdf) .reveal > .backgrounds {
    width: min(100vw, calc(100vh * 16 / 9));
    height: min(100vh, calc(100vw * 9 / 16));
    top: 50%; left: 50%; transform: translate(-50%, -50%);
  }
  /* ...and let them show through the slide-box backdrop */
  .reveal:has(section.present[data-background], section.present[data-background-color],
              section.present[data-background-gradient], section.present[data-background-image],
              section.present[data-background-video], section.present[data-background-iframe])
    .slides { background: transparent; }
}
```

Two details worth knowing. reveal deliberately paints a slide's
`data-background` across the *entire viewport*, not just the slide box — the
`.backgrounds` rule reins that in so background slides respect the bars like
everything else (delete it to get reveal's full-bleed behaviour back, e.g.
for video walls). And the `html:not(.print-pdf)` scope is not cosmetic:
reveal's print view copies the viewport's *computed* background onto every
PDF page, so an unscoped black viewport would print black pages. (For the
plugin's own colours — accent, toolbar, dashed edge, board surface — see
[Theming](#theming) below.)

**Plugin.** Nothing above needs this plugin — it adds behaviour only, and
adapts to whatever geometry and theme you pick. Ink is stored relative to the
slide box, so `margin`, `maxScale` and window size can change at any time
without touching your annotations. **Pick the aspect ratio before you
annotate**, though — switching e.g. 4:3 → 16:9 later stretches the slide box
and existing strokes would distort relative to the content.

The demo deck uses exactly this setup: 16:9 + `margin: 0` + `maxScale: 4`
(config) and the black-bar letterbox (theming).

## Controls

| Key            | Action                                             |
| -------------- | -------------------------------------------------- |
| `A`            | Annotate on/off (draw over the current slide)      |
| `E`            | Eraser (removes only the strokes you touch)        |
| `Ctrl`+`Z`     | Undo last stroke                                   |
| `Ctrl`+`Shift`+`Z` | Redo                                           |
| `X`            | Clear all ink on this slide                        |
| `Shift`+`X`    | Clear ink on **all** slides (asks first)           |
| `Esc`          | Exit annotation                                    |

The annotation toolbar (bottom-centre while drawing) has the same actions as
buttons, plus colour swatches, pen widths, undo/redo, a broom that sweeps the
current slide clean, the board buttons, and a broom-with-sparkle that clears
the whole deck (with confirmation).

On **touch devices** the navigation toolbar is always visible; tap ✏️ to draw.
Taps on links, buttons, form fields, video/iframe — or anything matching the
`tapIgnore` selector, including `[data-aht-no-tap]` — never navigate.

## Board slides

Press the board button (a board with a **+**) while annotating and a blank
**whiteboard slide** is inserted after the current slide — a real `<section>`,
so the overview, the speaker view, transitions and the PDF export all treat it
as one. It's marked `data-visibility="uncounted"`, so reveal's slide numbers
don't shift for the audience. The board keeps the **deck's slide format**:
its surface and writable area are exactly the slide box, like any other slide
— what you write fits the same frame your slides (and their PDF pages) use.
Entering a board auto-enables the pen; leaving it puts the pen away again.

While on a board:

- the **surface toggle** flips it between whiteboard (white, the default) and
  blackboard (dark, themeable via `--aht-board-bg`; make dark the default with
  `boardSurface: 'dark'`) — the pen colour automatically swaps to stay visible
  on either surface;
- the board button shows the board **crossed out** and turns into **remove
  this board** (with confirmation — its ink is deleted with it).

Boards persist like ink does: reload the deck and they're back, in place, with
their drawings.

## Saving, sharing & PDF export

Ink lives in localStorage by default — per browser, per deck. Everything that
takes it further sits in one place: the toolbar's **download/print menu**
(the printer/download button), with four choices:

- **Save a copy** — a single, self-contained HTML file of your deck *without*
  ink (any embedded annotations are stripped) — the clean, shareable deck.
- **💾 Save annotated copy** — the same single file, with the ink (and boards)
  embedded **and the plugin source inlined**, so the file opens anywhere —
  double-clicked from a Downloads folder included. (Keep reveal itself on
  absolute/CDN URLs; relative reveal assets can't travel with a single file.)
  Saving needs the deck served over http(s) — on `file://` this choice falls
  back to a JSON export of the ink.
  Technically the ink is stored in a
  `<script type="application/json" data-aht-annotations>` block; you can also
  add such a block to a deck by hand to ship baseline annotations with it.
  Local edits always win over the embedded baseline, and a confirmed
  *clear all* keeps it suppressed.
- **PDF / print with ink** — opens reveal's
  [print view](https://revealjs.com/pdf-export/) in a new tab (your running
  talk is untouched) and pops the browser's print dialog by itself: choose
  *Save as PDF* — and enable *background graphics*, or board slides and
  background colours come out white. Every annotation is rendered as a crisp
  **SVG vector overlay** on its slide, and board slides print as real
  dark/white pages. Chromium-based browsers paginate reveal's print view most
  reliably (reveal's own recommendation).
- **PDF / print clean** — the same, without ink or boards.

Under the hood the PDF choices are just URLs — `?print-pdf&aht-print=1`
(+`&aht-ink=0` for clean), so they script and bookmark well. `?aht-ink=0`
works for presenting, too: it hides all stored and embedded ink for that
session without deleting anything.

## Options

Pass an `autohideToolbar` object to `Reveal.initialize` (everything is optional):

```js
Reveal.initialize({
  plugins: [ RevealAutohideToolbar ],
  autohideToolbar: {
    colors: ['#FFFFFF','#8E8E93','#000000','#B91C1C', /* … */], // swatch palette
    defaultColor: '#B91C1C',
    widths: { thin: 3, med: 6, thick: 11 },  // name → px
    defaultWidth: 6,
    eraserRadius: 16,                        // px hit radius
    persist: true,                           // save ink to localStorage
    storageKey: 'aht:' + location.pathname,
    annotations: true,                       // false = present clean (like ?aht-ink=0)
    tapToAdvance: true,                      // touch: tap halves to navigate
    tapIgnore: 'a, button, …, [data-aht-no-tap]',  // taps here never navigate
    // toolbar items, in order ('sep' = divider; 'updown' = vertical arrow
    // cluster, only shown on slides that have a vertical route; 'export' =
    // the download/print menu):
    tools: ['prev','updown','next','sep','overview','speaker','fullscreen','sep','annotate','export','slideno'],
    // upgrading a custom tools array from ≤0.3? Add 'updown' — ◀/▶ behave like
    // the ←/→ cursor keys now and no longer descend into vertical stacks.
    position: 'bottom-left',   // or 'bottom-right' (e.g. when reveal.js-menu owns the left corner)
    toggleKey: 'a',            // annotation key; change on autoSlide decks (core uses A for pause)
    palmRejection: true,       // after first stylus use, bare touches stop drawing
    boardSurface: 'white',     // new board slides: 'white' or 'dark'
  },
});
```

A small runtime API is exposed on `window.AutohideToolbar`: `toggle()`, `enable(bool)`,
`setTool('pen'|'eraser')`, `setColor(hex)`, `undo()`, `clearSlide()`, `clearAll()`,
`redo()`, `addBoard()`, `removeBoard()`, `toggleSurface()`, `saveCopy(withInk)`,
`printPdf(withInk)` — the latter two default to *with ink*; pass `false` for the
clean variant. (The API acts directly — the confirmation dialogs live in the UI
paths only.)

### How ink is keyed to slides

Each slide's annotations are stored under a stable key, resolved in this order:
an explicit `<section id="…">` → a `data-aht-id` attribute → a fingerprint of
the slide's text content. That's why deck edits don't displace ink. Two
consequences worth knowing: rewriting a slide's *content* detaches its ink
(kept in storage, not deleted — revert the edit and it returns), and if you
plan heavy editing you can make keys fully edit-proof by giving sections `id`s.
Storage from versions before 0.3 (index-keyed) is migrated automatically.

## Theming

CSS custom properties, set on `:root` in your deck (values shown are the defaults):

```css
:root {
  --aht-accent: #E31937;               /* active-tool highlight */
  --aht-font: 'Open Sans', system-ui, sans-serif;
  --aht-panel-bg: rgba(10,18,34,.82);  /* navigation toolbar */
  --aht-bar-bg: rgba(6,18,42,.92);     /* annotation toolbar */
  --aht-board-bg: #000000;             /* blackboard colour */
  --aht-edge: rgba(125,135,155,.55);   /* dashed writable-area outline while annotating */
  --aht-z: 30;                         /* base z-index */
}
```

## Testing

The repo ships an automated Playwright suite (`npm install && npm test`) that
runs as a **matrix: {Chromium, WebKit} × {reveal 5.2.1, reveal 6.0.1}** —
about 50 tests per cell, ~200 total. The test server rewrites the pinned
reveal CDN version in every served page (including reveal 6's moved plugin
paths), so one set of fixtures covers every reveal version. Covered:
pixel-probed ink, eraser/undo, persistence and migration, stable-key behaviour
under deck edits, board slides, two-window speaker sync, print/scroll views,
touch emulation, options fixtures, and `destroy()`. It also smoke-tests
**real-world decks** vendored from `hakimel/reveal.js@5.2.1` (MIT) in
`test/decks/` — the official demo (vertical stacks, fragments, markdown,
highlight), the MathJax example, and the auto-animate example — including a
fragments-heavy `?print-pdf` run. The same suite runs in CI on every push.
Artifacts (log, JSON, screenshots) land in `test/artifacts/`.

## Robustness / test checklist

What the plugin is built to survive (and what to re-verify after changes):

1. **Resize / letterbox** — draw, then resize the window to extreme shapes: ink
   stays glued to slide content.
2. **Format change** — draw a circle, change `width`/`height` (e.g. 16:9 → 4:3,
   see the demo's buttons): the circle stays circular, centred (aspect-fit).
3. **Persistence** — reload: ink and board slides return. `Shift+X` (after
   confirmation) wipes deck + storage and keeps an embedded baseline suppressed.
4. **Deck edits** — insert/remove/reorder slides in the HTML: ink follows its
   slide (content-based keys); pre-0.3 index-keyed storage is migrated.
5. **Navigation** — leave a slide and return (with and without the annotation
   toolbar open): ink reappears.
6. **Overview** (`O`/`Esc`) — canvas and chrome hide; taps in overview don't navigate.
7. **Print/PDF** — `?print-pdf`: no plugin chrome, ink prints as SVG overlays,
   board slides print as pages; `&aht-ink=0` prints clean.
8. **Scroll view** (`?view=scroll`) — plugin disables itself.
9. **Touch** — swipe, tap-halves, persistent toolbar, finger/stylus drawing;
   taps on links/buttons don't navigate.
10. **Safari** — toolbar icons render (SVG carries `xmlns`); pen/eraser cursors
    render as shapes (verified on current macOS Safari); older browsers fall
    back to `crosshair`/`cell`.
11. **DPI changes** — drag the window to a different-DPI monitor or change
    browser zoom: canvas re-places crisply.
12. **Vertical stacks** — every leaf section gets its own key, so decks with
    vertical slides work.
13. **Custom config** — non-default palette (luminance logic handles any colours),
    subset `tools`, `persist:false`, `annotations:false`.

## Prior art & motivation

reveal.js core is very much alive (6.0 shipped in 2026), but it deliberately keeps
presenting chrome out of core — a built-in chalkboard was requested as far back as
[hakimel/reveal.js#1928](https://github.com/hakimel/reveal.js/issues/1928) and left
to plugins. The plugins that filled the gap have since gone quiet:

- **[rajgoel/reveal.js-plugins](https://github.com/rajgoel/reveal.js-plugins)**
  (chalkboard, customcontrols, …) — the de-facto annotation standard, last released
  mid-2025. Long-standing pain points motivated this plugin: ink offset under
  scaled/letterboxed layouts, drawing on a board that hides the slide, clear-all-only
  deletion, and open touch issues
  ([#186 palm rejection](https://github.com/rajgoel/reveal.js-plugins/issues/186),
  [#149 mobile eraser](https://github.com/rajgoel/reveal.js-plugins/issues/149)).
  Each reveal major also required plugin updates
  ([#85](https://github.com/rajgoel/reveal.js-plugins/issues/85),
  [#194](https://github.com/rajgoel/reveal.js-plugins/issues/194)).
- **[denehyg/reveal.js-toolbar](https://github.com/denehyg/reveal.js-toolbar)** and
  **[denehyg/reveal.js-menu](https://github.com/denehyg/reveal.js-menu)** — the
  button-toolbar and slide-menu plugins, both **archived on 2026-01-31**.

This plugin is a maintained successor to both categories in one file: the toolbar
(with auto-hide, which denehyg's never had) plus annotation (with per-stroke
eraser/undo and correct cursor mapping, which chalkboard never had), plus the
touch behaviour (pointer-events based, so styluses and palms behave), with no
dependencies and no separate CSS to include.

## Standards compliance

Follows the [official plugin API](https://revealjs.com/creating-plugins/):

- registered as the recommended **factory function** returning `{ id, init, destroy }`
  (the bare-object style also works — `id`/`init`/`destroy` are attached);
- implements **`destroy()`**: removes every listener, DOM node, injected style,
  and timer when the deck is uninitialized;
- ships a **classic script** (`reveal-autohide-toolbar.js`, sets
  `window.RevealAutohideToolbar`) *and* an **ES module** entry
  (`reveal-autohide-toolbar.mjs`, default export) wired via `package.json#exports`;
- respects the deck's **`keyboard: false`** config and announces its shortcuts in
  reveal's `?` help overlay.

## Compatibility with other plugins

- **Built-ins** (notes, highlight, markdown, math, search, zoom): no conflicts.
  Notes is actively integrated (the 🗣 button calls `getPlugin('notes').open()`);
  zoom's `Alt`+click and search's `Ctrl+Shift+F` don't collide with our keys.
- **reveal core keys**: `A` is used by core to pause **autoSlide** decks — on such
  decks set `toggleKey` to something else. `O`/`Esc`/`F`/`S` are used *by* our
  toolbar buttons, not redefined.
- **[reveal.js-menu](https://github.com/denehyg/reveal.js-menu)** (archived but
  widely deployed): its open button sits bottom-left — set our
  `position: 'bottom-right'` (or the menu's `side: 'right'`) to avoid overlap.
  Menu panel links are `<a>`, so tap-to-advance already ignores them.
- **rajgoel chalkboard**: don't combine — two drawing layers fight for the same
  pointer events; this plugin is meant as its replacement. (If you must: chalkboard
  binds `b`/`c`/`d`/`x`/`y`; our `e`/`x` are only active while annotating.)
- **rajgoel customcontrols**: sits bottom-right — compatible with our default
  bottom-left position.

## reveal.js compatibility

Tested in CI against reveal.js **5.2.1** (last 5.x) *and* **6.0.1** — the full
suite runs as a {Chromium, WebKit} × {5.x, 6.x} matrix. The plugin uses only
the stable plugin API (`{id, init, destroy}`, `getConfig`, events), which is
also present in **4.x** (version-dependent calls like `isPrintView` are
feature-detected with fallbacks). Not compatible with reveal 3. Note that
reveal 6 moved its own plugin files (`plugin/notes/notes.js` →
`dist/plugin/notes.js`) — that affects your deck's `<script>` tags, not this
plugin.

**Scroll view caveat:** reveal switches to scroll view *automatically* on viewports
narrower than 435 px — i.e. portrait phones — and this plugin deliberately stays
inactive in scroll view (a single overlay canvas can't track the continuously
scrolling, stacked-slides layout). If you want the toolbar/ink on phones, keep the
deck in slide mode with:

```js
Reveal.initialize({ scrollActivationWidth: 0, /* … */ });
```

## Known limitations

- **Single, full-viewport deck.** Not yet multi-deck / embedded-safe: UI is
  appended to `<body>`, listeners are document-level.
- **Scroll view** (`view: 'scroll'`) — plugin disables itself (see above).
- **Older browsers may show keyword cursors** (`crosshair`/`cell`) instead of
  the pen/eraser shapes — the SVG cursors render fine in current Chrome,
  Firefox, and Safari (Safari verified manually on macOS).
- **Live ink is per-browser** (localStorage) and private windows forget it —
  use *save annotated copy* to move or archive annotations.
- **Rewriting a slide's content detaches its ink** (content-based keys). The
  ink stays in storage and returns if the edit is reverted; explicit section
  `id`s make keys immune to content edits.
- **`Cmd/Ctrl+P` on the live view** prints without ink — use the toolbar's
  download/print menu (or `?print-pdf` by hand, reveal's own export path) for
  the annotated PDF.
- **Don't change the deck's aspect ratio after annotating.** Strokes live in
  slide-box coordinates: resizing the window, `margin` or `maxScale` is always
  safe, but switching `width`/`height` to a different ratio (4:3 → 16:9)
  stretches existing ink relative to the content.

## Licence

MIT. Toolbar icons are from [lucide](https://lucide.dev) (ISC).
