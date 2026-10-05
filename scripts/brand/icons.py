"""Icon SVGs for the web app and the Bantaba Host phone app. Run logo.py first."""
import json, os
os.makedirs('icons', exist_ok=True)
ic = json.load(open('icon.json'))
PLUM, SPOT, INK, SKY, WHITE = '#3B0764', '#FACC15', '#0F172A', '#60A5FA', '#FFFFFF'

def stub(stub_col, text_col, cut=None, box=(120, 80, 880, 920)):
    """The ticket stub with "ba": notches and a dotted tear line near the bottom. `cut` = colour of what's behind (notches, dots), or None to cut through (mask)."""
    x0, y0, x1, y1 = box
    ty = 660
    if cut is None:
        return (f'<defs><mask id="m"><rect x="0" y="0" width="1000" height="1000" fill="#fff"/>'
                f'<circle cx="{x0}" cy="{ty}" r="70" fill="#000"/><circle cx="{x1}" cy="{ty}" r="70" fill="#000"/>'
                f'<line x1="{x0 + 110}" y1="{ty}" x2="{x1 - 110}" y2="{ty}" stroke="#000" stroke-width="30" stroke-linecap="round" stroke-dasharray="0 62"/>'
                + (f'<path d="{ic["ba"]}" fill="#000"/>' if text_col is None else '') + '</mask></defs>'
                f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="120" fill="{stub_col}" mask="url(#m)"/>'
                + (f'<path d="{ic["ba"]}" fill="{text_col}"/>' if text_col else ''))
    return (f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="120" fill="{stub_col}"/>'
            f'<circle cx="{x0}" cy="{ty}" r="70" fill="{cut}"/><circle cx="{x1}" cy="{ty}" r="70" fill="{cut}"/>'
            f'<line x1="{x0 + 110}" y1="{ty}" x2="{x1 - 110}" y2="{ty}" stroke="{cut}" stroke-width="30" stroke-linecap="round" stroke-dasharray="0 62"/>'
            f'<path d="{ic["ba"]}" fill="{text_col}"/>')

def svg(inner, bg=None, rx=0):
    b = f'<rect width="1000" height="1000" rx="{rx}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">{b}{inner}</svg>'

def scaled(inner, s):
    o = (1000 - 1000 * s) / 2
    return f'<g transform="translate({o} {o}) scale({s})">{inner}</g>'

out = {
    # web: the browser tab icon is the stub alone (no tile), so it fills the 16 px square
    'web-icon.svg': svg(stub(SPOT, PLUM, None, (60, 40, 940, 960)).replace('rx="120"', 'rx="140"')),
    'web-apple-icon.svg': svg(scaled(stub(SPOT, PLUM, PLUM), 0.78), PLUM),
    # staff/organizer app (Bantaba Host): ink with the sky-blue stub
    'm-icon.svg': svg(scaled(stub(SKY, INK, INK), 0.78), INK),
    'm-fg.svg': svg(scaled(stub(SKY, INK, INK), 0.58)).replace('fill="#0F172A"/><circle', 'fill="#0F172A"/><circle'),
    'm-bg.svg': svg('', INK),
    'm-mono.svg': svg(scaled(stub(WHITE, None, None), 0.58)),
    'm-splash.svg': svg(scaled(stub(SKY, INK, None), 0.5)),  # ink text drawn, notches cut
    'm-favicon.svg': svg(stub(SKY, INK, None, (60, 40, 940, 960)).replace('rx="120"', 'rx="140"')),
}
# The adaptive-icon foreground sits on the ink background layer, so its cuts can be ink.
for k, v in out.items():
    open(f'icons/{k}', 'w').write(v)
print('ok')
