"""Draws the Bantaba wordmark (G4, "the name as a ticket") as SVG paths from
Bricolage Grotesque 800, for apps/web/components/Logo.tsx and the icons.

  npm pack @fontsource/bricolage-grotesque && tar xzf fontsource-bricolage-grotesque-*.tgz
  pip install fonttools brotli
  python3 logo.py      # writes geo.json (wordmark) and icon.json ("ba" for the icons)
  python3 icons.py     # writes the icon SVGs into ./icons
  node render-icons.js # renders the PNGs (needs Playwright)

Then paste geo.json's values into Logo.tsx and copy the icons into place
(docs/brand.md, "Logo").
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import json
f = TTFont('package/files/bricolage-grotesque-latin-800-normal.woff')
gs = f.getGlyphSet(); cmap = f.getBestCmap()
LS = -30
def run(text, x0, baseline, scale=1.0):
    pen = SVGPathPen(gs, ntos=lambda v: f'{v:.1f}'.rstrip('0').rstrip('.'))
    x = x0
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (scale, 0, 0, -scale, x, baseline))
        gs[g].draw(tp)
        x += (gs[g].width + LS) * scale
    return pen.getCommands(), x - LS * scale - x0
H = 1020
banta_d, banta_w = run('banta', 0, 863)
gap = 100; TW = 1320; R = 160; N = 130
tx = banta_w + gap
_, ba_w0 = run('ba', 0, 0, 0.9)
ba_x = tx + (TW - ba_w0) / 2 + N * 0.25
ba_d, _ = run('ba', ba_x, 828, 0.9)
W = tx + TW
geo = dict(W=round(W, 1), H=H, banta=banta_d, tagX=round(tx, 1), tagW=TW, tagR=R, notch=N, ba=ba_d)
json.dump(geo, open('geo.json', 'w'))
print(W, banta_w, ba_w0)
# Icon: the stub alone, upright, "ba" inside, tear line + notches on the sides near the bottom (as the app icon drafts)
# 1000x1000 box
ib_d, ib_w = run('ba', 0, 0, 0.62)
ix = (1000 - ib_w) / 2
icon_ba, _ = run('ba', ix, 560, 0.62)
json.dump(dict(ba=icon_ba), open('icon.json', 'w'))
print('icon ba width', ib_w)
