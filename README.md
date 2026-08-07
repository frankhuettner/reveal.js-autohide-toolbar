# reveal.js-autohide-toolbar

**▶ [Try the live demo](https://huettner.io/reveal.js-autohide-toolbar/demo/)** —
draw on the slides, insert a board slide, save an annotated copy, switch the
deck format, all in your browser.

A presenter toolkit for [reveal.js](https://revealjs.com), in one dependency-free
file: **ink annotation** over your slides plus a **Slidev-style auto-hiding
toolbar** with everything you need at the podium.

- ✏️ **Annotate slides** — pen, true per-stroke eraser, undo, colour palette
  (PowerPoint "Standard Colors"), three pen widths.
  Ink lands exactly under the cursor at any window size, zoom, or letterboxing.
- 🖼️ **Board slides** — insert a blank blackboard (or flip it to a whiteboard)
  as a *real slide* after the current one: it shows in the overview, the
  speaker view and the PDF export, and it's uncounted, so the audience-visible
  slide numbers don't shift.
- 🧭 **Bottom-left toolbar** — prev/next, slide overview, speaker view,
  fullscreen, annotate, and a slide counter. Appears when the mouse nears the
  corner, hides when it leaves; slides get the whole screen.
- 📱 **Touch-ready** — toolbar stays visible on no-hover devices, tap the
  left/right half to navigate, swipe works (reveal built-in), draw with a
  finger or stylus. **Palm rejection**: once a stylus is used, bare touches no
  longer draw and can't trigger iOS text-selection callouts — rest your palm.
- 💾 **Persistent ink that survives deck edits** — strokes are keyed to slides
  by *content*, not slide number: insert, remove or reorder slides later and
  every annotation stays on the slide it was drawn on. Strokes survive refresh
  (localStorage, per deck) and window resizing, and keep their shape if you
  change the deck's aspect ratio (aspect-fit, not stretched).
- 📄 **Save, share & export to PDF** — save a self-contained **annotated copy**
  of the deck (ink embedded in the HTML file), export/import the ink as JSON,
  and in reveal's `?print-pdf` view the ink prints as **crisp SVG vectors**.
- 🪟 **Speaker-view sync** — ink *and board slides* sync across same-origin
  windows (storage event): draw in the speaker view, the audience screen
  updates — and vice versa. (Requires `persist: true`; simultaneous drawing in
  two windows is last-write-wins.)
- 🧲 **Movable annotation toolbar** — drag it by its grip handle anywhere on
  screen, or minimize it to a tiny handle; position is remembered per deck.
- 🛡️ **Confirmation before anything destructive** — deleting a board slide,
  clearing the whole deck, or overwriting ink by import always asks first.

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

## Controls

| Key            | Action                                             |
| -------------- | -------------------------------------------------- |
| `A`            | Annotate on/off (draw over the current slide)      |
| `E`            | Eraser (removes only the strokes you touch)        |
| `Ctrl`+`Z`     | Undo last stroke                                   |
| `X`            | Clear ink on this slide                            |
| `Shift`+`X`    | Clear ink on **all** slides                        |
| `Esc`          | Exit annotation                                    |

The annotation toolbar (bottom-centre while drawing) has the same actions as
buttons, plus colour swatches, pen widths, the board button, and the
save/export/import buttons.

On **touch devices** the navigation toolbar is always visible; tap ✏️ to draw.
Taps on links, buttons, form fields, video/iframe — or anything matching the
`tapIgnore` selector, including `[data-aht-no-tap]` — never navigate.

## Board slides

Press the board button while annotating and a blank **blackboard slide** is
inserted after the current slide — a real `<section>`, so the overview, the
speaker view, transitions and the PDF export all treat it as one. It's marked
`data-visibility="uncounted"`, so reveal's slide numbers don't shift for the
audience. Entering a board auto-enables the pen; leaving it puts the pen away
again.

While on a board:

- the **surface toggle** flips it between blackboard (dark, themeable via
  `--aht-board-bg`) and **whiteboard** (white) — the pen colour automatically
  swaps to stay visible on either surface;
- the board button turns into **remove this board** (with confirmation — its
  ink is deleted with it).

Boards persist like ink does: reload the deck and they're back, in place, with
their drawings.

## Saving, sharing & PDF export

Ink lives in localStorage by default — per browser, per deck. Three ways to
take it further, all in the annotation toolbar:

- **💾 Save annotated copy** — downloads a single, self-contained HTML file of
  your deck with the ink (and boards) embedded. Open it anywhere and the
  annotations are there. The deck must be served over http(s) for this — on
  `file://` the button falls back to a JSON export. Technically the ink is
  stored in a `<script type="application/json" data-aht-annotations>` block;
  you can also add such a block to a deck by hand to ship baseline
  annotations with it. Local edits always win over the embedded baseline, and
  a confirmed *clear all* keeps it suppressed.
- **⬇️ / ⬆️ Export / import JSON** — move annotations between machines or
  archive them separately. Importing over existing ink asks first.
- **PDF export** — open the deck with
  [`?print-pdf`](https://revealjs.com/pdf-export/) and print to PDF as usual:
  every annotation is rendered as a crisp **SVG vector overlay** on its slide,
  and board slides print as real dark/white pages. To hand out a *clean* PDF
  instead, just add `&aht-ink=0`.

`?aht-ink=0` works for presenting, too: it hides all stored and embedded ink
for that session without deleting anything.

## Options

Pass an `autohideToolbar` object to `Reveal.initialize` (everything is optional):

```js
Reveal.initialize({
  plugins: [ RevealAutohideToolbar ],
  autohideToolbar: {
    colors: ['#FFFFFF','#000000','#C00000','#FF0000', /* … */], // swatch palette
    defaultColor: '#FF0000',
    widths: { thin: 3, med: 6, thick: 11 },  // name → px
    defaultWidth: 6,
    eraserRadius: 16,                        // px hit radius
    persist: true,                           // save ink to localStorage
    storageKey: 'aht:' + location.pathname,
    annotations: true,                       // false = present clean (like ?aht-ink=0)
    tapToAdvance: true,                      // touch: tap halves to navigate
    tapIgnore: 'a, button, …, [data-aht-no-tap]',  // taps here never navigate
    // toolbar items, in order ('sep' = divider):
    tools: ['prev','next','sep','overview','speaker','fullscreen','sep','annotate','slideno'],
    position: 'bottom-left',   // or 'bottom-right' (e.g. when reveal.js-menu owns the left corner)
    toggleKey: 'a',            // annotation key; change on autoSlide decks (core uses A for pause)
    palmRejection: true,       // after first stylus use, bare touches stop drawing
  },
});
```

A small runtime API is exposed on `window.AutohideToolbar`: `toggle()`, `enable(bool)`,
`setTool('pen'|'eraser')`, `setColor(hex)`, `undo()`, `clearSlide()`, `clearAll()`,
`addBoard()`, `removeBoard()`, `toggleSurface()`, `exportJSON()`, `saveCopy()`.
(The API acts directly — the confirmation dialogs live in the UI paths only.)

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
  --aht-board-bg: #0d1b2a;             /* blackboard colour */
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
  use *save annotated copy* or the JSON export to move or archive annotations.
- **Rewriting a slide's content detaches its ink** (content-based keys). The
  ink stays in storage and returns if the edit is reverted; explicit section
  `id`s make keys immune to content edits.
- **`Cmd/Ctrl+P` on the live view** prints without ink — use `?print-pdf` for
  the annotated PDF (that's reveal's own export path).

## Licence

MIT. Toolbar icons are from [lucide](https://lucide.dev) (ISC).
