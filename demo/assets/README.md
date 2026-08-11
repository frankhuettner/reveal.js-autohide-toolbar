# Cover background

The cover art is an **inline `<svg>`** in `../index.html`. The source is
**`title-bg.svg`** in this folder — an Inkscape vector illustration (~80 KB, 425
paths). It's **minified with svgo** down to **`title-bg.min.svg`** (~53 KB) and
those paths are pasted into a **hidden sprite** — `<svg …><defs><g id="cover-art">
…</g></defs></svg>` — parked at the **end of `<body>`**, so the ~24 K tokens of path
data stay out of the readable deck. The title slide draws it with a one-liner:
`<svg class="title-art" …><use href="#cover-art"/></svg>`. Still one file, no image
asset, crisp at any size. The deck ships **no raster image** at all.

### Reproduce / re-minify after editing `title-bg.svg`

```bash
cd assets
export npm_config_cache=/tmp/npmcache-aht   # avoids a ~/.npm perms issue
cat > /tmp/svgo-aht.mjs <<'CFG'
export default {
  multipass: true, floatPrecision: 2, transformPrecision: 2,
  plugins: [
    { name: 'preset-default', params: { overrides: { removeViewBox: false } } },
    'removeDimensions',   // drops width/height, keeps a viewBox so it scales full-bleed
  ],
};
CFG
npx --yes svgo -i title-bg.svg -o title-bg.min.svg --config /tmp/svgo-aht.mjs
```

Then paste the **inner** contents of `title-bg.min.svg` into the
`<g id="cover-art">…</g>` sprite at the end of `<body>` in `index.html`, and match
the `viewBox` on the visible `<svg class="title-art" …>` to whatever the minified
file reports. **Precision matters relative to the viewBox:** this source uses a tiny
mm coordinate space (~70 units wide), so `precision=2` keeps detail; `precision=0`
would round to integers and go blocky. A big-pixel viewBox (e.g. 1408×768) tolerates
`precision=0`. Bump precision if you see hairline seams.

## Swapping in a different illustration

Replace the contents of the `<g id="cover-art">` sprite with any other `<svg>`'s
inner markup, and set the visible `<svg class="title-art">` `viewBox` to match. Free
vector sources: **unDraw** <https://undraw.co>, **Humaaans** <https://humaaans.com>,
**SVGRepo** <https://svgrepo.com>. Minify anything large with the svgo recipe above.

## Using a photo instead (raster, inlined as a data URI)

If you'd rather have a photo cover, add `data-background-image` back to the
`.title-slide` section and inline the image so the deck stays one file:

```bash
cd ..                                   # into demo/
sips -s format jpeg -Z 1280 -s formatOptions 60 assets/your-photo.png --out /tmp/bg.jpg
python3 - <<'PY'
import base64, pathlib
uri = "data:image/jpeg;base64," + base64.b64encode(open('/tmp/bg.jpg','rb').read()).decode()
print("data URI is", len(uri)//1024, "KB — paste into a TITLE_BG const set before Reveal.initialize")
PY
```

`-Z 1280` + `formatOptions 60` keep the inlined blob ~120 KB so the HTML stays
small enough to edit. Keep the photo's subject in the upper two-thirds (the white
bands cover the lower third).

## Note on "single file"

The deck's own content — markup, styles, ink, and the cover art — all lives in
`index.html`. Shared **libraries** (reveal.js, Pretendard, Caveat, KaTeX) still
load from a CDN, like any web page. That's the honest scope of the one-file idea,
and it's stated on the closing slide.
